// Entry point. `run.cmd` starts the live loop; `--fixture` renders once from saved data.
//   node src/main.mjs                                    live loop (Ctrl+C to stop)
//   node src/main.mjs --fixture fixtures --now <iso> [--scores scores-x.json] [--shot out/x.png]
import { parseArgs } from 'node:util';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig } from './config.mjs';
import { createDevice } from './device.mjs';
import { measureMetrics } from './metrics.mjs';
import { buildGames, pickView, weekContext } from './model.mjs';
import { loadFixture } from './fixtures.mjs';
import { renderView, withReviewPage } from './render.mjs';

const { values: args } = parseArgs({
  options: { fixture: { type: 'string' }, now: { type: 'string' }, scores: { type: 'string' }, shot: { type: 'string' }, page: { type: 'string' } },
});

const config = loadConfig();
const device = createDevice(config.deviceUrl);

if (args.fixture) {
  const now = args.now ? new Date(args.now) : new Date();
  const { current, events } = loadFixture(args.fixture, { scoresFile: args.scores });
  const games = buildGames(current, events);
  let view = withReviewPage(pickView(games, now, config.timeZone), now);
  if (args.page && view.kind === 'review') view = { ...view, page: args.page };
  const metrics = await measureMetrics(device);
  const ctx = { now, tz: config.timeZone, pinnedTeam: config.pinnedTeam, ...weekContext(current), metrics, measure: device.measure, updatedAt: now };
  const { response } = await renderView(device, games, view, ctx);
  console.log(JSON.stringify(view), 'warnings:', JSON.stringify(response.warnings ?? []));
  if (args.shot) {
    await new Promise((r) => setTimeout(r, 2000)); // let the device settle after the refresh
    mkdirSync(dirname(args.shot), { recursive: true });
    writeFileSync(args.shot, await device.screenshot());
    console.log('screenshot ->', args.shot);
  }
} else {
  const { runLoop } = await import('./loop.mjs');
  await runLoop({ config, device });
}
