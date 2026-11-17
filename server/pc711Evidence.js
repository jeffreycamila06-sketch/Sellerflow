// 7-11 shadow checker — FULL EVIDENCE, re-checks, re-asks and mirror mode (Jeff 2026-11-17, sql/172).
// Pure helpers + the database adapter for pc711_shadow_evidence. The checking loop itself stays in
// server/pc711Shadow.js (one loop: one 2 s gap, one safety brake, one pause for every 7-11 request).
//
// pc711_shadow_evidence is ADMIN ONLY (RLS on, no policies, service_role only). It holds the FULL
// phone checked and 7-11's message text — NEVER written to a log line. Every log line here is words
// and numbers only.

export const MIRROR_SWITCH = "pc711_mirror_enabled";
export const EVIDENCE_KEEP_DAYS = 7;
export const EVIDENCE_PAGE = 20;
export const EXT_LIMIT_MS = 15 * 60 * 1000;            // mirror: the extension's answer is "late" after this
export const REASK_AFTER_MS = [30 * 1000, 5 * 60 * 1000]; // a real phone mismatch: ask again ~30 s and ~5 min after the check
export const EVIDENCE_SAVE_RETRY_MS = 10 * 60 * 1000;   // a failed evidence save: that value is not asked again for 10 min
export const EVIDENCE_SAVE_TRIES = 3;                    // … at most 3 tries, then left
// mirror self-stop (Jeff 2026-11-17): every 10 min, over the last 60 min of mirror-on time, ≥ 20 parcels checked
export const SELF_STOP_EVERY_MS = 10 * 60 * 1000;
export const SELF_STOP_WINDOW_MS = 60 * 60 * 1000;
export const SELF_STOP_MIN_PARCELS = 20;
export const SELF_STOP_PHONE_MEDIAN_S = 7;      // a. the typical phone time is over 7 s
export const SELF_STOP_WAITED = 10;             // b. 10 or more parcels waited over 5 min (sql/172 pc711_mirror_health) …
export const SELF_STOP_SILENT_MS = 10 * 60 * 1000; //    … skipped when the regular checker wrote no answer at all for 10 min
export const SELF_STOP_STORE_UNKNOWN = 3;       // c. 3 or more store "unknown" answers
export const SELF_STOP_RULES = ["phone_time", "waited", "store_unknown"];

/** The self-stop decision from pc711_mirror_health's numbers. Pure. silentSince = the regular checker's
 *  last answer when it has written nothing for 10 min (then rule b is skipped). */
export function selfStopDecision(h, nowMs) {
  if (!h || typeof h !== "object") return { stop: false, why: "no_numbers", silentSince: null };
  const last = Date.parse(h.lastAnswerAt || "");
  const silent = !Number.isFinite(last) || nowMs - last > SELF_STOP_SILENT_MS;
  const silentSince = silent ? (Number.isFinite(last) ? new Date(last).toISOString() : null) : null;
  const checked = Number(h.checked) || 0;
  if (checked < SELF_STOP_MIN_PARCELS) return { stop: false, why: "too_few", silentSince, silent, checked };
  const median = Number(h.medianS);
  if (Number.isFinite(median) && median > SELF_STOP_PHONE_MEDIAN_S) return { stop: true, rule: "phone_time", value: median, silentSince, silent, checked };
  const waited = Number(h.waited) || 0;
  if (!silent && waited >= SELF_STOP_WAITED) return { stop: true, rule: "waited", value: waited, silentSince, silent, checked };
  const unknown = Number(h.storeUnknown) || 0;
  if (unknown >= SELF_STOP_STORE_UNKNOWN) return { stop: true, rule: "store_unknown", value: unknown, silentSince, silent, checked };
  return { stop: false, why: "healthy", silentSince, silent, checked };
}

export const EVIDENCE_FILTERS = ["all", "mismatch", "recheck", "mirror", "error"];
const KINDS = ["store", "phone", "frozen"];
const SOURCES = ["fresh", "remembered", "unknown"];
const DAY_MS = 86400 * 1000;

