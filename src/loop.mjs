// The refresh loop: fetch on a cadence, keep the last good data, redraw only when the screen's
// content changed (and in live mode no more than every 2 minutes, since each refresh flashes).
import { fetchCurrent, fetchScoreboard } from './fetchers.mjs';
import { buildGames, pickView, gamesOn, isDone } from './model.mjs';
import { measureMetrics } from './metrics.mjs';
import { buildView } from './render.mjs';
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
// TODO(partial refresh): test refresh:'partial' on this panel; if it doesn't ghost, use it for live
// redraws (with a full refresh every 10th draw) and drop liveRedrawMs to one tick. Full only for now.
const REFRESH = 'full';

/**
 * createLoop({ config, device, fetchFn, clock, log }) -> { tick(): Promise<{view, redrew, reason, errors}> }
 */
export function createLoop({ config, device, fetchFn = fetch, clock = () => new Date() }) {
  const tz = config.timeZone;
  const s = { current: null, currentAt: 0, espn: new Map(), metrics: null, lastHash: null, lastViewKey: null, lastDrawAt: 0, needsDraw: true, dataAt: null };

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
        s.espn.set(key, { events: await fetchScoreboard(config.espnBase, key, fetchFn), at: now.getTime() });
        s.dataAt = now;
      } catch (e) {
        errors.push(e.message);
      }
    }
  }

  async function tick() {
    const now = clock();
    const errors = [];

    if (!s.current || now - s.currentAt >= CADENCE.currentMs) {
      try {
        s.current = await fetchCurrent(config.currentJsonUrl, fetchFn);
        s.currentAt = now.getTime();
        s.dataAt = now;
      } catch (e) {
        errors.push(e.message);
      }
    }
    if (!s.current) return { view: null, redrew: false, reason: 'no data yet', errors };

    // Decide the day from what we know, refresh ESPN for it (and the next ESPN date, since a late
    // west-coast kickoff can fall on the next Eastern date), then decide again with fresh scores.
    let games = buildGames(s.current, allEvents());
    let view = pickView(games, now, tz);
    if (view.kind === 'day') {
      const day = gamesOn(games, view.date, tz);
      const hot = day.some((g) => g.state === 'in' || (!isDone(g, now) && g.when - now < CADENCE.soonMs));
      await refreshEspn([view.date, addDays(view.date, 1)], hot ? CADENCE.espnHotMs : CADENCE.espnColdMs, now, errors);
    } else {
      const dates = [...new Set(s.current.allGames.map((g) => localDate(new Date(g.when), tz)))];
      await refreshEspn(dates, CADENCE.espnReviewMs, now, errors);
    }
    games = buildGames(s.current, allEvents());
    view = pickView(games, now, tz);

    try {
      s.metrics ??= await measureMetrics(device);
    } catch (e) {
      errors.push(e.message);
      s.needsDraw = true;
      return { view, redrew: false, reason: 'device unreachable', errors };
    }

    const ctx = { now, tz, pinnedTeam: config.pinnedTeam, week: s.current.meta?.currentWeek, metrics: s.metrics, measure: device.measure, updatedAt: s.dataAt };
    let built;
    try {
      built = await buildView(games, view, ctx);
    } catch (e) {
      errors.push(e.message);
      s.needsDraw = true;
      return { view, redrew: false, reason: 'build failed', errors };
    }

    const viewKey = JSON.stringify(view);
    const changed = built.hash !== s.lastHash || viewKey !== s.lastViewKey;
    let reason;
    if (s.needsDraw) reason = 'first draw / retry';
    else if (!changed) return { view, redrew: false, reason: 'unchanged', errors };
    else if (viewKey === s.lastViewKey && view.mode === 'live' && now - s.lastDrawAt < CADENCE.liveRedrawMs) {
      return { view, redrew: false, reason: 'changed, waiting (live redraw limit)', errors };
    } else reason = 'changed';

    try {
      await device.render(stripMeta(built.commands), { refresh: REFRESH });
      Object.assign(s, { lastHash: built.hash, lastViewKey: viewKey, lastDrawAt: now.getTime(), needsDraw: false });
      return { view, redrew: true, reason, errors };
    } catch (e) {
      errors.push(e.message);
      s.needsDraw = true;
      s.metrics = null; // re-measure once the device is back
      return { view, redrew: false, reason: 'draw failed', errors };
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
    const r = await loop.tick();
    const v = r.view ? (r.view.kind === 'review' ? 'view=review' : `view=${r.view.date} mode=${r.view.mode}`) : 'view=-';
    log(`${fmtTime(new Date(), tz)} ${v} redrew=${r.redrew ? 'y' : 'n'} ${r.reason}${r.errors.length ? ' | errors: ' + r.errors.join('; ') : ''}`);
    await new Promise((res) => setTimeout(res, CADENCE.tickMs));
  }
}
