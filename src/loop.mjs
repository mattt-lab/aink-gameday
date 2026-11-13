// The refresh loop: fetch on a cadence, keep the last good data, redraw only when the screen's
// content changed (and in live mode no more than every 2 minutes, since each refresh flashes).
import { fetchCurrent, fetchScoreboard } from './fetchers.mjs';
import { buildGames, pickView, gamesOn, isDone, weekContext } from './model.mjs';
import { measureMetrics } from './metrics.mjs';
import { buildView, withReviewPage } from './render.mjs';
import { stripMeta } from './screens/common.mjs';
import { localDate, addDays, ymd, fmtTime } from './time.mjs';

const MIN = 60 * 1000;
export const CADENCE = {
  tickMs: MIN,
  currentMs: 15 * MIN,
  espnHotMs: 0, // every tick while a game is live or about to start
  espnColdMs: 10 * MIN,
  espnReviewMs: 60 * MIN,
  liveRedrawMs: 2 * MIN,
  soonMs: 15 * MIN,
};
// Partial refresh was tested on this panel (aink-7.5, firmware 261016) on 2026-11-13: the device accepts
// refresh:'partial' but still does a full ~4.5 s flashing refresh, so full refresh + the 2-minute live limit stays.
const REFRESH = 'full';

/**
 * createLoop({ config, device, fetchFn, clock, log }) -> { tick(): Promise<{view, redrew, reason, errors}> }
 */
