# python3 -I docs/design/blacklist/harness/sheet.py   (after shoot.cjs)
# Overview sheets, one per device + language: the Settings tile · the screen states · the live row + sheet.
import pathlib
from PIL import Image
here = pathlib.Path(__file__).resolve().parent
shots = here.parent / "shots"
ROWS = [["settings", "bl_pick", "bl_ready", "bl_reading", "bl_added", "bl_already"],
        ["bl_noqr", "bl_search", "bl_remove", "bl_empty", "live", "livesheet"]]
for dev, scale in [("iphone390", 0.5), ("android360", 0.5), ("laptop1280", 0.25)]:
    for lang in ["en", "fil"]:
        rows = []
        for names in ROWS:
            ims = []
            for n in names:
                im = Image.open(shots / f"{n}_{dev}_{lang}.png").convert("RGB")
                im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
                if dev != "laptop1280": im = im.crop((0, 0, im.width, min(im.height, 900)))
                else: im = im.crop((0, 0, im.width, min(im.height, 420)))
                ims.append(im)
            rows.append(ims)
        gap = 18
        W = max(sum(i.width for i in r) + gap * (len(r) + 1) for r in rows)
        H = sum(max(i.height for i in r) for r in rows) + gap * (len(rows) + 1)
        sheet = Image.new("RGB", (W, H), (214, 219, 232))
        y = gap
        for r in rows:
            x = gap
            for i in r:
                sheet.paste(i, (x, y)); x += i.width + gap
            y += max(i.height for i in r) + gap
        sheet.save(here.parent / f"sheet_{dev}_{lang}.png", optimize=True)
        print(f"sheet_{dev}_{lang}.png {W}x{H}")
