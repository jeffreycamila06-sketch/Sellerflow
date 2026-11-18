// Admin → 7-11 Login → "Who is checking" (Jeff 2026-11-18). READ ONLY.
//
// What this module reads, and nothing else:
//   · app_settings: the lease the Chrome extension already writes (parcel_check_worker_lease) and
//     the backup switch (pc711_backup_enabled);
//   · pc711_backup_state and pc711_backup_log (sql/179).
// It never calls a database function — the duty decision (pc711_backup_duty) WRITES, so it is never
// called from here — and it never writes a row or a setting.
//
// The answer is counts and times only: dutyAnswer() builds it key by key from fixed names, so a
// phone, a person's name, a store number or a tracking number cannot be in it. The parcel ids read
// for the count stay in this server's memory and are never answered. The one text that is not a fixed
// word is the checker laptop's own device label (what the extension writes in the lease, e.g. "Lenovo"):
// it is answered only in the two plain shapes machineLabel() allows.
//
// sql/179 not applied (the two tables do not exist) or the switch is not exactly 'true' → backup "off".

export const DUTY_LEASE_KEY = "parcel_check_worker_lease";
export const DUTY_SWITCH_KEY = "pc711_backup_enabled";
export const DUTY_REASONS = ["silent", "degraded"];
export const DUTY_ANSWER_KINDS = ["store", "phone", "frozen"]; // a parcel's answers in pc711_backup_log
export const DUTY_PAGE = 1000;            // rows a read (the database answers at most 1,000 rows a request)
export const DUTY_MAX_PAGES = 10;         // … and at most this many reads for one answer; the next answer goes on
export const DUTY_LOG_ROWS = 40;          // the newest take-over / hand-back rows looked at for the history line
export const DUTY_CACHE_MS = 10 * 1000;   // one answer serves every request for this long
export const DUTY_LABEL_MAX = 20;
const TAG = "[PC711_DUTY]";

