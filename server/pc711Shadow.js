// 7-11 server checker SHADOW (Jeff 2026-11-14). Proves the server gives the SAME answer as the
// Chrome extension, on REAL parcels, without changing anything a seller sees:
//   every 20 s, up to 3 parcels the extension checked in the last 30 min (store_full_at /
//   phone_check_at) and not compared yet for that kind → the server checks them with the SAME
//   inputs (store id → the store chain; phone + name + store → the phone check) using the saved
//   7-11 login, maps its answer to the extension's words and writes ONE pc711_shadow row.
// Never writes parcel_scans (the db adapter has no way to). Never POSTs /cart/finish (the probe's
// URL allowlist refuses it). One check at a time, ≥ 3 s between checks, ≤ 300 checks a Taipei day;
// 01–05 Taipei keeps running (only a maint marker in the log). On needs_login it stops until the
// next connect (no re-login loop: the probe's ONE quick re-login and pc711Login's limits apply).
// Logs: [PC711_SHADOW] kind=… match=0/1 ms=… http=… — never a phone, store id, name, cookie or guid.
import { isMaintWindow } from "./pcServerProbe.js";

export const SHADOW_TICK_MS = 20_000;
export const SHADOW_BATCH = 3;
export const SHADOW_GAP_MS = 3_000;
export const SHADOW_DAY_MAX = 300;
export const SHADOW_LOOKBACK_MS = 30 * 60 * 1000;
export const SHADOW_KEEP_DAYS = 30;
export const SHADOW_SWITCH = "pc711_shadow_enabled";
const TAG = "[PC711_SHADOW]";

