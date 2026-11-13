// Picks the screen for a view, builds its commands, and (optionally) sends them to the device.
import { readFileSync } from 'node:fs';
import { buildUpNext } from './screens/upnext.mjs';
import { buildLive } from './screens/live.mjs';
import { buildReview } from './screens/review.mjs';
import { hashCommands, stripMeta } from './screens/common.mjs';

export const EYES = JSON.parse(readFileSync(new URL('./assets/eyes.json', import.meta.url), 'utf8'));

/** @returns {Promise<{commands, hash}>} commands still carry _volatile markers. */
export async function buildView(games, view, ctx) {
  const c = { eyes: EYES, ...ctx, dayDate: view.date };
  const commands = view.kind === 'review' ? await buildReview(games, c)
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
