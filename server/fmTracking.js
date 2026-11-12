// FamilyMart (全家) tracking — the PURE core (no network, no OCR, no database). What the site
// answers → what a parcel's row becomes, and one query session with injected steps.
// The real HTTP / OCR / database is server/fmTrackingRunner.js.
//
// Contract (taken by the owner from the browser, 2026-11-12):
//   base  https://ecfme.fme.com.tw/FMEDCFPWebV2_II/  (embedded in fmec.famiport.com.tw/FP_Entrance/QueryBox)
//   1. GET  index.aspx                      → session cookies
//   2. POST GetVerificationCode {}          → {"Code":"…"}
//   3. GET  CodeHandler.ashx?Code=…         → GIF, 6 digits
//   4. POST ChkVerificationCode {"P_CODE":"043180","P_VCODE":"<Code>"} → {"success":"1"}
//   5. GET  list.aspx
//   6. POST list.aspx/InquiryOrders {"ListEC_ORDER_NO":"<寄件編號>"}   → {"ErrorCode":"000","List":[{EC_ORDER_NO,CNT,ORDER_NO,…}]}
//   7. POST GetOrderDetail {"EC_ORDER_NO","RCV_USER_NAME":null,"ORDER_NO"} → the steps, NEWEST FIRST
//   Every JSON answer is {"d":"<JSON string>"} — parsed twice.
//
// ⚠️ GUESSES (only step 6's path is confirmed). When the site answers something else the session
// stops and logs one clear line; change the value here.
export const FM_BASE = "https://ecfme.fme.com.tw/FMEDCFPWebV2_II/";
export const FM_ORIGIN = "https://ecfme.fme.com.tw";
export const FM_EMBED_REFERER = "https://fmec.famiport.com.tw/";
export const FM_PATHS = Object.freeze({
  index: "index.aspx",
  getCode: "index.aspx/GetVerificationCode",   // GUESS (page method of index.aspx)
  codeImage: "CodeHandler.ashx",
  checkCode: "index.aspx/ChkVerificationCode", // GUESS (page method of index.aspx)
  list: "list.aspx",
  inquiry: "list.aspx/InquiryOrders",          // confirmed
  detail: "list.aspx/GetOrderDetail",          // GUESS (page method of list.aspx)
});
export const fmUrl = (path) => FM_BASE + path;
export const FM_PARCELS_PER_SESSION = 5;  // GUESS: parcels asked after one solved captcha
export const FM_MAX_CAPTCHA_TRIES = 4;    // a wrong captcha → a new one, at most this many per session
export const FM_CAPTCHA_DIGITS = 6;

// ORDER_STATUS codes seen on 4 real parcels.
export const FM_CODES = Object.freeze({
  "01": "訂單成立未寄件", "02": "已完成寄件", "03": "貨件前往物流中心", "04": "貨件抵達物流中心",
  "042": "貨件跨區轉運中", "043": "物流中心理貨中", "06": "貨件已完成理貨", "07": "貨件等待配送中",
  "073": "貨件進行配送中", "08": "貨件配達取件店舖", "09": "已完成取件", "11": "未取退回物流中心",
  "12": "貨件已退回物流中心", "31": "即將退回寄件店", "40": "訂單失效",
});
const RETURN_CODES = new Set(["11", "12", "31"]);
const TRANSIT_CODES = new Set(["02", "03", "04", "042", "043", "06", "07", "073"]);

export function fmError(code, detail = "") {
  const e = new Error(code);
  e.code = code;
  e.detail = detail;
  return e;
}

// Only letters, digits, _ and - reach a log line (never a name, a phone or a parcel number).
export const safeWord = (v, max = 24) => String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, max) || "-";
// Key names of an answer, for a log line. Every run of digits becomes # — a key can be a parcel number or a phone.
export const safeKeys = (o) => (o && typeof o === "object" ? Object.keys(o).slice(0, 8).map((k) => safeWord(k).replace(/\d+/g, "#")).join(",") : typeof o);

// 寄件編號 = 11 digits. The 好賣+ 訂單編號 (e.g. L26A1113SG) is never found by the site.
export function isFmTrackingNo(v) {
  return /^\d{11}$/.test(String(v ?? "").trim());
}

