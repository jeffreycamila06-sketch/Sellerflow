# python3 -I docs/design/fb-post-sales-public/harness/sheet-readonly.py   (after shoot-readonly.cjs)
# One picture per phone + language: the waiting line · the view-only Posts side · My posts, side by side.
import pathlib
from PIL import Image
here = pathlib.Path(__file__).resolve().parent
shots = here.parent / "shots"
for dev in ["iphone390", "android360"]:
    for lang in ["en", "zh-TW"]:
        ims = [Image.open(shots / f"{k}_{dev}_{lang}.png").convert("RGB") for k in ["readonly_waitlist", "readonly", "readonly_my"]]
        gap = 24
        w = sum(i.width for i in ims) + gap * (len(ims) + 1)
        h = max(i.height for i in ims) + gap * 2
        sheet = Image.new("RGB", (w, h), (226, 230, 240))
        x = gap
        for i in ims:
            sheet.paste(i, (x, gap)); x += i.width + gap
        sheet.save(here.parent / f"sheet_readonly_{dev}_{lang}.png", optimize=True)
        print(f"sheet_readonly_{dev}_{lang}.png {w}x{h}")
