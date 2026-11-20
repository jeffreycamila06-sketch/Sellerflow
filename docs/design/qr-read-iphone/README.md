# Scan QR on iPhone — "No QR found" on real stickers (branch `claude/qr-read-iphone`, 2026-11-20)

## The cause
Found by chat-Claude on the owner's own iPhone photos, confirmed here:
1. **More than one sticker in the photo.** A photo of the label roll holds 2–3 stickers. iPhone has no
   built-in QR reader in the app (no `BarcodeDetector` in WKWebView), so main uses **jsQR** only. jsQR looks for
   the three corner squares of ONE QR; with two QRs in the photo it mixes the corner squares of both and reads
   nothing — or it reads one of the two and fills in that buyer (a guess; see the table below).
2. **A sticker bent over the fingers.** jsQR also gives up on a curved / tilted QR.

It was NOT the photo size, the print, or the iPhone opening the photo (main shrinks the photo to 1000 px;
a single flat sticker reads fine at that size).

## The fix — `src/redesign/adapters/qrDecode.ts` (one function for 7-11 Parcel Scan, FamilyMart Parcel Scan, Blacklist)
1. **The phone's own reader first** (Android / Chrome: `BarcodeDetector`) — unchanged, but now every code it sees counts.
2. **A stronger reader where the phone has none (iPhone):** ZXing C++ compiled to WebAssembly — npm
   `zxing-wasm` **3.1.6** (licence **MIT**; ZXing C++ itself is **Apache-2.0** — both allow use in a paid app,
   keep the notices). It returns **every** QR in the photo and handles tilt better. It is loaded **only when the
   seller taps Scan** (and only on a phone without its own reader), from our own site (never a CDN).
   If it cannot load (old phone, no network), jsQR runs as before.
3. **The whole photo at up to 2400 px, then overlapping parts of it** — halves, thirds, quadrants — each part
   drawn from the photo itself (a part holds one sticker even when the photo holds three; a small sticker gets
   more pixels). It stops at the first pass that finds a code.
4. **Two DIFFERENT QRs → never a guess:** the screens say **"2 stickers in the photo — show only one"** (8
   languages; "3 stickers…" for 3) and fill in nothing. In the jsQR fallback a single hit is checked against the
   remaining parts of the photo before it is believed.
5. **Why "No QR found"** is recorded: one analytics event `qr_scan` per scan (PostHog) with the result, the
   reason (`image_unreadable` · `canvas_failed` · `decoder_unavailable` · `no_code`), photo size and type, which
   reader ran and the time of each pass. **Never the QR text, a username or a name** (test-pinned).
6. Canvases stay ≤ 2400 px on the long edge (≤ 5.8 MP) — far under iPhone's canvas limit (~16.7 MP), also for
   48 MP photos; every canvas is freed right after use.

Printing, the sticker, and the QR content are **unchanged** (decode side only).

## Proof
**Tests** (`src/redesign/adapters/__tests__/`):
- `qrRead.photos.test.ts` — REAL stickers (drawn by the app's own sticker code: 50×30, 60×40, 100×60; every QR
  module 0.75 mm) placed on a label roll inside **4032×3024 (12 MP)** and **8064×6048 (48 MP)** photos with
  blur, noise, rotation, tilt and a curve (`qrPhoto.harness.ts`). Each case runs **main's reader** (frozen copy,
  `fixtures/qrDecode.main.ts`) and the new one on the same photo:

  | photo | main | this branch |
  |---|---|---|
  | 1 sticker, flat (50×30 / 60×40 / 100×60) | read | read, 1 pass |
  | 2 stickers on the roll (3 sizes, 12 MP + 48 MP) | **nothing** | **2 stickers** |
  | 2 stickers side by side | **one of the two (guess)** | **2 stickers** |
  | 3 stickers, the 3rd curved | **nothing** | **2 stickers** (or 3) |
  | 1 sticker curved / curved + tilted 30° (12 + 48 MP) | **nothing** | read |
  | 2 small stickers (~6 % of a 48 MP photo) | nothing | 2 stickers (found by the quadrants) |
  | no QR | nothing | nothing, reason `no_code` |

  40×30 prints no QR at all (a QR needs ≥ 50×30), so there is nothing to scan. 100×150 is not a sticker size the
  app makes (custom sizes stop at 110 mm); 100×60 is the largest tested.
- `qrRead.paths.test.ts` — the jsQR fallback (2 stickers still → "2 stickers"), Android's reader first (2 codes →
  "2 stickers", the WebAssembly never loaded), each "No QR found" reason, the event without QR text, loading on
  the Scan tap only without a built-in reader.
- Screen tests: 7-11, FamilyMart and Blacklist show the message and fill/save nothing; tapping Scan starts loading.
- `proof/breaks.txt` — on-purpose breaks: each undoes one part of the fix; the tests must go red.

**The REAL screens with REAL photos** (`shoot.cjs`, the app in preview mode, Chromium — no BarcodeDetector on
Linux, so it takes the iPhone path): JPEG photos given to the Scan QR input of the three screens on this branch
and on main → `compare-with-main.txt`. Pictures of this branch at 360 / 390 / 430 / 1280 px (English) and the
"2 stickers" message in all 8 languages at 360 px → `shots/`, checks in `shots.txt` (no sideways scroll, no cut
text). The photos: `photos/` (small copies).

**Speed and size** (`speed.cjs` → `proof/speed-browser.txt`, real browser engine, desktop CPU):

| | 12 MP photo | 48 MP photo |
|---|---|---|
| 1 sticker | 0.20 s (reading the QR: 32 ms) | 0.4–0.5 s (reading: 39 ms; the rest is the phone opening the JPEG) |
| 2–3 stickers → "2 stickers" | 0.22–0.25 s | 0.39–0.45 s |
| curved | 0.20 s | 0.39 s |
| no QR → "No QR found" | 1.5 s (every pass) | 1.6 s |
| main, same photos | 0.14–0.17 s | 0.33–0.49 s |

An iPhone is slower than this desktop (expect roughly 2–3×; not measured on a device). The first scan after
opening the app also downloads the reader once: **947 KB WebAssembly (410 KB compressed) + 38 KB code (13 KB
compressed)**, started when Scan is tapped; then cached. It is not in the main app bundle.

## Limits (honest)
- A sticker bent so hard that its QR turns more than ~50° away from the camera, or a sticker smaller than ~5 %
  of a 48 MP photo, is still not read (main reads neither). The seller flattens it / moves closer.
- Not run on a real iPhone here (no device in this container). WebKit's own engine was not available either.

## Web only
No new phone app build: the phone apps load the web app, the reader is web code + a WebAssembly file served by
the web host. Note: `package.json` / `package-lock.json` change (the new `zxing-wasm` package) — the nightly
Render deploy counts those as server files, so once merged the server may restart once in the next night window
(03:30–05:30 Taipei) if the deploy secret is saved. The server itself does not use the package.