// Digits only. A captcha is used only when exactly FM_CAPTCHA_DIGITS are left.
export function cleanFmCaptcha(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

// {"d":"<JSON string>"} → the inner object. Throws fmError("bad_answer") for anything else.
export function parseFmAnswer(text) {
  let outer;
  try { outer = typeof text === "string" ? JSON.parse(text) : text; } catch { throw fmError("bad_answer", "not_json"); }
  if (!outer || typeof outer !== "object" || !("d" in outer)) throw fmError("bad_answer", `keys=${safeKeys(outer)}`);
  let inner = outer.d;
  if (typeof inner === "string") { try { inner = JSON.parse(inner); } catch { throw fmError("bad_answer", "d_not_json"); } }
  if (inner === null || typeof inner !== "object") throw fmError("bad_answer", `d=${typeof inner}`);
  return inner;
}

// "2026/11/11" + "04:31" (Taipei) → ISO; null when unreadable.
export function fmTime(date, time) {
  const d = String(date ?? "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!d) return null;
  const t = String(time ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  const pad = (n) => String(n).padStart(2, "0");
  const ms = Date.parse(`${d[1]}-${pad(d[2])}-${pad(d[3])}T${t ? `${pad(t[1])}:${t[2]}:${t[3] || "00"}` : "00:00:00"}+08:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
// "2026/11/18" → "2026-11-18"; null when unreadable.
export function fmDay(date) {
  const d = String(date ?? "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!d) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const out = `${d[1]}-${pad(d[2])}-${pad(d[3])}`;
  return Number.isFinite(Date.parse(`${out}T00:00:00Z`)) ? out : null;
}

const codeOf = (s) => { const c = String(s?.ORDER_STATUS ?? "").trim(); return /^\d$/.test(c) ? `0${c}` : c; };
const text = (v) => { const s = String(v ?? "").trim(); return s || null; };

// When a step happened (ms), or NaN — both the date and the time must be readable.
const stepMs = (s) => {
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(String(s?.ORDER_TIME ?? "").trim())) return NaN;
  const iso = fmTime(s.ORDER_DATE, s.ORDER_TIME);
  return iso ? Date.parse(iso) : NaN;
};
// The steps NEWEST FIRST by their own date and time, whatever order the site sent them in. Steps of
// the same minute keep the site's order. When any step has no readable time the site's order is kept.
export function newestFirst(steps) {
  const list = Array.isArray(steps) ? steps.filter((s) => s && typeof s === "object") : [];
  const at = list.map(stepMs);
  if (at.some((t) => !Number.isFinite(t))) return list;
  return list.map((s, i) => ({ s, t: at[i], i })).sort((x, y) => y.t - x.t || x.i - y.i).map((x) => x.s);
}

// The whole history → what the parcel is. Returns
//   { kind, status_message, at, pickup_deadline, arrived_at, rec_store, unknownCode? }
//   kind ∈ returned | picked_up | at_store | in_transit   ← real answers (written to the row)
//        | expired                                         ← the row is removed
//        | not_shipped | unknown | void_unclear            ← nothing but the check time is written
// The steps are first put newest first by their own date (newestFirst). Rules, in this order
// (owner, 2026-11-12, audit rounds):
//   1. RETURNED when ANY step is 11 / 12 / 31, or any step's ORDER_NO differs from its EC_ORDER_NO
//      (the way back) — even when the newest step is 09 已完成取件 (the SELLER collected the return),
//      even next to a 40 訂單失效, and even when another step has a code we do not know.
//      at = the first 11. The buyer's deadline = ORDER_DATE_RTN of the ORIGINAL leg. The buyer's
//      store = the 08 of the original leg: the steps that are not on the way back; when NO step
//      carries an ORDER_NO the way back cannot be told that way, so only steps OLDER than the first
//      11 / 12 / 31 count (an 08 after it is the seller's own store).
//   2. a 40 訂單失效 anywhere: when EVERY step is 01 or 40 → expired; with any other step →
//      void_unclear (the row is left as it is, one log line)
//   3. a code we do not know → unknown (no guess: the row keeps its status, one log line with the code)
//   4. any 09 → picked_up (at = the 09)        newest 08 → at_store (deadline = ORDER_DATE_RTN)
//      newest 02–073 → in_transit               newest 01 → not_shipped
// The caller has already made sure the list is not empty and every step belongs to the parcel asked
// (stepsFault); an empty list here still answers unknown.
export function classifyFm(steps, ecOrderNo) {
  const list = newestFirst(steps);
  const none = { status_message: null, at: null, pickup_deadline: null, arrived_at: null, rec_store: null };
  if (!list.length) return { ...none, kind: "unknown", unknownCode: "none" };
  const codes = list.map(codeOf);

  const own = String(ecOrderNo ?? "").trim();
  const isWayBack = (s) => {
    const o = String(s.ORDER_NO ?? "").trim(), e = String(s.EC_ORDER_NO ?? own).trim();
    return !!o && !!e && o !== e;
  };
  const timeOf = (s) => (s ? fmTime(s.ORDER_DATE, s.ORDER_TIME) : null);
  const msgOf = (s, c) => (s ? text(s.STATUS_D) || FM_CODES[c] || null : null);
  // The list is newest first → the LAST index of a code is its earliest step.
  const firstReturnAt = Math.max(...[...RETURN_CODES].map((c) => codes.lastIndexOf(c)));
  const noOrderNo = list.every((s) => !text(s.ORDER_NO));
  const original = noOrderNo && firstReturnAt >= 0 ? list.slice(firstReturnAt + 1) : list.filter((s) => !isWayBack(s));
  const originalCodes = original.map(codeOf);
  const arrivedStep = original[originalCodes.indexOf("08")] || null; // the buyer's store
  const arrived_at = timeOf(arrivedStep);
  const rec_store = arrivedStep ? text(arrivedStep.RCV_STORE_NAME) : null;
  const newest = codes[0];

  const wayBack = list.filter(isWayBack);
  if (firstReturnAt >= 0 || wayBack.length) {
    const lastIndex = (c) => codes.lastIndexOf(c);
    const first11 = lastIndex("11") >= 0 ? list[lastIndex("11")] : null;
    const firstOther = [lastIndex("12"), lastIndex("31")].filter((i) => i >= 0).sort((a, b) => b - a)[0];
    const decided = first11 || (firstOther != null ? list[firstOther] : null) || wayBack[wayBack.length - 1];
    const deadlineStep = arrivedStep && fmDay(arrivedStep.ORDER_DATE_RTN) ? arrivedStep : original.find((s) => fmDay(s.ORDER_DATE_RTN));
    return {
      kind: "returned", status_message: msgOf(decided, codeOf(decided)), at: timeOf(decided),
      pickup_deadline: deadlineStep ? fmDay(deadlineStep.ORDER_DATE_RTN) : null, arrived_at, rec_store,
    };
  }
  if (codes.includes("40")) {
    const at40 = codes.indexOf("40");
    if (codes.every((c) => c === "01" || c === "40")) return { ...none, kind: "expired", status_message: text(list[at40].STATUS_D) || FM_CODES["40"], at: fmTime(list[at40].ORDER_DATE, list[at40].ORDER_TIME) };
    return { ...none, kind: "void_unclear", status_message: text(list[at40].STATUS_D) || FM_CODES["40"] };
  }
  const unknownAt = codes.findIndex((c) => !(c in FM_CODES));
  if (unknownAt >= 0) return { ...none, kind: "unknown", unknownCode: safeWord(codes[unknownAt], 8), status_message: text(list[unknownAt].STATUS_D) };
  const picked = codes.indexOf("09");
  if (picked >= 0) return { kind: "picked_up", status_message: msgOf(list[picked], "09"), at: timeOf(list[picked]), pickup_deadline: null, arrived_at, rec_store };
  if (newest === "08") {
    return { kind: "at_store", status_message: msgOf(list[0], "08"), at: timeOf(list[0]), pickup_deadline: fmDay(list[0].ORDER_DATE_RTN), arrived_at: timeOf(list[0]), rec_store: text(list[0].RCV_STORE_NAME) };
  }
  if (TRANSIT_CODES.has(newest)) return { ...none, kind: "in_transit", status_message: msgOf(list[0], newest), at: timeOf(list[0]) };
  return { ...none, kind: "not_shipped", status_message: msgOf(list[0], newest), at: timeOf(list[0]) }; // 01
}

// InquiryOrders answer → { found, orderNo }. CNT 0 / ORDER_NO null = the site does not know it.
// Throws when the answer is not the expected shape (session over, blocked, changed).
export function inquiryItem(answer, ecOrderNo) {
  const code = String(answer?.ErrorCode ?? "");
  if (!answer || !Array.isArray(answer.List)) throw fmError("inquiry_shape", `keys=${safeKeys(answer)} code=${safeWord(code, 8)}`);
  if (code !== "000") throw fmError("inquiry_error", `code=${safeWord(code, 8)}`);
  const own = String(ecOrderNo).trim();
  const item = answer.List.find((x) => String(x?.EC_ORDER_NO ?? "").trim() === own); // only the parcel asked — never "the one item there is"
  const orderNo = String(item?.ORDER_NO ?? "").trim();
  if (!item || !(Number(item.CNT) > 0) || !orderNo) return { found: false, orderNo: null };
  return { found: true, orderNo };
}

// GetOrderDetail answer → the steps. Accepts a bare list or { List: [...] }.
export function detailSteps(answer) {
  if (Array.isArray(answer)) return answer;
  if (answer && Array.isArray(answer.List)) {
    const code = String(answer.ErrorCode ?? "000");
    if (code !== "000") throw fmError("detail_error", `code=${safeWord(code, 8)}`);
    return answer.List;
  }
  throw fmError("detail_shape", `keys=${safeKeys(answer)}`);
}

// The steps of a parcel the site said it KNOWS must be usable: not empty, and every step for the
// parcel we asked. Returns the fault code, or null.
//   detail_empty    — the site found the parcel but sent no step
//   detail_mismatch — a step carries another (or no) EC_ORDER_NO
// Either way this is a fault of that PARCEL's answer, not of the site: its status is left alone
// (only the check time is written) and the rest of the session's parcels are asked again.
export function stepsFault(steps, ecOrderNo) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) return "detail_empty";
  const own = String(ecOrderNo ?? "").trim();
  if (list.some((s) => !s || typeof s !== "object" || String(s.EC_ORDER_NO ?? "").trim() !== own)) return "detail_mismatch";
  return null;
}

// The four REAL answers. Only these change the row's status and stamp fm_answered_at (sql/151) —
// the mark that tells the 好賣+ upload "the check has answered this row, do not lower it".
export const FM_ANSWER_KINDS = Object.freeze(["returned", "picked_up", "at_store", "in_transit"]);

// One classified parcel → what to do with its row. `row` = the stored row (arrived_at, rec_store).
//   { action: "delete" } | { action: "update", patch }
// not_found / not_shipped / unknown / void_unclear change nothing but the check time. arrived_at and
// rec_store are written only when the row has none. The check never writes tracking_no.
export function fmRowChange(result, row, nowIso) {
  const base = { last_polled_at: nowIso };
  const answered = { ...base, fm_answered_at: nowIso };
  const once = {};
  if (result.arrived_at && !row?.arrived_at) once.arrived_at = result.arrived_at;
  if (result.rec_store && !row?.rec_store) once.rec_store = result.rec_store;
  switch (result.kind) {
    case "expired": return { action: "delete" };
    case "returned":
      return { action: "update", patch: { ...answered, ...once, status: "returned", status_message: result.status_message, terminal: true, returned_at: result.at || nowIso, ...(result.pickup_deadline ? { pickup_deadline: result.pickup_deadline } : {}) } };
    case "picked_up":
      return { action: "update", patch: { ...answered, ...once, status: "picked_up", status_message: result.status_message, terminal: true, picked_up_at: result.at || nowIso } };
    case "at_store":
      return { action: "update", patch: { ...answered, ...once, status: "at_store", status_message: result.status_message, terminal: false, ...(result.pickup_deadline ? { pickup_deadline: result.pickup_deadline } : {}) } };
    case "in_transit": // on its way → the "drop off before …" date from the upload no longer applies
      return { action: "update", patch: { ...answered, status: "in_transit", status_message: result.status_message, terminal: false, pickup_deadline: null } };
    default: // not_found, not_shipped, unknown, void_unclear
      return { action: "update", patch: base };
  }
}

// ONE session: captcha (retried), then each parcel. Steps are injected:
//   deps.openIndex()            deps.getCode() → "<Code>"        deps.getImage(code) → bytes
//   deps.solve(bytes) → text    deps.checkCode(digits, code) → boolean
//   deps.openList()             deps.inquiry(no) → answer        deps.detail(no, orderNo) → answer
// Returns { results: [{ tracking_no, result }], captchaTries, captchaHits, error, detail }.
// `results` holds every parcel answered before an error — the caller keeps them.
export async function runFmSession(codes, deps, { maxTries = FM_MAX_CAPTCHA_TRIES } = {}) {
  const out = { results: [], captchaTries: 0, captchaHits: 0, error: null, detail: "" };
  try {
    await deps.openIndex();
    let solved = false;
    for (let i = 0; i < maxTries && !solved; i++) {
      const code = await deps.getCode();
      const image = await deps.getImage(code);
      const digits = cleanFmCaptcha(await deps.solve(image));
      out.captchaTries += 1;
      if (digits.length !== FM_CAPTCHA_DIGITS) continue; // not 6 digits → a new captcha (no check request)
      solved = await deps.checkCode(digits, code);
      if (solved) out.captchaHits += 1;
    }
    if (!solved) { out.error = "captcha_failed"; return out; }
    await deps.openList();
    for (const no of codes) {
      const item = inquiryItem(await deps.inquiry(no), no);
      if (!item.found) { out.results.push({ tracking_no: no, result: { kind: "not_found" } }); continue; }
      const steps = detailSteps(await deps.detail(no, item.orderNo));
      const fault = stepsFault(steps, no);
      if (fault) throw fmError(fault); // this parcel's status is not touched
      out.results.push({ tracking_no: no, result: classifyFm(steps, no) });
    }
  } catch (e) {
    out.error = (e && e.code) || (e && e.name === "AbortError" ? "timeout" : "threw");
    out.detail = (e && e.detail) || "";
  }
  return out;
}
