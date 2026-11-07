# One sticker, same everywhere (printer fix Branch 1) — proof pictures

Every sticker picture here is drawn by the SAME function the print uses (`src/redesign/adapters/oneSticker.ts`).
The laptop pictures are Chrome's own print of the real print page (Playwright → PDF → 203.2 dpi = 8 dots per mm).

| Folder | What it shows |
|---|---|
| `screen/` | The new LIVE print pattern screen — iPhone 390, Android 412, desktop 1280 × light/dark × English / Filipino / 繁體中文 (`screen_<device>_<theme>_<lang>.png`), plus states: red fit warning (50×30, Buyer 2×), Custom 40×30, Niimbot B1 + a size too wide, a printer still on the older text sticker, 360 px and 430 px widths. `screens-check.txt` = no sideways scroll on any of them. |
| `stickers/aimo-d520/` | AIMO / Phomemo D520BT — 50×30, 60×40, 70×50, 80×50, 80×60, 100×60, custom 40×30 and 75×45. Each sheet: TikTok QR on / off, Facebook long name, very long comment, 中文, 日本語 田中さん「ワンピース」１２３, 한국어, ไทย, العربية, Български, emoji + fancy (🔥𝓐𝓶𝔂 𝐋𝐢𝐦🔥), blank shop name. |
| `stickers/generic-y41bt-xp420b/` | Flash Y41BT / Xprinter XP-420B (TSPL, density 15, speed 4, 1-dot ink) — same sizes and samples. |
| `stickers/niimbot/` | Niimbot — the sizes a Niimbot takes (B1/B21/B203 up to 50 mm wide: 50×30, 40×30; B3S up to 75 mm: also 60×40, 70×50, 75×45). The picture sits in the SDK frame 1 mm inside the label. |
| `stickers/laptop/` | Laptop / browser — Chrome's print of the real print page, every size × sample. |
| `controls/` | 100×60 and 60×40 (the readability guard is on, as printed): for each part (shop name, Buyer #, name, @username, comment/price) 0.6× / 1× / 2×, Normal / Bold / Extra, OFF — every step looks different (also tested: `oneSticker.test.ts`). |
| `pixel-table.md` | Pixel test: what each printer RECEIVES, decoded, == the preview — 8 sizes × 12 samples × AIMO / TSPL / ESC-POS / CPCL / Niimbot / laptop (all ✅), and Chrome's real print of all 96 laptop pages (picture inside Chrome's print = the sticker, 0 pixels different). |
| `today-vs-new/` | The customer case (laptop 100×60, long comment: today cut at "ako po yung bl"), the Japan client case (Niimbot 50×30 田中さん: today "tanaka" + kana removed), and the AIMO D520 at every size (long comment, Facebook 2-line name, 中文) — what the printer receives, TODAY vs NEW. |
| `all-scripts-today-layouts/` | The second switch (`sticker_all_scripts_enabled`) on TODAY's sticker (production settings) — AIMO D520 every size, generic 50×30 / 60×40, Niimbot 50×30 — OFF vs ON for Japanese, Korean, Thai, Arabic, Bulgarian and an iPhone-apostrophe/dash name (O’Brien Ana–Maria). `before-spacing/` = the same with the earlier spacing (every Thai / Korean letter group in a Chinese-size box); the main folder = AFTER (real letter widths). |
| `readability/` | Readability guard — per printer (AIMO, Y41BT/XP-420B with the 1-dot ink, Niimbot, laptop) × 50×30 / 60×40 / 100×60: Chinese, Japanese, Korean, Thai, Arabic, Cyrillic, Latin × Normal / Bold / Extra, BEFORE (the seller's weight as is) vs AFTER (what prints: lighter only where letters would close, never resized). |
| `font/` | One font "Sans": our pure-TypeScript drawing of Noto Sans 400/700/900 next to the same words drawn by the browser engine (Skia) — the same letter shapes. |

## How they were made
```bash
# sticker / control / ink / font / Niimbot pictures + the laptop print pages (scratch)
ONE_STICKER_PROOF_DIR=docs/design/one-sticker LAPTOP_HTML_DIR=<scratch>/laptop-html SFL_PROOF_FONTS=<dir with Noto Sans KR + Arabic TTF> \
  npx vitest run src/redesign/adapters/__tests__/oneSticker.proof.test.ts
# pixel table (the router's real bytes, decoded)
PIXEL_TABLE_OUT=docs/design/one-sticker/pixel-table.md npx vitest run src/redesign/adapters/__tests__/oneSticker.parity.test.ts
```
The laptop prints and the screen pictures were taken with Playwright (Chromium) from the same pages; Korean and Arabic in the pictures use Noto Sans KR / Noto Sans Arabic (on a phone the device's own font draws those two scripts).