export function createLoop({ config, device, fetchFn = fetch, clock = () => new Date() }) {
  const tz = config.timeZone;
  const s = { lastUptime: null, current: null, currentAt: 0, espn: new Map(), metrics: null, lastHash: null, lastViewKey: null, lastDrawAt: 0, needsDraw: true, dataAt: null };

  const allEvents = () => {
    const byId = new Map();
    for (const { events } of [...s.espn.values()].sort((a, b) => a.at - b.at)) for (const e of events) byId.set(String(e.id), e);
    return [...byId.values()];
  };

  async function refreshEspn(dates, maxAgeMs, now, errors) {
    for (const d of dates) {
      const key = ymd(d);
      const have = s.espn.get(key);
      if (have && now - have.at < maxAgeMs && maxAgeMs > 0) continue;
      try {
        const events = await fetchScoreboard(config.espnBase, key, fetchFn);
        // An empty scoreboard mid-day is far more likely an ESPN hiccup than games vanishing.
        if (!events.length && have?.events.length) throw new Error(`ESPN ${key} returned no events; keeping previous`);
        s.espn.set(key, { events, at: now.getTime() });
        s.dataAt = now;
      } catch (e) {
        errors.push(e.message);
      }
    }
  }

  // Every local game date in this week's data, plus the next day (late west-coast kickoffs land on the next Eastern date).
  const weekDates = () => {
    const days = new Set();
    for (const g of buildGames(s.current, [])) {
      const d = localDate(g.when, tz);
      days.add(d).add(addDays(d, 1));
    }
    return [...days];
  };

  async function tick() {
    const r = await tickInner();
    return { games: 0, ...r };
  }

  async function tickInner() {
    const now = clock();
    const errors = [];

    if (!s.current || now - s.currentAt >= CADENCE.currentMs) {
      try {
        const fresh = await fetchCurrent(config.currentJsonUrl, fetchFn);
        buildGames(fresh, []); // only accept a document we can actually use
        s.current = fresh;
        s.currentAt = now.getTime();
        s.dataAt = now;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (!s.current) return { view: null, redrew: false, reason: 'no data yet', errors, games: 0 };

    // Decide the day from what we know, refresh ESPN for it (and the next ESPN date, since a late
    // west-coast kickoff can fall on the next Eastern date), then decide again with fresh scores.
    let games = buildGames(s.current, allEvents());
    let view = pickView(games, now, tz);
    if (view.kind === 'day') {
      const day = gamesOn(games, view.date, tz);
      const hot = day.some((g) => g.state === 'in' || (!isDone(g, now) && g.when - now < CADENCE.soonMs));
      await refreshEspn([view.date, addDays(view.date, 1)], hot ? CADENCE.espnHotMs : CADENCE.espnColdMs, now, errors);
    } else {
      await refreshEspn(weekDates(), CADENCE.espnReviewMs, now, errors);
    }
    // Forget scoreboards for dates no longer in this week's data (a Saturday is ~1 MB).
    const keep = new Set(weekDates().map(ymd));
    for (const k of s.espn.keys()) if (!keep.has(k)) s.espn.delete(k);
    games = buildGames(s.current, allEvents());
    view = withReviewPage(pickView(games, now, tz), now);
    const shown = view.kind === 'day' ? gamesOn(games, view.date, tz).length : games.length;
    const done = (r) => ({ ...r, games: shown });

    try {
      // A rebooted device shows its own "AInk Ready" screen; uptime going backwards means redraw now.
      if (device.health) {
        const h = await device.health();
        if (s.lastUptime != null && h.uptime_ms < s.lastUptime) { s.needsDraw = true; errors.push('device restarted; redrawing'); }
        s.lastUptime = h.uptime_ms;
      }
      s.metrics ??= await measureMetrics(device);
    } catch (e) {
      errors.push(e.message);
      s.needsDraw = true;
      return done({ view, redrew: false, reason: 'device unreachable', errors });
    }

    const ctx = { now, tz, pinnedTeam: config.pinnedTeam, ...weekContext(s.current), metrics: s.metrics, measure: device.measure, updatedAt: s.dataAt };
    let built;
    try {
      built = await buildView(games, view, ctx);
    } catch (e) {
      errors.push(e.message);
      s.needsDraw = true;
      return done({ view, redrew: false, reason: 'build failed', errors });
    }

    const viewKey = JSON.stringify(view);
    const changed = built.hash !== s.lastHash || viewKey !== s.lastViewKey;
    let reason;
    if (s.needsDraw) reason = 'first draw / retry';
    else if (!changed) return done({ view, redrew: false, reason: 'unchanged', errors });
    else if (viewKey === s.lastViewKey && view.mode === 'live' && now - s.lastDrawAt < CADENCE.liveRedrawMs) {
      return done({ view, redrew: false, reason: 'changed, waiting (live redraw limit)', errors });
    } else reason = 'changed';

    try {
      await device.render(stripMeta(built.commands), { refresh: REFRESH });
      Object.assign(s, { lastHash: built.hash, lastViewKey: viewKey, lastDrawAt: now.getTime(), needsDraw: false });
      return done({ view, redrew: true, reason, errors });
    } catch (e) {
      errors.push(e.message);
      s.needsDraw = true;
      s.metrics = null; // re-measure once the device is back
      return done({ view, redrew: false, reason: 'draw failed', errors });
    }
  }

  return { tick };
}

/** Runs forever (Ctrl+C to stop), one console line per tick. */
export async function runLoop({ config, device, log = console.log }) {
  const tz = config.timeZone;
  try {
    await device.health();
    log(`AInk found at ${config.deviceUrl}. Updating every 60 s; Ctrl+C to stop.`);
  } catch {
    log(`AInk not reachable at ${config.deviceUrl}, retrying every 60 s (Ctrl+C to stop).`);
  }
  process.on('SIGINT', () => { log('Stopped.'); process.exit(0); });
  const loop = createLoop({ config, device });
  for (;;) {
    let r;
    try {
      r = await loop.tick();
    } catch (e) {
      r = { view: null, redrew: false, reason: 'tick failed', errors: [e.message], games: 0 }; // screen keeps its last image
    }
    const v = r.view ? (r.view.kind === 'review' ? 'view=review' : `view=${r.view.date} mode=${r.view.mode}`) : 'view=-';
    log(`${fmtTime(new Date(), tz)} ${v} games=${r.games} redrew=${r.redrew ? 'y' : 'n'} ${r.reason}${r.errors.length ? ' | errors: ' + r.errors.join('; ') : ''}`);
    await new Promise((res) => setTimeout(res, CADENCE.tickMs));
  }
}
