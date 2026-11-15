// Live (approved layout B): up to 3 cards for the most interesting games, the pinned-team bar, one
// row per other live game, then upcoming games if every live game fit, then a one-line footer.
// When nothing is live any more (the finals hold until 4 AM) the day's finals take the cards/rows.
import { gamesOn, isDone } from '../model.mjs';
import { interest, stakesOf, abbrevNetwork, shortName, upsetSize } from '../rank.mjs';
import { fmtTime } from '../time.mjs';
import { PAD_X, PAD_Y, GAP, W, SCREEN_H, TINY, BODY, FOOTER_H, teamLabel, volatileHeaderText, footerOp, alertOp } from './common.mjs';
import { teamSegs, matchupSegs, richOps, tableOps, pinBarOps } from './rich.mjs';

const CARD_H = 134, CARD_GAP = 10, MAX_CARDS = 3;
const ALERT_W = 28, NET_W = 90;

const isPinned = (g, team) => g.away === team || g.home === team;
const rankWeight = (g) => [g.awayRank, g.homeRank].reduce((s, r) => s + (r ? 26 - r : 0), 0);

/**
 * ctx = { now, tz, dayDate, pinnedTeam, metrics, measure, eyes }
 */
export async function buildLive(games, ctx) {
  const { tz, metrics: m, measure, eyes } = ctx;
  const day = gamesOn(games, ctx.dayDate, tz).filter((g) => !g.dead);
  const pinned = day.find((g) => isPinned(g, ctx.pinnedTeam));
  const others = day.filter((g) => g !== pinned);
  const live = others.filter((g) => g.state === 'in');
  const finals = others.filter((g) => g.completed);
  const upcoming = others.filter((g) => g.state === 'pre' && !isDone(g, ctx.now));
  const finalsOnly = live.length === 0;
  const featured = (finalsOnly ? finals : live).sort((a, b) => interest(b) - interest(a));

  const cmds = [{ op: 'clear' }, { op: 'header', x: PAD_X, y: PAD_Y, w: W, title: 'Gameday - Live', icon: 'bolt' }];
  let y = PAD_Y + m.headerH + GAP;

  const cards = featured.slice(0, MAX_CARDS);
  if (cards.length) {
    const cardW = Math.floor((W - CARD_GAP * (cards.length - 1)) / cards.length);
    const records = await recordsFitAll(cards, cardW - 24 - m.scoreW - 6, measure);
    for (const [i, g] of cards.entries()) cmds.push(...(await cardOps(g, PAD_X + i * (cardW + CARD_GAP), y, cardW, m, measure, eyes, records)));
    y += CARD_H + GAP;
  }

  if (pinned) {
    const scored = pinned.awayScore != null;
    const segs = scored
      ? [...teamSegs(pinned.awayName, pinned.awayRank, ` ${pinned.awayScore}  -  `, undefined, pinned.awayAbbr), ...teamSegs(pinned.homeName, pinned.homeRank, ` ${pinned.homeScore}`, undefined, pinned.homeAbbr)]
      : matchupSegs(pinned);
    const right = [scored ? pinned.clockText : fmtTime(pinned.when, tz), abbrevNetwork(pinned.network)].filter(Boolean).join('  |  ');
    cmds.push(...(await pinBarOps(segs, right, { x: PAD_X, y, w: W, h: m.pinBarH }, measure)));
    y += m.pinBarH + GAP;
  }

  const rest = featured.slice(MAX_CARDS);
  const roomRows = (bottom) => Math.max(0, Math.floor((bottom - y) / m.rowPitch12));
  const drawRows = async (list) => {
    for (const [k, g] of list.entries()) cmds.push(...(await rowOps(g, y + k * m.rowPitch12, m, measure, eyes)));
    if (list.length) y += list.length * m.rowPitch12 + GAP;
  };
  const drawUpcoming = async (bottom) => {
    const fit = Math.max(0, Math.floor((bottom - y - m.tableHeaderH12) / m.rowPitch12));
    const ups = [...upcoming].sort((a, b) => stakesOf(b) - stakesOf(a)).slice(0, fit).sort((a, b) => a.when - b.when);
    if (!ups.length) return;
    const t = await tableOps({ x: PAD_X, y, w: W, rowH: m.rowPitch12,
      columns: [{ title: 'Up next' }, { title: 'TV', width: 100 }, { title: 'Kick', width: 110, align: 'right' }],
      rows: ups.map((g) => [matchupSegs(g), abbrevNetwork(g.network), fmtTime(g.when, tz)]) }, measure);
    cmds.push(...t.ops);
    y += t.height + GAP;
  };

  const foot = [];
  if (!finalsOnly) {
    // Other games are live: their rows first; upcoming only once every live game is on screen; finals -> footer.
    // No "+N more live" note: the header already gives the live count.
    const bottom = SCREEN_H - PAD_Y - (finals.length ? FOOTER_H : 0);
    const nRows = Math.min(rest.length, roomRows(bottom));
    await drawRows(rest.slice(0, nRows));
    if (nRows === rest.length) await drawUpcoming(bottom);
    // The day's finished upsets, biggest first (same ranking as the week review), winner first.
    // No upsets yet: the notable finals, ranked teams first.
    const upsets = finals.filter((g) => g.alert === 'upset').sort((a, b) => upsetSize(b) - upsetSize(a));
    if (upsets.length) {
      foot.push('Upsets: ' + upsets.map((g) => {
        const [win, lose] = g.awayScore > g.homeScore ? ['away', 'home'] : ['home', 'away'];
        return `${teamLabel(g[`${win}Name`], g[`${win}Rank`])} ${g[`${win}Score`]}, ${teamLabel(g[`${lose}Name`], g[`${lose}Rank`])} ${g[`${lose}Score`]}`;
      }).join('  |  '));
    } else if (finals.length) {
      const notable = [...finals].sort((a, b) => rankWeight(b) - rankWeight(a));
      foot.push('Final: ' + notable.map((g) => `${teamLabel(g.awayName, g.awayRank)} ${g.awayScore}, ${teamLabel(g.homeName, g.homeRank)} ${g.homeScore}`).join('  |  '));
    }
  } else {
    // Nothing else live (finals hold, or only the pinned game is on): games still to come first,
    // then the remaining finals as rows, then "+N more finals".
    const bottom = SCREEN_H - PAD_Y - FOOTER_H;
    await drawUpcoming(bottom);
    const nRows = Math.min(rest.length, roomRows(bottom));
    await drawRows(rest.slice(0, nRows));
    if (rest.length > nRows) foot.push(`+${rest.length - nRows} more finals`);
  }
  if (foot.length) cmds.push(footerOp(foot.join('   |   ')));

  const liveCount = live.length + (pinned?.state === 'in' ? 1 : 0);
  cmds.push(volatileHeaderText(`${fmtTime(ctx.now, tz)}  |  ${finalsOnly && !liveCount ? 'Final' : `${liveCount} live`}`, m.headerH));
  return cmds;
}

