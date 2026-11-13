"""Spike: live screen (layout B), fixed geometry. Real schedule, MADE-UP scores.

Fill order: up to 3 cards (most interesting live) -> Washington bar (if UW plays today) ->
other live games one row each -> "+N more live" -> upcoming (only if every live game fits) -> finals line.
Alerts follow the web app (teams.js gameAlert): fire = upset, eyes = tight; nothing before the 2nd half.
Usage: live_fit.py OUTDIR SCENARIO   (sat | fri | fri_calm)
"""
import json, sys, urllib.request, base64, io
sys.argv = [sys.argv[0], sys.argv[1], "2026-11-14", "12", sys.argv[2]]
SCEN = sys.argv[4]
src = open(sys.argv[0].replace("live_fit.py", "upnext_fit.py"), encoding="utf-8").read()
exec(src.split("d = json.load(open(CUR))")[0])   # helpers: call, team, loc, kick, net, stakes, TZ, PAD_X/Y, GAP
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont

SIZE, TINY = 12, 9
d = json.load(open(CUR))
if SCEN == "sat":
    DAY, NOW = "2026-11-14", datetime(2026, 11, 14, 14, 47, tzinfo=TZ)
    SCORES = {
        "tennessee-texas-a-m": (24, 27, "4Q 3:12"), "usc-indiana": (17, 14, "3Q 8:40"),
        "missouri-georgia": (13, 10, "3Q 11:05"), "michigan-oregon": (14, 20, "3Q 6:51"),
        "baylor-byu": (10, 24, "3Q 2:30"), "boston-college-notre-dame": (3, 31, "3Q 9:14"),
        "ole-miss-oklahoma": (7, 7, "1Q 4:20"), "washington-michigan-state": (7, 3, "1Q 5:02"),
        "arizona-state-ucf": (21, 17, "3Q 4:44"), "california-virginia": (10, 13, "3Q 7:02"),
        "nevada-northern-illinois": (6, 9, "3Q 1:11"), "florida-atlantic-tulsa": (28, 24, "3Q 0:40"),
        "middle-tennessee-liberty": (0, 24, "3Q 5:55"), "georgia-southern-georgia-state": (14, 14, "3Q 3:03"),
        "jacksonville-state-western-kentucky": (17, 20, "3Q 9:30"), "fresno-state-texas-state": (7, 10, "2Q 2:10"),
        "new-mexico-state-missouri-state": (24, 20, "4Q 9:12"), "florida-international-delaware": (13, 27, "4Q 7:45"),
        "kansas-state-tcu": (20, 31, "4Q 2:01")}
    FINAL = {"wisconsin-maryland": (24, 17), "auburn-mississippi-state": (20, 23), "james-madison-uconn": (31, 14),
             "northwestern-ohio-state": (13, 31), "syracuse-nc-state": (27, 24), "duke-miami": (17, 38),
             "wake-forest-smu": (20, 23), "cincinnati-iowa-state": (14, 28), "nebraska-rutgers": (31, 10),
             "georgia-tech-clemson": (17, 24), "alabama-vanderbilt": (34, 20), "arkansas-state-coastal-carolina": (21, 24),
             "east-carolina-charlotte": (35, 14), "uab-temple": (17, 20), "tulane-rice": (28, 21),
             "kennesaw-state-sam-houston": (24, 17)}
elif SCEN == "fri_calm":
    DAY, NOW = "2026-11-13", datetime(2026, 11, 13, 19, 40, tzinfo=TZ)
    SCORES, FINAL = {"florida-state-pittsburgh": (10, 35, "4Q 1:48"), "illinois-ucla": (0, 14, "1Q 6:15")}, {}
else:
    DAY, NOW = "2026-11-13", datetime(2026, 11, 13, 19, 40, tzinfo=TZ)
    SCORES, FINAL = {"florida-state-pittsburgh": (20, 24, "4Q 1:48"), "illinois-ucla": (7, 3, "1Q 6:15")}, {}

games = [g for g in d["allGames"] if loc(g).date().isoformat() == DAY]
live, final, upcoming, uw = [], [], [], None
for g in games:
    k = f'{g["away"]}-{g["home"]}'
    if k in SCORES:
        a, h, clock = SCORES[k]
        g = dict(g, awayScore=a, homeScore=h, clock=clock)
        if "washington" in (g["home"], g["away"]): uw = g
        else: live.append(g)
    elif k in FINAL:
        final.append(dict(g, awayScore=FINAL[k][0], homeScore=FINAL[k][1]))
    elif loc(g) > NOW:
        upcoming.append(g)

