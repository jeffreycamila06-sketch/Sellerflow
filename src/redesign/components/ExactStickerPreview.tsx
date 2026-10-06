// LIVE print pattern — EXACT sticker preview (admin, while "Print QR on sticker" is on).
// Draws the REAL sticker image with the same renderer the phone printer path uses
// (stickerRaster.renderStickerBitmap): the chosen size, the seller's pattern toggles and
// sizes, the QR at its real size/position (bottom-right), and the comment wrapping
// around it exactly like the print (v2 layout when on). Display only — nothing printed.
import { useEffect, useRef } from "react";
import type { Settings } from "../adapters/printing";
import { renderStickerBitmap } from "../adapters/stickerRaster";
import { previewPayload, exactPreviewPayload } from "../adapters/stickerPreview";
import type { RasterSettings } from "../adapters/stickerRaster";
import { LATIN_ATLAS } from "../adapters/glyphAtlas.latin";
import { loadCjkAtlas } from "../adapters/cjkAtlasLoader";

// `flags` (sticker spacing sellers): the real image-only flags this seller prints with (QR only
// when it really prints, spacing choice) instead of the admin view's forced QR.
export default function ExactStickerPreview({ settings, cur, shopName, v2, flags }: { settings: Settings; cur: string; shopName: string; v2: boolean; flags?: RasterSettings }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = JSON.stringify(settings); // redraw only when the settings actually change
  const flagsKey = flags ? JSON.stringify(flags) : "";
  useEffect(() => {
    let live = true;
    const { payload, w, h } = flagsKey ? exactPreviewPayload(JSON.parse(key) as Settings, cur, shopName, JSON.parse(flagsKey) as RasterSettings) : previewPayload(JSON.parse(key) as Settings, cur, shopName, v2);
    void loadCjkAtlas().catch(() => undefined).then((cjk) => {
      const c = ref.current;
      if (!live || !c) return;
      const img = renderStickerBitmap(payload, w, h, { latin: LATIN_ATLAS, cjk: cjk ?? undefined });
      c.width = img.w; c.height = img.h;
      const ctx = c.getContext?.("2d");
      if (!ctx) return;
      const data = ctx.createImageData(img.w, img.h);
      for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
        const ink = (img.buf[y * img.rowBytes + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
        const i = (y * img.w + x) * 4;
        data.data[i] = data.data[i + 1] = data.data[i + 2] = ink ? 0 : 255; data.data[i + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
    });
    return () => { live = false; };
  }, [key, flagsKey, cur, shopName, v2]);
  return <canvas ref={ref} data-testid="pp-exact-preview" style={{ width: "100%", imageRendering: "pixelated", display: "block", border: "1px dashed #c9c7d9", borderRadius: 4 }} />;
}
