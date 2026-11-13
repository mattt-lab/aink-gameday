import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLoop } from '../src/loop.mjs';
import { applyScores } from '../src/fixtures.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
const CURRENT = load('current-2026-11-11.json');
const ESPN = { 20261113: load('espn-20261113-pre.json').events, 20261114: load('espn-20261114-pre.json').events };
const config = { timeZone: 'America/Phoenix', pinnedTeam: 'washington', currentJsonUrl: 'https://raw/current.json', espnBase: 'https://espn/scoreboard' };
const CHAR = { 9: 10, 12: 13, 18: 19, 24: 26 };

function harness({ start = '2026-11-13T19:00:00Z' } = {}) {
  const h = {
    now: new Date(start), calls: [], renders: [], scores: {},
    currentFails: false, espnBody: null, deviceDown: false,
  };
  h.fetchFn = async (url) => {
    h.calls.push(url);
    if (url.includes('current.json')) {
      if (h.currentFails) return { ok: false, status: 500, text: async () => 'oops' };
      return { ok: true, status: 200, text: async () => JSON.stringify(CURRENT) };
    }
    if (h.espnBody) return { ok: true, status: 200, text: async () => h.espnBody };
    const d = /dates=(\d+)/.exec(url)[1];
    return { ok: true, status: 200, text: async () => JSON.stringify({ events: applyScores(ESPN[d] ?? [], h.scores) }) };
  };
  const down = () => { if (h.deviceDown) throw new Error('device unreachable: ECONNREFUSED'); };
  h.device = {
    measure: async (items) => { down(); return items.map((i) => ({ width: i.text.length * CHAR[i.size] })); },
    naturalHeight: async (op) => { down(); return op.op === 'table' ? 33 * op.rows.length + 33 : op.op === 'header' ? (op.subtitle ? 54 : 44) : 45; },
    render: async (cmds) => { down(); h.renders.push(cmds); return { status: 'ok' }; },
  };
  h.loop = createLoop({ config, device: h.device, fetchFn: h.fetchFn, clock: () => h.now });
  h.advance = (sec) => { h.now = new Date(h.now.getTime() + sec * 1000); };
  h.count = (s) => h.calls.filter((u) => u.includes(s)).length;
  return h;
}
const fsuId = String(CURRENT.allGames.find((g) => g.away === 'florida-state').cfbdId);

test('first tick fetches both sources and draws', async () => {
  const h = harness();
  const r = await h.loop.tick();
  assert.equal(r.redrew, true);
  assert.equal(h.count('current.json'), 1);
  assert.ok(h.count('dates=20261113') >= 1);
  assert.equal(h.renders.length, 1);
  assert.ok(!JSON.stringify(h.renders[0]).includes('_volatile'));
});

test('second tick 60s later with same data does not redraw', async () => {
  const h = harness();
  await h.loop.tick();
  h.advance(60);
  const r = await h.loop.tick();
  assert.equal(r.redrew, false);
  assert.equal(r.reason, 'unchanged');
});

test('live: changed scores 60s after a draw wait; 120s after, redraw', async () => {
  const h = harness({ start: '2026-11-14T01:30:00Z' }); // 6:30 PM Fri
  h.scores = { [fsuId]: { away: 7, home: 7, state: 'in', period: 2, clock: '5:00' } };
  assert.equal((await h.loop.tick()).redrew, true);
  h.advance(60);
  h.scores = { [fsuId]: { away: 14, home: 7, state: 'in', period: 2, clock: '4:00' } };
  const r1 = await h.loop.tick();
  assert.equal(r1.redrew, false);
  assert.match(r1.reason, /waiting/);
  h.advance(60);
  const r2 = await h.loop.tick();
  assert.equal(r2.redrew, true);
});

test('live: ESPN is fetched every tick while a game is in progress', async () => {
  const h = harness({ start: '2026-11-14T01:30:00Z' });
  h.scores = { [fsuId]: { away: 7, home: 7, state: 'in', period: 2, clock: '5:00' } };
  await h.loop.tick();
  const before = h.count('dates=20261113');
  h.advance(60);
  await h.loop.tick();
  assert.equal(h.count('dates=20261113'), before + 1);
});

test('quiet day: ESPN refetched only after 10 min', async () => {
  const h = harness(); // Friday noon, first kickoff 5 PM
  await h.loop.tick();
  const before = h.count('dates=20261113');
  h.advance(60); await h.loop.tick();
  assert.equal(h.count('dates=20261113'), before);
  h.advance(600); await h.loop.tick();
  assert.equal(h.count('dates=20261113'), before + 1);
});

