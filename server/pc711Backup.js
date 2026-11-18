// 7-11 server BACKUP checker (Jeff 2026-11-18, sql/179). The Chrome extension on the Lenovo stays the main
// checker. When it stops, THIS job checks parcels and writes the answers sellers see, by the extension's
// rules (chrome-extension/background.js 1.18.2 pcPollMulti, frozen-check.js) — same steps, numbers and
// timers, test-pinned against those files. When the Lenovo is back, it lets go at once.
//
//   • ON DUTY is decided in the database (sql/179 pc711_backup_duty, the database clock), from the lease the
//     extension already writes. The server only READS the lease — it never calls the lease function and never
//     writes the extension's worker state (both would change what the extension does).
//       take over = no extension machine called the lease for 120 s, OR the leader is calling but reports
//                   itself degraded (its 7-11 duty tabs are dead — the extension's own thresholds);
//       hand back = the first lease call of a leader that is not degraded.
//   • Every write goes through a service-role copy of the extension's function; the copy checks the switch and
//     the duty ITSELF, so a write after the Lenovo's return is refused in the database ("not_on_duty").
//   • The Lenovo's answer wins: each verdict carries the time the server read the parcel (p_seen_at).
//   • The extension's rules while on duty: per parcel the store half, then the phone half, then 2 s; ≤ 5
//     parcels a pass; store ladder 15 / 30 / 60 / 120 s from the pass start, "unknown" on the 5th failure;
//     the phone is NEVER given up (ladder 5 / 10 / 20 / 60 / 120 s after a token GET with no answer, else
//     15 / 30 / 60 / 120 s) and a "rejected" answer is retried, never written; each parcel is checked with
//     its OWN shop; one shop with no answer waits this pass, two make every phone wait; 01:00–05:00 Taipei
//     failures are not counted and retry in 10 min; given-up stores go back in the queue after a recovery and
//     at 05:00; the sender health check every 5 min (two "restricted" in a row pause all checks).
//   • Phone checks need no 7-11 login: they keep running when the server is logged out. Store / frozen checks
//     run while the kept E-Map session lives.
//   • NO safety brake on duty (Jeff's decision). Nothing here is faster than the extension's timers.
//   • Logs: words, counts and ms only — never a phone, name, store number, cookie, token or guid.
import {
  SHADOW_LIMIT, SHADOW_FETCH_LIMIT, SHADOW_ROW_GAP_MS, SHADOW_LOOKBACK_MS, SHADOW_MAINT_RETRY_MS, SHADOW_STORE_BACKOFF_MS,
  SHADOW_PHONE_TOKEN_MS, SHADOW_PHONE_TOKEN_RETRY_FAILS, SHADOW_FROZEN_STORE_GAP_MS, SHADOW_FROZEN_SLOW_PAUSE_MS,
  inShadowMaint, storeBackoffDelay, phoneBackoffDelay, phoneNoAnswer,
} from "./pc711Shadow.js";

// ── mirrored from chrome-extension/background.js + frozen-check.js (test-pinned) ───────────────
export const BACKUP_STORE_GIVE_UP = 5;                         // PC_STORE_GIVE_UP
export const BACKUP_REQUEUE_RETRY_MS = 60 * 1000;              // PC_REQUEUE_RETRY_MS
export const BACKUP_HEALTH_INTERVAL_MS = 5 * 60 * 1000;        // PC_HEALTH_INTERVAL_MS
export const BACKUP_HEALTH_CONFIRM_MS = 60 * 1000;             // PC_HEALTH_CONFIRM_MS
export const BACKUP_HEALTH_STORE_ID = "195965";                // PC_HEALTH_STORE_ID
export const BACKUP_FROZEN_LIMIT = 3;                          // frozen-check.js PENDING_LIMIT
export const BACKUP_FROZEN_QUEUE_MAX_AGE_MS = 60 * 1000;       // frozen-check.js QUEUE_MAX_AGE_MS
export const BACKUP_FROZEN_EMPTY_WAIT_MS = 60 * 1000;          // frozen-check.js EMPTY_WAIT_MS
export const BACKUP_STORE_VERDICTS = ["open", "full", "company", "not_found"]; // PC_STORE_VERDICTS
// ── the backup's own ──────────────────────────────────────────────────────────────────────────
export const BACKUP_SWITCH = "pc711_backup_enabled";           // app_settings; created 'false' by sql/179
export const BACKUP_OFF_RECHECK_MS = 60 * 1000;                // switch off: ask the database again once a minute
export const BACKUP_DUTY_RECHECK_MS = 10 * 1000;               // on duty: ask again before a parcel when the last answer is older
export const BACKUP_ALERTS = ["took_over", "took_over_logged_out", "handed_back"];
const TAG = "[PC711_BACKUP]";
const SIX = /^\d{6}$/;

