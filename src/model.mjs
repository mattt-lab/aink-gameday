// Joins CFB HQ's current.json (schedule, names, ranks, spread, stakes) with ESPN scoreboard events
// (live status, scores, clock) into one normalized Game list, and decides what the screen shows.
import { gameAlert } from './alerts.mjs';
import { localDate, localHour, addDays } from './time.mjs';

const SIX_HOURS = 6 * 3600 * 1000;
const DEAD = new Set(['STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_CANCELLED', 'STATUS_FORFEIT']);

const titleCase = (id) => id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function clockTextOf(ev) {
  const st = ev.status, type = st?.type;
  if (!type) return '';
  if (type.state === 'pre') return '';
  if (type.state === 'post') return type.completed ? 'Final' : '';
  if (type.name === 'STATUS_HALFTIME') return 'Half';
  const p = st.period;
  if (p >= 5) return p === 5 ? 'OT' : `${p - 4}OT`;
  if (type.name === 'STATUS_END_PERIOD') return `End ${p}Q`;
  return `${p}Q ${st.displayClock}`;
}

/**
 * @returns {Game[]} one per current.allGames entry, kickoff order.
 * Game = {id, away, home, awayName, homeName, awayRank, homeRank, when, network, spread, stakes,
 *         state, completed, dead, hasEspn, awayScore, homeScore, period, clockText, status, alert}
 */
export function buildGames(current, espnEvents = []) {
  const byId = new Map(espnEvents.map((e) => [String(e.id), e]));
  const stakes = new Map();
  for (const g of [...(current.games ?? []), ...(current.rankedNextGames ?? [])]) {
    if (g.stakesScore != null) stakes.set(g.cfbdId, g.stakesScore);
  }
  const teams = current.teams ?? {};
  const valid = (g) => g && g.cfbdId != null && g.away && g.home && !Number.isNaN(new Date(g.when).getTime());
  return current.allGames.filter(valid).map((g) => {
    const ev = byId.get(String(g.cfbdId));
    const comp = ev?.competitions?.[0];
    const side = (ha) => comp?.competitors?.find((c) => c.homeAway === ha);
    const name = (id, ha) => teams[id]?.name ?? side(ha)?.team?.location ?? titleCase(id);
    // Overall record: ESPN's (fresher), else CFB HQ's wins-losses, else none.
    const record = (id, ha) => side(ha)?.records?.find((r) => r.type === 'total')?.summary
      ?? (teams[id]?.wins != null ? `${teams[id].wins}-${teams[id].losses}` : null);
    const type = ev?.status?.type;
    const state = type?.state ?? 'pre';
    const completed = !!type?.completed;
    const dead = !!type && DEAD.has(type.name);
    const live = state === 'in' || (state === 'post' && completed);
    const score = (ha) => (live && side(ha)?.score != null ? Number(side(ha).score) : null);
    const status = state === 'in' ? 'in_progress' : state === 'post' && completed ? 'final' : 'scheduled';
    const game = {
      id: String(g.cfbdId), away: g.away, home: g.home,
      awayName: name(g.away, 'away'), homeName: name(g.home, 'home'),
      awayAbbr: side('away')?.team?.abbreviation ?? null, homeAbbr: side('home')?.team?.abbreviation ?? null,
      awayRecord: record(g.away, 'away'), homeRecord: record(g.home, 'home'),
      awayRank: g.awayRank ?? null, homeRank: g.homeRank ?? null,
      awayConf: teams[g.away]?.conf ?? null, homeConf: teams[g.home]?.conf ?? null,
      when: new Date(g.when), network: g.network ?? null, spread: g.spread ?? null,
      stakes: stakes.get(g.cfbdId) ?? null,
      state, completed, dead, hasEspn: !!ev,
      awayScore: score('away'), homeScore: score('home'),
      period: ev?.status?.period ?? null, clockText: ev ? clockTextOf(ev) : '', status,
    };
    game.alert = gameAlert({
      status, period: game.period, awayRank: game.awayRank, homeRank: game.homeRank,
      awayTeam: { name: game.awayName }, homeTeam: { name: game.homeName },
      awayScore: game.awayScore, homeScore: game.homeScore, spread: game.spread,
    });
    return game;
  }).sort((a, b) => a.when - b.when);
}

/** Week-level context the screens need from current.json: week number, ranked list, team names. */
export function weekContext(current) {
  const week = current.meta?.currentWeek;
  const r = current.rankingsByWeek?.[String(week)] ?? {};
  const teamNames = Object.fromEntries(Object.entries(current.teams ?? {}).map(([id, t]) => [id, t.name]));
  return { week, rankings: r.primary ?? [], rankingSource: r.primarySource ?? current.meta?.currentPrimarySource, teamNames };
}

/**
 * Final, postponed/cancelled, or not in progress and kicked off more than 6 h ago (no ESPN status, or a
 * stale/stuck "pre" one -- either way it must not pin the screen to an old day).
 */
export function isDone(g, now) {
  return g.completed || g.dead || (g.state !== 'in' && now - g.when > SIX_HOURS);
}

export function gamesOn(games, date, tz) {
  return games.filter((g) => localDate(g.when, tz) === date);
}

/**
 * What the screen shows:
 *  1. any game in progress -> that game's day, live
 *  2. every game of the "hold day" is done, it's before 4:00 AM the next morning, and the week still has
 *     games to come -> that day, live (finals). The week's last day skips this: the recap starts at once.
 *  3. the earliest game not done -> its day, live if any game that day is in progress, else upnext
 *  4. nothing left -> week in review
 */
export function pickView(games, now, tz) {
  const inProgress = games.find((g) => g.state === 'in' && !g.dead);
  if (inProgress) return { kind: 'day', date: localDate(inProgress.when, tz), mode: 'live' };

  const today = localDate(now, tz);
  const holdDay = localHour(now, tz) < 4 ? addDays(today, -1) : today;
  const held = gamesOn(games, holdDay, tz).filter((g) => !g.dead);
  const next = games.find((g) => !isDone(g, now));
  if (next && held.length && held.every((g) => isDone(g, now))) return { kind: 'day', date: holdDay, mode: 'live' };

  if (next) return { kind: 'day', date: localDate(next.when, tz), mode: 'upnext' };
  return { kind: 'review' };
}

const POWER = new Set(['SEC', 'Big Ten', 'Big 12', 'ACC']);
const isPower = (id, conf) => POWER.has(conf) || id === 'notre-dame';
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday, 6 = Saturday

/**
 * The games the gameday screens consider. Saturday: all of them. Any other day: only games with a
 * ranked team, the pinned team, or two Power 4 teams (Notre Dame counts), so a Tuesday of MAC games
 * doesn't take the screen. (The weekend recap still uses every game.)
 */
export function visibleGames(games, pinnedTeam, tz) {
  return games.filter((g) => weekdayOf(localDate(g.when, tz)) === 6
    || g.awayRank || g.homeRank
    || g.away === pinnedTeam || g.home === pinnedTeam
    || (isPower(g.away, g.awayConf) && isPower(g.home, g.homeConf)));
}

/** The week's Saturday is over: every game on or before the last Saturday in the data is finished. */
export function weekendDone(games, now, tz) {
  const sats = games.map((g) => localDate(g.when, tz)).filter((d) => weekdayOf(d) === 6).sort();
  const sat = sats.at(-1);
  if (!sat) return false;
  return games.filter((g) => !g.dead && localDate(g.when, tz) <= sat).every((g) => isDone(g, now));
}
