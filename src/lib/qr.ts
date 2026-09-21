// QR module matrix for the printed sticker — encodes the buyer @username so it rides
// the physical label (the handle is purged from the free-tier DB, so it can't live only
// in Supabase). qrcode-generator is used for the MATRIX ONLY (no canvas/SVG); the caller
// stamps modules into the 1-bit sticker raster. ECC Q (25%) — resilient on small thermal
// codes. Payload is the @username string ONLY.
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
