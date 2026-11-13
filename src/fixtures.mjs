// Offline inputs for tests and `--fixture` renders: a saved current.json, saved ESPN scoreboards,
// and an optional scores file that overlays made-up live/final states onto the ESPN events.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Overlay scores onto ESPN events (returns new events; input untouched).
 * scores: { "<cfbdId>": { away, home, state: 'in'|'post', period, clock } }
 */
export function applyScores(events, scores = {}) {
  return events.map((ev) => {
    const s = scores[ev.id];
    if (!s) return ev;
    const copy = structuredClone(ev);
    const final = s.state === 'post';
    copy.status = {
      ...copy.status,
      period: s.period ?? (final ? 4 : 1),
      displayClock: s.clock ?? '0:00',
      type: final
        ? { ...copy.status.type, state: 'post', completed: true, name: 'STATUS_FINAL' }
        : { ...copy.status.type, state: 'in', completed: false, name: 'STATUS_IN_PROGRESS' },
    };
    for (const c of copy.competitions[0].competitors) c.score = String(c.homeAway === 'home' ? s.home : s.away);
    return copy;
  });
}

/** Loads current-*.json, every espn-*.json, and (optionally) a scores file from `dir`. */
export function loadFixture(dir, { scoresFile } = {}) {
  const files = readdirSync(dir);
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const currentFile = files.find((f) => f.startsWith('current-') && f.endsWith('.json'));
  if (!currentFile) throw new Error(`no current-*.json in ${dir}`);
  const events = files.filter((f) => f.startsWith('espn-') && f.endsWith('.json')).flatMap((f) => read(f).events ?? []);
  const scores = scoresFile ? read(scoresFile) : {};
  return { current: read(currentFile), events: applyScores(events, scores) };
}
