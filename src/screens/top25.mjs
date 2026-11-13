// Top 25 Recap: alternates with Week in Review once the week's games are done. Two columns,
// #1-13 left and #14-25 right; each team's result. Losses are bold with the fire icon. No pinned team.
import { fmtTime } from '../time.mjs';
import { PAD_X, PAD_Y, GAP, W, SCREEN_H, BODY, volatileHeaderText, alertOp } from './common.mjs';
import { teamSegs, richOps } from './rich.mjs';

const COL_GAP = 20, ICON_W = 30, RESULT_W = 96;
const SOURCE = { cfp: 'CFP', ap: 'AP', coaches: 'Coaches' };

/** One team's week: { text: 'W 38-17' | 'L 10-13' | 'Bye' | '-', lost } */
export function resultFor(teamId, games) {
  const g = games.find((x) => x.away === teamId || x.home === teamId);
  if (!g) return { text: 'Bye', lost: false };
  if (!g.completed || g.awayScore == null) return { text: '-', lost: false };
  const home = g.home === teamId;
  const us = home ? g.homeScore : g.awayScore, them = home ? g.awayScore : g.homeScore;
  return { text: `${us > them ? 'W' : 'L'} ${us}-${them}`, lost: us < them };
}

/**
 * ctx = { now, tz, week, rankings: [teamId x25], rankingSource, teamNames: {id: name}, metrics, measure, eyes, updatedAt }
 */
export async function buildTop25(games, ctx) {
  const { tz, metrics: m, measure, eyes } = ctx;
  const ids = (ctx.rankings ?? []).slice(0, 25);
  const source = SOURCE[ctx.rankingSource] ?? 'Top 25';
  const cmds = [{ op: 'clear' }, { op: 'header', x: PAD_X, y: PAD_Y, w: W, title: `Week ${ctx.week} Top 25 Recap`, subtitle: `${source} rankings going into the week`, icon: 'list' }];
  const top = PAD_Y + m.headerSubH + GAP;
  const perCol = Math.ceil(ids.length / 2) || 13;
  const rowH = Math.floor((SCREEN_H - PAD_Y - top) / perCol);
  const colW = Math.floor((W - COL_GAP) / 2);

  for (const [i, id] of ids.entries()) {
    const col = i < perCol ? 0 : 1;
    const x = PAD_X + col * (colW + COL_GAP), y = top + (i % perCol) * rowH;
    const r = resultFor(id, games);
    if (r.lost) cmds.push(alertOp('upset', x, y + Math.round((rowH - 20) / 2), 20, eyes));
    cmds.push(
      ...(await richOps(teamSegs(ctx.teamNames?.[id] ?? id, i + 1), { x: x + ICON_W, y, w: colW - ICON_W - RESULT_W, h: rowH, bold: r.lost }, measure)),
      { op: 'text', x: x + colW - RESULT_W, y, w: RESULT_W, h: rowH, text: r.text, size: BODY, bold: r.lost, align: 'right', valign: 'middle' },
      { op: 'line', x0: x, y0: y + rowH, x1: x + colW, y1: y + rowH },
    );
  }
  if (ids.length > perCol) {
    const dx = PAD_X + colW + COL_GAP / 2;
    cmds.push({ op: 'line', x0: dx, y0: top, x1: dx, y1: top + perCol * rowH });
  }
  if (!ids.length) cmds.push({ op: 'text', x: PAD_X, y: top + 20, w: W, text: 'No rankings yet', size: 18, align: 'center' });
  cmds.push(volatileHeaderText(`Updated ${fmtTime(ctx.updatedAt ?? ctx.now, tz)}`, m.headerSubH));
  return cmds;
}
