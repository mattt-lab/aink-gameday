# AInk Gameday Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A dependency-free Node script, started from `run.cmd`, that keeps the AInk e-ink display
showing CFB gameday screens (Up Next, Live, Week in Review), using CFB HQ's published
`current.json` plus ESPN's free scoreboard.

**Architecture:**
- **Pure modules:** they turn data (current.json + ESPN events + "now") into a normalized game
  list, a display-day decision, and a screen's command list.
- **`device.mjs`:** the only module that talks to the AInk (health, measure, dry-run, render).
- **`main.mjs`:** runs a 60 s loop that refetches on a cadence and redraws only when the screen's
  hash changes.

**Tech Stack:** Node 24 (≥20 works), ESM `.mjs`, built-in `fetch`, `node:test` +
`node:assert/strict`, no npm dependencies. A one-off Python/Pillow script generates the eyes glyph
asset.

**Spec:** `docs/superpowers/specs/2026-11-13-aink-gameday-design.md`. Approved screens:
`docs/prototypes/approved-*.png` and `review-week-mockup.png`. Geometry source:
`docs/prototypes/live_fit.py`, `upnext_fit.py`, `review_fit.py`.

## Global Constraints

- **Zero CFBD API calls.** Data comes only from
  `https://raw.githubusercontent.com/mattt-lab/CFB_top25/main/data/current.json` and
  `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&dates=YYYYMMDD`.
- **Zero npm dependencies.** `package.json` has `"type": "module"`, a `"test": "node --test"`
  script, and `"engines": {"node": ">=20"}`.
- **Join key:** `allGames[].cfbdId` (number) equals the ESPN `event.id` (string).
- **Type sizes:** only 9, 12, 18, 24. Card height 134, card gap 10, live row height 33, padding
  x 20 / y 12, gap 12, screen 800×480.
- **Alerts:** a line-for-line port of CFB HQ `gameAlert` / `underdogOf` / `parseSpread` with
  constants `TINY_UNDERDOG_MAX_POINTS = 3`, `MIN_UNDERDOG_RANK_GAP = 2`,
  `TIGHT_GAME_MAX_MARGIN = 7`. Upset is shown as the device `fire` icon, tight as the eyes PBM
  image. The spec's "within 8" wording is superseded by the real constant, 7.
- **Team names:** `current.json` `teams[id].name` (134 FBS teams), which is also what CFB HQ feeds
  `parseSpread`. Fallback is ESPN `team.location`, then the id title-cased. Shorten `" State"` to
  `" St"` only when the text is too wide. Never shrink fonts.
- **Network abbreviations:** `SEC Network→SECN`, `ACC Network→ACCN`, `USA Net→USA`, `Fox→FOX`.
- **Time zone:** the host's (`Intl.DateTimeFormat().resolvedOptions().timeZone`), overridable via
  `config.json` `timeZone`. Times are formatted `h:mm AM/PM`.
- **Day rules:**
  - A game counts as done when ESPN says `completed`, or when it has no ESPN status and kicked
    off more than 6 h ago.
  - Finals stay up until 4:00 AM local.
  - With no remaining game in the data, show Week in Review.
- **Redraw rules:** redraw only when the command hash changes (the "Updated" time is excluded).
  In live mode, redraw at most every 2 min.
- **Pinned team:** `pinnedTeam: "washington"`.
- **CFB HQ change:** comments only, plus a `package.json` patch-version bump. Commit and push to
  `main` (owner approved).

## Review Focus

1. **ESPN or GitHub down / slow / returns HTML.** The loop must log and keep the last good data.
   It must never crash or blank the screen. *Test in Task 7.*
2. **Device unreachable mid-run** (Wi-Fi blip, DHCP change). Log "device unreachable", retry next
   pass, and draw on reconnect, even if the hash didn't change. *Test in Task 7.*
3. **Postponed or cancelled game** (ESPN `state:"post"` with `completed:false`, or
   `STATUS_POSTPONED`). It must not pin the display day or count as live. *Test in Task 3.*
4. **A team missing from `teams`, or a null spread/network/rank.** Names fall back, and missing
   cells render blank rather than "null"/"undefined". *Test in Task 3 (names) and Task 5 (cells).*
5. **Overtime and halftime clocks.** ESPN reports period 5+ and `STATUS_HALFTIME`. The clock text
   must read `OT` / `2OT` / `Half`, OT must count for tight alerts, and halftime must not alert.
   *Test in Task 2 (alerts) and Task 3 (clock text).*

---

### Task 1: Project skeleton, config, device client

