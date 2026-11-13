// MIRRORED FROM cfb-top25-tracker: src/data/teams.js (gameAlert, underdogOf + constants) and src/utils/spread.js (parseSpread). When those change, re-port here and re-run tests. Ported 2026-11-13 from commit 6678d6b.

// Pure parser for CFBD's pre-formatted betting-line string (e.g. "Ohio State -6.5"). There is no
// structured numeric field for the line, just this string (see fetch-cfb-data.mjs's spread
// comment), so the favorite is resolved by checking whether it starts with either team's name.
// Lives in its own module (no imports, no data/current.json) so both the site (teams.js's
// gameAlert's line fallback) and the Node scripts (Pick 'em snapshot/review) read the line identically.
//
// Returns { side: 'away' | 'home' | null, points: number | null }. side is null (not a guess) when
// there's no line, or the string matches neither name -- a genuine pick'em line, or a
// name-formatting mismatch between the odds provider and our own team names. points is the
// favorite's margin as a positive number, null whenever side is null.
//
// One team's name can be a strict prefix of the other's ("Texas" vs. "Texas A&M"/"Texas State"/
// "Texas Tech" -- all real matchups, Texas-A&M is a rivalry game in data/rivalries.json), so a
// spread favoring the LONGER-named team ("Texas A&M -3.5") also satisfies startsWith() for the
// shorter one purely by coincidence. When both names match, the longer name is the real one --
// the string has to be at least that long for the longer match to succeed at all, so it can't be
// a coincidental prefix collision the way the shorter match can.
export function parseSpread(spread, awayName, homeName) {
  if (!spread) return { side: null, points: null };
  const awayMatch = !!(awayName && spread.startsWith(awayName));
  const homeMatch = !!(homeName && spread.startsWith(homeName));
  let side = null;
  if (awayMatch && homeMatch) side = awayName.length >= homeName.length ? 'away' : 'home';
  else if (awayMatch) side = 'away';
  else if (homeMatch) side = 'home';
  if (!side) return { side: null, points: null };
  const m = spread.match(/(-?\d+(?:\.\d+)?)\s*$/);
  return { side, points: m ? Math.abs(Number(m[1])) : null };
}

// A "tiny" underdog is one the line gives 3 points or fewer -- a coin-flip game, where the dog
// winning isn't much of an upset. 3.5 and up is a real underdog. Only used for Q3 and only in games
// with no ranked team (see gameAlert): a game with a ranked team decides its underdog by rank.
export const TINY_UNDERDOG_MAX_POINTS = 3;
// Two ranked teams need at least this many spots between them for one to count as the underdog --
// #18 leading #17 isn't a story. An unranked team is always below a ranked one.
export const MIN_UNDERDOG_RANK_GAP = 2;
// "Tight" = within one score.
export const TIGHT_GAME_MAX_MARGIN = 7;

// The underdog of a game, or { side: null } when there isn't a meaningful one.
//  - A game with a ranked team in it: the POLL decides -- the lower-ranked side (unranked counts as
//    lowest) is the underdog, given a gap of at least MIN_UNDERDOG_RANK_GAP. The betting line is
//    ignored entirely: #21 Florida, a 3.5-pt favorite at home, blowing out #4 Ole Miss is an upset to
//    anyone reading the poll, and under the old line-only rule it got no alert at all.
//  - A game with no ranked team: fall back to the betting line (src/utils/spread.js, the parser the
//    Node scripts use). No line, or one matching neither team, means no underdog rather than a guess.
export function underdogOf(g) {
  const ar = g.awayRank ?? null;
  const hr = g.homeRank ?? null;
  if (ar != null || hr != null) {
    const a = ar ?? Infinity;
    const h = hr ?? Infinity;
    if (Math.abs(a - h) < MIN_UNDERDOG_RANK_GAP) return { side: null }; // (Infinity - n is never < the gap)
    return { side: a > h ? 'away' : 'home', mode: 'rank' };
  }
  const { side: favored, points } = parseSpread(g.spread, g.awayTeam?.name, g.homeTeam?.name);
  if (!favored) return { side: null };
  return { side: favored === 'away' ? 'home' : 'away', mode: 'line', points };
}

// The live/final alert for a game: 'upset' (shown as 🔥), 'tight' (👀), or null. Only games in the
// second half or later can alert -- a first-half lead, even a 3-0 field goal, flagged about half of a
// real week's games and the favorite won 15 of the 19 flagged in Q1, so it was noise, not signal.
//
//   'upset'  the underdog (see underdogOf) is winning or tied:
//              Q3      tied or ahead -- but in a line-based game, not for a tiny underdog (line of 3
//                      or fewer), and not at all if the line has no number to judge by
//              Q4/OT   tied or ahead by any amount (a 3-point dog is still an upset by then)
//              final   the underdog won outright
//   'tight'  Q4/OT, still within one score, and not already an upset -- in ANY game, ranked or not.
//            Live only: once a game ends it is an upset or nothing, however close it was.
//   'upset' outranks 'tight', so a row never shows both. A game with no known period yet ("live"
//   before ESPN has real clock data, or period 0) never alerts -- same "Q0 isn't a real quarter"
//   convention gameStatusBadge uses.
export function gameAlert(g) {
  if (g.awayScore == null || g.homeScore == null) return null;
  const u = underdogOf(g);
  const dogScore = u.side === 'away' ? g.awayScore : g.homeScore;
  const favScore = u.side === 'away' ? g.homeScore : g.awayScore;

  if (g.status === 'final') return u.side && dogScore > favScore ? 'upset' : null;
  if (g.status !== 'in_progress' || !g.period) return null;
  if (g.period <= 2) return null; // first half (and halftime) -- see the rule above

  if (u.side) {
    const dogAhead = dogScore >= favScore;
    if (g.period === 3) {
      if (dogAhead && (u.mode === 'rank' || (u.points != null && u.points > TINY_UNDERDOG_MAX_POINTS))) return 'upset';
    } else if (dogAhead) {
      return 'upset';
    }
  }
  if (g.period >= 4 && Math.abs(g.awayScore - g.homeScore) <= TIGHT_GAME_MAX_MARGIN) return 'tight';
  return null;
}
