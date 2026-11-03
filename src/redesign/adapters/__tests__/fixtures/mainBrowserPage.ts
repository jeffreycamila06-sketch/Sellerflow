// FIXTURE — origin/main (4abe581) `printSlip` web-fallback page, copied VERBATIM from
// src/redesign/adapters/printing.ts lines 1047–1103 of that commit (the block from `const trunc` to the closing
// `</body></html>`). `esc` is main's line 730. Nothing else: the round-5 test compares printing.browserStickerHtml
// (the OLD laptop page) to THIS for every size × control. Do not edit by hand — regenerate from origin/main.
import { stickerQrEffective, stickerQrAllowedFor, webStickerQrSvg, type Settings } from "../../printing";
import type { Buyer } from "../../../../lib/orderTypes";
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch));
export function mainBrowserPage(buyer: Buyer, cfg: Settings, storeName: string, fbName: boolean, at: number | undefined): string {
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s); // native truncate()
  // Taipei date, same source/format family as buildNativeStickerPayload + the
  // native truncate(12) — NOT the old en-PH long date.
  const sess = trunc(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(at != null ? new Date(at) : new Date()), 12);
  // The order this sticker prints (onPrint passes a single-order buyer; reprint
  // rebuilds one). item = the CODE ("A2" / "A2 x2") for auto orders, else the
  // price string for manual — rendered LARGE at the bottom, mirroring native.
  const codeItem = buyer.orders?.[0]?.item;
  const codeTime = buyer.orders?.[0]?.time;
  // QR (same content rules as the phone): toggle on (+ entitled), not a Facebook buyer, @username line on,
  // handle not blank. Bottom-right; the lines that can reach that corner (name,
  // @handle, time + big code) get right padding so text never runs under it.
  const qr = stickerQrEffective() && stickerQrAllowedFor(buyer.platform) && cfg.printBuyerUsername !== false ? webStickerQrSvg(buyer.handle) : null;
  const qrCss = qr
    ? `body{position:relative}` +
      `.qr{position:absolute;right:clamp(1mm,2.5vw,2.5mm);bottom:clamp(1mm,2.5vh,2mm);width:${qr.sizeMm}mm;height:${qr.sizeMm}mm}` +
      `.name,.user,.foot{padding-right:${qr.sizeMm + 1.5}mm}`
    : "";
  // DRIVER-DRIVEN + AUTO-FIT (web only; native tiers UNTOUCHED): NO forced @page
  // size — the Windows printer driver's paper size decides. The body is exactly
  // ONE page tall with overflow:hidden, so content can NEVER spill to a 2nd label
  // at any size ≥60×40. Fonts scale with the page height (vh, clamped so they stay
  // readable at 60×40 and grow on taller labels). Field order mirrors the native
  // TSPL sticker: header + date, Buyer #, name, @handle, then time + the CODE big
  // at the bottom (margin-top:auto). Per-field scale multipliers are NOT applied on
  // web (they don't fit the auto-fit model; native keeps them). Names/handles are
  // single-line + ellipsis so they can't push a second page (overflow:hidden is the
  // hard guarantee regardless).
  const html = `<!DOCTYPE html><html><head><title>Sticker #${esc(buyer.num)}</title><style>` +
    `@page{size:auto;margin:0}` +
    `*{box-sizing:border-box;margin:0;padding:0}` +
    `html,body{height:100%}` +
    `body{width:100%;height:100vh;overflow:hidden;display:flex;flex-direction:column;padding:clamp(1mm,2.5vh,2mm) clamp(1mm,2.5vw,2.5mm);font-family:Arial,Helvetica,sans-serif;color:#000}` +
    `.head{display:flex;align-items:flex-end;justify-content:space-between;gap:2mm;flex-shrink:0}` +
    `.brand{font-size:clamp(2.6mm,7vh,4mm);font-weight:800;white-space:nowrap}` +
    `.date{font-size:clamp(2mm,5.5vh,3mm);font-weight:600;white-space:nowrap}` +
    `.bar{height:.6mm;background:#000;margin:.6mm 0 clamp(1mm,2.5vh,2.4mm);flex-shrink:0}` +
    `.store{font-size:clamp(2.6mm,7vh,4.2mm);font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}` +
    `.bnum{font-size:clamp(5mm,15vh,10mm);font-weight:900;line-height:1.02;white-space:nowrap;flex-shrink:0}` +
    `.name{font-size:clamp(3mm,9vh,5.6mm);font-weight:800;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;margin-top:1mm}` +
    `.user{font-size:clamp(2.4mm,6.5vh,3.8mm);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}` +
    `.foot{margin-top:auto;display:flex;flex-direction:column;min-height:0}` +
    `.ftime{font-size:clamp(2mm,5vh,2.8mm);font-weight:600}` +
    `.code{font-size:clamp(5.5mm,17vh,12mm);font-weight:900;line-height:1.02;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}` +
    qrCss +
    // Facebook name only: up to 2 lines at the same size instead of one line cut with "…"
    (fbName ? `.fbname{white-space:normal;text-overflow:clip;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}` : "") +
    `</style></head><body>` +
    `<div class="head"><span class="brand">SellerFlowLive</span><span class="date">${esc(sess)}</span></div>` +
    `<div class="bar"></div>` +
    (cfg.printStoreName && storeName ? `<div class="store">${esc(trunc(storeName, 36))}</div>` : "") +
    (cfg.printBuyerNumber ? `<div class="bnum">Buyer ${esc(buyer.num)}</div>` : "") +
    (buyer.name ? (fbName ? `<div class="name fbname">${esc(trunc(buyer.name, 60))}</div>` : `<div class="name">${esc(trunc(buyer.name, 30))}</div>`) : "") +
    (cfg.printBuyerUsername && buyer.handle ? `<div class="user">@${esc(trunc(buyer.handle.replace(/^@+/, ""), 30))}</div>` : "") +
    (cfg.printOrderItems && codeItem ? `<div class="foot">${codeTime ? `<div class="ftime">${esc(trunc(String(codeTime), 10))}</div>` : ""}<div class="code">${esc(trunc(String(codeItem), 14))}</div></div>` : "") +
    (qr ? qr.svg : "") +
    `</body></html>`;
  return html;
}
