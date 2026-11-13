"""Spike: 'Week in review' screen shown when no future game is in the data. MADE-UP final scores
(the live_fit.py Saturday fixture, every game treated as final). Fixed sizes, measured fit."""
import json, sys, urllib.request, re
OUT = sys.argv[1]
sys.argv = [sys.argv[0].replace("review_fit.py", "live_fit.py"), OUT, "sat"]
src = open(sys.argv[0], encoding="utf-8").read()
exec(src.split("# ---- fixed geometry ----")[0])   # data + helpers + alert pieces (eyes, short, underdog)

W = 800 - 2 * PAD_X
finals = [dict(g, awayScore=a, homeScore=h) for g in live + ([uw] if uw else []) for a, h in [(g["awayScore"], g["homeScore"])]] + final
uwg = next(g for g in finals if "washington" in (g["home"], g["away"]))
others = [g for g in finals if g is not uwg]

def spread_pts(g):
    m = re.search(r"-(\d+(\.\d+)?)", g.get("spread") or "")
    return float(m.group(1)) if m else 0.0
def is_upset(g):                      # web-app rule for finals: the underdog won outright
    side = underdog(g)
    if not side: return False
    dog, fav = (g["awayScore"], g["homeScore"]) if side == "away" else (g["homeScore"], g["awayScore"])
    return dog > fav
def upset_size(g):                    # bigger favourite / better-ranked loser = bigger upset
    loser_rank = g["homeRank"] if g["awayScore"] > g["homeScore"] else g["awayRank"]
    return spread_pts(g) + (26 - loser_rank if loser_rank else 0)
upsets = sorted([g for g in others if is_upset(g)], key=upset_size, reverse=True)
close = sorted([g for g in others if not is_upset(g) and abs(g["awayScore"] - g["homeScore"]) <= 8],
               key=lambda g: (abs(g["awayScore"] - g["homeScore"]), -sum(26 - r for r in (g["homeRank"], g["awayRank"]) if r)))

def line(g):
    w_first = g["awayScore"] > g["homeScore"]
    a = f'{short(g["away"], g["awayRank"])} {g["awayScore"]}'; h = f'{short(g["home"], g["homeRank"])} {g["homeScore"]}'
    return [a, h, f'by {abs(g["awayScore"] - g["homeScore"])}']

def h_of(op):
    return call("/canvas", {"dryRun": True, "commands": [dict(op, x=PAD_X, y=0, w=W)]})["validation"]["commands"][0]["bbox"][3]
def tbl(title, gs):
    return {"op": "table", "columns": [title, "", ""], "rows": [line(g) for g in gs], "widths": [0, 0, 80],
            "align": ["left", "left", "right"], "size": 12, "lines": True}

ops, y = [], PAD_Y
header = {"op": "header", "title": "Week 11 in Review", "subtitle": "Next slate when CFB HQ updates", "right": "Updated 9:15 AM", "icon": "star"}
ops.append(dict(header, x=PAD_X, y=y, w=W)); y += h_of(header) + GAP
bar = {"op": "box", "border": 1, "radius": 6, "padding": [6, 10], "direction": "row", "align": "center", "gap": 10, "children": [
    {"op": "icon", "name": "star", "size": 20},
    {"op": "text", "text": f'{short(uwg["away"], uwg["awayRank"])} {uwg["awayScore"]}  -  {short(uwg["home"], uwg["homeRank"])} {uwg["homeScore"]}',
     "size": 18, "bold": True, "flex": 1, "wrap": False},
    {"op": "text", "text": "Final", "size": 12, "bold": True, "wrap": False}]}
ops.append(dict(bar, x=PAD_X, y=y, w=W)); y += h_of(bar) + GAP

# Two tables share the remaining height: upsets first, then close games; each gets what fits, upsets favoured.
bottom = 480 - PAD_Y
nu, nc = len(upsets), len(close)
while nu + nc > 0:
    hu = h_of(tbl("Upsets", upsets[:nu])) if nu else 0
    hc = h_of(tbl("Close finishes", close[:nc])) if nc else 0
    if y + hu + (GAP if nu and nc else 0) + hc <= bottom: break
    if nc >= nu and nc > 0: nc -= 1
    else: nu -= 1
for title, gs, n in (("Upsets", upsets, nu), ("Close finishes", close, nc)):
    if n:
        t = tbl(title, gs[:n]); ops.append(dict(t, x=PAD_X, y=y, w=W)); y += h_of(t) + GAP
        ops.append(alert_op("UPSET" if title == "Upsets" else "TIGHT", PAD_X + W - 30, y - GAP - h_of(t) + 4, 20))

res = call("/canvas?wait=1", {"commands": [{"op": "clear"}] + ops})
open(f"{OUT}/review_week.png", "wb").write(urllib.request.urlopen(f"{DEV}/canvas/screenshot.png", timeout=30).read())
print(f"upsets {nu}/{len(upsets)} close {nc}/{len(close)} warnings={res.get('warnings')}")
