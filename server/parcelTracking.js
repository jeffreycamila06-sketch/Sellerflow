// Parcel tracking — SHOPMORE (tracking.shopmore.com.tw) status poller CORE.
// PURE, network-free functions imported by server.js (the /admin/parcel-tracking-poll
// endpoint, built later) AND unit-tested by vitest (server.js has no test harness —
// this module is how the parse/classify logic gets real coverage). The captcha GET,
// tesseract OCR, and the /PackageDetail POST are injected as deps into pollBatch so
// the whole flow is testable without a live server (broadcastTranslate.js pattern).
//
// Verified contract (from the live Index.js + 3 real searchResults samples, saved
// uncommitted in vendor/shopmore-sample.txt):
//   Captcha : GET  /api/Captcha            → { captchaId, image(base64 PNG) }
//   Query   : POST /PackageDetail (form)   → PaymentNo[] (≤6) + CaptchaId + Captcha
//   Response: HTML embedding  var searchResults=[{...}];
//   Bad captcha → a redirect whose URL carries ?handler= (refetch + retry, cap 3).

export const SHOPMORE_BASE = "https://tracking.shopmore.com.tw";
export const CAPTCHA_URL = `${SHOPMORE_BASE}/api/Captcha`;
export const QUERY_URL = `${SHOPMORE_BASE}/PackageDetail`;
export const MAX_BATCH = 6;              // SHOPMORE PaymentNo[] cap per query
export const MAX_CAPTCHA_RETRIES = 3;    // refetch+re-OCR on an expired/wrong captcha

// ── Status vocabulary (locked from real samples 1/2/3) ───────────────────────
// in_transit — matched by includes() so the short + long forms both hit
// (e.g. "貨運已取件，包裹將送往物流中心" contains "貨運已取件").
const IN_TRANSIT_KW = [
  "訂單已成立", "寄件門市已收件", "貨運已取件",
  "已送達物流中心", "包裹等待配送中", "包裹進行配送中", "配送中",
];
// picked_up (terminal, SUCCESS) — require BOTH 完成 and 取件 (or 已取貨) so the
// in_transit "貨運已取件" (which contains 已取件) is NEVER misread as picked up.
const isPickedUpMsg = (m) => (m.includes("完成") && m.includes("取件")) || m.includes("已取貨");
// at_store (CHASE trigger) — the 門市 wording varies; match store-arrival variants.
const AT_STORE_KW = ["配達取件門市", "配達門市", "待取", "已到店", "可取貨"];
// ACTUAL return-in-progress markers (parcel is being / has been sent back to the
// seller). These EXCLUDE the future warning "…將退回物流中心" (see RETURNING_SOON_KW):
// "將退回物流" does not contain 退貨門市 / 退往物流 / 指定退貨, so a still-at-store
// parcel with only the warning is NOT classified returned (sample d). 逾期 kept as a
// defensive keyword (myship's 逾期未取 never appears in SHOPMORE, but harmless here).
const RETURNED_KW = ["退貨門市", "退往物流", "指定退貨", "退件", "逾期"];
// LAST-CHANCE warning: buyer hasn't picked up; SHOPMORE will send it back tonight.
const RETURNING_SOON_KW = ["將退回物流"];

// The current step = the NEWEST ladder entry's notificationName; fall back to the
// top-level statusMessage when the ladder is missing/empty.
function currentStep(statusMessage, shipStatusDetails) {
  const ladder = Array.isArray(shipStatusDetails) ? shipStatusDetails : [];
  const top = ladder.length ? String(ladder[0]?.notificationName || "").trim() : "";
  return top || String(statusMessage || "").trim();
}

