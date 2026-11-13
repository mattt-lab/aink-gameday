import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interest, stakesOf, upsetSize, shortName, abbrevNetwork, spreadPoints } from '../src/rank.mjs';
import { measureMetrics, colWidth } from '../src/metrics.mjs';

const g = (o) => ({ awayRank: null, homeRank: null, awayScore: 0, homeScore: 0, period: 1, alert: null, spread: null, stakes: null, ...o });

test('interest: upset outranks a close Q1 game', () => {
  assert.ok(interest(g({ period: 3, awayScore: 21, homeScore: 10, alert: 'upset' })) > interest(g({ period: 1, awayScore: 7, homeScore: 7 })));
});

test('interest: Q4 one-score beats Q3 one-score', () => {
  assert.ok(interest(g({ period: 4, awayScore: 20, homeScore: 17 })) > interest(g({ period: 3, awayScore: 20, homeScore: 17 })));
});

test('interest: OT is latest of all, ranked teams add weight', () => {
  assert.ok(interest(g({ period: 5, awayScore: 24, homeScore: 24 })) > interest(g({ period: 4, awayScore: 24, homeScore: 24 })));
  assert.ok(interest(g({ awayRank: 3 })) > interest(g({})));
});

test('stakesOf: real stakesScore beats any stand-in', () => {
  assert.ok(stakesOf(g({ stakes: 0.5 })) > stakesOf(g({ awayRank: 1, homeRank: 2, spread: 'Ohio State -1' })));
});

test('stakesOf: stand-in prefers ranked teams and close lines', () => {
  assert.ok(stakesOf(g({ homeRank: 10, spread: 'Foo -20' })) > stakesOf(g({ spread: 'Foo -20' })));
  assert.ok(stakesOf(g({ spread: 'Foo -2.5' })) > stakesOf(g({ spread: 'Foo -20' })));
});

test('upsetSize: bigger favourite / better-ranked loser is a bigger upset', () => {
  const small = g({ awayScore: 21, homeScore: 20, homeRank: 24, spread: 'Home -3' });
  const big = g({ awayScore: 21, homeScore: 20, homeRank: 1, spread: 'Home -15.5' });
  assert.ok(upsetSize(big) > upsetSize(small));
});

test('spreadPoints parses CFB HQ spread strings', () => {
  assert.equal(spreadPoints('Ohio State -6.5'), 6.5);
  assert.equal(spreadPoints(null), 0);
});

test("shortName('New Mexico State') === 'New Mexico St'", () => {
  assert.equal(shortName('New Mexico State'), 'New Mexico St');
  assert.equal(shortName('Statesboro'), 'Statesboro');
});

test("abbrevNetwork('SEC Network') === 'SECN'", () => {
  assert.equal(abbrevNetwork('SEC Network'), 'SECN');
  assert.equal(abbrevNetwork('Fox'), 'FOX');
  assert.equal(abbrevNetwork('ESPN'), 'ESPN');
  assert.equal(abbrevNetwork(null), '');
});

test('measureMetrics computes rowPitch from two dry runs', async () => {
  const device = {
    measure: async (items) => items.map((i) => ({ width: i.size === 24 ? 52 : 99 })),
    naturalHeight: async (op) => (op.op === 'table' ? 33 * op.rows.length + 33 : op.op === 'header' ? (op.subtitle ? 54 : 44) : 40),
  };
  const m = await measureMetrics(device);
  assert.equal(m.rowPitch12, 33);
  assert.equal(m.tableHeaderH12, 33);
  assert.equal(m.scoreW, 58);
  assert.equal(m.clockW, 107);
  assert.equal(m.headerH, 44);
  assert.equal(m.headerSubH, 54);
  assert.equal(m.pinBarH, 40);
});

test('colWidth: widest measured string plus padding', async () => {
  const device = { measure: async (items) => items.map((i) => ({ width: i.text.length * 10 })) };
  assert.equal(await colWidth(device, ['ESPN', 'SECN', 'ESPN2'], 12), 66);
});
