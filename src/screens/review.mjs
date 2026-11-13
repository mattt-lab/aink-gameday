// Week in Review: shown when no tracked game is left. Pinned team's final, the week's upsets
// (biggest first) and close finishes (closest first), sharing the space below.
import { TIGHT_GAME_MAX_MARGIN } from '../alerts.mjs';
import { upsetSize } from '../rank.mjs';
import { fmtTime } from '../time.mjs';
import { PAD_X, PAD_Y, GAP, W, SCREEN_H, volatileHeaderText, alertOp } from './common.mjs';
import { teamSegs, tableOps, pinBarOps } from './rich.mjs';

const rankWeight = (g) => [g.awayRank, g.homeRank].reduce((s, r) => s + (r ? 26 - r : 0), 0);
const margin = (g) => Math.abs(g.awayScore - g.homeScore);

/**
 * ctx = { now, tz, week, pinnedTeam, metrics, measure, eyes, updatedAt }
 */
export async function buildReview(games, ctx) {
  const { tz, metrics: m, measure, eyes } = ctx;
  const finals = games.filter((g) => g.completed && g.awayScore != null);
  const pinned = finals.find((g) => g.away === ctx.pinnedTeam || g.home === ctx.pinnedTeam);
  const others = finals.filter((g) => g !== pinned);
  const upsets = others.filter((g) => g.alert === 'upset').sort((a, b) => upsetSize(b) - upsetSize(a));
  const close = others.filter((g) => g.alert !== 'upset' && margin(g) <= TIGHT_GAME_MAX_MARGIN)
    .sort((a, b) => margin(a) - margin(b) || rankWeight(b) - rankWeight(a));

  const cmds = [{ op: 'clear' }, { op: 'header', x: PAD_X, y: PAD_Y, w: W, title: `Week ${ctx.week} in Review`, subtitle: 'Next slate when CFB HQ updates', icon: 'star' }];
  let y = PAD_Y + m.headerSubH + GAP;
  if (pinned) {
    const segs = [...teamSegs(pinned.awayName, pinned.awayRank, ` ${pinned.awayScore}  -  `), ...teamSegs(pinned.homeName, pinned.homeRank, ` ${pinned.homeScore}`)];
    cmds.push(...(await pinBarOps(segs, 'Final', { x: PAD_X, y, w: W, h: m.pinBarH }, measure)));
    y += m.pinBarH + GAP;
  }

  // Both tables share what's left; drop from the longer list first, always keeping the top upset.
  const tableH = (n) => (n ? m.tableHeaderH12 + n * m.rowPitch12 : 0);
  let nu = upsets.length, nc = close.length;
  while (nu + nc > 0 && y + tableH(nu) + (nu && nc ? GAP : 0) + tableH(nc) > SCREEN_H - PAD_Y) {
    if ((nc >= nu && nc > 0) || nu <= 1) nc -= 1; else nu -= 1;
    if (nc < 0) { nc = 0; nu -= 1; }
  }

  for (const [title, list, n, alert] of [['Upsets', upsets, nu, 'upset'], ['Close finishes', close, nc, 'tight']]) {
    if (!n) continue;
    const t = await tableOps({ x: PAD_X, y, w: W, rowH: m.rowPitch12,
      columns: [{ title }, { title: '', width: 90, align: 'right' }],
      rows: list.slice(0, n).map((g) => {
        const awayWon = g.awayScore > g.homeScore;
        return [
          [...teamSegs(g.awayName, g.awayRank, '', awayWon), { text: ' at ', bold: false }, ...teamSegs(g.homeName, g.homeRank, '', !awayWon)],
          `${g.awayScore}-${g.homeScore}`,
        ];
      }) }, measure);
    cmds.push(...t.ops);
    cmds.push(alertOp(alert, PAD_X + W - 30, y + 6, 20, eyes));
    y += tableH(n) + GAP;
  }
  if (!finals.length) cmds.push({ op: 'text', x: PAD_X, y: y + 20, w: W, text: 'No games this week', size: 18, align: 'center' });

  cmds.push(volatileHeaderText(`Updated ${fmtTime(ctx.updatedAt ?? ctx.now, tz)}`, m.headerSubH));
  return cmds;
}

