// The refresh loop: fetch on a cadence, keep the last good data, redraw only when the screen's
// content changed (and in live mode no more than every 2 minutes, since each refresh flashes).
import { fetchCurrent, fetchScoreboard } from './fetchers.mjs';
import { buildGames, pickView, gamesOn, isDone, weekContext, visibleGames, weekendDone } from './model.mjs';
import { measureMetrics } from './metrics.mjs';
import { buildView, withReviewPage } from './render.mjs';
import { stripMeta } from './screens/common.mjs';
import { localDate, localHour, addDays, ymd, fmtTime } from './time.mjs';
import { makeSnapshot, reviveSnapshot, loadSnapshot, saveSnapshot, chooseView } from './recap.mjs';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

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

/** Overnight the device is left alone entirely (no draws, no requests): [startHour, endHour) local. */
export const DEFAULT_QUIET_HOURS = [23, 7];
export function isQuiet(now, tz, [start, end] = DEFAULT_QUIET_HOURS) {
  const h = localHour(now, tz);
  return start > end ? h >= start || h < end : h >= start && h < end;
}

/**
 * createLoop({ config, device, fetchFn, clock, log }) -> { tick(): Promise<{view, redrew, reason, errors}> }
 */
export function createLoop({ config, device, fetchFn = fetch, clock = () => new Date() }) {
  const tz = config.timeZone;
  const s = { snapshot: config.snapshotPath ? loadSnapshot(config.snapshotPath) : null, lastUptime: null, current: null, currentAt: 0, espn: new Map(), metrics: null, lastHash: null, lastViewKey: null, lastDrawAt: 0, needsDraw: true, dataAt: null };

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
    const visible = (all) => visibleGames(all, config.pinnedTeam, tz);
    let games = buildGames(s.current, allEvents());
    let view = pickView(visible(games), now, tz);
    if (view.kind === 'day') {
      const day = gamesOn(games, view.date, tz);
      const hot = day.some((g) => g.state === 'in' || (!isDone(g, now) && g.when - now < CADENCE.soonMs));
      await refreshEspn([view.date, addDays(view.date, 1)], hot ? CADENCE.espnHotMs : CADENCE.espnColdMs, now, errors);
    }
    // The recap needs the whole week's final scores, also when started after Saturday (e.g. an auto-update).
    if (view.kind !== 'day' || weekendDone(games, now, tz)) await refreshEspn(weekDates(), CADENCE.espnReviewMs, now, errors);
    // Forget scoreboards for dates no longer in this week's data (a Saturday is ~1 MB).
    const keep = new Set(weekDates().map(ymd));
    for (const k of s.espn.keys()) if (!keep.has(k)) s.espn.delete(k);
    games = buildGames(s.current, allEvents());
    view = pickView(visible(games), now, tz);

    // A finished weekend (Saturday all final, or nothing left to play) is saved, so the recap can stay
    // up after CFB HQ switches to next week on Sunday, until Tuesday noon. A stray Sunday game must not
    // hold it back: on 2026-11-15 one did, CFB HQ rolled over before it ended, and no recap was saved.
    if (view.kind === 'review' || weekendDone(games, now, tz)) {
      const snap = makeSnapshot(s.current, games, tz, now);
      if (snap.games.length && JSON.stringify(snap.games) !== JSON.stringify(s.snapshot?.games)) {
        s.snapshot = reviveSnapshot(JSON.parse(JSON.stringify(snap)));
        if (config.snapshotPath) {
          try { saveSnapshot(config.snapshotPath, snap); } catch (e) { errors.push(`saving recap: ${e.message}`); }
        }
      }
    }
    const choice = chooseView(view, s.snapshot, now, tz);
    view = withReviewPage(choice.view, now);
    const fromSnapshot = choice.recap === 'snapshot';
    games = fromSnapshot ? s.snapshot.games : view.kind === 'review' ? games : visible(games);
    const shown = view.kind === 'day' ? gamesOn(games, view.date, tz).length : games.length;
    const done = (r) => ({ ...r, games: shown });

    // Quiet hours: data keeps updating (so the weekend recap is still saved overnight), the device is left alone.
    if (isQuiet(now, tz, config.quietHours)) return done({ view, redrew: false, reason: 'quiet hours', errors });

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

    const ctx = { now, tz, pinnedTeam: config.pinnedTeam, ...(fromSnapshot ? s.snapshot.ctx : weekContext(s.current)), metrics: s.metrics, measure: device.measure, updatedAt: s.dataAt };
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

/**
 * A logger that prints to the console and to `path`, starting the file fresh (cleared) each run.
 * File lines carry the date too, since a run spans days. File errors never stop the dashboard.
 */
export function createLog(path, tz, { print = console.log, clock = () => new Date(), append = false } = {}) {
  let fileOk = !!path;
  if (fileOk) {
    try { mkdirSync(dirname(path), { recursive: true }); if (!append) writeFileSync(path, ''); } catch { fileOk = false; }
  }
  return (line) => {
    print(line);
    if (!fileOk) return;
    try { appendFileSync(path, `${localDate(clock(), tz)} ${line}\n`); } catch { /* keep running */ }
  };
}

/** Exit code that tells run.cmd "new code was committed: start me again". */
export const RESTART_EXIT_CODE = 75;

/** The commit this checkout is on, or throws (no git, not a repo, mid-commit). */
export function gitHead(root) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
}

/**
 * Remembers the commit the dashboard started on; each call returns {from, to} once HEAD has moved
 * to a different commit, else null. Any failure to read HEAD counts as "no update", never a restart.
 */
export function createUpdateCheck(readHead) {
  let start = null;
  try { start = readHead(); } catch { /* no git: never restarts */ }
  return () => {
    if (!start) return null;
    try {
      const now = readHead();
      return now && now !== start ? { from: start.slice(0, 7), to: now.slice(0, 7) } : null;
    } catch {
      return null;
    }
  };
}

/** Runs forever (Ctrl+C to stop), one line per tick to the console and the log file. */
export async function runLoop({ config, device, log = createLog(config.logPath, config.timeZone, { append: process.env.AINK_RESTART === '1' }), checkUpdate = createUpdateCheck(() => gitHead(config.root)) }) {
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
    // Checked between ticks, so a restart never interrupts a draw. run.cmd starts the new code at once.
    const update = checkUpdate();
    if (update) {
      log(`${fmtTime(new Date(), tz)} update found (${update.from} -> ${update.to}); restarting with the new code`);
      process.exit(RESTART_EXIT_CODE);
    }
    await new Promise((res) => setTimeout(res, CADENCE.tickMs));
  }
}
