// Shared geometry, text helpers and the redraw hash for all three screens.
import { createHash } from 'node:crypto';

export const SCREEN_W = 800, SCREEN_H = 480;
export const PAD_X = 20, PAD_Y = 12, GAP = 12;
export const W = SCREEN_W - 2 * PAD_X; // 760
export const TINY = 9, BODY = 12;

/** '#13 Wake Forest' / 'SMU' -- single-size text (footer); screens use rich.mjs for the tiny '#'. */
export const teamLabel = (name, rank) => (rank ? `#${rank} ` : '') + name;

/** The "Updated 9:40 AM" / "2:47 PM | 7 live" text: drawn over the header's right end, excluded from the hash. */
export function volatileHeaderText(text, headerH) {
  return { op: 'text', x: PAD_X, y: PAD_Y, w: W - 12, h: headerH, text, size: BODY, color: 'white', align: 'right', valign: 'middle', _volatile: true };
}

/** Bottom-of-screen one-liner (size 9). */
export function footerOp(text) {
  return { op: 'text', x: PAD_X, y: SCREEN_H - PAD_Y - 22, w: W, h: 22, text, size: TINY, valign: 'middle', maxLines: 1 };
}

export const FOOTER_H = 26;

/** 🔥 = device fire icon, 👀 = committed 1-bit image (the device drops emoji). */
export function alertOp(alert, x, y, px, eyes) {
  if (alert === 'upset') return { op: 'icon', name: 'fire', x, y: y - 2, size: px + 4 };
  const e = eyes[String(px)];
  return { op: 'image', x, y: y + Math.floor((px - e.h) / 2), w: e.w, h: e.h, data: e.data };
}

/** Hash of everything that's actually content (volatile ops dropped). */
export function hashCommands(cmds) {
  return createHash('sha1').update(JSON.stringify(cmds.filter((c) => !c._volatile))).digest('hex');
}

/** Commands as sent to the device (internal `_`-prefixed keys removed). */
export function stripMeta(cmds) {
  return cmds.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => !k.startsWith('_'))));
}
