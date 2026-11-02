// LIVE print pattern — EXACT sticker preview: THE SAME bitmap the saved printer will print (Nov 3,
// item 5: printing.stickerBitmapFor is the one function behind the three bitmap print paths and this
// canvas — AIMO stream, generic TSPL with the model's bold, the Niimbot 50×30 frame, layout v2 ON/OFF,
// every switch and size level). On a laptop (no native printer) it shows the browser print page
// itself (printing.browserStickerHtml) in a frame. Display only — nothing printed.
import { useEffect, useMemo, useRef } from "react";
import { buildNativeStickerPayload, stickerBitmapFor, savedPrinterPath, browserStickerHtml, type Settings, type StickerPath } from "../adapters/printing";
import { previewBuyer } from "../adapters/stickerPreview";
import type { Buyer } from "../../lib/orderTypes";
import { hasNativePrinter } from "../adapters/printerBridge";

export default function ExactStickerPreview({ settings, cur, shopName, buyer, path, browser }: {
  settings: Settings; cur: string; shopName: string;
  buyer?: Buyer;          // printer setup v2: draw THIS buyer (the test sticker's) instead of the sample
  path?: StickerPath;     // default = this device's saved printer
  browser?: boolean;      // default = no native printer on this device → the browser print page
  // kept for callers: the real flags come from the module state the print reads (QR toggle, layout, spacing)
  v2?: boolean; flags?: unknown; extraAtlas?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = JSON.stringify(settings); // redraw only when the settings actually change
  const buyerKey = buyer ? JSON.stringify(buyer) : "";
  const asBrowser = browser ?? !hasNativePrinter();
  const printerPath = path ?? savedPrinterPath();
  useEffect(() => {
    let live = true;
    const b = buyerKey ? JSON.parse(buyerKey) as Buyer : previewBuyer();
    const payload = buildNativeStickerPayload(b, cur, shopName, JSON.parse(key) as Settings);
    if (asBrowser) return; // the browser page is derived below (no state)
    void stickerBitmapFor({ path: printerPath, payload, platform: b.platform }).then((img) => {
      const c = ref.current;
      if (!live || !c) return;
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
  }, [key, buyerKey, cur, shopName, printerPath, asBrowser]);
  const html = useMemo(() => (asBrowser ? browserStickerHtml({ buyer: buyerKey ? JSON.parse(buyerKey) as Buyer : previewBuyer(), cur, storeName: shopName, cfg: JSON.parse(key) as Settings }) : ""), [asBrowser, buyerKey, cur, shopName, key]);
  if (asBrowser) return <iframe title="sticker" data-testid="pp-exact-preview-browser" srcDoc={html} style={{ width: "100%", height: 180, border: "1px dashed #c9c7d9", borderRadius: 4, background: "#fff" }} />;
  return <canvas ref={ref} data-testid="pp-exact-preview" data-path={printerPath} style={{ width: "100%", imageRendering: "pixelated", display: "block", border: "1px dashed #c9c7d9", borderRadius: 4 }} />;
}
