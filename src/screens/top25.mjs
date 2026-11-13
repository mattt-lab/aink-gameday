// Top 25 Recap: alternates with Week in Review once the week's games are done. Two columns,
// #1-13 left and #14-25 right; each team's result. Losses are bold with the fire icon. No pinned team.
import { fmtTime } from '../time.mjs';
import { PAD_X, PAD_Y, GAP, W, SCREEN_H, BODY, volatileHeaderText, alertOp } from './common.mjs';
import { teamSegs, richOps } from './rich.mjs';

const COL_GAP = 20, ICON_W = 30, RESULT_W = 96;

/** One team's week: { text: 'W 38-17' | 'L 10-13' | 'Bye' | '-', lost, opponent: 'at #22 Missouri' | 'vs Duke' | '' } */
export function resultFor(teamId, games) {
  const g = games.find((x) => x.away === teamId || x.home === teamId);
  if (!g) return { text: 'Bye', lost: false, opponent: '' };
  const home = g.home === teamId;
  const [oName, oRank] = home ? [g.awayAbbr ?? g.awayName, g.awayRank] : [g.homeAbbr ?? g.homeName, g.homeRank];
  const opponent = `${home ? 'vs' : 'at'} ${oRank ? `#${oRank} ` : ''}${oName}`;
  if (!g.completed || g.awayScore == null) return { text: '-', lost: false, opponent };
  const us = home ? g.homeScore : g.awayScore, them = home ? g.awayScore : g.homeScore;
  return { text: `${us > them ? 'W' : 'L'} ${us}-${them}`, lost: us < them, opponent };
}

/**
 * ctx = { now, tz, week, rankings: [teamId x25], rankingSource, teamNames: {id: name}, metrics, measure, eyes, updatedAt }
 */
export async function buildTop25(games, ctx) {
  const { tz, metrics: m, measure, eyes } = ctx;
  const ids = (ctx.rankings ?? []).slice(0, 25);
  const cmds = [{ op: 'clear' }, { op: 'header', x: PAD_X, y: PAD_Y, w: W, title: `Week ${ctx.week} Top 25 Recap`, icon: 'list' }];
  const top = PAD_Y + m.headerH + GAP;
  const perCol = Math.ceil(ids.length / 2) || 13;
  const rowH = Math.floor((SCREEN_H - PAD_Y - top) / perCol);
  const colW = Math.floor((W - COL_GAP) / 2);

  for (const [i, id] of ids.entries()) {
    const col = i < perCol ? 0 : 1;
    const x = PAD_X + col * (colW + COL_GAP), y = top + (i % perCol) * rowH;
    const r = resultFor(id, games);
    if (r.lost) cmds.push(alertOp('upset', x, y + Math.round((rowH - 20) / 2), 20, eyes));
    cmds.push(
      ...(await richOps([...teamSegs(ctx.teamNames?.[id] ?? id, i + 1), ...(r.opponent ? [{ text: `  ${r.opponent}`, note: true }] : [])], { x: x + ICON_W, y, w: colW - ICON_W - RESULT_W, h: rowH, bold: r.lost }, measure)),
      { op: 'text', x: x + colW - RESULT_W, y, w: RESULT_W, h: rowH, text: r.text, size: BODY, bold: r.lost, align: 'right', valign: 'middle' },
      { op: 'line', x0: x, y0: y + rowH, x1: x + colW, y1: y + rowH },
    );
  }
  if (ids.length > perCol) {
    const dx = PAD_X + colW + COL_GAP / 2;
    cmds.push({ op: 'line', x0: dx, y0: top, x1: dx, y1: top + perCol * rowH });
  }
  if (!ids.length) cmds.push({ op: 'text', x: PAD_X, y: top + 20, w: W, text: 'No rankings yet', size: 18, align: 'center' });
  cmds.push(volatileHeaderText(`Updated ${fmtTime(ctx.updatedAt ?? ctx.now, tz)}`, m.headerH));
  return cmds;
}
