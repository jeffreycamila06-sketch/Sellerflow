# In-page QR scanner — previews (Android phone size, 412×915)

The REAL app (preview mode: made-up data) in Chromium, told it is the **Android app without the built-in
scanner**, with a **fake camera** that plays short videos of real SellerFlowLive stickers (drawn by the app's own
sticker code). The scanner, its QR reader, the centre rule and the four screens are the real code.
`results.txt` = what each step did (all checks passed).

| Picture | What it shows |
|---|---|
| `01-scanner-light-off.png` | The scanner screen over Parcel Scan: frame, "Point at the QR on the sticker", Close, light (off), "Take a photo instead" |
| `02-scanner-light-on.png` | The same with the light switched on |
| `03-point-at-one-qr.png` | Two stickers equally near the middle → "Point at one QR" (nothing is read) |
| `04-camera-refused-photo-flow.png` | Camera refused → the scanner is gone, one line on Parcel Scan, today's photo picker opened |
| `05-camera-refused-after-long-question.png` | Camera refused after a long permission question → the scanner stays with the line and its own "Take a photo instead" |
| `06-blacklist-scan-button.png` | Blacklist with its Scan sticker QR button |
| `07-orders-scan-button.png` | Orders with the Scan button |
| `08-parcel-scan-after-read.png` | Parcel Scan right after a live read (the username is filled) |
| `09-blacklist-after-read.png` | Blacklist right after a live read (the buyer is added) |
| `10-orders-after-read.png` | Orders right after a live read ("@username" in the search box) |

Not real: the camera (a video file), the camera's light (the fake camera has none — the page is told it has one),
the refused camera (the camera request is made to fail). Chromium on this machine has no QR reader of its own, so
the reader here is the loaded one. **Not run on a real Android phone.**

## Make them again
```bash
OUT=/tmp/sfl-cam npx vitest run --config previews/web-qr-scanner/harness/vitest.gen.config.ts
```
```bash
npx vite --config vite.preview.config.ts --port 5199
```
```bash
node previews/web-qr-scanner/make-previews.cjs /tmp/sfl-cam 5199
```
