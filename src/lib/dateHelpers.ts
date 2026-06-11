// Calendar-day ID helpers, extracted verbatim from App.tsx (Phase 2a) so
// they can be unit-tested. Behaviour is intentionally IDENTICAL — do not
// "fix" timezone semantics here without an owner-approved migration plan,
// because sf_buyers/sf_orders localStorage keys embed these day IDs.

// Device-LOCAL calendar day (YYYY-MM-DD). Used for the buyer-number daily
// reset keys; flips at the device's own midnight.
export const liveDayId = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Asia/Taipei calendar day — hardcoded TZ so #1 reset at midnight is
// consistent across all sellers regardless of their device timezone.
// Falls back to device-local liveDayId() if Intl is unavailable.
export const taipeiDayId = () => {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const y = parts.find(p => p.type === "year")?.value || "";
    const m = parts.find(p => p.type === "month")?.value || "";
    const d = parts.find(p => p.type === "day")?.value || "";
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {/* fall through */}
  return liveDayId();
};
