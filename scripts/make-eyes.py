r"""One-off: render Windows' monochrome eyes emoji glyph to 1-bit PBM at 20 and 24 px.

The AInk drops emoji, so the web app's eyes icon is shipped as an image. Needs Pillow and
C:\Windows\Fonts\seguiemj.ttf (Windows only); the output is committed, so the Pi never runs this.
Usage:  py scripts\make-eyes.py > src\assets\eyes.json
"""
import base64, io, json
from PIL import Image, ImageDraw, ImageFont

def eyes(px):
    f = ImageFont.truetype(r"C:\Windows\Fonts\seguiemj.ttf", px * 8)
    im = Image.new("L", (px * 16, px * 16), 255)
    ImageDraw.Draw(im).text((px * 2, px * 2), "\U0001F440", font=f, fill=0, embedded_color=False)
    im = im.crop(Image.eval(im, lambda v: 255 - v).getbbox())
    w, h = im.size
    k = px / max(w, h)
    im = im.resize((round(w * k), round(h * k)), Image.LANCZOS).point(lambda v: 0 if v < 128 else 255).convert("1")
    buf = io.BytesIO()
    im.save(buf, "PPM")
    return {"w": im.width, "h": im.height, "data": base64.b64encode(buf.getvalue()).decode()}

print(json.dumps({"20": eyes(20), "24": eyes(24)}, indent=1))