// The extension's words (parcel_scans.store_full_status / phone_check_status).
export const STORE_WORDS = ["open", "full", "company", "not_found", "unknown"];
export const PHONE_WORDS = ["ok", "restricted", "unknown"];
/** The server's answer → the extension's word for that kind; anything else → "unknown". */
export function toExtWord(kind, verdict) {
  const words = kind === "store" ? STORE_WORDS : kind === "phone" ? PHONE_WORDS : [];
  const v = String(verdict ?? "").trim();
  return words.includes(v) ? v : "unknown";
}
/** One short word for the note column (never data). */
export function noteWord(w) {
  const s = String(w ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
  return s || null;
}

const pad = (n) => String(n).padStart(2, "0");
/** Asia/Taipei (UTC+8, no DST) day key and that day's 00:00 as an ISO instant. */
export function taipeiDay(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 8 * 3600 * 1000;
  return { key, startIso: new Date(startMs).toISOString() };
}

// Parcels to compare: the extension's verdict written in the last 30 min, newest first, with no
// pc711_shadow row for that kind. → [{ scanId, kind, ext, input }]. Pure (rows in, jobs out).
export function pickJobs(scans, done, sinceMs, limit = SHADOW_BATCH) {
  const seen = new Set((done || []).map((d) => `${d.scan_id}:${d.kind}`));
  const jobs = [];
  for (const r of scans || []) {
    const storeAt = Date.parse(r.store_full_at || "");
    const phoneAt = Date.parse(r.phone_check_at || "");
    if (r.store_full_status && Number.isFinite(storeAt) && storeAt >= sinceMs && !seen.has(`${r.id}:store`)) {
      jobs.push({ scanId: r.id, kind: "store", ext: toExtWord("store", r.store_full_status), at: storeAt, input: { kind: "store", storeId: String(r.store_id ?? "") } });
    }
    if (r.phone_check_status && Number.isFinite(phoneAt) && phoneAt >= sinceMs && !seen.has(`${r.id}:phone`)) {
      jobs.push({ scanId: r.id, kind: "phone", ext: toExtWord("phone", r.phone_check_status), at: phoneAt, input: { kind: "phone", phone: String(r.phone ?? ""), name: String(r.customer_name ?? ""), storeId: String(r.store_id ?? "") } });
    }
  }
  return jobs.sort((a, b) => b.at - a.at).slice(0, limit);
}

// The db the job uses (server.js builds it on the service-role client). It can READ parcel_scans
// and read/write pc711_shadow — and nothing else.
export function createShadowDb(sb) {
  return {
    async recentScans(sinceIso) {
      const { data, error } = await sb.from("parcel_scans")
        .select("id,store_id,phone,customer_name,store_full_status,store_full_at,phone_check_status,phone_check_at")
        .or(`store_full_at.gte.${sinceIso},phone_check_at.gte.${sinceIso}`)
        .limit(60);
      if (error) throw error;
      return data || [];
    },
    async doneFor(ids) {
      if (!ids.length) return [];
      const { data, error } = await sb.from("pc711_shadow").select("scan_id,kind").in("scan_id", ids);
      if (error) throw error;
      return data || [];
    },
    async insert(row) {
      const { error } = await sb.from("pc711_shadow").upsert(row, { onConflict: "scan_id,kind", ignoreDuplicates: true });
      if (error) throw error;
    },
    async countSince(sinceIso) {
      const { count, error } = await sb.from("pc711_shadow").select("id", { count: "exact", head: true }).gte("at", sinceIso);
      if (error) throw error;
      return Number(count) || 0;
    },
    async purgeBefore(beforeIso) {
      const { error } = await sb.from("pc711_shadow").delete().lt("at", beforeIso);
      if (error) throw error;
    },
    async rowsSince(sinceIso) {
      const { data, error } = await sb.from("pc711_shadow").select("kind,match,srv_ms").gte("at", sinceIso).limit(1000);
      if (error) throw error;
      return data || [];
    },
    async lastMismatches(n = 5) {
      const { data, error } = await sb.from("pc711_shadow").select("kind,ext_verdict,srv_verdict,at").eq("match", false).order("at", { ascending: false }).limit(n);
      if (error) throw error;
      return data || [];
    },
  };
}

// The job. check(input) → { verdict, http, ms, kind } (one server check; server.js runs the probe's
// target mode). pc711 = the login module (status()). Never throws.
export function createPc711Shadow({ db, check, pc711, readSetting, now = Date.now, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let running = false;
  let lastEnd = -Infinity;     // when the last 7-11 check finished
  let day = "", used = 0;      // checks made this Taipei day
  let stoppedSince = null;     // the connect (status.since) the job stopped on (needs_login)
  let timer = null;
  const say = (line) => { try { log(`${TAG} ${line}`); } catch { /* a log never stops the job */ } };

  async function tick() {
    if (running) return { skipped: "running" };
    running = true;
    try {
      let on = "";
      try { on = String((await readSetting(SHADOW_SWITCH)) ?? ""); } catch { on = ""; }
      if (on !== "true") return { skipped: "off" };
      const st = pc711 && typeof pc711.status === "function" ? pc711.status() : null;
      if (!st || st.state !== "connected") return { skipped: "not_connected" };
      if (stoppedSince !== null && stoppedSince === (st.since ?? null)) return { skipped: "stopped" };
      stoppedSince = null;
      const t = now();
      const d = taipeiDay(t);
      if (d.key !== day) {
        day = d.key;
        try { used = await db.countSince(d.startIso); } catch { used = SHADOW_DAY_MAX; } // unknown → rest today
        try { await db.purgeBefore(new Date(t - SHADOW_KEEP_DAYS * 86400 * 1000).toISOString()); } catch { /* next day */ }
      }
      if (used >= SHADOW_DAY_MAX) return { skipped: "day_max" };
      const sinceMs = t - SHADOW_LOOKBACK_MS;
      const scans = await db.recentScans(new Date(sinceMs).toISOString());
      const done = await db.doneFor(scans.map((s) => s.id));
      const jobs = pickJobs(scans, done, sinceMs, SHADOW_BATCH);
      let checked = 0;
      for (const job of jobs) {
        if (used >= SHADOW_DAY_MAX) break;
        const wait = SHADOW_GAP_MS - (now() - lastEnd);
        if (wait > 0) await sleep(wait);
        const t0 = now();
        let r;
        try { r = await check(job.input); } catch { r = { verdict: "unknown", http: 0, ms: now() - t0, kind: "error" }; }
        lastEnd = now();
        used += 1;
        checked += 1;
        const after = pc711 && typeof pc711.status === "function" ? pc711.status() : null;
        if ((r && (r.kind === "login_not_accepted" || r.kind === "no_session")) || (after && after.state === "needs_login")) {
          stoppedSince = st.since ?? null;
          say(`kind=${job.kind} stop=needs_login maint=${isMaintWindow(lastEnd) ? 1 : 0}`);
          break;
        }
        const srv = toExtWord(job.kind, r?.verdict);
        const ms = Math.max(0, Math.round(Number(r?.ms) || lastEnd - t0));
        const http = Number(r?.http) || 0;
        const match = srv === job.ext;
        try {
          await db.insert({ scan_id: job.scanId, kind: job.kind, ext_verdict: job.ext, srv_verdict: srv, srv_ms: ms, srv_http: http, match, note: noteWord(r?.kind) });
        } catch { /* the next tick tries again */ }
        say(`kind=${job.kind} match=${match ? 1 : 0} ms=${ms} http=${http} maint=${isMaintWindow(lastEnd) ? 1 : 0}`);
      }
      return { checked };
    } catch {
      return { skipped: "error" };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(setIntervalImpl = setInterval) {
      if (timer) return timer;
      timer = setIntervalImpl(() => { void tick(); }, SHADOW_TICK_MS);
      if (timer && typeof timer.unref === "function") timer.unref();
      return timer;
    },
    _state: () => ({ used, day, stoppedSince, lastEnd }),
  };
}

// Admin summary (GET /admin/pc711/shadow, behind requireAuth + requireAdmin): today's compared /
// match % per kind / server average ms + the last 5 mismatches (no ids).
export async function shadowSummary(db, readSetting, nowMs = Date.now()) {
  const d = taipeiDay(nowMs);
  let enabled = false;
  try { enabled = String((await readSetting(SHADOW_SWITCH)) ?? "") === "true"; } catch { enabled = false; }
  const rows = await db.rowsSince(d.startIso);
  const part = (kind) => {
    const r = rows.filter((x) => x.kind === kind);
    const m = r.filter((x) => x.match === true).length;
    return { n: r.length, matchPct: r.length ? Math.round((m * 100) / r.length) : null };
  };
  const ms = rows.map((x) => Number(x.srv_ms)).filter((x) => Number.isFinite(x) && x >= 0);
  const mis = await db.lastMismatches(5);
  return {
    enabled,
    today: { n: rows.length, store: part("store"), phone: part("phone"), avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null },
    mismatches: mis.map((x) => ({ kind: x.kind === "phone" ? "phone" : "store", ext: toExtWord(x.kind, x.ext_verdict), srv: toExtWord(x.kind, x.srv_verdict), at: x.at })),
  };
}