const word = (w) => {
  const s = String(w ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
  return s || null;
};

/** Which input rule failed (a rule NAME, never the value), or null when the value is checkable.
 *  Same tests as the probe (server/pcServerProbe.js): phone /^09\d{8}$/ after trim, store /^\d{6}$/. */
export function badInputRule(input) {
  if (!input) return "no_input";
  if (input.kind === "phone") {
    const p = String(input.phone ?? "").trim();
    if (!p) return "phone_empty";
    if (!/^\d+$/.test(p)) return "phone_not_digits";
    if (!p.startsWith("09")) return "phone_not_09";
    if (p.length !== 10) return "phone_length";
    return null;
  }
  const s = String(input.storeId ?? "");
  if (!s) return "store_empty";
  if (!/^\d+$/.test(s)) return "store_not_digits";
  if (s.length !== 6) return "store_length";
  return null;
}

/** Two Postgres timestamps (as strings from the RPC) are the SAME instant: string first (keeps the
 *  microseconds), then the parsed time. */
export function sameInstant(a, b) {
  if (a == null || b == null) return false;
  if (String(a) === String(b)) return true;
  const x = Date.parse(String(a)), y = Date.parse(String(b));
  return Number.isFinite(x) && x === y;
}

/** A changed phone / store whose extension verdict time did NOT change → the old verdict was kept. */
export function changeFlagOf(job) {
  if (!job || job.prevInput == null || job.prevInput === job.value) return null;
  if (!sameInstant(job.prevExtAt, job.extAtRaw)) return null;
  return job.kind === "phone" ? "phone_changed_verdict_kept" : "store_changed_verdict_kept";
}

/** RPC rows (pc711_evidence_pending / pc711_mirror_pending) → jobs. Pure. */
export function evidenceJobs(rows, mode) {
  const jobs = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !r.scan_id || !KINDS.includes(r.kind)) continue;
    if (mode === "mirror" && r.kind === "frozen") continue;
    const at = Date.parse(r.at || "");
    const input = r.kind === "phone"
      ? { kind: "phone", phone: String(r.phone ?? ""), name: String(r.customer_name ?? ""), storeId: String(r.store_id ?? "") }
      : { kind: r.kind, storeId: String(r.store_id ?? "") };
    jobs.push({
      scanId: r.scan_id, kind: r.kind, mode, input, value: String(r.input ?? ""),
      ext: mode === "mirror" ? null : r.ext ?? null, at: Number.isFinite(at) ? at : NaN, extAtRaw: mode === "mirror" ? null : r.at ?? null,
      sellerId: r.seller_id ?? null, createdAt: r.created_at ?? null, round: Math.max(1, Number(r.round) || 1),
      msg: r.msg == null ? null : String(r.msg).slice(0, 120), until: r.until ?? null, cacheAt: r.cache_at ?? null,
      source: SOURCES.includes(r.source) ? r.source : mode === "mirror" ? null : "unknown",
      prevInput: r.prev_input ?? null, prevExtAt: r.prev_ext_at ?? null,
    });
  }
  return jobs;
}

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** ONE server check → the evidence row. `old` = the pc711_shadow row built by shadowRow (same verdict
 *  words, error step / reason). Never a name. */
export function evidenceRow(job, old, r, t0, end, waiting, seenAt) {
  const isErr = old.match === null && Boolean(old.fail_reason);
  const mirror = job.mode === "mirror";
  const extAtMs = Date.parse(job.extAtRaw || "");
  const mismatch = !mirror && old.match === false;
  return {
    scan_id: job.scanId, seller_id: job.sellerId, kind: job.kind, round: job.round, mode: mirror ? "mirror" : "after",
    input: job.value, store_id: job.input.storeId || null, phone: job.kind === "phone" ? job.input.phone : null,
    flag: mirror ? null : changeFlagOf(job), queue_waiting: Number.isFinite(waiting) ? Math.max(0, waiting) : null,
    parcel_created_at: job.createdAt,
    ext_at: mirror ? null : job.extAtRaw, ext_verdict: mirror ? null : job.ext, ext_message: mirror ? null : job.msg,
    ext_restricted_until: mirror ? null : job.until, ext_source: mirror ? null : job.source,
    ext_cache_at: mirror ? null : job.cacheAt,
    ext_age_s: !mirror && job.kind === "store" && Number.isFinite(extAtMs) ? Math.round((t0 - extAtMs) / 1000) : null,
    seen_waiting_at: mirror ? iso(seenAt) : null,
    srv_started_at: iso(t0), srv_finished_at: iso(end), srv_verdict: old.srv_verdict, srv_raw: old.raw,
    srv_http: old.srv_http, srv_ms: old.srv_ms,
    bad_input_rule: old.fail_reason === "bad_input" ? badInputRule(job.input) : null,
    match: mirror ? null : old.match,
    fail_step: isErr ? old.fail_step : null, fail_http: isErr ? old.fail_http : null, fail_reason: isErr ? old.fail_reason : null,
    fail_at: isErr ? iso(end) : null, steps: old.steps,
    reask_next_at: mismatch && job.kind === "phone" ? iso(end + REASK_AFTER_MS[0]) : null,
  };
}

/** A mirror row waiting for the extension + the parcel's current state → the patch (or null = keep
 *  waiting). `nowMs` decides nothing about late: the database marked ext_timeout at 15 min. */