**Files:**
- Create: `package.json`, `config.json`, `run.cmd`, `.gitignore` (`node_modules/`, `*.log`),
  `src/config.mjs`, `src/device.mjs`
- Test: `test/config.test.mjs`, `test/device.test.mjs`

**Interfaces:**
- Produces:
  - `loadConfig(path = 'config.json', env = process.env) -> { deviceUrl, pinnedTeam, currentJsonUrl, espnBase, timeZone }`
  - `createDevice(baseUrl, fetchFn = fetch) -> { health(), measure(items), naturalHeight(op), render(commands, { refresh = 'full' }), screenshot() }`
  - `naturalHeight(op)` POSTs `{dryRun:true, commands:[{...op, x:20, y:0, w:760}]}` and returns
    `validation.commands[0].bbox[3]`. Every method rejects with `Error('device unreachable: …')`
    on network failure.

- [ ] **Step 1: Write the failing tests.**
  - `config: defaults` asserts `deviceUrl === 'http://192.168.200.119'`, `pinnedTeam === 'washington'`, and a non-empty `timeZone`.
  - `config: AINK_URL overrides deviceUrl` uses env `{AINK_URL:'http://x'}` and asserts `deviceUrl === 'http://x'`.
  - `device: naturalHeight posts a dryRun and returns bbox height` uses a fake fetch returning `{validation:{commands:[{bbox:[0,0,800,572]}]}}`, then asserts the result is `572` and the posted body has `dryRun:true`, `x:20`, `w:760`.
  - `device: network error becomes 'device unreachable'` uses a fake fetch that throws, then asserts the rejection message matches `/device unreachable/`.
- [ ] **Step 2: Run `npm test`.** Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - `config.json`: `{"deviceUrl":"http://192.168.200.119","pinnedTeam":"washington","currentJsonUrl":"https://raw.githubusercontent.com/mattt-lab/CFB_top25/main/data/current.json","espnBase":"https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard"}`
  - `run.cmd`: `@echo off`, `cd /d %~dp0`, `node src\main.mjs %*`.
- [ ] **Step 4: Run `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: project skeleton, config and device client"`

### Task 2: Alerts port (shared with CFB HQ)

**Files:**
- Create: `src/alerts.mjs`
- Test: `test/alerts.test.mjs`

**Interfaces:**
- Produces:
  - `parseSpread(spread, awayName, homeName) -> {side, points}`
  - `underdogOf(g) -> {side, mode?, points?}`
  - `gameAlert(g) -> 'upset'|'tight'|null`
  - `TIGHT_GAME_MAX_MARGIN`
  - Here `g` has `{status:'scheduled'|'in_progress'|'final', period, awayRank, homeRank, awayTeam:{name}, homeTeam:{name}, awayScore, homeScore, spread}`, the same shape CFB HQ uses.

- [ ] **Step 1: Write the failing tests.**
  - Copy the `describe('gameAlert', …)` block from `cfb-top25-tracker/src/data/teams.test.js` (starting at line 338) and the cases from `src/utils/spread.test.js`. Convert `expect(x).toBe(y)` to `assert.equal(x, y)` and `toBeNull()` to `assert.equal(x, null)`.
  - Add `alerts: OT counts as tight`: `period 5`, scores `20–24`, unranked, no spread, asserts `'tight'`.
  - Add `alerts: halftime never alerts`: `period 2`, `status 'in_progress'`, underdog ahead, asserts `null`.
- [ ] **Step 2: Run `node --test test/alerts.test.mjs`.** Expected: FAIL.
- [ ] **Step 3: Implement `src/alerts.mjs`.**
  - Copy the three functions and three constants verbatim from `cfb-top25-tracker/src/data/teams.js` (lines ~350–418) and `src/utils/spread.js`, as ES exports.
  - Header comment: `// MIRRORED FROM cfb-top25-tracker: src/data/teams.js (gameAlert, underdogOf + constants) and src/utils/spread.js (parseSpread). When those change, re-port here and re-run tests. Ported 2026-11-13 from commit <short sha of cfb-top25-tracker HEAD>.`
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: port CFB HQ game alert rules"`

### Task 3: Game model, display day, mode

**Files:**
- Create: `src/model.mjs`, `src/time.mjs`
- Create fixtures:
  - `fixtures/current-2026-11-11.json` (copy of `cfb-top25-tracker/data/current.json`)
  - `fixtures/espn-20261114-pre.json` (ESPN scoreboard, `dates=20261114`, fetched once)
  - `fixtures/espn-20261113-pre.json` (same for `dates=20261113`)
