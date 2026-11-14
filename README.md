# aink-gameday

A college-football gameday screen for the **AInk** e-ink display (ukielab.com, `aink-7.5`, 800×480).
It reformats data that [CFB HQ](https://github.com/mattt-lab/CFB_top25) already publishes into
three screens:

| Screen | When |
|---|---|
| **Up Next** | Before games: the day's not-yet-started games with kickoff times and TV. When they don't all fit, the lowest-stakes games are dropped first. |
| **Live** | As soon as any game that day is in progress. Up to 3 big cards for the most interesting games, Washington's bar, other live scores, then upcoming games if there's room. Final scores stay up until 4:00 AM. |
| **Week in Review** | When no game is left in CFB HQ's data (Sunday until its Monday run, and the off-season). Washington's final, the week's upsets 🔥 and close finishes 👀. |

🔥 / 👀 follow exactly the same rules as the CFB HQ website (see *Kept in sync* below).

## Running it

Double-click `run.cmd`, or run it in a `cmd` window. It checks every 60 s and prints one line per
check. Press Ctrl+C to stop.

```bash
run.cmd
```

The display only accepts requests from its own Wi-Fi network, so this must run on a machine on
that network. Requirements: Node 20+ and nothing else (no `npm install` needed).

**Config:** `config.json`
- `deviceUrl`: the AInk's address. The environment variable `AINK_URL` overrides it, for example
  `set AINK_URL=http://192.168.1.50` before `run.cmd`.
- `pinnedTeam`: the always-shown team (`washington`).
- `timeZone`: optional. Defaults to the computer's time zone.
- `quietHours`: optional `[start, end]` local hours when the display is left alone. Defaults to
  `[23, 7]` (11 PM to 7 AM). Data keeps updating overnight; the screen catches up at 7 AM.

**Refresh cadence:**
- CFB HQ data: every 15 min.
- ESPN: every check while a game is live or about to start, otherwise every 10 min.
- Screen: redraws only when its content changed, and at most every 2 min in live mode, because
  every e-ink refresh flashes.

## Data sources (no CFBD API calls)

- **CFB HQ's published `data/current.json`** (raw GitHub): schedule, team names, rankings, TV
  network, spread, stakes.
- **ESPN's free public scoreboard:** live status, scores and clock. CFB HQ's `cfbdId` equals
  ESPN's event id, so no name mapping is needed.

## Checking screens without a game on

Render once from saved data and save a screenshot:

```bash
node src/main.mjs --fixture fixtures --now 2026-11-14T21:47:00Z --scores scores-sat-1447.json --shot out/live-sat.png
```

`fixtures/` holds a real `current.json` and ESPN scoreboards from 2026-11-13/14, plus made-up
score overlays (`scores-*.json`).

## Tests

```bash
npm test
```

## Kept in sync with CFB HQ

- **`src/alerts.mjs`** is a line-for-line copy of CFB HQ's `gameAlert` / `underdogOf` and their
  constants (`src/data/teams.js`) plus `parseSpread` (`src/utils/spread.js`). When those change,
  re-port them here and run `npm test`. CFB HQ has matching "MIRRORED IN aink-gameday" comments.
- **`allGames[]` fields read here:** `cfbdId`, `when`, `network`, `away`/`home`, `awayRank`/`homeRank`
  and `spread`. Also `meta.currentWeek`, `teams[id].name`, and `stakesScore` from
  `games[]`/`rankedNextGames[]`. CFB HQ's `docs/data-schema.md` points back here.
- **`src/assets/eyes.json`:** the 👀 icon, generated once on Windows by `scripts/make-eyes.py`
  (the device can't draw emoji).

Design: `docs/superpowers/specs/2026-11-13-aink-gameday-design.md`.