# ---- alerts: a rough stand-in for the web app's gameAlert (the real build imports it) ----
def underdog(g):
    ar, hr = g["awayRank"] or 99, g["homeRank"] or 99
    if ar != hr: return "away" if ar > hr else "home"
    fav = g["spread"].split(" -")[0].lower() if g.get("spread") else ""
    if not fav: return None
    return "home" if fav.startswith(name(g["away"]).lower()) else "away"
def tag(g):
    q = g["clock"].split()[0]
    if q in ("1Q", "2Q", "HALF"): return None            # web app: first-half alerts were noise
    a, h, side = g["awayScore"], g["homeScore"], underdog(g)
    if side:
        dog, fav = (a, h) if side == "away" else (h, a)
        if dog >= fav: return "UPSET"
    if q in ("4Q", "OT") and abs(a - h) <= 8: return "TIGHT"
    return None
def interest(g):
    m, q = abs(g["awayScore"] - g["homeScore"]), g["clock"].split()[0]
    late = {"1Q": 0.3, "2Q": 0.5, "3Q": 0.8, "4Q": 1.0, "OT": 1.2}.get(q, 0.5)
    s = max(0, 17 - m) * late * 2 + (25 if tag(g) == "UPSET" else 0)
    return s + sum(26 - r for r in (g["homeRank"], g["awayRank"]) if r)
live.sort(key=interest, reverse=True)
def short(s, r): return team(s, r).replace(" State", " St")

# ---- icons: fire = the device's own vector icon; eyes = Windows' monochrome emoji glyph as a 1-bit image ----
def eyes(px):
    f = ImageFont.truetype(r"C:\Windows\Fonts\seguiemj.ttf", px * 8)
    im = Image.new("L", (px * 16, px * 16), 255)
    ImageDraw.Draw(im).text((px * 2, px * 2), "\U0001F440", font=f, fill=0, embedded_color=False)
    im = im.crop(Image.eval(im, lambda v: 255 - v).getbbox())
    w, h = im.size; k = px / max(w, h)
    im = im.resize((round(w * k), round(h * k)), Image.LANCZOS).point(lambda v: 0 if v < 128 else 255).convert("1")
    buf = io.BytesIO(); im.save(buf, "PPM")
    return {"w": im.width, "h": im.height, "data": base64.b64encode(buf.getvalue()).decode()}