- Test: `test/model.test.mjs`, `test/time.test.mjs`

**Interfaces:**
- Consumes: `gameAlert`, `parseSpread` (Task 2).
- Produces:
  - `time.mjs`:
    - `localDate(date, tz) -> 'YYYY-MM-DD'`
    - `fmtTime(date, tz) -> '1:30 PM'`
    - `fmtDayTitle(date, tz) -> 'Saturday, Nov 14'`
    - `ymd(localDateStr) -> 'YYYYMMDD'`
    - `localHour(date, tz) -> number`
  - `model.mjs`:
    - `buildGames(current, espnEvents[]) -> Game[]`, where `Game = {id, away, home, awayName, homeName, awayRank, homeRank, when:Date, network, spread, stakes:number|null, state:'pre'|'in'|'post', completed:boolean, awayScore, homeScore, period, clockText, status:'scheduled'|'in_progress'|'final', alert:'upset'|'tight'|null}`.
    - `pickView(games, now, tz) -> {kind:'day', date, mode:'live'|'upnext'} | {kind:'review'}`
    - `gamesOn(games, date, tz) -> Game[]`
    - `isDone(game, now) -> boolean`
  - `stakes` comes from `games[]` / `rankedNextGames[]` `stakesScore`, joined by `cfbdId`.
  - `clockText` is one of `'3Q 8:40'`, `'Half'`, `'OT'`, `'2OT'`, `'Final'`, or `''` for pre-game.
  - `status` maps from ESPN state (`pre→scheduled`, `in→in_progress`, `post+completed→final`). `alert = gameAlert(...)` uses `awayTeam:{name: awayName}`.

- [ ] **Step 1: Write the failing tests.**
  - `buildGames joins all 56 Saturday games by cfbdId` asserts 56 games on `'2026-11-14'` in `America/Phoenix`.
  - `stakes joined from rankedNextGames` asserts the Illinois–UCLA game has `stakes === 10.5`.
  - `names fall back` deletes `teams['duke']` from a fixture copy, then asserts the Duke game's `awayName === 'Duke'` (from ESPN `location`).
  - `pickView: Friday noon -> day 2026-11-13 upnext` uses `now = 2026-11-13T19:00Z`.
  - `pickView: any game in -> live` overrides the FSU–Pitt event to `state:'in'`.
  - `pickView: all final at 11 PM keeps the day; at 4:05 AM rolls to next day`.
  - `pickView: no ESPN status and kicked off 7h ago counts as done`.
  - `pickView: postponed game does not pin the day` uses ESPN `state:'post', completed:false, name:'STATUS_POSTPONED'` on the earliest game and asserts the day advances past it, with mode not `'live'`.
  - `pickView: nothing left -> review` uses `now = 2026-11-16T12:00Z` with all games done.
  - `clockText: period 5 -> 'OT', period 6 -> '2OT', STATUS_HALFTIME -> 'Half'`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Date math goes through `Intl.DateTimeFormat(…, {timeZone})` parts. No libraries.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: game model, display-day and mode rules"`

### Task 4: Ranking, layout metrics, eyes asset

**Files:**
- Create: `src/rank.mjs`, `src/metrics.mjs`, `scripts/make-eyes.py`, `src/assets/eyes.json`
- Test: `test/rank.test.mjs`, `test/metrics.test.mjs`

**Interfaces:**
- Produces:
  - `rank.mjs`:
    - `interest(g) -> number`. Port of `live_fit.py` `interest`: margin closeness × lateness (Q1 .3, Q2 .5, Q3 .8, Q4 1.0, OT 1.2) × 2, plus 25 if `alert==='upset'`, plus Σ(26−rank).
    - `stakesOf(g) -> number`. If `g.stakes` is set: `100 + g.stakes`, so real scores always outrank stand-ins. Otherwise Σ(30−rank) + max(0, 14 − spread points).
    - `upsetSize(g) -> number`
    - `shortName(name) -> string`
    - `abbrevNetwork(n) -> string`
  - `metrics.mjs`:
    - `measureMetrics(device) -> {scoreW, clockW, rowPitch12, tableHeaderH12, headerH, headerSubH, pinBarH}`. Measured once per run; `rowPitch12` = height(2-row table) − height(1-row table).
    - `colWidth(device, strings, size, bold) -> max width + 16`
  - `eyes.json`: `{ "20": {w,h,data}, "24": {w,h,data} }` (base64 PBM P4), generated by `py scripts\make-eyes.py > src\assets\eyes.json` using `docs/prototypes/live_fit.py` `eyes()`.

