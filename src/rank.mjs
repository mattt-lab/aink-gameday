// Ordering rules: which live games get cards, which upcoming games survive when space runs out,
// and how big an upset was. Plus the two text-shortening rules the screens share.

const rankPoints = (g, base) => [g.awayRank, g.homeRank].reduce((s, r) => s + (r ? base - r : 0), 0);

/** Favourite's points from CFB HQ's spread string ("Ohio State -6.5" -> 6.5); 0 when unknown. */
export function spreadPoints(spread) {
  const m = /-(\d+(?:\.\d+)?)\s*$/.exec(spread ?? '');
  return m ? Number(m[1]) : 0;
}

const LATENESS = { 1: 0.3, 2: 0.5, 3: 0.8, 4: 1.0 };

/** How interesting a live game is right now: close + late, upsets, ranked teams. */
export function interest(g) {
  const margin = Math.abs((g.awayScore ?? 0) - (g.homeScore ?? 0));
  const late = g.period >= 5 ? 1.2 : LATENESS[g.period] ?? 0.5;
  return Math.max(0, 17 - margin) * late * 2 + (g.alert === 'upset' ? 25 : 0) + rankPoints(g, 26);
}

/** Pre-game importance. CFB HQ's real stakesScore (featured games only) always outranks the stand-in. */
export function stakesOf(g) {
  if (g.stakes != null) return 100 + g.stakes;
  return rankPoints(g, 30) + Math.max(0, 14 - spreadPoints(g.spread));
}

/** Size of a finished upset: how favoured the loser was, plus a bonus for a better-ranked loser. */
export function upsetSize(g) {
  const loserRank = g.awayScore > g.homeScore ? g.homeRank : g.awayRank;
  return spreadPoints(g.spread) + (loserRank ? 26 - loserRank : 0);
}

/** Used only when a name doesn't fit its box. */
export function shortName(name) {
  return name.replace(/ State\b/g, ' St');
}

const NETWORKS = { 'SEC Network': 'SECN', 'ACC Network': 'ACCN', 'USA Net': 'USA', Fox: 'FOX' };
export function abbrevNetwork(n) {
  return n ? NETWORKS[n] ?? n : '';
}
