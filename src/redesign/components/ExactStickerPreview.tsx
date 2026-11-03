// LIVE print pattern — EXACT sticker preview: THE SAME bitmap the saved printer will print (Nov 3,
// item 5: printing.stickerBitmapFor is the one function behind the bitmap print paths and this canvas —
// AIMO stream, generic TSPL with the model's bold, the Niimbot 50×30 frame, the laptop's print page
// (round 3, item 7), layout v2 ON/OFF, every switch and size level). Display only — nothing printed.
//
// Laptop (round 3, item 1): the bitmap is drawn at the label's REAL size (mm → CSS px) and the frame scales
// it with a CSS transform, so what the frame shows is the printed page at every screen width.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildNativeStickerPayload, stickerBitmapFor, savedPrinterPath, type Settings, type StickerPath } from "../adapters/printing";
import { previewBuyer, labelPx, labelMm } from "../adapters/stickerPreview";
import type { Buyer } from "../../lib/orderTypes";
import { hasNativePrinter } from "../adapters/printerBridge";

export default function ExactStickerPreview({ settings, cur, shopName, buyer, path, browser }: {
  settings: Settings; cur: string; shopName: string;
  buyer?: Buyer;          // printer setup v2: draw THIS buyer (the test sticker's) instead of the sample
  path?: StickerPath;     // default = this device's saved printer
  browser?: boolean;      // default = no native printer on this device → the laptop print page (path "browser")
  // kept for callers: the real flags come from the module state the print reads (QR toggle, layout, spacing)
  v2?: boolean; flags?: unknown; extraAtlas?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const key = JSON.stringify(settings); // redraw only when the settings actually change
  const buyerKey = buyer ? JSON.stringify(buyer) : "";
  const asBrowser = browser ?? !hasNativePrinter();
  const printerPath: StickerPath = path ?? (asBrowser ? "browser" : savedPrinterPath());
  useEffect(() => {
    let live = true;
    const b = buyerKey ? JSON.parse(buyerKey) as Buyer : previewBuyer();
    const payload = buildNativeStickerPayload(b, cur, shopName, JSON.parse(key) as Settings);
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
  }, [key, buyerKey, cur, shopName, printerPath]);
  // laptop frame: the label's size in CSS px and the scale that fits it into the frame's width
  const mm = useMemo(() => labelMm(settings.stickerSize), [settings.stickerSize]);
  const px = labelPx(mm.w, mm.h);
  const [frameW, setFrameW] = useState(0);
  useLayoutEffect(() => {
    if (!asBrowser) return;
    const el = frameRef.current;
    if (!el) return;
    const read = () => setFrameW(el.getBoundingClientRect().width);
    read();
    if (typeof ResizeObserver === "function") { const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect(); }
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [asBrowser]);
  const scale = frameW > 0 ? frameW / px.w : 1;
  const canvasStyle = { imageRendering: "pixelated" as const, display: "block" as const };
  if (asBrowser) {
    return (
      <div ref={frameRef} data-testid="pp-exact-preview-browser" data-aspect={`${mm.w} / ${mm.h}`} data-label-px={`${px.w.toFixed(2)}x${px.h.toFixed(2)}`} data-scale={scale.toFixed(4)}
        style={{ width: "100%", aspectRatio: `${mm.w} / ${mm.h}`, position: "relative", overflow: "hidden", border: "1px dashed #c9c7d9", borderRadius: 4, background: "#fff" }}>
        <canvas ref={ref} data-testid="pp-exact-preview" data-path={printerPath} style={{ ...canvasStyle, width: `${mm.w}mm`, height: `${mm.h}mm`, transform: `scale(${scale})`, transformOrigin: "top left" }} />
      </div>
    );
  }
  return <canvas ref={ref} data-testid="pp-exact-preview" data-path={printerPath} style={{ ...canvasStyle, width: "100%", border: "1px dashed #c9c7d9", borderRadius: 4 }} />;
}
