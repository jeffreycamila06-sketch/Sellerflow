// Picture harness only: the QR reader answers what the page asks (?qr=link|other|none|wait).
export async function decodeQrFromFile(_f: File): Promise<string | null> {
  const q = new URLSearchParams(location.search).get("qr") || "link";
  if (q === "wait") return new Promise(() => {});
  if (q === "other") return "ABC123";
  if (q === "none") return null;
  return "https://tiktok.com/@jhunbelle.ukay";
}
