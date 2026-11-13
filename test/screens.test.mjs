import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadFixture } from '../src/fixtures.mjs';
import { buildGames, pickView } from '../src/model.mjs';
import { buildView } from '../src/render.mjs';
import { hashCommands, stripMeta } from '../src/screens/common.mjs';

const TZ = 'America/Phoenix';
const DIR = fileURLToPath(new URL('../fixtures', import.meta.url));
// Real values measured from the AInk (aink-7.5) on 2026-11-13.
const metrics = { scoreW: 58, clockW: 107, rowPitch12: 33, tableHeaderH12: 33, headerH: 44, headerSubH: 54, pinBarH: 45 };
const CHAR = { 9: 10, 12: 13, 18: 19, 24: 26 }; // device avgCharWidth per size
const measure = async (items) => items.map((i) => ({ width: i.text.length * CHAR[i.size] }));

async function screen(nowIso, scoresFile, overrides = {}) {
  const { current, events } = loadFixture(DIR, { scoresFile });
  let games = buildGames(current, events);
  if (overrides.games) games = overrides.games(games);
  const now = new Date(nowIso);
  const view = pickView(games, now, TZ);
  const { commands, hash } = await buildView(games, view, { now, tz: TZ, pinnedTeam: 'washington', week: 11, metrics, measure, updatedAt: now });
  const texts = commands.filter((c) => c.op === 'text').map((c) => c.text);
  return { view, commands, hash, texts, tables: commands.filter((c) => c._table).map((c) => c._table), bar: commands.find((c) => c._pinBar)?._pinBar, json: JSON.stringify(stripMeta(commands)) };
}

test("upnext Saturday shows 9 rows in kickoff order, footer '+N lower-stakes games hidden'", async () => {
  const s = await screen('2026-11-14T16:40:00Z');
  assert.deepEqual(s.view, { kind: 'day', date: '2026-11-14', mode: 'upnext' });
  const rows = s.tables[0].rows;
  assert.equal(rows.length, 9);
  const footer = s.texts.find((t) => /lower-stakes/.test(t));
  assert.match(footer, /^\+\d+ lower-stakes games hidden$/);
  const pending = 56 - 0; // at 9:40 AM nothing has kicked off
  assert.equal(rows.length + Number(footer.match(/\d+/)[0]), pending);
  const mins = rows.map((r) => { const [h, m] = r[0].split(/[: ]/); return ((+h % 12) + (r[0].endsWith('PM') ? 12 : 0)) * 60 + +m; });
  assert.deepEqual(mins, [...mins].sort((a, b) => a - b));
});

test("upnext Friday shows 3 rows, no footer, subtitle ends '(Tonight)' after 4 PM / '(Today)' before", async () => {
  const eve = await screen('2026-11-13T23:30:00Z'); // 4:30 PM
  assert.equal(eve.tables[0].rows.length, 3);
  assert.ok(!eve.texts.some((t) => /hidden/.test(t)));
  assert.match(eve.commands.find((c) => c.op === 'header').subtitle, /\(Tonight\)$/);
  const noon = await screen('2026-11-13T19:00:00Z');
  assert.match(noon.commands.find((c) => c.op === 'header').subtitle, /\(Today\)$/);
});

test('upnext never contains a pinned-team box', async () => {
  const s = await screen('2026-11-14T16:40:00Z');
  assert.equal(s.bar, undefined);
});

test("live Saturday: 3 cards, a pinned bar containing 'Washington 7', footer starts '+'", async () => {
  const s = await screen('2026-11-14T21:47:00Z', 'scores-sat-1447.json');
  assert.equal(s.view.mode, 'live');
  assert.equal(s.commands.filter((c) => c.op === 'rect' && c.h === 134).length, 3);
  assert.match(s.bar.text, /^Washington 7/);
  assert.match(s.texts.find((t) => /more live/.test(t)), /^\+\d+ more live/);
});

test("live: pinned bar stays and reads 'Final' when UW is final but other games are live", async () => {
  const s = await screen('2026-11-14T21:47:00Z', 'scores-sat-1447.json', {
    games: (gs) => gs.map((g) => (g.away === 'washington' ? { ...g, state: 'post', completed: true, status: 'final', clockText: 'Final' } : g)),
  });
  assert.match(s.bar.right, /^Final/);
});

test('live Friday: 2 cards, an Up next table with Houston, no footer', async () => {
  const s = await screen('2026-11-14T02:40:00Z', 'scores-fri-1940.json');
  assert.equal(s.commands.filter((c) => c.op === 'rect' && c.h === 134).length, 2);
  assert.equal(s.tables.length, 1);
  assert.match(s.tables[0].rows[0][0], /Houston at Colorado/);
  assert.ok(!s.texts.some((t) => /^Final:|more live/.test(t)));
});

test('live: every card and row contains its network text', async () => {
  const s = await screen('2026-11-14T21:47:00Z', 'scores-sat-1447.json');
  const tiny = s.commands.filter((c) => c.op === 'text' && c.size === 9 && c.w <= 120 && c.text !== '#').map((c) => c.text);
  // 3 cards + 5 rows on this fixture, each with a network
  assert.equal(tiny.length, 8);
  assert.ok(tiny.every((t) => t.length > 0));
});

