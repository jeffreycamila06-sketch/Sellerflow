// One export controller for EVERY branded Excel/PDF export button (Orders, Products,
// Sales, Sales ranking / Miners). Two rules:
//   1. Never fail silently — any failure shows a short seller-words message.
//   2. Phone app shell (iOS WKWebView / Android WebView): a blob <a download> is a silent
//      no-op there, so the .xlsx is BUILT when the Export menu opens ("Preparing…") and
//      the Excel tap shares the ready bytes SYNCHRONOUSLY (navigator.share must run inside
//      the tap or iOS aborts the sheet — the Parcel Scan lesson). PDF printing does
//      nothing in the app, so the PDF tap says "use Excel on the phone" instead.
// Laptop / browser path = exactly as before (exportBrandedXlsx / exportBrandedPdf).
import { useCallback, useEffect, useRef, useState } from "react";
import { exportBrandedXlsx, exportBrandedPdf, buildBrandedXlsxBytes, XLSX_TYPE, type BrandedExportInput } from "./brandedExport";
import { deliverXlsmMobile } from "./shippingExport";
import { isAppShell } from "./appShell";

export interface ExportMessages {
  failed: string;            // "Export didn't work. Refresh the page and try again."
  pdfPhone: string;          // "PDF works on a computer browser; use Excel on the phone."
  phoneUnsupported: string;  // this phone can't save/share the file
}
export type ExportPrep = "idle" | "building" | "ready" | "error";

export function useBrandedExport(build: () => BrandedExportInput, msgs: ExportMessages, onMessage?: (msg: string) => void) {
  const phone = isAppShell();
  const [prep, setPrep] = useState<ExportPrep>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const prepRef = useRef<{ bytes: Uint8Array; filename: string } | null>(null);
  const genRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildRef = useRef(build);
  const msgsRef = useRef(msgs);
  const onMessageRef = useRef(onMessage);
  // Latest props for the tap handlers (synced after each render; taps happen after it).
  useEffect(() => { buildRef.current = build; msgsRef.current = msgs; onMessageRef.current = onMessage; });
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const show = useCallback((msg: string) => {
    if (onMessageRef.current) { onMessageRef.current(msg); return; }
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);

  // Call when the Export menu OPENS. Phone only: build the .xlsx now so the tap can share.
  const prepare = useCallback(() => {
    if (!isAppShell()) return;
    const gen = ++genRef.current;
    prepRef.current = null;
    setPrep("building");
    let input: BrandedExportInput;
    try { input = buildRef.current(); } catch { setPrep("error"); return; }
    void buildBrandedXlsxBytes(input).then((bytes) => {
      if (gen !== genRef.current) return;
      prepRef.current = { bytes, filename: `${input.filename}.xlsx` };
      setPrep("ready");
    }).catch(() => { if (gen === genRef.current) setPrep("error"); });
  }, []);

  // Call when the menu closes without exporting (drops a prepared file).
  const cancel = useCallback(() => {
    genRef.current++;
    prepRef.current = null;
    setPrep("idle");
  }, []);

  const xlsx = useCallback(() => {
    if (isAppShell()) {
      const p = prepRef.current;
      if (!p) { if (prep !== "building") { cancel(); show(msgsRef.current.failed); } return; } // still preparing → the button is disabled
      // ⚠️ share() fires NOW, inside the tap — nothing awaited before it.
      const share = deliverXlsmMobile(p.bytes, p.filename, XLSX_TYPE);
      cancel();
      void share.then((d) => {
        if (d.ok || d.cancelled) return;
        show(d.unsupported ? msgsRef.current.phoneUnsupported : msgsRef.current.failed);
      }).catch(() => show(msgsRef.current.failed));
      return;
    }
    try {
      void Promise.resolve(exportBrandedXlsx(buildRef.current())).catch(() => show(msgsRef.current.failed));
    } catch { show(msgsRef.current.failed); }
  }, [prep, cancel, show]);

  const pdf = useCallback(() => {
    if (isAppShell()) { cancel(); show(msgsRef.current.pdfPhone); return; }
    try { exportBrandedPdf(buildRef.current(), () => show(msgsRef.current.failed)); } catch { show(msgsRef.current.failed); }
  }, [cancel, show]);

  return { phone, prep, preparing: phone && prep === "building", prepare, cancel, xlsx, pdf, message };
}