test('current.json 500 keeps last good data, logs error, still draws from cache', async () => {
  const h = harness();
  await h.loop.tick();
  h.currentFails = true;
  h.advance(16 * 60);
  const r = await h.loop.tick();
  assert.ok(r.errors.some((e) => /current.json HTTP 500/.test(e)));
  assert.equal(r.view.kind, 'day');
});

test('ESPN returns HTML (bad JSON) -> error logged, no crash', async () => {
  const h = harness();
  h.espnBody = '<html>maintenance</html>';
  const r = await h.loop.tick();
  assert.ok(r.errors.some((e) => /non-JSON/.test(e)));
  assert.equal(r.redrew, true); // still draws from current.json alone
});

test('device unreachable -> error, next tick redraws even if hash unchanged', async () => {
  const h = harness();
  h.deviceDown = true;
  const r1 = await h.loop.tick();
  assert.equal(r1.redrew, false);
  assert.ok(r1.errors.some((e) => /device unreachable/.test(e)));
  h.deviceDown = false;
  h.advance(60);
  const r2 = await h.loop.tick();
  assert.equal(r2.redrew, true);
});

test('current.json refetched only after 15 min', async () => {
  const h = harness();
  await h.loop.tick();
  for (let i = 0; i < 14; i++) { h.advance(60); await h.loop.tick(); }
  assert.equal(h.count('current.json'), 1);
  h.advance(60); await h.loop.tick();
  assert.equal(h.count('current.json'), 2);
});

test('no data at all -> no draw, clear reason', async () => {
  const h = harness();
  h.currentFails = true;
  const r = await h.loop.tick();
  assert.equal(r.redrew, false);
  assert.equal(r.reason, 'no data yet');
});

test('device drops after a good draw, comes back with the same data -> redraws once, then settles', async () => {
  const h = harness();
  assert.equal((await h.loop.tick()).redrew, true);
  h.deviceDown = true;
  h.advance(60);
  const down = await h.loop.tick();
  assert.equal(down.redrew, false);
  assert.ok(down.errors.some((e) => /device unreachable/.test(e)));
  h.deviceDown = false;
  h.advance(60);
  assert.equal((await h.loop.tick()).redrew, true); // it may have rebooted: redraw even though content is the same
  h.advance(60);
  assert.equal((await h.loop.tick()).reason, 'unchanged');
});

test('a draw that fails is retried next tick even though the content is unchanged', async () => {
  const h = harness();
  await h.loop.tick();
  h.advance(11 * 60);
  h.scores = { [fsuId]: { away: 0, home: 0, state: 'in', period: 1, clock: '15:00' } }; // view changes -> draw attempt
  h.deviceDown = true;
  h.now = new Date('2026-11-14T00:05:00Z');
  const fail = await h.loop.tick();
  assert.equal(fail.redrew, false);
  h.deviceDown = false;
  h.advance(60);
  const r = await h.loop.tick();
  assert.equal(r.redrew, true);
});

test('unusable current.json is rejected and the previous one kept', async () => {
  const h = harness();
  await h.loop.tick();
  const bad = { ...CURRENT, allGames: 'nope' };
  h.fetchFn = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(bad) });
  const h2 = harness();
  h2.fetchFn = h.fetchFn;
  const loop = createLoop({ config, device: h2.device, fetchFn: h2.fetchFn, clock: () => h2.now });
  const r = await loop.tick();
  assert.equal(r.reason, 'no data yet');
  assert.ok(r.errors.some((e) => /no allGames/.test(e)));
});

test('an empty ESPN scoreboard does not wipe cached live scores', async () => {
  const h = harness({ start: '2026-11-14T01:30:00Z' });
  h.scores = { [fsuId]: { away: 7, home: 7, state: 'in', period: 2, clock: '5:00' } };
  await h.loop.tick();
  h.espnBody = '{"events":[]}';
  h.advance(60);
  const r = await h.loop.tick();
  assert.equal(r.view.mode, 'live');
  assert.ok(r.errors.some((e) => /keeping previous/.test(e)));
});

test('tick reports how many games are on the shown day', async () => {
  const h = harness();
  assert.equal((await h.loop.tick()).games, 3);
});

test('device reboot between ticks (uptime went backwards) -> redraw even though nothing changed', async () => {
  const h = harness();
  let uptime = 100000;
  h.device.health = async () => ({ uptime_ms: uptime });
  assert.equal((await h.loop.tick()).redrew, true);
  h.advance(60); uptime += 60000;
  assert.equal((await h.loop.tick()).reason, 'unchanged');
  h.advance(60); uptime = 5000; // rebooted
  const r = await h.loop.tick();
  assert.equal(r.redrew, true);
  assert.ok(r.errors.some((e) => /restarted/.test(e)));
});
