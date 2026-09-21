// QR module matrix for the printed sticker — encodes the buyer's TikTok profile URL so it
// rides the physical label (the handle is purged from the free-tier DB). qrcode-generator
// is used for the MATRIX ONLY (no canvas/SVG); the caller stamps modules into the 1-bit
// sticker raster. Generic over ECC + payload; the sticker path passes the URL with ECC M
// (keeps a typical ≤37-byte URL at QR v3). See src/lib/tiktokHandle.ts for the payload.
import qrcode from "qrcode-generator";

export type QrEcc = "L" | "M" | "Q" | "H";

// n×n boolean matrix (true = dark module), or null on blank/any failure — NEVER throws
// into the print path. typeNumber 0 = auto-fit the smallest version for the data.
export function qrMatrix(text: string, ecc: QrEcc = "Q"): boolean[][] | null {
  const s = String(text || "").trim();
  if (!s) return null;
  try {
    const qr = qrcode(0, ecc);
    qr.addData(s);
    qr.make();
    const n = qr.getModuleCount();
    if (!n) return null;
    const m: boolean[][] = [];
    for (let r = 0; r < n; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
      m.push(row);
    }
    return m;
  } catch { return null; }
}
