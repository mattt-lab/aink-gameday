import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gameAlert, parseSpread } from '../src/alerts.mjs';

describe('gameAlert', () => {
  // A live/final game between "Away U" and "Home U". Ranks null = unranked. Scores are away/home.
  const game = ({
    awayRank = null, homeRank = null, away = 0, home = 0, period = 4, status = 'in_progress',
    spread = null, awayName = 'Away U', homeName = 'Home U', clock = '5:00',
  } = {}) => ({
    status, period, clock, awayRank, homeRank,
    awayTeam: { name: awayName }, homeTeam: { name: homeName },
    awayScore: away, homeScore: home, spread,
  });

  // Replaces the old betting-line-only isPotentialUpset (2026-09-26): a game with a ranked team in it
  // now takes its underdog from the POLL, not the line -- #21 Florida (a 3.5-pt favorite) blowing out
  // #4 Ole Miss got no alert under the line rule. Games with no ranked team still use the line.
  describe('the four games that prompted the change (2026-09-26, Q4)', () => {
    it('#21 Florida 38-21 over #4 Ole Miss is an upset, even though the line made Florida the favorite', () => {
      const g = game({ awayRank: 4, homeRank: 21, away: 21, home: 38, awayName: 'Ole Miss', homeName: 'Florida', spread: 'Florida -3.5' });
      assert.equal(gameAlert(g), 'upset');
    });
    it('#18 Michigan 19-14 over #17 Iowa is only a tight game -- adjacent ranks, no underdog', () => {
      assert.equal(gameAlert(game({ awayRank: 17, homeRank: 18, away: 14, home: 19, spread: 'Home U -5.5' })), 'tight');
    });
    it('#15 Utah 24-17 over unranked Iowa State is only a tight game -- the higher-ranked team is winning', () => {
      assert.equal(gameAlert(game({ awayRank: 15, homeRank: null, away: 24, home: 17, spread: 'Away U -7.5' })), 'tight');
    });
    it('#2 Georgia 41-6 over unranked Oklahoma gets nothing', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 2, away: 6, home: 41, spread: 'Home U -13.5' })), null);
    });
  });

  describe('who the underdog is when a ranked team is playing (the poll decides, the line is ignored)', () => {
    it('an unranked team ahead of a ranked one is an upset', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 10, away: 17, home: 14, period: 3 })), 'upset');
    });
    it('the lower-ranked team is the underdog when both are ranked, from a 2-spot gap up', () => {
      assert.equal(gameAlert(game({ awayRank: 10, homeRank: 12, away: 14, home: 17, period: 3 })), 'upset'); // gap 2
      assert.equal(gameAlert(game({ awayRank: 10, homeRank: 11, away: 14, home: 17, period: 3 })), null);     // gap 1: no underdog
    });
    it('ignores the line, even when the line makes the higher-ranked team the underdog', () => {
      // #5 is +7 on the line against an unranked team but is still the higher-ranked side, so its lead is no upset
      assert.equal(gameAlert(game({ awayRank: 5, homeRank: null, away: 24, home: 17, period: 3, spread: 'Home U -7' })), null);
    });
    it('does not fall back to the line for adjacent ranks -- there is simply no underdog', () => {
      // line makes #17 the favorite, #18 leads by 12 in Q4: neither an upset nor tight
      assert.equal(gameAlert(game({ awayRank: 17, homeRank: 18, away: 10, home: 22, spread: 'Away U -3' })), null);
    });
  });

  describe('a game with no ranked team uses the betting line', () => {
    it('ignores a tiny underdog (3 points or fewer) leading in Q3, but not 3.5 or more', () => {
      assert.equal(gameAlert(game({ away: 17, home: 14, period: 3, spread: 'Home U -3' })), null);
      assert.equal(gameAlert(game({ away: 17, home: 14, period: 3, spread: 'Home U -3.5' })), 'upset');
    });
    it('cannot judge a line with no number in Q3, so it does not flag on a guess', () => {
      assert.equal(gameAlert(game({ away: 17, home: 14, period: 3, spread: 'Home U' })), null);
    });
    it('still flags a tiny underdog in Q4/OT and once final', () => {
      assert.equal(gameAlert(game({ away: 17, home: 14, spread: 'Home U -3' })), 'upset');
      assert.equal(gameAlert(game({ away: 24, home: 21, status: 'final', spread: 'Home U -2.5' })), 'upset');
    });
    it('has no underdog at all without a line -- never an upset, though it can still be tight', () => {
      assert.equal(gameAlert(game({ away: 30, home: 10 })), null);
      assert.equal(gameAlert(game({ away: 20, home: 17 })), 'tight');
    });
  });

  describe('timing', () => {
    it('never alerts in the first half, however big the lead -- including at halftime itself', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 21, home: 0, period: 1 })), null);
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 24, home: 3, period: 2, clock: '5:00' })), null);
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 24, home: 3, period: 2, clock: '0:00' })), null);
    });
    it('Q3: the underdog tied or ahead is an upset; a close game is NOT tight yet', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 14, home: 14, period: 3 })), 'upset');
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 10, home: 14, period: 3 })), null);
    });
    it('Q4/OT: the underdog tied or ahead by any amount is an upset', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 35, home: 14 })), 'upset');
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 14, home: 14 })), 'upset');
    });
    it('Q4/OT: any game within 7 that is not an upset is tight -- 8 is not', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 10, home: 17 })), 'tight'); // fav up 7
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 10, home: 18 })), null);    // fav up 8
      assert.equal(gameAlert(game({ away: 20, home: 24 })), 'tight');                              // no ranks, no line
    });
    it('treats overtime like Q4', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 27, home: 24, period: 5 })), 'upset');
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 24, home: 27, period: 6 })), 'tight');
    });
    it('upset outranks tight: an underdog leading by 3 in Q4 is an upset, not just a close game', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 17, home: 14 })), 'upset');
    });
  });

  describe('once final', () => {
    it('the underdog winning is an upset (poll-based and line-based)', () => {
      assert.equal(gameAlert(game({ awayRank: 4, homeRank: 21, away: 21, home: 38, status: 'final' })), 'upset');
      assert.equal(gameAlert(game({ away: 10, home: 7, status: 'final', spread: 'Home U -14' })), 'upset');
    });
    it('a favorite winning gets nothing -- tight games stop being tight once they end', () => {
      assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 20, home: 21, status: 'final' })), null);
      assert.equal(gameAlert(game({ awayRank: 17, homeRank: 18, away: 20, home: 21, status: 'final' })), null);
      assert.equal(gameAlert(game({ away: 20, home: 21, status: 'final' })), null);
    });
  });

  it('never alerts before kickoff, without scores, or with a "live" game that has no period yet', () => {
    assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: null, home: null, status: 'scheduled', period: null })), null);
    assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 7, home: 0, period: null })), null);
    assert.equal(gameAlert(game({ awayRank: null, homeRank: 4, away: 7, home: 0, period: 0 })), null);
  });
});

