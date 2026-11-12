# LIVE print pattern — TikTok / Facebook view (2026-11-12)

Four buttons above the preview: **TikTok · Facebook · Instagram (Soon) · Shopee (Soon)**. The view only
picks which sample buyer the preview shows and Printer Test prints. It changes no setting and is never saved.

Pictures here = what Printer Test draws on each print path, buyer #128 Maria Santos, recommended
settings with the QR on, 60×40 mm (Niimbot: 50×30 mm):

| Path | TikTok view (= main, unchanged) | Facebook view (new) |
|---|---|---|
| D520 | `d520-tiktok-view.png` | `d520-facebook-view.png` |
| TSPL (XP-420B) | `tspl-tiktok-view.png` | `tspl-facebook-view.png` |
| ESC/POS | `escpos-tiktok-view.png` | `escpos-facebook-view.png` |
| CPCL | `cpcl-tiktok-view.png` | `cpcl-facebook-view.png` |
| Niimbot | `niimbot-tiktok-view.png` | `niimbot-facebook-view.png` |
| Laptop | `laptop-tiktok-view.png` | `laptop-facebook-view.png` |

Facebook view at the other sizes (D520): `d520-facebook-view-50x30.png`, `-70x50`, `-80x50`, `-80x60`, `-100x60`.

Remake them: `SFL_VIEW_PICS=$PWD/docs/design/pattern-view npx vitest run src/redesign/adapters/__tests__/stickerView.facebook.test.ts`

Proof (tests): `stickerView.tiktokMain.test.ts` (TikTok view = main's bytes), `stickerView.facebook.test.ts`
(Facebook view = a real Facebook order's bytes).