- [ ] **Step 1: Write the failing tests.**
  - `interest: upset outranks a close Q1 game`
  - `interest: Q4 one-score beats Q3 one-score`
  - `stakesOf: real stakesScore beats any stand-in`
  - `shortName('New Mexico State') === 'New Mexico St'`
  - `abbrevNetwork('SEC Network') === 'SECN'`
  - `measureMetrics computes rowPitch from two dry runs`, with a fake device returning heights 99 then 66, asserts `rowPitch12 === 33`.
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement, then generate `eyes.json`** (requires Pillow plus `C:\Windows\Fonts\seguiemj.ttf`, Windows only; the output is committed).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: ranking rules, layout metrics, eyes glyph asset"`

### Task 5: Screen builders (Up Next, Live, Review)

**Files:**
- Create: `src/screens/common.mjs`, `src/screens/upnext.mjs`, `src/screens/live.mjs`, `src/screens/review.mjs`
- Create fixture: `fixtures/scores-sat-1447.json` (the `SCORES`/`FINAL` tables from `docs/prototypes/live_fit.py` as `{ "<cfbdId>": {away, home, period, clock, state} }`) and `fixtures/scores-fri-1940.json`. Build them once with a small throwaway script.
- Test: `test/screens.test.mjs`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `buildUpNext(games, ctx) -> commands[]`
  - `buildLive(games, ctx) -> commands[]`
  - `buildReview(games, ctx) -> commands[]`
  - Here `ctx = {now, tz, dayDate, week, pinnedTeam, metrics, eyes, updatedAt}`.
  - The "Updated" text is the last command, tagged `{_volatile:true}`. `common.mjs` `hashCommands(cmds)` drops `_volatile` ops before hashing, and `stripMeta(cmds)` removes the `_volatile` key before sending.
- Geometry: copy from the prototypes.
  - **Live:** absolute-positioned cards and rows (`card_ops`, `row_ops`); the pinned bar is a `box` at a computed y; the footer line sits at y = 480 − 12 − 26 + 4.
  - **Up Next:** a header plus one table. Kick/TV widths come from `colWidth`, and the row count is `floor((480 − 2·12 − headerH − 12 − tableHeaderH12 − footer) / rowPitch12)`. Drop by `stakesOf`, then display in kickoff order.
  - **Review:** follows `review_fit.py`. The two tables share height, dropping from the longer list first while keeping ≥1 upset.

- [ ] **Step 1: Write the failing tests.** Use a fake `metrics` with the measured real values (`rowPitch12 33`, `headerH 54`, `scoreW 58`, `clockW 107`). Tests:
  - `upnext Saturday shows 9 rows in kickoff order, footer '+47 lower-stakes games hidden'`, from the fixtures at `now 2026-11-14T16:40Z`.
  - `upnext Friday shows 3 rows, no footer, subtitle ends '(Tonight)'`
  - `upnext never contains a pinned-team box`
  - `live Saturday: 3 cards, a pinned bar containing 'Washington 7', footer starts '+'`
  - `live: pinned bar stays and reads 'Final' when UW is final but other games are live`
  - `live Friday: 2 cards, an Up next table with Houston, no footer`
  - `live: every card and row contains its network text`
  - `live: alert ops: fire icon for upset, image op for tight, none in Q1/Q2`
  - `live: a null network renders '' not 'null'` (search the JSON for 'null' and 'undefined' text values)
  - `review: Upsets and Close finishes tables, pinned bar 'Final', no bar on a UW bye`
  - `hashCommands ignores the Updated text`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement the three builders.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: Up Next, Live and Week in Review screens"`

### Task 6: Fixture render on the real device

**Files:**
- Create: `src/render.mjs` (`renderView(device, games, view, ctx) -> {commands, hash}`; it picks the builder and calls `device.render`)
- Modify: `src/main.mjs` (CLI only in this task)

**Interfaces:**
- Produces the CLI: `node src/main.mjs --fixture <dir> --day <YYYY-MM-DD> --now <iso> --once [--shot out.png]`. It loads `current-*.json` + `espn-*-pre.json` + optional `scores-*.json` from the dir, overlays the scores onto the ESPN events, renders once, and saves the screenshot.

- [ ] **Step 1: Render all four approved scenarios to `out/`:**
  - Saturday Up Next at 9:40 AM
  - Saturday Live at 2:47 PM (scores-sat-1447)
  - Friday Live at 7:40 PM (scores-fri-1940)
  - Review at Monday noon (the sat scores treated as final)