EYES = {24: eyes(24), 20: eyes(20)}
def alert_op(t, x, y, px):
    if t == "UPSET": return {"op": "icon", "name": "fire", "x": x, "y": y - 2, "size": px + 4}
    e = EYES[px]; return {"op": "image", "x": x, "y": y + (px - e["h"]) // 2, "w": e["w"], "h": e["h"], "data": e["data"]}

# ---- fixed geometry ----
W = 800 - 2 * PAD_X
SCORE_W = call("/measure", {"text": "88", "size": 24, "bold": True})["width"] + 6
CLOCK_W = call("/measure", {"text": "4Q 11:05", "size": SIZE})["width"] + 8
NCARDS = min(3, len(live))
CARD_H, CARD_GAP = 134, 10
CARD_W = (W - CARD_GAP * (NCARDS - 1)) // max(1, NCARDS)
ROW_H = 33                                   # measured row pitch at size 12

def card_ops(g, x, y):
    t, ix, iw = tag(g), x + 12, CARD_W - 24
    ops = [{"op": "rect", "x": x, "y": y, "w": CARD_W, "h": CARD_H, "color": "white", "stroke": "black", "strokeWidth": 2, "radius": 8}]
    tx = ix
    if t: ops.append(alert_op(t, ix, y + 9, 24)); tx = ix + 32
    ops += [{"op": "text", "x": tx, "y": y + 8, "w": 120, "h": 26, "text": net(g), "size": TINY, "valign": "middle", "maxLines": 1},
            {"op": "text", "x": ix, "y": y + 8, "w": iw, "h": 26, "text": g["clock"], "size": SIZE, "bold": True, "align": "right", "valign": "middle"}]
    for i, (s_, r, sc, oth) in enumerate([(g["away"], g["awayRank"], g["awayScore"], g["homeScore"]),
                                          (g["home"], g["homeRank"], g["homeScore"], g["awayScore"])]):
        ry, bold = y + 36 + i * 46, sc > oth
        ops += [{"op": "text", "x": ix, "y": ry, "w": iw - SCORE_W - 6, "h": 46, "text": short(s_, r), "size": SIZE, "bold": bold, "valign": "middle", "maxLines": 1},
                {"op": "text", "x": ix + iw - SCORE_W, "y": ry, "w": SCORE_W, "h": 48, "text": str(sc), "size": 24, "bold": bold, "align": "right", "valign": "middle"}]
    return ops

def row_ops(g, y):
    t, x = tag(g), PAD_X
    name_w = (W - 28 - 90 - CLOCK_W) // 2
    ops = [{"op": "line", "x0": PAD_X, "y0": y + ROW_H, "x1": PAD_X + W, "y1": y + ROW_H}]
    if t: ops.append(alert_op(t, x, y + 6, 20))
    for j, (s_, r, sc, oth) in enumerate([(g["away"], g["awayRank"], g["awayScore"], g["homeScore"]),
                                          (g["home"], g["homeRank"], g["homeScore"], g["awayScore"])]):
        ops.append({"op": "text", "x": x + 28 + j * name_w, "y": y, "w": name_w - 8, "h": ROW_H, "text": f"{short(s_, r)} {sc}",
                    "size": SIZE, "bold": sc > oth, "valign": "middle", "maxLines": 1})
    ops += [{"op": "text", "x": x + 28 + 2 * name_w, "y": y, "w": 90, "h": ROW_H, "text": net(g), "size": TINY, "valign": "middle", "maxLines": 1},
            {"op": "text", "x": PAD_X, "y": y, "w": W, "h": ROW_H, "text": g["clock"], "size": SIZE, "align": "right", "valign": "middle"}]
    return ops

def h_of(op):
    return call("/canvas", {"dryRun": True, "commands": [dict(op, x=PAD_X, y=0, w=W)]})["validation"]["commands"][0]["bbox"][3]

ops, y = [], PAD_Y
header = {"op": "header", "title": "Gameday - Live", "right": f'{NOW.strftime("%#I:%M %p")}  |  {len(live) + bool(uw)} live', "icon": "bolt"}
ops.append(dict(header, x=PAD_X, y=y, w=W)); y += h_of(header) + GAP
for i, g in enumerate(live[:3]):
    ops += card_ops(g, PAD_X + i * (CARD_W + CARD_GAP), y)
if live: y += CARD_H + GAP
if uw:
    bar = {"op": "box", "border": 1, "radius": 6, "padding": [6, 10], "direction": "row", "align": "center", "gap": 10, "children": [
        {"op": "icon", "name": "star", "size": 20},
        {"op": "text", "text": f'{short(uw["away"], uw["awayRank"])} {uw["awayScore"]}  -  {short(uw["home"], uw["homeRank"])} {uw["homeScore"]}',
         "size": 18, "bold": True, "flex": 1, "wrap": False},
        {"op": "text", "text": f'{uw["clock"]}  |  {net(uw)}', "size": SIZE, "wrap": False}]}
    ops.append(dict(bar, x=PAD_X, y=y, w=W)); y += h_of(bar) + GAP

FOOT = 26
rest = live[3:]
bottom = 480 - PAD_Y - (FOOT if (final or rest) else 0)
n_rows = max(0, min(len(rest), (bottom - y) // ROW_H))
for k, g in enumerate(rest[:n_rows]):
    ops += row_ops(g, y + k * ROW_H)
y += n_rows * ROW_H + (GAP if n_rows else 0)
more = len(rest) - n_rows

ups = []
if not more:
    up_tbl = lambda gs: {"op": "table", "columns": ["Up next", "TV", "Kick"], "widths": [0, 100, 110], "align": ["left", "left", "right"],
                         "size": SIZE, "lines": True,
                         "rows": [[f'{short(g["away"], g["awayRank"])} at {short(g["home"], g["homeRank"])}', net(g), kick(g)] for g in gs]}
    for g in sorted(upcoming, key=stakes, reverse=True):
        trial = sorted(ups + [g], key=loc)
        if y + h_of(up_tbl(trial)) > bottom: break
        ups = trial
    if ups: ops.append(dict(up_tbl(ups), x=PAD_X, y=y, w=W))

foot = []
if more: foot.append(f"+{more} more live")
if final:
    notable = sorted(final, key=lambda g: -sum(26 - r for r in (g["homeRank"], g["awayRank"]) if r))
    foot.append("Final: " + "  |  ".join(f'{short(g["away"], g["awayRank"])} {g["awayScore"]}, {short(g["home"], g["homeRank"])} {g["homeScore"]}' for g in notable))
if foot:
    ops.append({"op": "text", "x": PAD_X, "y": 480 - PAD_Y - FOOT + 4, "w": W, "h": FOOT - 4, "text": "   |   ".join(foot), "size": TINY, "valign": "middle", "maxLines": 1})

res = call("/canvas?wait=1", {"commands": [{"op": "clear"}] + ops})
open(f"{OUT}/live_{SCEN}.png", "wb").write(urllib.request.urlopen(f"{DEV}/canvas/screenshot.png", timeout=30).read())
print(SCEN, f"cards={min(3, len(live))} uw={bool(uw)} rows={n_rows} more={more} upcoming={len(ups)} finals={len(final)} "
      f"alerts={[(g['away'], tag(g)) for g in live if tag(g)]} warnings={res.get('warnings')}")
