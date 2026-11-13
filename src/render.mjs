// Picks the screen for a view, builds its commands, and (optionally) sends them to the device.
import { readFileSync } from 'node:fs';
import { buildUpNext } from './screens/upnext.mjs';
import { buildLive } from './screens/live.mjs';
import { buildReview } from './screens/review.mjs';
import { buildTop25 } from './screens/top25.mjs';
import { hashCommands, stripMeta } from './screens/common.mjs';

export const EYES = JSON.parse(readFileSync(new URL('./assets/eyes.json', import.meta.url), 'utf8'));

export const REVIEW_PAGE_MS = 5 * 60 * 1000;
/** Week in Review and Top 25 Recap take turns, switching every 5 minutes. */
export function withReviewPage(view, now) {
  if (view.kind !== 'review') return view;
  return { ...view, page: Math.floor(now.getTime() / REVIEW_PAGE_MS) % 2 ? 'top25' : 'week' };
}

/** @returns {Promise<{commands, hash}>} commands still carry _volatile markers. */
export async function buildView(games, view, ctx) {
  const c = { eyes: EYES, ...ctx, dayDate: view.date };
  const commands = view.kind === 'review' ? await (view.page === 'top25' ? buildTop25 : buildReview)(games, c)
    : view.mode === 'live' ? await buildLive(games, c)
      : await buildUpNext(games, c);
  return { commands, hash: hashCommands(commands) };
}

/** Build and send. Returns {commands, hash, response}. */
export async function renderView(device, games, view, ctx, { refresh = 'full' } = {}) {
  const built = await buildView(games, view, ctx);
  const response = await device.render(stripMeta(built.commands), { refresh });
  return { ...built, response };
}
