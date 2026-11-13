# AInk Gameday dashboard: design

Date: 2026-11-13. Status: draft, awaiting approval.

## Intent

A college-football gameday screen for the AInk e-ink display (ukielab.com, model `aink-7.5`,
800x480, 1-bit, about 4 s per refresh, firmware 261016). It reformats data that CFB HQ already
produces so the owner can glance at it on game days:

- **Before games:** what's on next, with kickoff times and TV channels.
- **During games:** live scores, with the most interesting or important games featured.
- **Washington Huskies** always get top billing on days they play.

Why: a glanceable companion to the CFB HQ website that doesn't need a phone or laptop open.

## Goals

- One script, started by hand in a `cmd` window, that keeps the display current until stopped.
- Same alert semantics as the CFB HQ website: 🔥 upset, 👀 tight game.
- Stable, fixed visual design. Font sizes and geometry never change from day to day. Fit is
  decided by measurement, never by guesswork.
- Runs on this Windows PC now and, later, unchanged on a Raspberry Pi Zero 2 W.

## Non-goals (for this build)

- Task Scheduler, a Windows service, or auto-start. The owner runs it by hand.
- Raspberry Pi setup. The code must be portable, but provisioning the Pi is a later task.
- Paging or rotating screens to show every game.
- The device's MCP server, or any interactive control.
- Ranked-team views, poll movement, or anything beyond the day's games.

## Anti-goals (a failure even if it technically works)

