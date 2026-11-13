import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildGames, pickView, gamesOn, isDone } from '../src/model.mjs';
import { localDate, fmtTime, fmtDayTitle, ymd, addDays } from '../src/time.mjs';

const TZ = 'America/Phoenix';
const load = (f) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8'));
const current = () => load('current-2026-11-11.json');
const events = () => [...load('espn-20261113-pre.json').events, ...load('espn-20261114-pre.json').events];
const find = (games, away) => games.find((g) => g.away === away);
const setEvent = (evs, cfbdId, status, scores) => {
  const ev = evs.find((e) => e.id === String(cfbdId));
  ev.status = { ...ev.status, ...status, type: { ...ev.status.type, ...status.type } };
  if (scores) for (const c of ev.competitions[0].competitors) c.score = String(scores[c.homeAway]);
  return evs;
};
const idOf = (away) => current().allGames.find((g) => g.away === away).cfbdId;
const IN = (period, clock = '8:40') => ({ period, displayClock: clock, type: { state: 'in', completed: false, name: 'STATUS_IN_PROGRESS' } });
const FINAL = { type: { state: 'post', completed: true, name: 'STATUS_FINAL' } };

test('buildGames joins all 56 Saturday games by cfbdId', () => {
  const games = buildGames(current(), events());
  const sat = gamesOn(games, '2026-11-14', TZ);
  assert.equal(sat.length, 56);
  assert.ok(sat.every((g) => g.hasEspn));
});

test('stakes joined from rankedNextGames', () => {
  assert.equal(find(buildGames(current(), events()), 'illinois').stakes, 10.5);
});

test('names come from current.teams, falling back to ESPN location', () => {
  const cur = current();
  assert.equal(find(buildGames(cur, events()), 'duke').awayName, cur.teams.duke.name);
  delete cur.teams.duke;
  assert.equal(find(buildGames(cur, events()), 'duke').awayName, 'Duke');
});

test('pre-game: no scores, empty clock, no alert, null-safe fields', () => {
  const g = find(buildGames(current(), events()), 'florida-state');
  assert.equal(g.awayScore, null);
  assert.equal(g.clockText, '');
  assert.equal(g.alert, null);
  assert.equal(g.status, 'scheduled');
});

test('pickView: Friday noon -> day 2026-11-13 upnext', () => {
  const v = pickView(buildGames(current(), events()), new Date('2026-11-13T19:00Z'), TZ);
  assert.deepEqual(v, { kind: 'day', date: '2026-11-13', mode: 'upnext' });
});

test('pickView: any game in -> live', () => {
  const evs = setEvent(events(), idOf('florida-state'), IN(4, '1:48'), { away: 20, home: 24 });
  const games = buildGames(current(), evs);
  assert.deepEqual(pickView(games, new Date('2026-11-14T02:40Z'), TZ), { kind: 'day', date: '2026-11-13', mode: 'live' });
  const g = find(games, 'florida-state');
  assert.equal(g.clockText, '4Q 1:48');
  assert.equal(g.status, 'in_progress');
  assert.equal(g.homeScore, 24);
});

test('pickView: all final at 11 PM keeps the day; at 4:05 AM rolls to next day', () => {
  let evs = events();
  for (const a of ['florida-state', 'illinois', 'houston']) evs = setEvent(evs, idOf(a), FINAL, { away: 10, home: 20 });
  const games = buildGames(current(), evs);
  assert.deepEqual(pickView(games, new Date('2026-11-14T06:00Z'), TZ), { kind: 'day', date: '2026-11-13', mode: 'live' }); // 11 PM Fri
  assert.deepEqual(pickView(games, new Date('2026-11-14T10:30Z'), TZ), { kind: 'day', date: '2026-11-13', mode: 'live' }); // 3:30 AM Sat
  assert.deepEqual(pickView(games, new Date('2026-11-14T11:05Z'), TZ), { kind: 'day', date: '2026-11-14', mode: 'upnext' }); // 4:05 AM Sat
});

test('pickView: no ESPN status and kicked off 7h ago counts as done', () => {
  const games = buildGames(current(), []); // nothing from ESPN at all
  const g = find(games, 'florida-state'); // kicks 2026-11-14T00:00Z
  assert.equal(isDone(g, new Date('2026-11-14T07:00Z')), true);
  assert.equal(isDone(g, new Date('2026-11-14T05:00Z')), false);
});

test('pickView: a stale ESPN "pre" status 6h+ after kickoff does not pin the day', () => {
  const games = buildGames(current(), events()); // Friday events still say 'pre'
  assert.deepEqual(pickView(games, new Date('2026-11-14T16:40Z'), TZ), { kind: 'day', date: '2026-11-14', mode: 'upnext' });
});

test('pickView: postponed game does not pin the day', () => {
  const evs = setEvent(events(), idOf('florida-state'), { type: { state: 'post', completed: false, name: 'STATUS_POSTPONED' } });
  const games = buildGames(current(), evs);
  const v = pickView(games, new Date('2026-11-14T01:30Z'), TZ); // 6:30 PM Fri, FSU-Pitt "should" be on
  assert.equal(v.date, '2026-11-13');
  assert.equal(v.mode, 'upnext'); // Illinois-UCLA and Houston still to come; postponed game is not live
  assert.equal(find(games, 'florida-state').dead, true);
});

test('pickView: nothing left -> review', () => {
  const games = buildGames(current(), []);
  assert.deepEqual(pickView(games, new Date('2026-11-16T19:00Z'), TZ), { kind: 'review' });
});

test("clockText: period 5 -> 'OT', period 6 -> '2OT', STATUS_HALFTIME -> 'Half'", () => {
  const id = idOf('florida-state');
  const g = (st) => find(buildGames(current(), setEvent(events(), id, st, { away: 7, home: 7 })), 'florida-state');
  assert.equal(g(IN(5, '0:00')).clockText, 'OT');
  assert.equal(g(IN(6, '0:00')).clockText, '2OT');
  assert.equal(g({ period: 2, displayClock: '0:00', type: { state: 'in', completed: false, name: 'STATUS_HALFTIME' } }).clockText, 'Half');
});

test('alerts flow through: Q4 one-score game between unranked teams is tight', () => {
  const g = find(buildGames(current(), setEvent(events(), idOf('florida-state'), IN(4, '1:48'), { away: 20, home: 24 })), 'florida-state');
  assert.equal(g.alert, 'tight');
});

test('time helpers', () => {
  const d = new Date('2026-11-14T20:30:00Z');
  assert.equal(localDate(d, TZ), '2026-11-14');
  assert.equal(fmtTime(d, TZ), '1:30 PM');
  assert.equal(fmtDayTitle(d, TZ), 'Saturday, Nov 14');
  assert.equal(ymd('2026-11-14'), '20261114');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});