test('live: alert ops: fire icon for upset, image op for tight, none in Q1/Q2', async () => {
  const fri = await screen('2026-11-14T02:40:00Z', 'scores-fri-1940.json');
  // FSU-Pitt 4Q 20-24 -> tight (image); Illinois-UCLA Q1 -> nothing
  assert.equal(fri.commands.filter((c) => c.op === 'image').length, 1);
  assert.equal(fri.commands.filter((c) => c.op === 'icon' && c.name === 'fire').length, 0);
  const sat = await screen('2026-11-14T21:47:00Z', 'scores-sat-1447.json');
  assert.ok(sat.commands.some((c) => c.op === 'icon' && c.name === 'fire'));
});

test("live: a null network renders '' not 'null'", async () => {
  const s = await screen('2026-11-14T21:47:00Z', 'scores-sat-1447.json', { games: (gs) => gs.map((g) => ({ ...g, network: null })) });
  assert.ok(!/"text":"(null|undefined)"/.test(s.json));
  assert.ok(!/null|undefined/.test(s.texts.join('|')));
});

test("review: Upsets and Close finishes tables, pinned bar 'Final', no bar on a UW bye", async () => {
  const s = await screen('2026-11-16T19:00:00Z', 'scores-week-final.json');
  assert.deepEqual(s.view, { kind: 'review' });
  assert.deepEqual(s.tables.map((t) => t.columns[0]), ['Upsets', 'Close finishes']);
  assert.equal(s.bar.right, 'Final');
  const bye = await screen('2026-11-16T19:00:00Z', 'scores-week-final.json', { games: (gs) => gs.filter((g) => g.away !== 'washington' && g.home !== 'washington') });
  assert.equal(bye.bar, undefined);
});

test('hashCommands ignores the Updated text', async () => {
  const a = await screen('2026-11-14T16:40:00Z');
  const b = await screen('2026-11-14T16:41:00Z');
  assert.notEqual(JSON.stringify(a.commands), JSON.stringify(b.commands));
  assert.equal(hashCommands(a.commands), hashCommands(b.commands));
  assert.ok(!stripMeta(a.commands).some((c) => '_volatile' in c));
});

test("live finals hold (all Saturday final at 11 PM): footer says '+N more finals', never 'more live'", async () => {
  const s = await screen('2026-11-15T06:00:00Z', 'scores-week-final.json');
  assert.deepEqual(s.view, { kind: 'day', date: '2026-11-14', mode: 'live' });
  assert.ok(!s.texts.some((t) => /more live/.test(t)));
  assert.match(s.texts.find((t) => /more finals/.test(t)), /^\+\d+ more finals$/);
  assert.match(s.texts.find((t) => /\|/.test(t) && t.includes('PM')), /Final$/);
});

test('live: only Washington live, the rest final, two still to kick off -> Up next table shows them', async () => {
  const late = new Set(['texas-tech', 'colorado-state']); // 7:30 PM and 8:30 PM kickoffs
  const s = await screen('2026-11-15T01:30:00Z', 'scores-week-final.json', {
    games: (gs) => gs.map((g) => {
      if (g.away === 'washington') return { ...g, state: 'in', completed: false, status: 'in_progress', period: 4, clockText: '4Q 2:00', alert: null };
      if (late.has(g.away)) return { ...g, state: 'pre', completed: false, status: 'scheduled', awayScore: null, homeScore: null, clockText: '', alert: null };
      return g;
    }),
  });
  assert.ok(!s.texts.some((t) => /more live/.test(t)));
  const up = s.tables.find((t) => t.columns[0] === 'Up next');
  assert.ok(up, 'up next table present');
  assert.equal(up.rows.length, 2);
  assert.match(s.texts.find((t) => /live$/.test(t)), /1 live$/);
});

test("ranked teams get a tiny '#' (size 9) right before the rank number", async () => {
  const s = await screen('2026-11-14T02:40:00Z', 'scores-fri-1940.json');
  const i = s.commands.findIndex((c) => c.op === 'text' && c.text === '#');
  assert.ok(i >= 0);
  assert.equal(s.commands[i].size, 9);
  assert.match(s.commands[i + 1].text, /^4 UCLA/);
  assert.equal(s.tables[0].rows[0][0], '#14 Houston at Colorado');
});

test('review rows read "away at home" with the score away-home and the winner bold', async () => {
  const s = await screen('2026-11-16T19:00:00Z', 'scores-week-final.json');
  const upsets = s.tables.find((t) => t.columns[0] === 'Upsets');
  assert.deepEqual(upsets.rows[0], ['#22 Missouri at #1 Georgia', '13-10']);
  const missouri = s.commands.find((c) => c.op === 'text' && c.text === '22 Missouri');
  const georgia = s.commands.find((c) => c.op === 'text' && c.text === '1 Georgia');
  assert.equal(missouri.bold, true);
  assert.equal(georgia.bold, false);
});

test('no internal _ keys reach the device', async () => {
  const s = await screen('2026-11-16T19:00:00Z', 'scores-week-final.json');
  assert.ok(!/"_(table|pinBar|volatile)"/.test(s.json));
});
