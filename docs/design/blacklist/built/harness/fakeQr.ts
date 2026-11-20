// Picture harness only: the QR reader answers what the page asks (?qr=link|other|none|wait|many).
// (Same exports as src/redesign/adapters/qrDecode.ts since the 2026-11-20 QR fix.)
async function answer(): Promise<string | null | string[]> {
  const q = new URLSearchParams(location.search).get("qr") || "link";
  if (q === "wait") return new Promise(() => {});
  if (q === "other") return "ABC123";
  if (q === "none") return null;
  if (q === "many") return ["https://tiktok.com/@jhunbelle.ukay", "https://tiktok.com/@maria_live"];
  return "https://tiktok.com/@jhunbelle.ukay";
}
const diag = { decoder: "none", loader: "none", imgW: 0, imgH: 0, fileType: "", fileKb: 0, ms: 0, passes: [] };
export async function readQrFromFile(_f: File) {
  const a = await answer();
  if (Array.isArray(a)) return { kind: "many" as const, count: a.length, diag };
  return a ? { kind: "one" as const, text: a, diag } : { kind: "none" as const, reason: "no_code" as const, diag };
}
export async function decodeQrFromFile(f: File): Promise<string | null> {
  const r = await readQrFromFile(f);
  return r.kind === "one" ? r.text : null;
}
export function warmQrReader(): void {}