export function pairPatch(x, nowMs) {
  if (!x) return null;
  if (x.gone) return { pair_closed: true, flag: "parcel_gone" };
  if (String(x.cur_input ?? "") !== String(x.input ?? "")) return { pair_closed: true, flag: "value_changed_before_answer" };
  if (!x.ext) return null;
  const kind = x.kind;
  const words = kind === "phone" ? ["ok", "restricted", "unknown"] : ["open", "full", "company", "not_found", "unknown"];
  const ext = words.includes(x.ext) ? x.ext : "unknown";
  const extMs = Date.parse(x.ext_at || ""), srvEnd = Date.parse(x.srv_finished_at || ""), srvStart = Date.parse(x.srv_started_at || "");
  const srvErr = Boolean(x.fail_reason);
  const match = srvErr ? null : String(x.srv_verdict ?? "") === ext;
  // "who finished first" only means something when the extension really checked just now (a FRESH answer);
  // a remembered answer can be hours old (one row showed the extension "first" by 16 hours) → no winner.
  const source = SOURCES.includes(x.source) ? x.source : "unknown";
  const first = source === "fresh" && Number.isFinite(extMs) && Number.isFinite(srvEnd) ? (extMs <= srvEnd ? "extension" : "server") : null;
  const patch = {
    ext_at: x.ext_at, ext_verdict: ext, ext_message: x.msg == null ? null : String(x.msg).slice(0, 120),
    ext_restricted_until: x.until ?? null, ext_source: source,
    ext_cache_at: x.cache_at ?? null, ext_late: Boolean(x.ext_timeout), pair_closed: true, match,
    first, first_by_ms: first ? Math.abs(extMs - srvEnd) : null,
    ext_age_s: kind === "store" && Number.isFinite(extMs) && Number.isFinite(srvStart) ? Math.round((srvStart - extMs) / 1000) : null,
  };
  if (match === false && kind === "phone") patch.reask_next_at = new Date(Math.max(srvEnd + REASK_AFTER_MS[0], nowMs)).toISOString();
  return patch;
}

/** The pc711_shadow row (first check only) for a paired mirror check — so the existing totals and
 *  Waiting keep counting it. No phone, no name, no store. */
export function oldRowFromPair(x, patch) {
  return {
    scan_id: x.scan_id, kind: x.kind, ext_verdict: patch.ext_verdict, srv_verdict: x.srv_verdict ?? "unknown",
    srv_ms: Number(x.srv_ms) || 0, srv_http: Number(x.srv_http) || 0, match: patch.match,
    note: x.fail_reason ? word(x.fail_reason) : "mirror", fail_step: x.fail_reason ? x.fail_step ?? null : null,
    fail_http: x.fail_reason ? x.fail_http ?? 0 : null, fail_reason: x.fail_reason ? word(x.fail_reason) : null,
    steps: Array.isArray(x.steps) ? x.steps : [], gap_s: null, raw: x.srv_raw ?? null,
  };
}

/** A re-ask's answer as one word: the verdict, or err_<reason> when the server got no answer. */
export function reaskWord(srvWord, failReason) {
  if (failReason) return word(`err_${failReason}`);
  return word(srvWord) || "unknown";
}

/** The next re-ask time after re-ask n (1 → ~5 min after the check, never sooner than 30 s from now). */
export function nextReaskAt(row, n, nowMs) {
  if (n >= REASK_AFTER_MS.length) return null;
  const end = Date.parse(row.srv_finished_at || "");
  const base = Number.isFinite(end) ? end + REASK_AFTER_MS[n] : nowMs + REASK_AFTER_MS[n];
  return new Date(Math.max(base, nowMs + REASK_AFTER_MS[0])).toISOString();
}

const LIST_COLS = "id,at,scan_id,kind,round,mode,flag,queue_waiting,ext_at,ext_verdict,ext_source,ext_late,ext_timeout,pair_closed,srv_verdict,srv_raw,srv_ms,match,first,first_by_ms,reask_n,reask1_word,reask2_word,fail_step,fail_http,fail_reason,fail_at,bad_input_rule,ext_age_s";