/** frozen-check.js pickRows: one parcel per store, a store only when its 10-minute gap is over. Pure. */
export function pickFrozenRows(rows, storeAt, nowMs, limit = BACKUP_FROZEN_LIMIT) {
  const out = []; const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (out.length >= limit) break;
    if (!row || !row.id || !row.store_id) continue;
    const store = String(row.store_id);
    const at = storeAt.get(store);
    if (seen.has(store) || (at && nowMs - at < SHADOW_FROZEN_STORE_GAP_MS)) continue;
    seen.add(store); out.push({ id: String(row.id), store_id: store });
  }
  return out;
}
/** admin_parcel_check_config's sample shop: a pool shop, a different one every 5 minutes. Pure. */
export function healthShop(gmsSetting, nowMs) {
  let pool = [];
  try { const a = JSON.parse(String(gmsSetting ?? "")); if (Array.isArray(a)) pool = a.map(String).filter((g) => /^GM\d{6,20}$/.test(g)); } catch { pool = []; }
  return pool.length ? pool[Math.floor(nowMs / 1000 / 300) % pool.length] : "";
}

// The database the job uses (server.js builds it on the service-role client): ONLY the sql/179 functions.
export function createBackupDb(sb) {
  const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; };
  const obj = (d) => (d && typeof d === "object" ? d : {});
  const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);
  return {
    async duty(loggedOut) {
      const d = obj(await rpc("pc711_backup_duty", { p_logged_out: Boolean(loggedOut) }));
      const hb = Date.parse(String(d.handed_back_at ?? ""));
      return { enabled: d.enabled === true, onDuty: d.on_duty === true, reason: typeof d.reason === "string" ? d.reason : null, change: typeof d.change === "string" ? d.change : null,
        alerts: Array.isArray(d.alerts) ? d.alerts.map(String) : [], floor: Number.isFinite(hb) ? hb : 0 };
    },
    async alertDone(kind) { await rpc("pc711_backup_alert_done", { p_kind: String(kind) }); },
    async pending(limit) {
      const d = obj(await rpc("pc711_backup_pending", { p_limit: limit }));
      return { onDuty: d.on_duty === true, readAt: typeof d.read_at === "string" ? d.read_at : null, rows: Array.isArray(d.rows) ? d.rows : [] };
    },
    async verdict(v) {
      return String(await rpc("pc711_backup_verdict", {
        p_id: v.id, p_store_full_status: v.store ?? null, p_phone_check_status: v.phone ?? null, p_phone_check_message: v.message ?? null,
        p_phone_restricted_until: v.until ?? null, p_expected_phone: v.expectedPhone ?? null, p_expected_store: v.expectedStore ?? null, p_seen_at: v.seenAt ?? null,
      }));
    },
    async requeue(sinceMs) { return Number(await rpc("pc711_backup_requeue", { p_since: iso(sinceMs) })); },
    async frozenPending(limit) {
      const d = obj(await rpc("pc711_backup_frozen_pending", { p_limit: limit }));
      return { onDuty: d.on_duty === true, readAt: typeof d.read_at === "string" ? d.read_at : null, rows: Array.isArray(d.rows) ? d.rows : [] };
    },
    async frozenVerdict(v) { return String(await rpc("pc711_backup_frozen_verdict", { p_id: v.id, p_expected_store: v.expectedStore ?? null, p_status: v.status, p_seen_at: v.seenAt ?? null })); },
    async senderHealth(ok) { return String(await rpc("pc711_backup_sender_health", { p_ok: Boolean(ok) })); },
  };
}

