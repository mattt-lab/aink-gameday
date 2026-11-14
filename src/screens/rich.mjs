// Mixed-size text: the device draws one size per text op, so a line like "#4 UCLA" with a tiny,
// top-aligned "#" is laid out here as several ops placed side by side from measured widths.
// Also a table drawn the same way (the device's own table op can't mix sizes inside a cell).
import { shortName } from '../rank.mjs';
import { BODY } from './common.mjs';
import { tinyWidth, tinyTextOp, TINY_H } from '../tinyfont.mjs';

const CAP = { 9: 12, 12: 17, 18: 25, 24: 33 }; // cap heights reported by the device's font list
const HASH_GAP = 1;

/**
 * Segments for a team: [{text:'#', small:true}, {text:'4 UCLA'}] or [{text:'UCLA'}]. Extra text is appended.
 * `bold` (optional) overrides the line's weight for this team's text.
 */
export function teamSegs(name, rank, suffix = '', bold) {
  const main = { text: `${rank ? `${rank} ` : ''}${name}${suffix}`, ...(bold === undefined ? {} : { bold }) };
  return rank ? [{ text: '#', small: true }, main] : [main];
}

/** "#18 USC at #9 Indiana" as segments. */
export function matchupSegs(g) {
  return [...teamSegs(g.awayName, g.awayRank, ' at '), ...teamSegs(g.homeName, g.homeRank)];
}

export const plain = (segs) => segs.map((s) => s.text).join('');

/**
 * Lay out segments left-aligned in the box (x, y, w, h), vertically centred like a valign:'middle'
 * text op. Small segments are size 9, top-aligned with the main text's cap line (superscript look).
 * If the line is too wide, " State" -> " St"; anything still too wide is truncated by the last op.
 */
export async function richOps(segs, { x, y, w, h, size = BODY, bold = false }, measure) {
  const smallSize = 9;
  // small: size-9 top-aligned mark ('#'); note: 5x7 pixel-font trailing text (e.g. an opponent), centred
  const sized = (list) => list.map((s) => ({ ...s, size: s.small || s.note ? smallSize : size }));
  let parts = sized(segs);
  const weight = (p) => (p.small || p.note ? false : p.bold ?? bold);
  const widthsOf = async (ps) => (await measure(ps.map((p) => ({ text: p.text, size: p.size, bold: weight(p) })))).map((m, i) => (ps[i].note ? tinyWidth(ps[i].text) + 6 : m.width));
  let widths = await widthsOf(parts);
  const total = () => widths.reduce((a, b, i) => a + b + (parts[i].small ? HASH_GAP : 0), 0);
  // Optional segments (e.g. a record) are the first thing dropped when the line doesn't fit.
  if (total() > w && segs.some((s) => s.optional)) {
    segs = segs.filter((s) => !s.optional);
    parts = sized(segs);
    widths = await widthsOf(parts);
  }
  if (total() > w) {
    parts = sized(segs.map((s) => (s.small ? s : { ...s, text: shortName(s.text) })));
    widths = await widthsOf(parts);
  }
  const capTop = y + Math.round((h - CAP[size]) / 2);
  const ops = [];
  let cx = x;
  for (const [i, p] of parts.entries()) {
    const room = x + w - cx;
    if (room <= 4) break;
    if (p.note) {
      // the pixel font has no ellipsis: show the note only if it fits completely
      if (widths[i] <= room) ops.push(tinyTextOp(p.text.trim(), cx + 6, y + Math.round((h - TINY_H) / 2)));
      cx += widths[i];
    } else if (p.small) {
      ops.push({ op: 'text', x: cx, y: capTop, text: p.text, size: smallSize });
      cx += widths[i] + HASH_GAP;
    } else {
      ops.push({ op: 'text', x: cx, y, w: room, h, text: p.text, size, bold: weight(p), valign: 'middle', maxLines: 1 });
      cx += widths[i];
    }
  }
  return ops;
}

/**
 * A table drawn with plain ops: bold header row, a line under it and under every row, fixed row pitch.
 * columns: [{ title, width (0 = take the rest), align: 'left'|'right' }]
 * rows: arrays of cells; a cell is a string or a segments array (left-aligned only).
 * @returns {Promise<{ops, height}>}
 */
export async function tableOps({ x, y, w, columns, rows, rowH }, measure) {
  const PAD = 8;
  const fixed = columns.reduce((s, c) => s + (c.width || 0), 0);
  const flex = columns.filter((c) => !c.width).length;
  const widths = columns.map((c) => c.width || Math.floor((w - fixed) / flex));
  const xs = widths.reduce((acc, cw, i) => [...acc, acc[i] + cw], [x]);
  const ops = [];
  const cell = async (content, i, cy, bold) => {
    const box = { x: xs[i] + PAD, y: cy, w: widths[i] - 2 * PAD, h: rowH };
    if (Array.isArray(content)) return richOps(content, { ...box, bold }, measure);
    return [{ op: 'text', ...box, text: content ?? '', size: BODY, bold, align: columns[i].align ?? 'left', valign: 'middle', maxLines: 1 }];
  };
  for (const [i, c] of columns.entries()) if (c.title) ops.push(...(await cell(c.title, i, y, true)));
  ops.push({ op: 'line', x0: x, y0: y + rowH, x1: x + w, y1: y + rowH, thickness: 2 });
  for (const [r, row] of rows.entries()) {
    const cy = y + rowH * (r + 1);
    for (const [i, content] of row.entries()) ops.push(...(await cell(content, i, cy, false)));
    ops.push({ op: 'line', x0: x, y0: cy + rowH, x1: x + w, y1: cy + rowH });
  }
  // Plain-text description for tests/debugging; stripped before sending (see common.stripMeta).
  if (ops.length) ops[0]._table = { columns: columns.map((c) => c.title), rows: rows.map((r) => r.map((c) => (Array.isArray(c) ? plain(c) : c))) };
  return { ops, height: rowH * (rows.length + 1) };
}

/**
 * The pinned-team bar drawn with plain ops (so ranks can carry the tiny '#'):
 * rounded 1px box, star icon, bold size-18 line, size-12 right-hand text.
 */
export async function pinBarOps(segs, right, { x, y, w, h }, measure) {
  const [rw] = await measure([{ text: right, size: BODY }]);
  const textX = x + 10 + 20 + 10;
  return [
    { op: 'rect', x, y, w, h, color: 'white', stroke: 'black', strokeWidth: 1, radius: 6, _pinBar: { text: plain(segs), right } },
    { op: 'icon', name: 'star', x: x + 10, y: y + Math.round((h - 20) / 2), size: 20 },
    ...(await richOps(segs, { x: textX, y, w: x + w - 10 - rw.width - 10 - textX, h, size: 18, bold: true }, measure)),
    { op: 'text', x, y, w: w - 10, h, text: right, size: BODY, align: 'right', valign: 'middle' },
  ];
}
