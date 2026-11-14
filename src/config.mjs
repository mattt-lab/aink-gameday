import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function loadConfig(path = 'config.json', env = process.env) {
  // Relative paths resolve from the project root, not cwd.
  const raw = JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
  const cfg = { ...raw };
  if (env.AINK_URL) cfg.deviceUrl = env.AINK_URL;
  if (!cfg.timeZone) cfg.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Where the finished weekend is saved so the recap survives CFB HQ's Sunday rollover and restarts.
  cfg.snapshotPath = resolve(ROOT, cfg.snapshotPath ?? 'cache/last-week.json');
  // One line per minute; cleared each time run.cmd starts.
  cfg.logPath = resolve(ROOT, cfg.logPath ?? 'logs/dashboard.log');
  return cfg;
}