/**
 * Records are all-or-nothing across the cards: shown only if every team's "name (W-L)" fits its card
 * (the usual " State" -> " St" shortening allowed), so cards never look uneven.
 */
async function recordsFitAll(cards, nameW, measure) {
  const teams = cards.flatMap((g) => [[g.awayName, g.awayRank, g.awayRecord], [g.homeName, g.homeRank, g.homeRecord]]);
  if (teams.some(([, , rec]) => !rec)) return false;
  const label = (name, rank) => `${rank ? `${rank} ` : ''}${name}`;
  const items = teams.flatMap(([name, rank, rec]) => [
    { text: `${shortName(label(name, rank))} (${rec})`, size: BODY, bold: true }, // bold = widest case
    ...(rank ? [{ text: '#', size: TINY }] : []),
  ]);
  const widths = (await measure(items)).map((x) => x.width);
  let i = 0;
  return teams.every(([, rank]) => {
    const w = widths[i++] + (rank ? widths[i++] + 1 : 0);
    return w <= nameW;
  });
}

async function cardOps(g, x, y, cardW, m, measure, eyes, records = true) {
  const ix = x + 12, iw = cardW - 24;
  const nameW = iw - m.scoreW - 6;
  const ops = [{ op: 'rect', x, y, w: cardW, h: CARD_H, color: 'white', stroke: 'black', strokeWidth: 2, radius: 8 }];
  let tx = ix;
  if (g.alert) { ops.push(alertOp(g.alert, ix, y + 9, 24, eyes)); tx = ix + 32; }
  ops.push(
    { op: 'text', x: tx, y: y + 8, w: 120, h: 26, text: abbrevNetwork(g.network), size: TINY, valign: 'middle', maxLines: 1 },
    { op: 'text', x: ix, y: y + 8, w: iw, h: 26, text: g.clockText, size: BODY, bold: true, align: 'right', valign: 'middle' },
  );
  for (const [i, [name, rank, score, other, rec]] of [[g.awayName, g.awayRank, g.awayScore, g.homeScore, g.awayRecord], [g.homeName, g.homeRank, g.homeScore, g.awayScore, g.homeRecord]].entries()) {
    const ry = y + 36 + i * 46, bold = score > other;
    ops.push(
      ...(await richOps([...teamSegs(name, rank), ...(records && rec ? [{ text: ` (${rec})`, bold: false }] : [])], { x: ix, y: ry, w: nameW, h: 46, bold }, measure)),
      { op: 'text', x: ix + iw - m.scoreW, y: ry, w: m.scoreW, h: 48, text: String(score ?? ''), size: 24, bold, align: 'right', valign: 'middle' },
    );
  }
  return ops;
}

async function rowOps(g, y, m, measure, eyes) {
  const rowH = m.rowPitch12;
  const nameW = Math.floor((W - ALERT_W - NET_W - m.clockW) / 2);
  const ops = [{ op: 'line', x0: PAD_X, y0: y + rowH, x1: PAD_X + W, y1: y + rowH }];
  if (g.alert) ops.push(alertOp(g.alert, PAD_X, y + 6, 20, eyes));
  ops.push(
    ...(await richOps(teamSegs(g.awayName, g.awayRank, ` ${g.awayScore}`, undefined, g.awayAbbr), { x: PAD_X + ALERT_W, y, w: nameW - 8, h: rowH, bold: g.awayScore > g.homeScore }, measure)),
    ...(await richOps(teamSegs(g.homeName, g.homeRank, ` ${g.homeScore}`, undefined, g.homeAbbr), { x: PAD_X + ALERT_W + nameW, y, w: nameW - 8, h: rowH, bold: g.homeScore > g.awayScore }, measure)),
    { op: 'text', x: PAD_X + ALERT_W + 2 * nameW, y, w: NET_W, h: rowH, text: abbrevNetwork(g.network), size: TINY, valign: 'middle', maxLines: 1 },
    { op: 'text', x: PAD_X, y, w: W, h: rowH, text: g.clockText, size: BODY, align: 'right', valign: 'middle' },
  );
  return ops;
}
