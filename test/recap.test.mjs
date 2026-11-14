import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recapCutoff, localTime, chooseView } from '../src/recap.mjs';
import { createLoop } from '../src/loop.mjs';
import { applyScores } from '../src/fixtures.mjs';

const TZ = 'America/Phoenix';

test('recapCutoff: Saturday games -> the following Tuesday at noon local', () => {
  assert.equal(recapCutoff('2026-11-14', TZ).toISOString(), '2026-11-17T19:00:00.000Z'); // noon MST = 19:00Z
});

test('recapCutoff: a Monday finish -> next day; a Tuesday finish -> the Tuesday after', () => {
  assert.equal(recapCutoff('2026-11-16', TZ).toISOString(), '2026-11-17T19:00:00.000Z');
  assert.equal(recapCutoff('2026-11-17', TZ).toISOString(), '2026-11-24T19:00:00.000Z');
});

test('localTime handles a DST zone', () => {
  assert.equal(localTime('2026-07-14', 12, 'America/Los_Angeles').toISOString(), '2026-07-14T19:00:00.000Z');
  assert.equal(localTime('2026-12-15', 12, 'America/Los_Angeles').toISOString(), '2026-12-15T20:00:00.000Z');
});

test('chooseView: live wins; recap until Tuesday noon; Up Next after', () => {
  const snap = { lastGameDate: '2026-11-14' };
  const upnext = { kind: 'day', date: '2026-11-19', mode: 'upnext' };
  const live = { kind: 'day', date: '2026-11-17', mode: 'live' };
  assert.deepEqual(chooseView(live, snap, new Date('2026-11-17T18:00:00Z'), TZ), { view: live, recap: null });
  assert.deepEqual(chooseView(upnext, snap, new Date('2026-11-17T18:59:00Z'), TZ), { view: { kind: 'review' }, recap: 'snapshot' });
  assert.deepEqual(chooseView(upnext, snap, new Date('2026-11-17T19:00:00Z'), TZ), { view: upnext, recap: null });
  assert.deepEqual(chooseView({ kind: 'review' }, null, new Date(), TZ), { view: { kind: 'review' }, recap: 'current' });
});

// ---- the whole weekend through the loop ----
const load = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
const WEEK11 = load('current-2026-11-11.json');
const FINALS = load('scores-week-final.json');
const ESPN = { 20261113: load('espn-20261113-pre.json').events, 20261114: load('espn-20261114-pre.json').events };
// "Week 12": the same slate shifted 6 days later (Thursday 19th onward), as if CFB HQ rolled over Sunday.
const WEEK12 = structuredClone(WEEK11);
WEEK12.meta.currentWeek = 12;
WEEK12.rankingsByWeek['12'] = WEEK11.rankingsByWeek['11'];
for (const g of WEEK12.allGames) { g.when = new Date(new Date(g.when).getTime() + 6 * 864e5).toISOString(); g.cfbdId += 1e6; }

function weekend(snapshotPath) {
  const h = { now: new Date('2026-11-16T03:00:00Z'), current: WEEK11 };
  const fetchFn = async (url) => {
    if (url.includes('current.json')) return { ok: true, status: 200, text: async () => JSON.stringify(h.current) };
    const d = /dates=(\d+)/.exec(url)[1];
    return { ok: true, status: 200, text: async () => JSON.stringify({ events: applyScores(ESPN[d] ?? [], FINALS) }) };
  };
  const CHAR = { 9: 10, 12: 13, 18: 19, 24: 26 };
  const device = {
    measure: async (items) => items.map((i) => ({ width: i.text.length * CHAR[i.size] })),
    naturalHeight: async (op) => (op.op === 'table' ? 33 * op.rows.length + 33 : op.op === 'header' ? (op.subtitle ? 54 : 44) : 45),
    render: async () => ({ status: 'ok' }),
  };
  const config = { timeZone: TZ, pinnedTeam: 'washington', currentJsonUrl: 'x/current.json', espnBase: 'espn', snapshotPath };
  h.make = () => createLoop({ config, device, fetchFn, clock: () => h.now });
  h.loop = h.make();
  return h;
}

test('weekend recap survives the Sunday rollover and a restart, then gives way at Tuesday noon', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'aink-')), 'last-week.json');
  const h = weekend(path);

  // Sunday 8 PM: week 11 is all final -> recap, and it gets saved.
  assert.equal((await h.loop.tick()).view.kind, 'review');
  assert.ok(existsSync(path));

  // CFB HQ rolls to week 12 (next games Thursday). Monday 10 AM, after a restart: still the recap.
  h.current = WEEK12;
  h.now = new Date('2026-11-16T17:00:00Z');
  h.loop = h.make();
  const mon = await h.loop.tick();
  assert.equal(mon.view.kind, 'review');

  // Tuesday 11:59 AM: recap. Tuesday 12:01 PM: Up Next for Thursday.
  h.now = new Date('2026-11-17T18:59:00Z');
  assert.equal((await h.loop.tick()).view.kind, 'review');
  h.now = new Date('2026-11-17T19:01:00Z');
  const tue = await h.loop.tick();
  assert.deepEqual([tue.view.kind, tue.view.mode], ['day', 'upnext']);
});