// mapStatus — scans the WHOLE ladder (not just [0]) so a returned parcel that shows
// "已完成包裹取件" at the top (the seller collected the RETURN) is caught as returned,
// never as a buyer pickup (sample 3 — the bug-catch). Returns:
//   { status, terminal, known, returning_soon }
//   status ∈ in_transit | at_store | picked_up | returned | unknown
//   known  = false when the newest step matched no rule → the caller LOGS it so we
//            learn any not-yet-seen string from prod.
export function mapStatus(statusMessage, shipStatusDetails) {
  const ladder = Array.isArray(shipStatusDetails) ? shipStatusDetails : [];
  const names = ladder.map((d) => String(d?.notificationName || ""));
  const anyLadder = names.join("\n");
  const returning_soon = RETURNING_SOON_KW.some((k) => anyLadder.includes(k));

  // 1) ACTUAL RETURN OVERRIDES everything, including a 已完成包裹取件 at index 0
  //    (sample 3 — the seller collected the return, not a buyer pickup).
  if (RETURNED_KW.some((k) => anyLadder.includes(k))) {
    return { status: "returned", terminal: true, known: true, returning_soon };
  }

  // 2) LAST-CHANCE warning present but no actual return yet → the parcel is still
  //    sitting AT the store awaiting pickup (the "將退回物流中心" event only fires
  //    while it's at store). Classify at_store even if that warning is the newest
  //    ladder entry (sample 4). Buyer can still collect until tonight.
  if (returning_soon) {
    return { status: "at_store", terminal: false, known: true, returning_soon: true };
  }

  // 3) Otherwise classify by the newest step.
  const step = currentStep(statusMessage, shipStatusDetails);
  if (step) {
    if (isPickedUpMsg(step)) return { status: "picked_up", terminal: true, known: true, returning_soon };
    if (AT_STORE_KW.some((k) => step.includes(k))) return { status: "at_store", terminal: false, known: true, returning_soon };
    if (IN_TRANSIT_KW.some((k) => step.includes(k))) return { status: "in_transit", terminal: false, known: true, returning_soon };
  }
  // 4) Unmapped — surface for logging so we capture the real string.
  return { status: "unknown", terminal: false, known: false, returning_soon };
}

// A parcel is chaseable (store-pickup we can chase before the deadline) ONLY when it
// is C2C with no special service type. Any non-empty special_type is a home-delivery
// / return flow with no buyer store-pickup to chase.
export function isChaseable(shipType, specialType) {
  return String(shipType || "").trim().toUpperCase() === "C2C"
    && String(specialType || "").trim() === "";
}

