// The weekend recap (Week in Review + Top 25) outlives CFB HQ's data: current.json switches to the
// next week when Sunday's poll comes out, so the finished week is saved here and shown until
// Tuesday noon (local). A game in progress always takes the screen.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { weekContext } from './model.mjs';
import { localDate, addDays } from './time.mjs';

export const CUTOFF_WEEKDAY = 2; // Tuesday
export const CUTOFF_HOUR = 12;   // noon, local

/** The Date that is `hour`:00 local time on calendar date `dateStr` in `tz`. */
export function localTime(dateStr, hour, tz) {
  const want = Date.parse(`${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`);
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const seen = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    t += want - seen;
  }
  return new Date(t);
}

/** First Tuesday strictly after the week's last game day, at noon local. */
export function recapCutoff(lastGameDate, tz) {
  const weekday = new Date(`${lastGameDate}T12:00:00Z`).getUTCDay();
  const days = (CUTOFF_WEEKDAY - weekday + 7) % 7 || 7;
  return localTime(addDays(lastGameDate, days), CUTOFF_HOUR, tz);
}

/** Snapshot of a finished week: its completed games plus what the recap screens need from current.json. */
export function makeSnapshot(current, games, tz, now) {
  const finals = games.filter((g) => g.completed);
  const lastGameDate = games.reduce((d, g) => { const x = localDate(g.when, tz); return x > d ? x : d; }, '');
  return { savedAt: now.toISOString(), lastGameDate, ctx: weekContext(current), games: finals };
}

export function reviveSnapshot(raw) {
  if (!raw?.games || !raw.ctx || !raw.lastGameDate) return null;
  return { ...raw, games: raw.games.map((g) => ({ ...g, when: new Date(g.when) })) };
}

export function loadSnapshot(path) {
  try {
    return reviveSnapshot(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return null; // no file yet, or unreadable: just no recap until the next finished week
  }
}

export function saveSnapshot(path, snap) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snap));
}

/**
 * Final screen decision, given what current.json says (`view`) and the saved weekend (`snapshot`):
 *  - a game in progress (or a day's finals before 4 AM) wins
 *  - before the snapshot's Tuesday-noon cutoff -> the recap from the snapshot
 *  - nothing left in current.json -> the recap (snapshot if there is one)
 *  - otherwise Up Next as usual
 * @returns {{ view, recap: 'snapshot' | 'current' | null }}
 */
export function chooseView(view, snapshot, now, tz) {
  if (view.kind === 'day' && view.mode === 'live') return { view, recap: null };
  if (snapshot && now < recapCutoff(snapshot.lastGameDate, tz)) return { view: { kind: 'review' }, recap: 'snapshot' };
  if (view.kind === 'review') return { view, recap: snapshot ? 'snapshot' : 'current' };
  return { view, recap: null };
}
