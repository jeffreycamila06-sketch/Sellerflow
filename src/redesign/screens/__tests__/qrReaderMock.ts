// The screen tests fake the QR reader with one function "photo → QR text or null". This turns that function
// into the reader's whole module: readQrFromFile answers "one" (a text) or "none" (null), as a photo with one
// QR or none would; a LIST of 2+ different texts = a photo with that many stickers ("many").
// warmQrReader calls `warm` (when given) — the screens start loading the reader when Scan is tapped.
type Answer = string | null | string[];
export function qrReaderModule(decode: (f: File) => Promise<Answer> | Answer, warm?: () => void) {
  const diag = { decoder: "none", loader: "none", imgW: 0, imgH: 0, fileType: "", fileKb: 0, ms: 0, passes: [] };
  return {
    decodeQrFromFile: async (f: File) => { const a = await decode(f); return Array.isArray(a) ? null : a; },
    readQrFromFile: async (f: File) => {
      const a = await decode(f);
      if (Array.isArray(a)) {
        const n = new Set(a).size;
        return n >= 2 ? { kind: "many" as const, count: n, diag } : n === 1 ? { kind: "one" as const, text: a[0], diag } : { kind: "none" as const, reason: "no_code" as const, diag };
      }
      return a ? { kind: "one" as const, text: a, diag } : { kind: "none" as const, reason: "no_code" as const, diag };
    },
    warmQrReader: () => { warm?.(); },
  };
}