// Extract the searchResults array from the /PackageDetail HTML, JSON.parse, and
// shape-guard each object down to the fields we use. Never throws → [] on any fault.
export function parseSearchResults(html) {
  const m = String(html || "").match(/var\s+searchResults\s*=\s*(\[[\s\S]*?\]);/);
  if (!m) return [];
  let arr;
  try { arr = JSON.parse(m[1]); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.map((o) => ({
    paymentNo: o?.paymentNo != null ? String(o.paymentNo).trim() : "",
    status: o?.status,
    statusMessage: o?.statusMessage != null ? String(o.statusMessage) : "",
    recStore: o?.recStore != null ? String(o.recStore) : "",
    recDate: o?.recDate != null ? String(o.recDate).trim() : "",
    orderAmount: o?.orderAmount != null && o.orderAmount !== "" ? Number(o.orderAmount) : null,
    shipType: o?.shipType != null ? String(o.shipType).trim() : "",
    specialType: o?.specialType != null && String(o.specialType).trim() !== "" ? String(o.specialType).trim() : null,
    shipStatusDetails: Array.isArray(o?.shipStatusDetails) ? o.shipStatusDetails : [],
  })).filter((o) => o.paymentNo);
}

// Turn one parsed searchResults object into the DB update fields for its row.
// status 0/2 → not_found (SHOPMORE couldn't resolve the code). recDate stored RAW
// (empty until at-store; means different deadlines per flow — the screen decides).
// arrived_at is set ONCE, the first time we see the parcel at_store.
export function resultToUpdate(sr, { now = new Date(), prevArrivedAt = null } = {}) {
  const nowIso = now.toISOString();
  const paymentNo = String(sr?.paymentNo || "").trim();
  const code = Number(sr?.status);
  if (code === 0 || code === 2) {
    return {
      tracking_no: paymentNo, status: "not_found", status_message: sr?.statusMessage ?? null,
      known: true, terminal: false, returning_soon: false,
      ship_type: sr?.shipType || null, special_type: sr?.specialType ?? null, chaseable: false,
      pickup_deadline: null, arrived_at: prevArrivedAt, rec_store: sr?.recStore ?? null,
      order_amount: sr?.orderAmount ?? null, last_polled_at: nowIso,
    };
  }
  const { status, terminal, known, returning_soon } = mapStatus(sr?.statusMessage, sr?.shipStatusDetails);
  const chaseable = isChaseable(sr?.shipType, sr?.specialType);
  const recDate = sr?.recDate ? String(sr.recDate).trim() : "";
  return {
    tracking_no: paymentNo,
    status, terminal, known, returning_soon,
    status_message: sr?.statusMessage ?? null,
    ship_type: sr?.shipType || null,
    special_type: sr?.specialType ?? null,
    chaseable,
    pickup_deadline: recDate || null,                    // raw recDate (empty until at store)
    arrived_at: prevArrivedAt || (status === "at_store" ? nowIso : null),
    rec_store: sr?.recStore ?? null,
    order_amount: sr?.orderAmount ?? null,
    last_polled_at: nowIso,
  };
}

// Group F/E-codes into ≤6-per-query batches.
export function batch(codes, size = MAX_BATCH) {
  const out = [];
  const list = Array.isArray(codes) ? codes : [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// A wrong/expired captcha bounces to a URL carrying ?handler= (…=expired etc.).
export function isExpiredCaptcha(finalUrl) {
  return /[?&]handler=/.test(String(finalUrl || ""));
}

// Keep only digits from the OCR output and take the 4-digit captcha.
export function cleanCaptcha(raw) {
  return String(raw || "").replace(/\D/g, "").slice(0, 4);
}

// Build the form-encoded /PackageDetail body: PaymentNo[] repeated + CaptchaId + Captcha.
export function buildQueryBody({ paymentNos = [], captchaId = "", captcha = "" }) {
  const p = new URLSearchParams();
  for (const code of paymentNos) p.append("PaymentNo[]", String(code));
  p.append("CaptchaId", String(captchaId));
  p.append("Captcha", String(captcha));
  return p;
}

// Orchestrate ONE ≤6-code batch with injected deps (no network/OCR here → testable):
//   deps.getCaptcha()   → { captchaId, image }
//   deps.solveCaptcha(image) → "1234"
//   deps.submitQuery({ paymentNos, captchaId, captcha }) → { finalUrl, html }
//   deps.onUnknownStatus?(statusMessage) — called per row whose newest step is unmapped
// Retries on an expired captcha up to MAX_CAPTCHA_RETRIES; returns { ok, updates, attempts }.
export async function pollBatch(codes, deps, { maxRetries = MAX_CAPTCHA_RETRIES, now = () => new Date() } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const { captchaId, image } = await deps.getCaptcha();
    const captcha = cleanCaptcha(await deps.solveCaptcha(image));
    const { finalUrl, html } = await deps.submitQuery({ paymentNos: codes, captchaId, captcha });
    if (isExpiredCaptcha(finalUrl)) continue;                 // bad captcha → refetch + retry
    const updates = parseSearchResults(html).map((sr) => resultToUpdate(sr, { now: now() }));
    for (const u of updates) {
      if (!u.known && deps.onUnknownStatus) deps.onUnknownStatus(u.status_message);
    }
    return { ok: true, updates, attempts: attempt };
  }
  return { ok: false, updates: [], attempts: maxRetries, error: "captcha_failed" };
}