// The job. db = createBackupDb; emap = the kept E-Map session (server/pc711Emap.js); phoneCheck(input) →
// { verdict, kind, steps, message, until } (ONE phone check with the parcel's own shop; server.js runs the
// probe); pc711 = the login module (status()); alert = server/telegramAlert.js. Never throws.
export function createPc711Backup({ db, emap, phoneCheck, pc711, readSetting, alert = null, now = Date.now, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const say = (line) => { try { log(`${TAG} ${line}`); } catch { /* a log never stops the job */ } };
  let enabled = false, onDuty = false, dutyAt = -Infinity, floor = 0, dutyFailAt = 0;
  const backoff = new Map();   // parcel id → { storeFails, storeNextAt, phoneFails, phoneNextAt, countedGen, seenAt } (pcBackoff)
  let wasMaint = null;         // the previous pass was inside 01:00–05:00 (the 05:00 edge re-queues)
  let requeueDue = "", requeueAt = 0;
  let healthAt = 0, strikes = 0;   // pcLastHealthAt, pcSenderStrikes
  const fz = { queue: [], queueAt: 0, readAt: null, emptyUntil: 0, pauseUntil: 0, storeAt: new Map() }; // frozen-check.js st
  let alertBusy = false;
  const loggedOut = () => { try { return !(pc711 && typeof pc711.status === "function" && pc711.status().state === "connected"); } catch { return true; } };
  const entry = (id, t) => { let b = backoff.get(id); if (!b) { b = { storeFails: 0, storeNextAt: 0, phoneFails: 0, phoneNextAt: 0, countedGen: -1, seenAt: t }; backoff.set(id, b); } return b; };
  const forget = () => { backoff.clear(); fz.queue = []; fz.queueAt = 0; fz.readAt = null; fz.emptyUntil = 0; fz.pauseUntil = 0; fz.storeAt.clear(); requeueDue = ""; requeueAt = 0; healthAt = 0; strikes = 0; wasMaint = null; };

  // The queued alerts (kept in the database, sql/179): one at a time, oldest first; taken off the queue once
  // its tries are over (sent, or given up after 3 tries — server/telegramAlert.js). Never awaited by the checker.
  function flushAlerts(list) {
    if (alertBusy || !Array.isArray(list) || !list.length) return;
    const kind = String(list[0]);
    alertBusy = true;
    const send = alert && BACKUP_ALERTS.includes(kind) && typeof alert.deliver === "function" ? alert.deliver(kind) : Promise.resolve(null);
    void Promise.resolve(send).catch(() => null).then(() => db.alertDone(kind)).catch(() => {}).finally(() => { alertBusy = false; });
  }

  // ONE duty call: the state, the change (logged once), the queued alerts. A failed read = follower.
  async function readDuty() {
    let d;
    try { d = await db.duty(loggedOut()); }
    catch {
      const t = now();
      if (!dutyFailAt || t - dutyFailAt > 60 * 60_000) { dutyFailAt = t; say("duty read failed"); }   // once, then once an hour (e.g. sql/179 not applied yet)
      onDuty = false; dutyAt = now();
      return false;
    }
    dutyFailAt = 0;
    dutyAt = now(); enabled = d.enabled; floor = d.floor;
    if (d.change) say(`${d.change}${d.change === "took_over" ? ` reason=${d.reason === "degraded" ? "degraded" : "silent"} logged_out=${loggedOut() ? 1 : 0}` : ""}`);
    if (d.change === "took_over") { forget(); try { emap.takeRequeueDue(); } catch { /* nothing */ } }
    flushAlerts(d.alerts);
    onDuty = d.onDuty;
    return onDuty;
  }
  // before a parcel: still on duty? (asked again when the last answer is older than 10 s)
  async function stillOnDuty() {
    if (!onDuty) return false;
    if (now() - dutyAt < BACKUP_DUTY_RECHECK_MS) return true;
    return readDuty();
  }
  // the database refused a write: the Lenovo is back (or the switch is off) → follower now, state read next pass
  function refused() { onDuty = false; dutyAt = -Infinity; say("write refused not_on_duty"); }

  // pcSenderHealthCheck (background.js:942): a known-clean buyer every 5 min; two "restricted" in a row → pause.
  async function senderHealth() {
    const t = now();
    if (t - healthAt < BACKUP_HEALTH_INTERVAL_MS) return true;
    healthAt = t;
    let sender = "", buyer = "", gms = "", healthy = "";
    try { [sender, buyer, gms, healthy] = await Promise.all(["parcel_check_sender_phone", "parcel_check_probe_buyer", "parcel_check_shared_gms", "parcel_check_sender_healthy"].map((k) => readSetting(k))); }
    catch { return true; }
    const gm = healthShop(gms, t);
    if (!sender || !buyer || !gm) return true;
    let r;
    try { r = await phoneCheck({ phone: String(buyer), name: "SFL sender health", storeId: BACKUP_HEALTH_STORE_ID, gm, sender: String(sender), tokenMs: SHADOW_PHONE_TOKEN_MS, tokenRetry: false }); } catch { r = null; }
    const st = r && r.verdict;
    if (st === "restricted") {
      strikes += 1;
      if (strikes < 2) { healthAt = now() - BACKUP_HEALTH_INTERVAL_MS + BACKUP_HEALTH_CONFIRM_MS; say("sender probe restricted 1/2"); return true; }
      let w = "";
      try { w = await db.senderHealth(false); } catch { w = "failed"; }
      say(`sender paused result=${w}`);
      if (w === "not_on_duty") { refused(); return false; }
    } else if (st === "ok") {
      strikes = 0;
      if (String(healthy ?? "true") !== "true") {
        let w = "";
        try { w = await db.senderHealth(true); } catch { w = "failed"; }
        say(`sender recovered result=${w}`);
        if (w === "not_on_duty") { refused(); return false; }
      }
    }
    return true;
  }

  // pcRequeueUnknown (background.js:535): given-up stores (6 h) back in the queue, every backoff forgotten.
  async function requeue() {
    const t = now();
    if (!requeueDue || t < requeueAt) return;
    const why = requeueDue;
    backoff.clear();
    let n = null;
    try { n = await db.requeue(t - SHADOW_LOOKBACK_MS); } catch { n = null; }
    if (n === null || !Number.isFinite(n)) { requeueAt = t + BACKUP_REQUEUE_RETRY_MS; say(`requeue after ${why} failed next=${BACKUP_REQUEUE_RETRY_MS / 1000}s`); return; }
    requeueDue = ""; requeueAt = 0;
    if (n < 0) { refused(); return; }
    say(`requeue after ${why} rows=${n}`);
  }

  // The frozen lane (frozen-check.js sendOne / sendNight / readPending; not the warm-up): at most ONE frozen
  // request a pass, from parcels read in an earlier pass; then the read for the next pass.
  async function frozenKick() {
    if (!emap.usable()) return true;                       // no live session: the parcels stay queued in the database
    const t = now(); const night = inShadowMaint(t);
    fz.queue = fz.queue.filter((q) => { const at = fz.storeAt.get(q.store_id); return !at || t - at >= SHADOW_FROZEN_STORE_GAP_MS; });
    if (fz.queue.length && t >= fz.pauseUntil) {
      const row = fz.queue.shift();
      fz.storeAt.set(row.store_id, now());                 // the 10-minute gap starts at the request, answered or not
      let r;
      try { r = await emap.checkFrozen(row.store_id); } catch { r = null; }
      const status = r && (r.verdict === "ok" || r.verdict === "no_frozen") ? r.verdict : "unknown";
      const slow = !r || r.transient === true;             // slowAnswer: no reply / timeout / network / 5xx
      if (slow && !night) { fz.pauseUntil = now() + SHADOW_FROZEN_SLOW_PAUSE_MS; say("frozen slow or no answer pause=10m"); }
      let w = "";
      try { w = await db.frozenVerdict({ id: row.id, expectedStore: row.store_id, status, seenAt: fz.readAt }); } catch { w = "failed"; }
      say(`wrote frozen=${status} result=${w} ms=${Math.max(0, Math.round(Number(r && r.ms) || 0))} night=${night ? 1 : 0}`);
      if (w === "not_on_duty") { refused(); return false; }
    }
    const t2 = now();
    if ((!fz.queue.length || t2 - fz.queueAt >= BACKUP_FROZEN_QUEUE_MAX_AGE_MS) && t2 >= fz.emptyUntil && t2 >= fz.pauseUntil) {
      fz.queue = []; fz.queueAt = t2;
      let p = null;
      try { p = await db.frozenPending(BACKUP_FROZEN_LIMIT); } catch { p = null; }
      if (p && !p.onDuty) { refused(); return false; }
      if (p) { fz.readAt = p.readAt; fz.queue = pickFrozenRows(p.rows, fz.storeAt, now()); }
      if (!fz.queue.length) fz.emptyUntil = t2 + BACKUP_FROZEN_EMPTY_WAIT_MS;
    }
    return true;
  }

  // ONE pass on duty = pcRunOnce (multi-seller lane): pick → sender health → pending read → ≤ 5 parcels →
  // the frozen request → keepalive → recovery / re-open → re-queue.
  async function pass() {
    const passAt = now(); const inMaint = inShadowMaint(passAt);
    try { emap.pick(inMaint); } catch { /* never stops the pass */ }
    if (wasMaint === true && !inMaint) requeueDue = "maintenance_end";
    wasMaint = inMaint;
    if (!(await senderHealth())) return 0;
    let p = null;
    try { p = await db.pending(SHADOW_FETCH_LIMIT); } catch { p = null; say("pending read failed"); }
    if (p && !p.onDuty) { refused(); return 0; }
    const rows = p ? p.rows : [];
    const anyNeedStore = rows.some((r) => r && r.need_store);
    for (const [id, b] of backoff) if (passAt - b.seenAt > SHADOW_LOOKBACK_MS) backoff.delete(id);   // gone for 6 h
    let processed = 0, checked = 0;
    const stalled = new Set();                               // stalledGms: shops whose phone check got no answer this pass
    for (const row of rows) {
      if (processed >= SHADOW_LIMIT) break;
      if (!row || !row.id) continue;
      if (!(await stillOnDuty())) return checked;
      const bo = backoff.get(row.id);
      if (bo) bo.seenAt = passAt;
      const gm = String(row.gm_id || "");
      const doStore = Boolean(row.need_store) && emap.usable() && (!bo || passAt >= bo.storeNextAt);
      const doPhone = Boolean(row.need_phone) && !(stalled.size >= 2 || stalled.has(gm)) && (!bo || now() >= bo.phoneNextAt);
      if (!doStore && !doPhone) continue;
      processed += 1;
      let storeStatus = null, phoneStatus = null, message = null, until = null, storeMs = 0, phoneMs = 0;
      if (doStore) {
        checked += 1;
        const t0 = now();
        let r;
        try { r = await emap.checkStore(row.store_id); } catch { r = null; }
        if (!r || typeof r !== "object") r = { verdict: "unknown", kind: "threw", transient: true };
        storeMs = now() - t0;
        if (BACKUP_STORE_VERDICTS.includes(r.verdict)) {
          storeStatus = r.verdict;
          emap.verdict();
          const b = backoff.get(row.id);
          if (b && b.storeFails) { b.storeFails = 0; b.storeNextAt = 0; }
        } else {
          const b = entry(row.id, passAt);
          if (inMaint) b.storeNextAt = passAt + SHADOW_MAINT_RETRY_MS;      // 01:00–05:00: not counted, slow retry
          else {
            if (!r.transient && b.countedGen !== emap.gen()) { emap.miss(`store: ${r.kind || "no_answer"}`, false, inMaint); b.countedGen = emap.gen(); }
            b.storeFails += 1;
            if (b.storeFails >= BACKUP_STORE_GIVE_UP) {
              storeStatus = "unknown";                                        // give up the STORE half only
              b.storeNextAt = passAt + SHADOW_STORE_BACKOFF_MS[SHADOW_STORE_BACKOFF_MS.length - 1];
            } else b.storeNextAt = passAt + storeBackoffDelay(b.storeFails);
          }
          say(`store no answer attempt=${b.storeFails} kind=${String(r.kind || "no_answer").replace(/[^a-z0-9_]/gi, "").slice(0, 24)} maint=${inMaint ? 1 : 0}${storeStatus === "unknown" ? " gave_up" : ""}`);
        }
      }
      if (doPhone) {
        checked += 1;
        const bPrev = backoff.get(row.id);
        const t0 = now();
        let r;
        if (!SIX.test(String(row.store_id || ""))) r = { verdict: "unknown", kind: "config", steps: [] };   // myship-711.js: "store id not 6 digits"
        else {
          try {
            r = await phoneCheck({ phone: String(row.phone ?? ""), name: String(row.customer_name ?? ""), storeId: String(row.store_id), gm, sender: String(row.sender_phone ?? ""),
              tokenMs: SHADOW_PHONE_TOKEN_MS, tokenRetry: !inMaint && (!bPrev || bPrev.phoneFails < SHADOW_PHONE_TOKEN_RETRY_FAILS) });
          } catch { r = null; }
        }
        if (!r || typeof r !== "object") r = { verdict: "unknown", kind: "threw", steps: [] };
        phoneMs = now() - t0;
        if (r.verdict === "ok" || r.verdict === "restricted") {              // DEFINITIVE only; anything else is never written
          phoneStatus = r.verdict;
          message = r.verdict === "restricted" ? r.message ?? null : null;
          until = r.verdict === "restricted" ? r.until ?? null : null;
          const b = backoff.get(row.id);
          if (b && b.phoneFails) { b.phoneFails = 0; b.phoneNextAt = 0; }
        } else {
          if (phoneNoAnswer(r)) stalled.add(gm);
          const b = entry(row.id, passAt);
          if (!inMaint) b.phoneFails += 1;                                    // never given up
          const wait = inMaint ? SHADOW_MAINT_RETRY_MS : phoneBackoffDelay(b.phoneFails, r);
          b.phoneNextAt = now() + wait;                                       // from the END of this attempt
          say(`phone no answer attempt=${b.phoneFails} kind=${String(r.kind || "other").replace(/[^a-z0-9_]/gi, "").slice(0, 24)} maint=${inMaint ? 1 : 0} next=${wait / 1000}s`);
        }
      }
      if (storeStatus !== null || phoneStatus !== null) {                     // nothing learned → no write, the parcel retries later
        let w = "";
        try {
          w = await db.verdict({ id: row.id, store: storeStatus, phone: phoneStatus, message, until,
            expectedPhone: row.phone ?? null, expectedStore: row.store_id ?? null, seenAt: p.readAt });
        } catch { w = "failed"; }
        say(`wrote store=${storeStatus ?? "-"} phone=${phoneStatus ?? "-"} result=${w} store_ms=${storeMs} phone_ms=${phoneMs}`);
        if (w === "not_on_duty") { refused(); return checked; }
      }
      await sleep(SHADOW_ROW_GAP_MS);                                         // 2 s after each parcel
    }
    if (!(await frozenKick())) return checked;
    try { await emap.keepalive(anyNeedStore, inShadowMaint(now())); } catch { /* never stops the pass */ }
    // recovery + re-open with NO brake hooks: no safety brake while on duty
    try { await emap.refresh(inShadowMaint(now()), null); } catch { /* never stops the pass */ }
    try { if (emap.takeRequeueDue()) requeueDue = requeueDue || "recovery"; } catch { /* nothing */ }
    await requeue();
    return checked;
  }

  // Called at the top of every checker pass (server/pc711Shadow.js). → { onDuty, floor }: on duty, the pass
  // above ran and the shadow does nothing this pass (comparing pauses); floor = the last hand-back time.
  async function tick() {
    try {
      const t = now();
      if (!enabled && t - dutyAt < BACKUP_OFF_RECHECK_MS) return { onDuty: false, floor };
      if (!(await readDuty())) return { onDuty: false, floor };
      const checked = await pass();
      return { onDuty: true, floor, checked };
    } catch {
      return { onDuty: false, floor };
    }
  }

  return {
    tick,
    state: () => ({ enabled, onDuty, floor: floor || null }),
    _state: () => ({ backoff: new Map(backoff), strikes, requeueDue, frozen: { queue: [...fz.queue], pauseUntil: fz.pauseUntil, emptyUntil: fz.emptyUntil } }),
  };
}