- [ ] **Step 2: Compare each PNG against `docs/prototypes/approved-*.png` by eye.** Look for no overlapping text, no `...` cut-offs on names or scores, and correct icons. Fix and re-render until they match. Check the response `warnings` arrays too: only the finals footer may truncate.
- [ ] **Step 3: Commit** (add `out/` to `.gitignore`). `git commit -m "feat: one-shot fixture rendering"`

### Task 7: Live loop with cadence, caching, flicker control

**Files:**
- Modify: `src/main.mjs`
- Create: `src/fetchers.mjs`, `src/loop.mjs`
- Test: `test/loop.test.mjs`

**Interfaces:**
- Produces:
  - `fetchers.mjs`:
    - `fetchCurrent(url, fetchFn) -> current`. Throws on non-200 or on a non-JSON body.
    - `fetchScoreboard(base, ymd, fetchFn) -> events[]`
  - `loop.mjs`:
    - `createLoop({config, device, fetchFn, clock, log}) -> { tick(): Promise<TickResult> }`
    - `TickResult = {view, redrew:boolean, reason:string, errors:string[]}`
    - `tick()` is pure orchestration, driven by an injected `clock()`.
  - **Cadence:**
    - current.json every 15 min.
    - The ESPN scoreboard for the view's day every tick while any game is `in` or kicks off within 15 min, otherwise every 10 min.
    - Review mode fetches each distinct game date in `allGames` hourly.
  - **Redraw** when the hash changed AND (mode ≠ live OR ≥ 2 min since the last draw), OR when the last render failed (`needsDraw` flag).
  - **Refresh type:** always `'full'`. Partial is out of scope until tested on the panel (spec: builder's call). Leave a TODO in `loop.mjs` naming `refresh:'partial'`.

- [ ] **Step 1: Write the failing tests** with fake fetch, device and clock:
  - `first tick fetches both sources and draws`
  - `second tick 60s later with same data does not redraw`
  - `live: changed scores 60s after a draw wait; 120s after, redraw`
  - `current.json 500 keeps last good data, logs error, still draws from cache`
  - `ESPN returns HTML (bad JSON) -> error logged, no crash`
  - `device unreachable -> error, next tick redraws even if hash unchanged`
  - `current.json refetched only after 15 min`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** `main.mjs` without `--fixture`: load config, then `device.health()`. If unreachable, print `AInk not reachable at <url>, retrying every 60 s` and keep looping. Call `tick()` every 60 s and print one line per tick: `HH:MM view=<day|review> mode=<…> games=<n> redrew=<y/n> <reason> <errors>`. Ctrl+C exits cleanly.
- [ ] **Step 4: Run `npm test`.** Expected: PASS. Then run `run.cmd` for 3 minutes against the real device and confirm Friday Up Next draws once and does not redraw on unchanged ticks.
- [ ] **Step 5: Commit.** `git commit -m "feat: live loop with cadence and flicker control"`

### Task 8: Docs, sync notes in both repos, ship

**Files:**
- Create: `README.md` (replaces the initial one)
- Modify: `cfb-top25-tracker/src/data/teams.js` (comment above `gameAlert`), `cfb-top25-tracker/src/utils/spread.js` (comment above `parseSpread`), `cfb-top25-tracker/docs/data-schema.md` (one line under `allGames`), `cfb-top25-tracker/package.json` (patch version bump)

- [ ] **Step 1: Write the README** covering: what it is, `run.cmd`, `config.json` / `AINK_URL`, `--fixture` usage, data sources (no CFBD), and a **"Kept in sync with CFB HQ"** section naming `src/alerts.mjs` ← `teams.js` / `spread.js`, the `allGames` fields consumed, and `scripts/make-eyes.py`.
- [ ] **Step 2: Add the CFB HQ comments.** Exact text above `gameAlert`: `// MIRRORED IN aink-gameday/src/alerts.mjs (github.com/mattt-lab/aink-gameday) -- if you change gameAlert, underdogOf or their constants, re-port them there.` Do the same above `parseSpread`. In `data-schema.md` under `allGames`: `> Consumed by aink-gameday (cfbdId, when, network, awayRank/homeRank, spread; stakesScore via games[]/rankedNextGames[]). Check it when changing these fields.`
- [ ] **Step 3: In cfb-top25-tracker, run `npm test`** (expected: PASS, comments only), bump the patch version, commit `docs: note aink-gameday mirrors gameAlert/parseSpread`, and push to `main`.
- [ ] **Step 4: In aink-gameday, run `npm test`** (expected: PASS), commit the README, and push `main` to `origin`.