/** An ISO time, or null when the value is not a date. Pure. */
export function isoOrNull(v) {
  if (typeof v !== "string" || !v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The checker laptop's label as it may be answered. It is the device name the Chrome extension
 *  itself writes in the lease, never parcel data. Answered only in one of two shapes:
 *    · one plain word (letters first, then letters / digits / dot / dash / underscore): "Lenovo";
 *    · the extension's own default "<platform> <4 id characters>": "Mac fe08".
 *  At most DUTY_LABEL_MAX characters and never a run of 5 or more digits (no phone, store or
 *  tracking number fits); two free words (a person's first and last name) do not fit either.
 *  Anything else → "" (the card then says "the checker laptop"). Pure. */
export function machineLabel(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > DUTY_LABEL_MAX) return "";
  if (/\d{5,}/.test(s)) return "";
  return /^[A-Za-z][A-Za-z0-9._-]*( [0-9a-z]{4})?$/.test(s) ? s : "";
}

/** The lease row → the label of the machine on duty and when it last called. Pure; never throws. */
export function parseLease(raw) {
  let v = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { v = null; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return { label: "", lastCallAt: null };
  return { label: machineLabel(v.leader_label), lastCallAt: isoOrNull(v.leader_at) };
}

/** A read error that means "this table does not exist" (sql/179 not applied yet). Pure. */
export function isMissingTable(error) {
  const code = String((error && error.code) || "");
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = String((error && error.message) || "");
  return /relation .* does not exist|could not find the table/i.test(msg);
}

const reasonOf = (v) => (DUTY_REASONS.includes(v) ? v : null);

/** A database error code as it may be logged: 5 capitals / digits (SQLSTATE) or PGRST + 3 digits. Pure. */
export function codeWord(code) {
  const c = typeof code === "string" ? code : "";
  return /^[0-9A-Z]{5}$/.test(c) || /^PGRST\d{3}$/.test(c) ? c : "error";
}

/** The last FINISHED take-over: the newest hand-back / switch-off row, and the newest take-over row
 *  before it. rows = the newest "duty" rows of the log, newest first. When the log no longer holds
 *  the pair and the server is not on duty now, the state row's own times are used. Pure. */
export function lastTakeOver(rows, state) {
  const list = Array.isArray(rows) ? rows : [];
  const endIdx = list.findIndex((r) => r && (r.word === "handed_back" || r.word === "switch_off") && isoOrNull(r.at));
  if (endIdx >= 0) {
    const end = isoOrNull(list[endIdx].at);
    const start = list.slice(endIdx + 1).find((r) => r && (r.word === "took_over_silent" || r.word === "took_over_degraded") && isoOrNull(r.at));
    if (start && Date.parse(isoOrNull(start.at)) <= Date.parse(end)) {
      return { start: isoOrNull(start.at), end, reason: start.word === "took_over_silent" ? "silent" : "degraded" };
    }
  }
  if (state && state.on_duty !== true) {
    const start = isoOrNull(state.since), end = isoOrNull(state.handed_back_at);
    if (start && end && Date.parse(start) <= Date.parse(end)) return { start, end, reason: reasonOf(state.reason) };
  }
  return null;
}

/** The answer, built key by key (nothing is copied through). Pure. */
export function dutyAnswer({ enabled = false, state = null, lease = null, dutyRows = [], answered = null, more = false, loggedOut = false, nowMs = Date.now() } = {}) {
  const on = enabled === true;
  const onDuty = on && Boolean(state && state.on_duty === true);
  const l = lease && typeof lease === "object" ? lease : { label: "", lastCallAt: null };
  return {
    backup: on ? "on" : "off",
    onDuty,
    loggedOut: loggedOut === true,
    reason: onDuty ? reasonOf(state.reason) : null,
    since: onDuty ? isoOrNull(state.since) : null,
    answered: onDuty && Number.isInteger(answered) && answered >= 0 ? answered : null,
    answeredMore: onDuty && more === true,
    checker: { label: machineLabel(l.label), lastCallAt: isoOrNull(l.lastCallAt) },
    last: lastTakeOver(dutyRows, state),
    now: new Date(nowMs).toISOString(),
  };
}

// The four reads (select only). sb = the server's own Supabase client.
export function createDutyDb(sb) {
  return {
    async settings() {
      const { data, error } = await sb.from("app_settings").select("key,value").in("key", [DUTY_SWITCH_KEY, DUTY_LEASE_KEY]);
      if (error) throw error;
      const out = { enabled: null, lease: null };
      for (const r of data || []) {
        if (r && r.key === DUTY_SWITCH_KEY) out.enabled = r.value;
        else if (r && r.key === DUTY_LEASE_KEY) out.lease = r.value;
      }
      return out;
    },
    async state() {
      const { data, error } = await sb.from("pc711_backup_state").select("on_duty,reason,since,handed_back_at").eq("id", 1).maybeSingle();
      if (error) throw error;
      return data || null;
    },
    async dutyRows(limit) {
      const { data, error } = await sb.from("pc711_backup_log").select("at,word").eq("kind", "duty").order("id", { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    },
    // the parcels answered since the duty started: only the row id and the parcel id are read
    async answeredPage(sinceIso, afterId, limit) {
      const { data, error } = await sb.from("pc711_backup_log").select("id,scan_id").gte("at", sinceIso).gt("id", afterId)
        .eq("result", "written").in("kind", DUTY_ANSWER_KINDS).order("id", { ascending: true }).limit(limit);
      if (error) throw error;
      return data || [];
    },
  };
}

/**
 * get() → the answer. db = createDutyDb (null → every get() fails); loginState() → the saved 7-11 login's
 * state word (memory, no read). One read serves all requests for cacheMs, and requests that arrive while
 * a read is running share it. The parcels of the current duty are counted from where the last answer
 * stopped (only new log rows are read).
 */
export function createDutyReader({ db, loginState = () => null, now = Date.now, cacheMs = DUTY_CACHE_MS, log = console.log }) {
  let cache = null;      // { at, answer }
  let running = null;    // the read in flight
  let count = { since: null, lastId: 0, ids: new Set() };
  let saidAt = -Infinity;
  // at most one line a minute; the only detail is the database's error CODE in its fixed shape
  // ("57014", "PGRST205") — anything else is the word "error" (never the database's own sentence)
  const say = (code) => {
    if (now() - saidAt < 60 * 1000) return;
    saidAt = now();
    try { log(`${TAG} read failed ${codeWord(code)}`); } catch { /* a log never fails the answer */ }
  };

  async function countAnswered(since) {
    if (count.since !== since) count = { since, lastId: 0, ids: new Set() };
    let more = false;
    for (let i = 0; i < DUTY_MAX_PAGES; i++) {
      const page = await db.answeredPage(since, count.lastId, DUTY_PAGE);
      for (const r of page) {
        const id = Number(r && r.id);
        if (Number.isSafeInteger(id) && id > count.lastId) count.lastId = id;
        if (r && typeof r.scan_id === "string" && r.scan_id) count.ids.add(r.scan_id);
      }
      more = page.length >= DUTY_PAGE;
      if (!more) break;
    }
    return { answered: count.ids.size, more };
  }

  async function read() {
    if (!db) throw new Error("no_db");
    const s = await db.settings();
    let state = null, dutyRows = [], installed = true;
    try { state = await db.state(); dutyRows = await db.dutyRows(DUTY_LOG_ROWS); } catch (e) {
      if (!isMissingTable(e)) throw e;
      installed = false; state = null; dutyRows = [];
    }
    const enabled = installed && s.enabled === "true";
    const since = enabled && state && state.on_duty === true ? isoOrNull(state.since) : null;
    let answered = null, more = false;
    if (since) {
      // the count never fails the answer: a read error = no number this time
      try { ({ answered, more } = await countAnswered(since)); } catch (e) { answered = null; more = false; say(e && e.code); }
    } else {
      count = { since: null, lastId: 0, ids: new Set() };
    }
    let loggedOut = false;
    try { loggedOut = loginState() === "needs_login"; } catch { loggedOut = false; }
    return dutyAnswer({ enabled, state, lease: parseLease(s.lease), dutyRows, answered, more, loggedOut, nowMs: now() });
  }

  return {
    async get() {
      if (cache && now() - cache.at < cacheMs) return cache.answer;
      if (!running) {
        running = read().then(
          (answer) => { cache = { at: now(), answer }; running = null; return answer; },
          (e) => { running = null; say(e && e.code); throw e; },
        );
      }
      return running;
    },
  };
}

/** GET /admin/pc711/duty (server.js puts requireAuth + requireAdmin in front). */
export function createDutyHandler({ reader, allowed = () => Boolean(1) }) {
  return async (req, res) => {
    if (!allowed((req && req.authUserId) || "admin")) return res.status(429).json({ error: "rate_limited" });
    try { return res.json(await reader.get()); } catch { return res.status(500).json({ error: "failed" }); }
  };
}