- **Any CollegeFootballData (CFBD) API call.** CFB HQ is near its 1,000-calls-per-month free tier.
  This project uses only GitHub (CFB HQ's published `data/current.json`) and ESPN's free public
  scoreboard.
- **A flickering screen.** Every e-ink refresh flashes. Never redraw when nothing on screen
  changed, and never redraw more often than the cadence below.
- **Changing CFB HQ's website behaviour.** The only change to that repo is a sync note (below).
- **Showing games from more than one day.**

## Constraints

- **Device API:** `POST /canvas` with drawing commands. `POST /measure` measures text, and
  `dryRun: true` returns layout boxes without drawing. The device drops emoji. Full API:
  `GET http://<device>/llms.txt`.
- **Network:** the display only accepts requests from its own LAN; nothing in the cloud can push
  to it. The script runs on a machine on the same Wi-Fi. Today the device is at
  `192.168.200.119` on a DHCP guest network, so the address must be configurable.
- **Runtime:** Node (this PC has v24.15.0). Zero npm dependencies, so the Pi needs nothing but
  Node: use built-in `fetch` and `node:test`.
- **Time zone:** use the host's local time zone. This PC is US Mountain Standard Time (Arizona).

## Approaches considered

1. **Inside the CFB HQ repo.** Import the web app's `gameAlert` directly after moving it into a
   pure module. One set of rules, but it touches site code (deploy plus version bump) and makes
   the Pi clone the whole web app.
2. **Standalone project (chosen by the owner).** A small, dependency-free Node project in
   `Desktop/code/aink-gameday`. It reads CFB HQ's data over HTTP and keeps its own copy of the
   alert rules. Easy to move to a Pi and no risk to the website. The cost is that the copied rules
   can drift, which is handled with sync notes in both repos (below).
3. **Python.** Dropped: it would mean rewriting the alert logic from scratch, and the Pi Zero 2 W
   runs Node fine.

## Data

| Need | Source | Refresh |
|---|---|---|
| Schedule, kickoff, TV network, rankings, spread, `stakesScore` | `https://raw.githubusercontent.com/mattt-lab/CFB_top25/main/data/current.json`, `allGames[]` (public, no auth) | every 15 min |
| Live status, scores, period, clock | ESPN `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&dates=YYYYMMDD` | every cycle (see cadence) |

- **Joining the two:** `allGames[].cfbdId` equals the ESPN event `id`. Verified 2026-11-13: all
  56 Saturday FBS games matched. No team-name mapping is needed.
- **Missing pieces:** if a CFB HQ game has no ESPN event, treat it as scheduled. If an ESPN event
  has no CFB HQ game, ignore it, because CFB HQ's `allGames` defines the tracked slate.
- **Unreliable statuses:** `current.json` statuses are only ever `scheduled` or `final`. ESPN is
  the authority on in-progress and final.
- **Fallbacks:** if a fetch fails, keep using the last good data and log the error. The header's
  "Updated" time keeps showing the last good fetch, so staleness is visible.

## Behaviour

### Which day is shown

The **display day** is the local calendar date of the earliest tracked game that is not final.
"Final" means ESPN says final. A game with no ESPN status whose kickoff was more than **6 hours**
ago also counts as done. `current.json` never marks a game final until its next daily run, so
without this cutoff a stale or postponed game would pin the screen to an old day. *(Planner's
call.)*
Only that day's games appear. With no games today, it is the next day that has games, so on a
Tuesday it shows Thursday's, Friday's or Saturday's slate, whichever comes first.

**Rollover (owner confirmed):** after the day's last game ends, keep the finals-only live screen
until **4:00 AM local**, then roll to the next game day.

**No future game in the data (owner's call):** this happens from Sunday until CFB HQ's Monday run
publishes the next week, and in the off-season. Show the **Week in Review** screen (below).

### Mode

- **Live mode** as soon as any game on the display day is in progress (ESPN `state == "in"`).
- **Up Next mode** otherwise.

### Up Next screen (approved)

- **Header:** "Gameday - Up Next", the date (plus "(Tonight)" when the display day is today),
  "Updated h:mm AM/PM".
- **Table:** Kick | Matchup | TV, **size 12**, kickoff order, only games not yet started.
- **Matchup format:** `13 Wake Forest at SMU` (rank prefix only when ranked).
- **Overflow:** when the games don't all fit, drop the lowest-stakes games first, keep the shown
  ones in kickoff order, and add a footer: `+N lower-stakes games hidden` (size 9).
- **Washington:** no special box on Up Next. It is listed like any other game.
- **Light days:** clean and sparse. No extra content to fill space.

### Live screen (approved: layout B)

Top to bottom, filling until the screen is full:

1. **Header:** "Gameday - Live", "h:mm AM/PM | N live".
2. **Cards:** up to **3** for the most interesting live games (Washington excluded). Each card
   shows the alert icon (if any), the TV network (size 9), the clock (size 12 bold), and two
   team lines with names at size 12 and scores at size 24, the leader in bold. With fewer live
   games there are fewer, wider cards.
3. **Washington bar** (only if UW plays on the display day): star icon, `Washington 7 - Michigan
   St 3` (size 18 bold), clock and network. It stays visible once UW's game is final (shows
   "Final").
4. **Other live games,** one row each, most interesting first: alert icon | away name + score |
   home name + score | network (size 9) | clock. Size 12, fixed 33 px rows.
5. **Up next table,** only when every live game is already on screen. Most important first,
   shown in kickoff order while room remains.
6. **Footer** (size 9, one line): `+N more live` if any live games are hidden, then
   `Final: ...` with the most notable finished games first.

Saturday overflow: show the top games only, with no paging. Each live card or row always shows
its TV network.

### Week in Review screen (owner requested; mockup `docs/prototypes/review-week-mockup.png`)

Shown when no tracked game remains in the data.

- **Header:** "Week N in Review" (N = `meta.currentWeek`), subtitle "Next slate when CFB HQ
  updates", "Updated h:mm".
- **Washington bar:** UW's final from that week, same style as the live bar, labelled "Final".
  Omitted on a bye week.
- **"Upsets" table** (🔥 at right of its heading): every final the web app's `gameAlert` calls
  `'upset'`. Biggest first, by the losing favourite's spread points plus a bonus for a
  better-ranked loser. Rows read `away score | home score | by N`, size 12.
- **"Close finishes" table** (👀): non-upset finals within `TIGHT_GAME_MAX_MARGIN`. Smallest
  margin first, ties broken by the rankings involved.
- **Fit:** the two tables share the remaining height. When they don't fit, drop from the longer
  list first, keeping at least the top upset.
- **Data:** the week's finals from ESPN, fetched once per game date that appears in `allGames`.
  Refetch hourly; nothing changes once games are final. `current.json` finals can lag by up to a
  day, so it is not used for scores.

### Alerts (identical to the web app)

- **🔥 upset, 👀 tight.** Port `gameAlert` and `underdogOf` from
  `cfb-top25-tracker/src/data/teams.js`, plus the `parseSpread` they use from
  `src/utils/spread.js`, line for line, including the constants (`MIN_UNDERDOG_RANK_GAP`,
  `TINY_UNDERDOG_MAX_POINTS`, `TIGHT_GAME_MAX_MARGIN`).
- **No alerts before the second half.** The upset rule takes precedence over the tight rule.
- **Drawing:** 🔥 is the device's built-in `fire` icon. 👀 is a 1-bit image of Windows' monochrome
  eyes glyph (Segoe UI Emoji), generated once and committed as a PBM asset. The Pi will not have
  that font, so it must not be generated at runtime.
- **Sizes:** 24 px on cards, 20 px in rows.

### Ranking rules (builder's calls, tunable)

- **Live interest** (which games get cards and the order of rows): an upset alert counts most,
  then closeness weighted by lateness (Q1 < Q2 < Q3 < Q4 < OT), then the rankings involved.
  The prototype formula in the appendix is a starting point.
- **Up Next stakes** (drop order): `stakesScore` is always null in `allGames[]`. It lives on
  `games[]` (6 games) and `rankedNextGames[]` (14 games), which join to `allGames[]` by
  `cfbdId` (verified: all 20 match). Use that score where present. Otherwise use a stand-in:
  points for each ranked team (better rank, more points) plus closeness of the spread. Every
  game must be comparable on one scale, so normalise or rank-merge the two. *(Builder-check
  answer; planner's call.)*

### Cadence and flicker control

- **Loop:** one pass every 60 s.
- **ESPN:** fetched every pass while any display-day game is in progress or kicks off within
  15 min; otherwise every 10 min.
- **`current.json`:** fetched every 15 min.
- **Redraw:** build the command list, hash it, and send only when the hash changed. Live clocks
  change constantly, so live mode redraws at most every **2 min**. Up Next redraws only when its
  content changes.
- **"Updated" time:** excluded from the hash, so it doesn't force redraws by itself.
- **Partial refresh:** the device offers `refresh: "partial"` "where the panel supports it". The
  builder should test it on this panel. If it works without ghosting, use partial for live
  updates with a full refresh every 10th draw. Otherwise always use full.

### Layout engine

- **Fixed constants:** type sizes 9 / 12 / 18 / 24, card height 134, row height 33, padding
  20 / 12.
- **Measured once at startup** via `POST /measure` (cached for the run): the widest kickoff time
  and network actually present, the score width for "88", and clock width for "4Q 11:05".
- **Precise positioning:** cards and live rows use explicit coordinates. The device's
  `row` container let scores overlap names during prototyping, so it isn't used there.
- **Fit check:** a top-level op's natural height comes from a `dryRun` (a `stack` is clamped to
  the screen, so don't measure a stack). Row counts come from row height arithmetic, not from
  trial-and-error loops.
- **Long names:** shorten `" State"` to `" St"` when a matchup is too wide. Never shrink the font.
  Long network names use fixed abbreviations (SEC Network → SECN, ACC Network → ACCN,
  USA Net → USA, Fox → FOX).

## Running it

- **Start:** `run.cmd` in the project root runs `node src\main.mjs`. Ctrl+C stops it.
- **Console:** logs one line per pass (mode, display day, games, whether it redrew, any errors).
- **Config:** `config.json` holds `deviceUrl` (default `http://192.168.200.119`), `pinnedTeam`
  (`washington`), and `currentJsonUrl`. The environment variable `AINK_URL` overrides `deviceUrl`.
- **Startup checks:** call `GET /health` on the device. Unreachable means a clear message and a
  retry every 60 s, not a crash.

## Sync notes (the owner asked for these)

- **In `aink-gameday`:** the README and a header comment in `src/alerts.mjs` name the exact
  source files and functions copied from CFB HQ, and say to re-port them whenever those change.
- **In `cfb-top25-tracker`:** a comment directly above `gameAlert` (and above `parseSpread`) in
  CFB HQ says the logic is mirrored in `aink-gameday/src/alerts.mjs` and must be updated there
  too. Also a one-line pointer in CFB HQ's `docs/data-schema.md` noting that `aink-gameday`
  consumes `allGames[]` fields (`cfbdId`, `when`, `network`, `awayRank`/`homeRank`, `spread`,
  `stakesScore`), so schema changes must consider it.
- **CFB HQ commits:** these are comment-only changes with no site behaviour change. They follow
  that repo's shipping convention (bump `package.json` version in the shipping commit).
  **Owner confirmed:** commit and push to `main`, which redeploys the site with no visible change.
- **This project's repo:** https://github.com/mattt-lab/aink-gameday. It already has one commit
  on `main`. Clone it and build on top of that commit rather than starting a fresh history.

## Testing

- **Unit tests (`node:test`)** for the pure parts: display-day choice (including no games today,
  and the after-midnight finals case), mode choice, alerts (port the CFB HQ test cases if any
  exist), live interest ordering, Up Next drop order, name shortening, and hash-based redraw
  suppression.
- **Render checks** against the real device with `dryRun` and `GET /canvas/screenshot.png`,
  using the two fixtures from prototyping: busy Saturday 2026-11-14 at 2:47 PM (19 live) and
  Friday 2026-11-13 at 7:40 PM (2 live).
- **Fixture mode:** `node src\main.mjs --fixture <file> --now <iso>` renders once from saved
  ESPN and `current.json` snapshots instead of live fetches, so screens can be checked any day.

## Left to the builder

- Module structure and file layout.
- Exact interest and stakes weights, within the rules above.
- Partial-refresh decision, after testing on the panel.
- Wording of console logs.

## Appendix: prototype references

`docs/prototypes/` in this repo holds the throwaway Python prototypes from the design session,
plus screenshots of the approved screens:

- **`upnext_fit.py`:** Up Next fit.
- **`live_fit.py`:** live layout, all card, row, bar and footer geometry, eyes-glyph generation
  with Pillow, and the stand-in alert and interest rules.
- **`approved-*.png`:** the target look.

Port the geometry and the look, not the code. The real alert rules come from the CFB HQ port.

**Fixtures are synthetic.** The two render-check scenarios use the real 2026-11-13/14 schedule
from `current.json` with made-up scores. The `SCORES` and `FINAL` tables at the top of
`live_fit.py` define them. The builder turns these into fixture files: a snapshot of
`current.json` plus an ESPN-shaped scoreboard JSON with those scores and clocks.
