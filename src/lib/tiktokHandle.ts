// Buyer @username <-> TikTok profile URL for the sticker QR. ONE QR serves two roles:
// (1) SFL Parcel Scan reads the handle back off the label (encoder round-trip), and
// (2) a plain phone camera treats it as a link and opens the buyer's TikTok profile so
// details staff can message the receipt/total — no search mistakes.
//
// Payload = the shortest URL cameras (iOS Camera + Android) reliably treat as a link and
// TikTok resolves: https://tiktok.com/@<handle> (no www). Handle kept VERBATIM (a single
// leading @ stripped once).

// Strip a single leading @ and surrounding whitespace; otherwise verbatim.
export function stripHandle(raw: string): string {
  const s = String(raw || "").trim();
  return s.startsWith("@") ? s.slice(1).trim() : s;
}

// Build the profile URL for the QR. Blank handle → null (caller stamps no QR).
export function tiktokProfileUrl(raw: string): string | null {
  const h = stripHandle(raw);
  return h ? `https://tiktok.com/@${h}` : null;
}

// Decode either payload shape scanned off a QR:
//   - a TikTok profile URL: tiktok.com / www.tiktok.com / m.tiktok.com, with/without
//     https, /@<handle> (new stickers)
//   - a bare username: "annc" or "@annc" (old stickers)
// → the handle VERBATIM, or null when it is neither (never fill from a random QR).
export function handleFromQrPayload(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const url = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})/i);
  if (url) return url[1];
  const bare = s.match(/^@?([A-Za-z0-9._]{1,30})$/); // plausible bare handle, no scheme/slash/space
  if (bare) return bare[1];
  return null; // non-TikTok URL / arbitrary QR → reject
}
