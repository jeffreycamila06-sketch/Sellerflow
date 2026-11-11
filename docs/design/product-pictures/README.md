# Product pictures — built from the approved preview (Nov 12 2026)

Only while the product-pictures switch (`product_images_enabled`) is on; off = Products exactly as before.

## Screens
`products_pictures_{iphone390,android412,laptop1280}.jpg` — Products list, Edit dialog, full-screen viewer,
light and dark, with real product photos (cropped from the shop photos in `public/landing-seller*.jpg`,
run through the real upload adjust). Measured in Chromium:

| view | columns | picture box | horizontal scroll | dialog box | viewer (blue blouse 480×900) |
|---|---|---|---|---|---|
| iPhone 390 | 2 | 181×181, cover | no | 160×160, contain | 285×534 (whole picture) |
| Android 412 | 2 | 192×192, cover | no | 160×160, contain | 388×728 |
| Laptop 1280 (240 px left menu) | 5 | 196×196, cover | no | 160×160, contain | 415×744 |

✕ closes and gives focus back to the tapped picture (all 6 runs).

## Automatic picture adjust on upload (real Chromium run)
12 MP phone photos with coloured corner marks (red = top-left, green = top-right, blue = bottom-left as seen):

| photo | in | stored | KB | corners |
|---|---|---|---|---|
| portrait, stored sideways (EXIF 6) | 4032×3024, 2.4 MB | 1200×1600 | 306 | red / green / blue ✓ |
| landscape (EXIF 1) | 4032×3024 | 1600×1200 | 305 | ✓ |
| landscape upside down (EXIF 3) | 4032×3024 | 1600×1200 | 306 | ✓ |
| portrait, other way (EXIF 8) | 4032×3024 | 1200×1600 | 306 | ✓ |
| small 600×400 | 600×400 | 600×400 (never enlarged) | 41 | ✓ |
| iPhone HEIC (type image/heic) | 3024×4032, 2.3 MB | 1200×1600 JPEG | 334 | ✓ |
| iPhone HEIC (no file type) | same | 1200×1600 JPEG | 334 | ✓ |

Same 7 results again with a decoder that ignores the EXIF tag (our own turning code does the work);
breaking our turn for orientation 6 then gave a wrong result — so that path is really used.
All stored files are under the bucket's 400 KB limit (sql/95, unchanged).
