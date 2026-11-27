// WAYBILL USERNAME — handing the new PDF to the seller on a laptop / browser (the phone app shares it with
// shippingExport.deliverXlsmMobile, inside the tap). Nothing here talks to a printer: "Print" opens the
// browser's own print window on the PDF.

// "waybills-20261128-0005.pdf" — Asia/Taipei clock (= the Philippines' clock).
export function pdfFilename(now = Date.now()): string {
  const d = new Date(now + 8 * 3600 * 1000).toISOString();
  return `waybills-${d.slice(0, 10).replace(/-/g, "")}-${d.slice(11, 16).replace(":", "")}.pdf`;
}

const pdfBlob = (bytes: Uint8Array): Blob => new Blob([new Uint8Array(bytes)], { type: "application/pdf" });

// A real browser: a blob link click (the file lands in Downloads).
export function downloadPdf(bytes: Uint8Array, filename: string): boolean {
  try {
    const url = URL.createObjectURL(pdfBlob(bytes));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  } catch { return false; }
}

// The PDF in a hidden frame, then the browser's print window; if the frame can't print, the PDF opens in
// a new tab (it has its own Print button). false = nothing could be opened.
export function printPdf(bytes: Uint8Array): boolean {
  let url = "";
  try {
    url = URL.createObjectURL(pdfBlob(bytes));
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.setAttribute("title", "waybills");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none";
    f.onload = () => {
      setTimeout(() => {
        try { f.contentWindow?.focus(); f.contentWindow?.print(); } catch { window.open(url, "_blank", "noopener"); }
      }, 150);
    };
    f.src = url;
    document.body.appendChild(f);
    setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 5 * 60_000);
    return true;
  } catch {
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}
