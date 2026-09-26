// GM validation core (2026-09-27, multi-seller parcel check) — PURE parse of
// the anonymous 賣貨便 cart page (myship.7-11.com.tw/cart/easy/<GM>).
// Probe-verified page facts (2026-09-27): the page loads with NO login, the
// shop name is the <title>, and a hidden input Cgdm_Id echoes the GM id.
// Validity = BOTH the echo matches AND a non-empty, non-error title.

export function validGmShape(gmId) {
  return /^GM\d{8,20}$/.test(String(gmId || ""));
}

// → { valid, shopName } . NEVER throws. An error/busy page ("系統忙碌中") or a
// missing echo → invalid (fail-safe: we never confirm a shop we didn't see).
export function parseGmPage(html, gmId) {
  const s = String(html || "");
  const echo = s.match(/id="Cgdm_Id"[^>]*value="([^"]*)"/i) || s.match(/value="([^"]*)"[^>]*id="Cgdm_Id"/i);
  if (!echo || echo[1] !== gmId) return { valid: false, shopName: null };
  const t = s.match(/<title>\s*([^<]{1,120}?)\s*<\/title>/i);
  const title = t ? t[1].trim() : "";
  if (!title || /系統忙碌|錯誤|error/i.test(title)) return { valid: false, shopName: null };
  return { valid: true, shopName: title };
}
