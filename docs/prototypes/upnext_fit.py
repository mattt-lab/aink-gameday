"""Spike: Up Next with a FIXED type scale; fit is decided by the device, not by guesses.

Rules:
  * One type scale, never changed per day: header (device default), rows at ROW_SIZE.
  * Kick/TV column widths = widest string actually shown, measured on the device (+ padding).
  * Fit loop: dry-run the layout; if anything is truncated or the stack runs off the bottom,
    drop the lowest-stakes game and try again. Display order stays kickoff order.
Usage: upnext_fit.py OUTDIR YYYY-MM-DD   (local date to show)
"""
import json, sys, urllib.request
from datetime import datetime, timezone, timedelta

DEV = "http://192.168.200.119"
CUR = r"C:\Users\mattt\Desktop\code\cfb-top25-tracker\data\current.json"
OUT, DAY = sys.argv[1], sys.argv[2]
TZ = timezone(timedelta(hours=-7))          # this PC: US Mountain Standard Time (Arizona)
H = 480
ROW_SIZE = int(sys.argv[3]) if len(sys.argv) > 3 else 18   # the one body size for every Up Next screen
PAD_X, PAD_Y, GAP, CELL_PAD = 20, 12, 12, 16

SHORT = {"texas-a-m": "Texas A&M", "nc-state": "NC State", "ucla": "UCLA", "usc": "USC", "byu": "BYU", "smu": "SMU",
         "lsu": "LSU", "ucf": "UCF", "uconn": "UConn", "ul-monroe": "UL Monroe", "utsa": "UTSA", "utep": "UTEP",
         "unlv": "UNLV", "uab": "UAB", "hawai-i": "Hawai'i", "florida-international": "FIU", "app-state": "App State",
         "north-dakota-state": "N. Dakota St", "middle-tennessee": "Middle Tenn", "jacksonville-state": "Jax State",
         "western-kentucky": "W. Kentucky", "georgia-southern": "Ga Southern", "northern-illinois": "N. Illinois",
         "massachusetts": "UMass", "mississippi-state": "Miss State", "michigan-state": "Michigan St"}
NET = {"SEC Network": "SECN", "ACC Network": "ACCN", "USA Net": "USA", "Fox": "FOX"}
def name(s): return SHORT.get(s) or s.replace("-", " ").title()
def team(s, r): return (f"{r} " if r else "") + name(s)
def loc(g): return datetime.fromisoformat(g["when"].replace("Z", "+00:00")).astimezone(TZ)
def kick(g): return loc(g).strftime("%#I:%M %p")
def net(g): return NET.get(g["network"], g["network"])

def call(path, body):
    req = urllib.request.Request(DEV + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=30))

def stakes(g):  # stand-in until the real importance rule is designed
    s = sum(30 - r for r in (g["homeRank"], g["awayRank"]) if r)
    try: s += max(0, 14 - abs(float(g["spread"].split()[-1])))
    except Exception: pass
    return s

def layout(games, hidden, day_dt, now):
    rows = [[kick(g), f'{team(g["away"], g["awayRank"])} at {team(g["home"], g["homeRank"])}', net(g)] for g in games]
    m = call("/measure", [{"text": s, "size": ROW_SIZE, "bold": True} for s in ["Kick", "TV"] + [r[0] for r in rows] + [r[2] for r in rows]])
    n = len(rows)
    kick_w = max([m[0]["width"]] + [x["width"] for x in m[2:2 + n]]) + CELL_PAD
    tv_w = max([m[1]["width"]] + [x["width"] for x in m[2 + n:]]) + CELL_PAD
    room = 800 - 2 * PAD_X - kick_w - tv_w - CELL_PAD
    mw = call("/measure", [{"text": r[1], "size": ROW_SIZE} for r in rows])
    for r, x in zip(rows, mw):          # too wide for its column: shorten "State" -> "St", never shrink the font
        if x["width"] > room:
            r[1] = r[1].replace(" State", " St")
    label = "  (Tonight)" if day_dt == now.date() else ""
    kids = [{"op": "header", "title": "Gameday - Up Next", "subtitle": f'{day_dt.strftime("%A, %b %#d")}{label}',
             "right": "Updated " + now.strftime("%#I:%M %p"), "icon": "calendar"},
            {"op": "table", "columns": ["Kick", "Matchup", "TV"], "rows": rows, "widths": [kick_w, 0, tv_w],
             "size": ROW_SIZE, "lines": True}]
    if hidden:
        kids += [{"op": "spacer", "flex": 1}, {"op": "text", "text": f"+{hidden} lower-stakes games hidden", "size": 9}]
    return [{"op": "clear"}, {"op": "stack", "padding": [PAD_Y, PAD_X], "gap": GAP, "children": kids}]

d = json.load(open(CUR))
now = datetime.now(TZ)
day_games = sorted((g for g in d["allGames"] if loc(g).date().isoformat() == DAY), key=loc)
day_games = [g for g in day_games if "washington" not in (g["home"], g["away"])] + \
            [g for g in day_games if "washington" in (g["home"], g["away"])]  # (UW box comes later; listed like any game here)
day_dt = loc(day_games[0]).date()

shown = sorted(day_games, key=stakes, reverse=True)
tries = 0
while True:
    tries += 1
    games = sorted(shown, key=loc)
    cmds = layout(games, len(day_games) - len(games), day_dt, now)
    # Natural heights: a top-level op reports its true size in a dry run (a stack is clamped to the screen).
    hdr, tbl = cmds[1]["children"][0], cmds[1]["children"][1]
    hs = call("/canvas", {"dryRun": True, "commands": [dict(hdr, x=PAD_X, y=0, w=800 - 2 * PAD_X),
                                                       dict(tbl, x=PAD_X, y=0, w=800 - 2 * PAD_X)]})["validation"]["commands"]
    footer = (GAP + 20) if len(games) < len(day_games) else 0
    need = PAD_Y + hs[0]["bbox"][3] + GAP + hs[1]["bbox"][3] + footer + PAD_Y
    if need <= H:
        break
    shown = shown[:-1]

res = call("/canvas?wait=1", {"commands": cmds})
png = urllib.request.urlopen(f"{DEV}/canvas/screenshot.png", timeout=30).read()
open(f"{OUT}/upnext_{DAY}_s{ROW_SIZE}.png", "wb").write(png)
print(f"{DAY}: {len(games)} of {len(day_games)} games shown, {tries} fit passes, size {ROW_SIZE}, warnings={res.get('warnings')}")