describe('parseSpread', () => {
  it('finds the favorite and the size of the line', () => {
    assert.deepEqual(parseSpread('Texas A&M -16.5', 'Kentucky', 'Texas A&M'), { side: 'home', points: 16.5 });
    assert.deepEqual(parseSpread('Ohio State -6', 'Ohio State', 'Texas'), { side: 'away', points: 6 });
  });

  it('resolves a Texas / Texas A&M name-prefix collision to the longer name', () => {
    assert.deepEqual(parseSpread('Texas A&M -3.5', 'Texas', 'Texas A&M'), { side: 'home', points: 3.5 });
    assert.deepEqual(parseSpread('Texas -3.5', 'Texas', 'Texas A&M'), { side: 'away', points: 3.5 });
  });

  it('is null (not a guess) when there is no line or it matches neither team', () => {
    assert.deepEqual(parseSpread(null, 'A', 'B'), { side: null, points: null });
    assert.deepEqual(parseSpread("Pick 'em", 'A', 'B'), { side: null, points: null });
    assert.deepEqual(parseSpread('Somebody Else -7', 'A', 'B'), { side: null, points: null });
  });

  it('keeps the favorite but has no number when the line has none', () => {
    assert.deepEqual(parseSpread('Team A', 'Team A', 'Team B'), { side: 'away', points: null });
  });
});

describe('alerts: overtime and halftime', () => {
  const g = (o) => ({
    status: 'in_progress', period: 4, awayRank: null, homeRank: null,
    awayTeam: { name: 'Away U' }, homeTeam: { name: 'Home U' },
    awayScore: 0, homeScore: 0, spread: null, ...o,
  });
  it('alerts: OT counts as tight', () => {
    assert.equal(gameAlert(g({ period: 5, awayScore: 20, homeScore: 24 })), 'tight');
  });
  it('alerts: halftime never alerts', () => {
    assert.equal(gameAlert(g({ period: 2, status: 'in_progress', awayRank: null, homeRank: 4, awayScore: 24, homeScore: 3 })), null);
  });
});