// The database adapter (service-role client). Reads/writes pc711_shadow_evidence + its RPCs only.
export function createEvidenceDb(sb) {
  const rpc = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  };
  const queue = (o) => {
    const x = o && typeof o === "object" ? o : {};
    return { waiting: Math.max(0, Number(x.waiting) || 0), jobs: Array.isArray(x.jobs) ? x.jobs : [] };
  };
  return {
    // ONE call per pass (sql/172 pc711_shadow_pass): shadow switch + queue + re-asks due + mirror switch + mirror queue + waiting pairs
    async pass(sinceIso, limit, reaskLimit, mirrorAllowed, healthFromIso = null) {
      const o = await rpc("pc711_shadow_pass", { p_since: sinceIso, p_limit: limit, p_reask_limit: reaskLimit, p_mirror_allowed: Boolean(mirrorAllowed), p_health_from: healthFromIso });
      const x = o && typeof o === "object" ? o : {};
      return {
        shadow: x.shadow === true, ...queue(x), mirror: x.mirror === true,
        reasks: Array.isArray(x.reasks) ? x.reasks : [], awaiting: Array.isArray(x.awaiting) ? x.awaiting : [],
        mirrorQueue: x.mirror_queue ? queue(x.mirror_queue) : null,
        health: x.health && typeof x.health === "object" ? x.health : null,
      };
    },
    // the self-stop: the ONLY setting it writes is pc711_mirror_enabled = 'false' (+ the stop record)
    async stopMirror(rule, value, fromIso, parcels) {
      const d = await rpc("pc711_mirror_stop", { p_rule: rule, p_value: value, p_from: fromIso, p_parcels: parcels });
      return d === true;
    },
    async insert(row) {
      const { error } = await sb.from("pc711_shadow_evidence").upsert(row, { onConflict: "scan_id,kind,input", ignoreDuplicates: true });
      if (error) throw error;
    },
    async update(id, patch) {
      const { error } = await sb.from("pc711_shadow_evidence").update(patch).eq("id", id);
      if (error) throw error;
    },
    // the parcel's CURRENT phone + name for a re-ask (one primary-key read; the name never leaves the server)
    async parcelForReask(scanId) {
      const { data, error } = await sb.from("parcel_scans").select("phone,customer_name,store_id").eq("id", scanId).limit(1);
      if (error) throw error;
      return (data || [])[0] || null;
    },
    async totals(fromIso, toIso) { return (await rpc("pc711_evidence_totals", { p_from: fromIso, p_to: toIso })) || {}; },
    async list(fromIso, toIso, filter, page) {
      let q = sb.from("pc711_shadow_evidence").select(LIST_COLS).gte("at", fromIso).lt("at", toIso);
      if (filter === "mismatch") q = q.eq("match", false);
      else if (filter === "recheck") q = q.gt("round", 1);
      else if (filter === "mirror") q = q.eq("mode", "mirror");
      else if (filter === "error") q = q.not("fail_reason", "is", null);
      const from = Math.max(0, page) * EVIDENCE_PAGE;
      const { data, error } = await q.order("at", { ascending: false }).range(from, from + EVIDENCE_PAGE);
      if (error) throw error;
      return data || [];
    },
    async detail(id) {
      const { data, error } = await sb.from("pc711_shadow_evidence").select("*").eq("id", id).limit(1);
      if (error) throw error;
      return (data || [])[0] || null;
    },
  };
}

/** Admin: one page of evidence (newest first) for today | 7days. */
export async function evidenceList(edb, { day = "today", filter = "all", page = 0 } = {}, nowMs = Date.now(), dayStartMs = null) {
  const f = EVIDENCE_FILTERS.includes(filter) ? filter : "all";
  const p = Math.max(0, Math.min(1000, Math.floor(Number(page) || 0)));
  const which = day === "7days" ? "7days" : "today";
  const from = which === "7days" ? nowMs - EVIDENCE_KEEP_DAYS * DAY_MS : (dayStartMs ?? nowMs - DAY_MS);
  const got = await edb.list(new Date(from).toISOString(), new Date(nowMs + 1).toISOString(), f, p);
  return { day: which, filter: f, page: p, more: got.length > EVIDENCE_PAGE, rows: got.slice(0, EVIDENCE_PAGE) };
}

/** Admin: totals for today | 7days (one RPC). */
export async function evidenceTotals(edb, readSetting, { day = "today" } = {}, nowMs = Date.now(), dayStartMs = null, state = null) {
  let mirror = false;
  try { mirror = String((await readSetting(MIRROR_SWITCH)) ?? "") === "true"; } catch { mirror = false; }
  const which = day === "7days" ? "7days" : "today";
  const from = which === "7days" ? nowMs - EVIDENCE_KEEP_DAYS * DAY_MS : (dayStartMs ?? nowMs - DAY_MS);
  const totals = await edb.totals(new Date(from).toISOString(), new Date(nowMs + 1).toISOString());
  const ss = (state && state.selfStop) || {};
  return { day: which, mirrorEnabled: mirror, totals, selfStop: { silentSince: ss.silentSince ?? null, lastCheckAt: ss.lastCheckAt ?? null, lastStop: totals && totals.lastStop ? totals.lastStop : null } };
}
