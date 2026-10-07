// Parcel tracking — AUTOMATIC check (sql/83). PURE helpers used by the job worker for
// kind = 'auto' jobs: the tunable settings (app_settings, clamped), the budget tier, and
// which parcels an auto job checks (and in what order). No network, no database.
//
// The database (parcel_tracking_auto_check) decides WHETHER a seller gets an auto job;
// these helpers decide WHAT that job checks. Manual / urgent / new-parcel jobs never use
// them and keep the existing 4,500 daily cap.

// app_settings keys. A missing or invalid value → the default; every value is clamped.
export const AUTO_MODE_KEY = "parcel_tracking_auto_mode"; // off | list | all (default off)
export const AUTO_SETTINGS = {
  cooldownHours: { key: "parcel_tracking_auto_cooldown_hours", def: 12, min: 4, max: 48 },
  dueDays:       { key: "parcel_tracking_auto_due_days",       def: 3,  min: 1, max: 7 },
  maxParcels:    { key: "parcel_tracking_auto_max_parcels",    def: 200, min: 20, max: 600 },
  budgetNormal:  { key: "parcel_tracking_auto_budget_normal",  def: 2000, min: 0, max: 4500 },
  budgetUrgent:  { key: "parcel_tracking_auto_budget_urgent",  def: 3000, min: 0, max: 4500 },
  memPct:        { key: "parcel_tracking_auto_mem_pct",        def: 70, min: 40, max: 90 },
};
export const AUTO_SETTING_KEYS = [AUTO_MODE_KEY, ...Object.values(AUTO_SETTINGS).map((s) => s.key)];
// At-store parcels due LATER than the due-soon window are re-checked only after this long.
export const FAR_AT_STORE_STALE_MS = 3 * 24 * 60 * 60 * 1000;
const STALE_STATUSES = new Set(["in_transit", "not_found", "unknown"]);

// PURE — one setting: a whole number inside [min, max]; anything else → the default.
export function clampSetting(raw, { def, min, max }) {
  const s = raw == null ? "" : String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return def;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// PURE — every auto setting from an app_settings { key: value } map.
export function autoSettingsFrom(map = {}) {
  const out = {};
  for (const [name, spec] of Object.entries(AUTO_SETTINGS)) out[name] = clampSetting(map[spec.key], spec);
  if (out.budgetUrgent < out.budgetNormal) out.budgetUrgent = out.budgetNormal; // the urgent tier never ends below the normal one
  const mode = String(map[AUTO_MODE_KEY] ?? "").trim().toLowerCase();
  out.mode = mode === "list" || mode === "all" ? mode : "off";
  return out;
}

// PURE — which kind of auto job today's request count allows (all job kinds together).
//   below budgetNormal → "normal"; up to budgetUrgent → "urgent_only"; at/above → "skip".
export function autoTier(requestsToday, s) {
  const used = Number(requestsToday) || 0;
  if (used >= s.budgetUrgent) return "skip";
  if (used >= s.budgetNormal) return "urgent_only";
  return "normal";
}

// Taipei calendar day (YYYY-MM-DD) `days` after `nowDate`.
function taipeiDayPlus(nowDate, days) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(nowDate.getTime() + days * 24 * 60 * 60 * 1000));
}
const deadlineOf = (r) => (r.pickup_deadline ? String(r.pickup_deadline).slice(0, 10) : "");
const polledMs = (r) => (r.last_polled_at ? Date.parse(r.last_polled_at) : NaN);
const byPolledAsc = (a, b) => (polledMs(a) || 0) - (polledMs(b) || 0);
const byDeadlineAsc = (a, b) => (deadlineOf(a) < deadlineOf(b) ? -1 : deadlineOf(a) > deadlineOf(b) ? 1 : byPolledAsc(a, b));

// PURE — the parcels an auto job checks, in order, cut to s.maxParcels from the END:
//   1. at-store parcels due within the due-soon window (nearest deadline first)
//   2. parcels never checked
//   3. in-transit / not found / unknown parcels last checked more than cooldownHours ago (oldest first)
//   4. at-store parcels due later, not checked for 3 days (oldest first)
// tier "urgent_only" → only at-store parcels due today or tomorrow (nearest first).
// Returns { rows, capped }.
export function autoScope(rows, nowDate, s, tier = "normal") {
  const now = nowDate.getTime();
  const tomorrow = taipeiDayPlus(nowDate, 1);
  const dueLimit = taipeiDayPlus(nowDate, s.dueDays);
  const atStoreDueBy = (r, limit) => r.status === "at_store" && deadlineOf(r) !== "" && deadlineOf(r) <= limit;
  let pick;
  if (tier === "urgent_only") {
    pick = rows.filter((r) => atStoreDueBy(r, tomorrow)).sort(byDeadlineAsc);
  } else {
    const staleMs = s.cooldownHours * 60 * 60 * 1000;
    const taken = new Set();
    const take = (list) => list.filter((r) => { if (taken.has(r)) return false; taken.add(r); return true; });
    const g1 = take(rows.filter((r) => atStoreDueBy(r, dueLimit)).sort(byDeadlineAsc));
    const g2 = take(rows.filter((r) => !r.last_polled_at));
    const g3 = take(rows.filter((r) => STALE_STATUSES.has(r.status) && now - polledMs(r) > staleMs).sort(byPolledAsc));
    const g4 = take(rows.filter((r) => r.status === "at_store" && !atStoreDueBy(r, dueLimit) && now - polledMs(r) > FAR_AT_STORE_STALE_MS).sort(byPolledAsc));
    pick = [...g1, ...g2, ...g3, ...g4];
  }
  return { rows: pick.slice(0, s.maxParcels), capped: pick.length > s.maxParcels };
}

// PURE — the memory guard: is the process above memPct of the instance's RAM?
export function overMemoryLimit(rssBytes, limitMb, memPct) {
  return (Number(rssBytes) || 0) > limitMb * 1024 * 1024 * (memPct / 100);
}
