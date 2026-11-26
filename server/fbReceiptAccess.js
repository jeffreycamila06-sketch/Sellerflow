// THE RECEIPT ADD-ON CHECK (Jeff, 2026-11-26, rule 2): the Messenger receipt is allowed only while
//   (1) the seller has an enabled fb_receipt_access row (the add-on — any plan, Free too), AND
//   (2) the seller's plan has not ended: seller_profiles.plan_expiry is empty or in the future. A FREE plan never
//       ends (it is limited by orders, not by time — the app's lib/planWindow isTimeLimitedPlan), so its
//       plan_expiry is not read: a Free seller with the add-on keeps the receipt (rule 1: any plan, Free too).
// Plan ended = Messenger receipt stops (Send all, the Orders receipt Send, /fb/access, the sold-out
// message). Any read error, no profile row or a date that cannot be read = NOT allowed (fail closed).
//
// The Facebook sign-in (/fb/oauth/start) keeps asking only for the row (receiptAddonRow), so a seller
// whose plan ended and who signs in again does not lose the Page's Messenger permission for when the
// plan is renewed.

// accessRow = the fb_receipt_access row (or null); profile = { plan, plan_expiry } (or null). PURE.
export function receiptAccessAllowed(accessRow, profile, nowMs = Date.now()) {
  if (!accessRow || accessRow.enabled !== true) return false;
  if (!profile || typeof profile !== "object") return false;
  if (String(profile.plan ?? "").trim().toLowerCase() === "free") return true;
  const exp = profile.plan_expiry;
  if (exp === null || exp === undefined || String(exp).trim() === "") return true;
  const t = Date.parse(String(exp));
  return Number.isFinite(t) && t > nowMs;
}

// readAccess(uid) → { enabled } | null ; readProfile(uid) → { plan, plan_expiry } | null. Either may throw.
export function makeReceiptAccess({ readAccess, readProfile, now = () => Date.now() }) {
  const uidOf = (u) => String(u || "");
  async function receiptAddonRow(userId) {
    try { const r = await readAccess(uidOf(userId)); return !!r && r.enabled === true; } catch { return false; }
  }
  async function hasReceiptAccess(userId) {
    try {
      const uid = uidOf(userId);
      if (!uid) return false;
      const [row, profile] = await Promise.all([readAccess(uid), readProfile(uid)]);
      return receiptAccessAllowed(row, profile, now());
    } catch { return false; }
  }
  return { hasReceiptAccess, receiptAddonRow };
}
