// Up Next: one day's not-yet-started games, kickoff order, lowest stakes dropped first when they don't fit.
import { gamesOn, isDone } from '../model.mjs';
import { stakesOf, abbrevNetwork } from '../rank.mjs';
import { colWidth } from '../metrics.mjs';
import { fmtTime, fmtDayTitle, localDate, localHour } from '../time.mjs';
import { PAD_X, PAD_Y, GAP, W, SCREEN_H, BODY, volatileHeaderText, footerOp } from './common.mjs';
import { matchupSegs, tableOps } from './rich.mjs';

const FOOTER_RESERVE = GAP + 20;

/**
 * ctx = { now, tz, dayDate, metrics, measure, updatedAt }
 */
export async function buildUpNext(games, ctx) {
  const { tz, metrics: m, measure } = ctx;
  const pending = gamesOn(games, ctx.dayDate, tz).filter((g) => g.state === 'pre' && !g.dead && !isDone(g, ctx.now));
  const first = pending[0]?.when ?? new Date(`${ctx.dayDate}T19:00:00Z`);
  const tonight = ctx.dayDate !== localDate(ctx.now, tz) ? '' : localHour(ctx.now, tz) >= 16 ? '  (Tonight)' : '  (Today)';

  const tableTop = PAD_Y + m.headerSubH + GAP;
  const rowsFor = (reserve) => Math.max(0, Math.floor((SCREEN_H - PAD_Y - tableTop - m.tableHeaderH12 - reserve) / m.rowPitch12));
  let n = rowsFor(0);
  if (pending.length > n) n = rowsFor(FOOTER_RESERVE);
  const shown = [...pending].sort((a, b) => stakesOf(b) - stakesOf(a)).slice(0, n).sort((a, b) => a.when - b.when);
  const hidden = pending.length - shown.length;

  const kicks = shown.map((g) => fmtTime(g.when, tz));
  const nets = shown.map((g) => abbrevNetwork(g.network));
  const [kickW, tvW] = await Promise.all([colWidth({ measure }, ['Kick', ...kicks], BODY, true), colWidth({ measure }, ['TV', ...nets], BODY, true)]);

  const cmds = [
    { op: 'clear' },
    { op: 'header', x: PAD_X, y: PAD_Y, w: W, title: 'Gameday - Up Next', subtitle: fmtDayTitle(first, tz) + tonight, icon: 'calendar' },
  ];
  if (shown.length) {
    const t = await tableOps({ x: PAD_X, y: tableTop, w: W, rowH: m.rowPitch12,
      columns: [{ title: 'Kick', width: kickW }, { title: 'Matchup' }, { title: 'TV', width: tvW }],
      rows: shown.map((g, i) => [kicks[i], matchupSegs(g), nets[i]]) }, measure);
    cmds.push(...t.ops);
  } else {
    cmds.push({ op: 'text', x: PAD_X, y: tableTop + 20, w: W, text: 'No more games today', size: 18, align: 'center' });
  }
  if (hidden) cmds.push(footerOp(`+${hidden} lower-stakes games hidden`));
  cmds.push(volatileHeaderText(`Updated ${fmtTime(ctx.updatedAt ?? ctx.now, tz)}`, m.headerSubH));
  return cmds;
}

