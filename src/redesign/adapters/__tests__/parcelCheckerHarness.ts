// Shared harness for the parcel-checker service-worker tests: evaluates the REAL
// chrome-extension/background.js under a faithful `chrome` stub (node:vm) and
// exposes the worker's top-level functions + spies. No tests in this file.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { vi } from "vitest";

export function fakeJwt(expSecFromNow = 3600): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp: Math.floor(Date.now() / 1000) + expSecFromNow })}.sig`;
}

export const PENDING_ROW = {
  id: "row-1", phone: "0912345678", store_id: "195965", customer_name: "測試",
  gm_id: "GM2609096099718", sender_phone: "0979593026", need_phone: true, need_store: true,
  queue_depth: 1, created_at: new Date(Date.now() - 4000).toISOString(),
};

export type EmapTab = { id: number; url: string; guid: boolean; discarded?: boolean };

// ── VIRTUAL-CLOCK SIMULATION (opt-in via BootOpts.sim) ──────────────────────────
// Every timer, tab reply and fetch of the worker runs on sim time with REAL delays (E-Map,
// myship, database, local messages). The dry and frozen queues shrink as verdicts are
// written. Every E-Map request is recorded as an interval [start, end] so overlaps between
// the normal lane (row checks + keepalive) and the frozen lane can be counted both ways.
export const SIM_FROZEN_ABORT_MS = 2500;   // emap-frozen-711.js aborts its byIDData request at 2.5 s
export type SimInterval = { kind: "normal" | "keepalive" | "frozen"; start: number; end: number; rowId?: string };
export type Sim = {
  now: number; seq: number; nextId: number; queue: { t: number; seq: number; id: number; fn: () => void }[]; cancelled: Set<number>;
  emapMs: number; phoneMs: number; fetchMs: number; localMs: number; frozenSwitch: "true" | "false";
  dry: Record<string, unknown>[]; frozen: { id: string; store_id: string; retryAt: number }[];
  intervals: SimInterval[]; normalVerdicts: { id: string; t: number }[]; frozenVerdicts: { id: string; status: string; t: number }[];
  alarm: ((a: { name: string }) => void) | null; nextAlarmAt: number | null;
  // 1.18.0 warm-up: the switch, the stores admin_frozen_warmup_next hands out, the answers written,
  // and dry parcels that ARRIVE during the run (moved into `dry` when their time comes)
  warmupSwitch: "true" | "false"; warmStores: string[]; warmVerdicts: { store: string; status: string; t: number }[];
  arrivals: { t: number; row: Record<string, unknown> }[]; arrivedAt: Record<string, number>;
  gaveUp?: number;   // 1.18.1: what admin_parcel_gave_up_count answers (default 0)
};
export function makeSim(p: { t0: number; emapMs: number; phoneMs?: number; fetchMs?: number; localMs?: number; dry?: number; frozen?: { id: string; store_id: string }[]; frozenSwitch?: "true" | "false";
  warmupSwitch?: "true" | "false"; warmStores?: string[]; arrivals?: number[] }): Sim {
  const dry = Array.from({ length: p.dry ?? 0 }, (_, i) => ({ ...PENDING_ROW, id: `dry-${i + 1}`, store_id: String(100000 + i), created_at: new Date(p.t0 - 60_000).toISOString() }));
  return {
    now: p.t0, seq: 0, nextId: 1, queue: [], cancelled: new Set(),
    emapMs: p.emapMs, phoneMs: p.phoneMs ?? 1500, fetchMs: p.fetchMs ?? 150, localMs: p.localMs ?? 5, frozenSwitch: p.frozenSwitch ?? "true",
    dry, frozen: (p.frozen ?? []).map((f) => ({ ...f, retryAt: 0 })),
    intervals: [], normalVerdicts: [], frozenVerdicts: [], alarm: null, nextAlarmAt: null,
    warmupSwitch: p.warmupSwitch ?? "false", warmStores: [...(p.warmStores ?? [])], warmVerdicts: [],
    arrivals: (p.arrivals ?? []).map((ms, i) => ({ t: p.t0 + ms, row: { ...PENDING_ROW, id: `arr-${i + 1}`, store_id: String(500000 + i), created_at: new Date(p.t0 + ms).toISOString() } })),
    arrivedAt: {},
  };
}
export function simAdd(sim: Sim, ms: number, fn: () => void): number {
  const id = sim.nextId++;
  sim.queue.push({ t: sim.now + Math.max(0, ms), seq: sim.seq++, id, fn });
  return id;
}
// Run the event queue until untilT (sim ms). alarmEveryMs > 0 also fires the worker's
// chrome.alarms listener on that period, as Chrome does (the keepalive alarm is 30 s).
export async function runSim(sim: Sim, untilT: number, alarmEveryMs = 0): Promise<void> {
  const tick = () => new Promise<void>((r) => setImmediate(r));
  if (alarmEveryMs > 0) {
    const fire = () => { if (sim.alarm) sim.alarm({ name: "parcel-checker-keepalive" }); sim.nextAlarmAt = sim.now + alarmEveryMs; simAdd(sim, alarmEveryMs, fire); };
    sim.nextAlarmAt = sim.now + alarmEveryMs; simAdd(sim, alarmEveryMs, fire);
  }
  await tick();
  for (;;) {
    let bi = -1;
    for (let i = 0; i < sim.queue.length; i++) {
      const e = sim.queue[i], b = bi >= 0 ? sim.queue[bi] : null;
      if (!b || e.t < b.t || (e.t === b.t && e.seq < b.seq)) bi = i;
    }
    if (bi < 0 || sim.queue[bi].t > untilT) break;
    const ev = sim.queue.splice(bi, 1)[0];
    if (sim.cancelled.has(ev.id)) continue;
    sim.now = Math.max(sim.now, ev.t);
    ev.fn();
    await tick();
  }
  sim.now = untilT;
}
// Overlaps on the E-Map session: frozenDuringNormal = a frozen request STARTED while a normal
// row check or keepalive was open; normalDuringFrozen = a normal / keepalive request STARTED
// while a frozen one was open; normalNormal = two normal-lane requests open at once (main's own).
export function simOverlaps(iv: SimInterval[]) {
  const fz = iv.filter((i) => i.kind === "frozen"), nm = iv.filter((i) => i.kind !== "frozen");
  const open = (a: SimInterval, t: number) => a.start <= t && t < a.end;
  let normalNormal = 0;
  for (let i = 0; i < nm.length; i++) for (let j = i + 1; j < nm.length; j++) if (open(nm[i], nm[j].start) || open(nm[j], nm[i].start)) normalNormal += 1;
  return {
    frozenDuringNormal: fz.filter((f) => nm.some((n) => open(n, f.start))).length,
    normalDuringFrozen: nm.filter((n) => fz.some((f) => open(f, n.start))).length,
    normalNormal,
  };
}
function simBody(sim: Sim, url: string, init?: { body?: string }): unknown {
  let body: Record<string, unknown> = {};
  try { body = init?.body ? JSON.parse(String(init.body)) : {}; } catch { body = {}; }
  if (/admin_parcel_checks_pending/.test(url)) {
    for (const a of sim.arrivals.filter((x) => x.t <= sim.now)) { sim.dry.push(a.row); sim.arrivedAt[String(a.row.id)] = a.t; }
    sim.arrivals = sim.arrivals.filter((x) => x.t > sim.now);
  }
  if (/admin_parcel_checks_pending/.test(url)) { const lim = Number(body.p_limit) || 5; return sim.dry.slice(0, lim).map((r) => ({ ...r, queue_depth: sim.dry.length })); }
  if (/admin_parcel_check_verdict/.test(url)) {
    const i = sim.dry.findIndex((r) => r.id === body.p_id); if (i >= 0) sim.dry.splice(i, 1);
    sim.normalVerdicts.push({ id: String(body.p_id), t: sim.now }); return {};
  }
  if (/admin_parcel_frozen_pending/.test(url)) {
    const lim = Number(body.p_limit) || 3; const seen = new Set<string>(); const out: unknown[] = [];
    for (const f of sim.frozen) { if (out.length >= lim) break; if (f.retryAt > sim.now || seen.has(f.store_id)) continue; seen.add(f.store_id); out.push({ id: f.id, store_id: f.store_id, queue_depth: sim.frozen.length }); }
    return out;
  }
  if (/admin_parcel_frozen_verdict/.test(url)) {
    const i = sim.frozen.findIndex((f) => f.id === body.p_id); const status = String(body.p_status);
    if (i >= 0) { if (status === "unknown") sim.frozen[i].retryAt = sim.now + 10 * 60_000; else sim.frozen.splice(i, 1); }
    sim.frozenVerdicts.push({ id: String(body.p_id), status, t: sim.now }); return {};
  }
  if (/rest\/v1\/app_settings\?/.test(url) && /frozen_warmup_enabled/.test(url)) return [{ key: "frozen_warmup_enabled", value: sim.warmupSwitch }];
  if (/rest\/v1\/app_settings\?/.test(url)) return [{ key: "frozen_store_check_enabled", value: sim.frozenSwitch }];
  if (/admin_frozen_warmup_next/.test(url)) {
    if (sim.warmupSwitch !== "true" || sim.frozenSwitch !== "true") return [];
    const lim = Math.min(Number(body.p_limit) || 1, 5);
    return sim.warmStores.slice(0, lim).map((st) => ({ store_id: st, frozen_history: false, parcels: 1, left_count: sim.warmStores.length, checked_count: sim.warmVerdicts.length }));
  }
  if (/admin_frozen_warmup_verdict/.test(url)) {
    const st = String(body.p_store); sim.warmStores = sim.warmStores.filter((x) => x !== st);
    sim.warmVerdicts.push({ store: st, status: String(body.p_status), t: sim.now }); return {};
  }
  if (/admin_frozen_warmup_stop/.test(url)) { sim.warmupSwitch = "false"; return {}; }
  if (/admin_parcel_gave_up_count/.test(url)) return sim.gaveUp ?? 0;  // 1.18.1: given-up rows waiting (sim: none unless set)
  return undefined;
}
export type BootOpts = {
  multiSeller?: boolean;
  rows?: unknown[];
  emapTab?: boolean;              // false = no emap tab at all
  emapTabs?: EmapTab[];           // explicit emap tab set (overrides emapTab)
  storeVerdict?: (row?: { id?: string; store_id?: string }) => string; // PC_CHECK_STORE reply (default "open"); gets the checked row
  phoneVerdict?: () => string;    // PC_CHECK_PHONE reply (default "ok")
  // 1.14.9: full PC_CHECK_PHONE reply — status + fail kind (timeout/network/rejected/…);
  // null = the myship tab didn't answer. Takes precedence over phoneVerdict.
  phoneReply?: (row?: { id?: string; gm_id?: string }, msg?: { tokenRetry?: boolean }) => { status: string; kind?: string } | null;
  sflToken?: () => string | null; // SFL_GET_TOKEN reply (default a fresh JWT)
  onSflRefresh?: () => { token?: string | null; hadSession?: boolean | null }; // SFL_REFRESH_TOKEN reply
  now?: () => number;             // injectable clock for Date.now()
  initialStatus?: Record<string, unknown>; // what a PREVIOUS worker life left in pc_status
  cartDetailTab?: boolean;        // a 賣貨便 tab parked on /cart/detail exists (default true)
  onPickStoreClick?: (emapTabs: EmapTab[]) => { clicked: boolean; reason?: string } | void; // what the click does to the tab set
  maintenance?: boolean;          // 1.14.6: honour the 01:00–05:00 Taipei window (default OFF so suites are clock-independent)
  storeTransient?: boolean;       // PC_CHECK_STORE misses are flagged transient (timeout / network)
  requeueOk?: boolean;            // admin_parcel_check_requeue answers 200 (default true)
  // 1.15.0: the lease RPC (admin_parcel_worker_lease). Gets the parsed body; returns the
  // JSON to answer with (+ optional HTTP status), or "throw" for a network error.
  // Absent → the generic {} answer (= a bad lease answer → pre-1.15 behaviour).
  lease?: (body: { p_worker_id: string; p_label: string; p_state: Record<string, unknown> }) => { status?: number; json?: unknown } | "throw" | "hang";
  legacyRows?: unknown[];                   // rows the legacy lane's GET parcel_scans returns (default [])
  initialStorage?: Record<string, unknown>; // extra chrome.storage.local keys (e.g. a persisted pc_worker)
  config?: Record<string, unknown>;         // extra pc_config fields (e.g. deviceName)
  // 1.17.0 frozen check: the PC_FROZEN_CHECK reply ("ok" / "no_frozen" / "unknown"; null = the
  // emap tab didn't answer; "hang" = never answers; "throw" = the stub throws), and the
  // settings rows the app_settings GET returns (default: the switch row absent = OFF).
  frozenVerdict?: (row?: { id?: string; store_id?: string }) => string | null; // "hang" never answers · "throw" · "timeout" = the content script's 2.5 s abort (transient) · null = no answer
  frozenSwitch?: "true" | "false" | "missing" | "error";
  frozenPending?: unknown[] | "error";       // admin_parcel_frozen_pending rows (default [])
  frozenVerdictHttp?: number;               // admin_parcel_frozen_verdict status (default 200)
  extDir?: string;                          // read the worker from another folder (e.g. main's copy)
  frozenScript?: boolean;                   // the frozen content script answers PC_FROZEN_PING (default true); false = until injected
  frozenModuleSrc?: string | null;          // importScripts("frozen-check.js"): null = file missing (throws), a string = that source instead
  slowChecks?: boolean;                     // PC_CHECK_STORE / PC_CHECK_PHONE answer one macrotask later (lets the lanes interleave); records overlaps
  sim?: Sim;                                // virtual-clock mode (see makeSim / runSim)
  frozenScriptNever?: boolean;              // the frozen ping never answers, even after an injection (injection rate-limit test)
  onFrozenPing?: () => void;                // runs when the frozen script is pinged (a test flips the lease / clock there)
  // 1.18.0 warm-up
  warmupSwitch?: "true" | "false" | "missing"; // the frozen_warmup_enabled row (default missing = off)
  warmupNext?: unknown[] | ((body: Record<string, unknown>) => unknown[]) | "error"; // admin_frozen_warmup_next rows (default [])
  warmupStopHttp?: number;                     // admin_frozen_warmup_stop status (default 200)
  frozenReply?: (row?: { id?: string; store_id?: string }) => Record<string, unknown> | null; // the FULL PC_FROZEN_CHECK reply (overrides frozenVerdict)
  holdStorageGet?: string;                     // chrome.storage.local.get of THIS key is held: queued in calls.heldGets until the test releases it
  // 1.18.1: admin_parcel_gave_up_count (sql/147) — a count (default 0), "error" (HTTP 500), "throw" (network), or a function
  gaveUp?: number | "error" | "throw" | (() => number | "error" | "throw");
};

export function bootWorker(opts: BootOpts = {}) {
  const extDir = opts.extDir || process.env.SFL_EXT_DIR || "chrome-extension";
  const src = readFileSync(`${extDir}/background.js`, "utf8");
  const calls = { sendMessage: [] as { type: string; tabId: number; rowId?: string; tokenRetry?: boolean; nightWarm?: boolean }[], fetch: [] as string[], fetchBodies: [] as string[], update: [] as unknown[], reload: [] as number[], removed: [] as number[], logs: [] as string[], scheduled: [] as number[], timers: [] as { ms: number; fn: () => void }[],
    injected: [] as string[], openNormal: 0, frozenOverlap: 0,
    heldGets: [] as { key: string; release: () => void }[] };
  const storage: Record<string, unknown> = {
    pc_config: { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", multiSeller: opts.multiSeller ?? true, maintenanceWindow: opts.maintenance ?? false, ...(opts.config ?? {}) },
    ...(opts.initialStatus ? { pc_status: opts.initialStatus } : {}),
    ...(opts.initialStorage ?? {}),
  };
  const emapTabs: EmapTab[] = opts.emapTabs ?? (opts.emapTab === false ? [] : [{ id: 3, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true }]);
  const tabFor = (patterns: string[] | string) => {
    const p = (Array.isArray(patterns) ? patterns[0] : patterns) || ""; // chrome.tabs.query accepts a string or an array
    if (/emap/.test(p)) return emapTabs.map((t) => ({ id: t.id, url: t.url, discarded: Boolean(t.discarded), frozen: false }));
    if (/cart\/detail/.test(p)) return opts.cartDetailTab === false ? [] : [{ id: 2, url: "https://myship.7-11.com.tw/cart/detail", discarded: false, frozen: false }];
    return [{ id: /sellerflow/.test(p) ? 1 : 2, url: p.replace("*", "cart/easy/GM1"), discarded: false, frozen: false }];
  };
  const chrome = {
    alarms: {
      create: vi.fn(), onAlarm: { addListener: vi.fn((fn: (a: { name: string }) => void) => { if (opts.sim) opts.sim.alarm = fn; }) },
      // sim: the next keepalive alarm (as chrome.alarms.get reports it); no alarm → undefined
      ...(opts.sim ? { get: (name: string, cb: (a?: { name: string; scheduledTime: number }) => void) => { const t = opts.sim!.nextAlarmAt; simAdd(opts.sim!, opts.sim!.localMs, () => cb(t === null ? undefined : { name, scheduledTime: t })); } } : {}),
    },
    runtime: { lastError: undefined, onMessage: { addListener: vi.fn() }, getManifest: () => ({ version: "test" }) },
    scripting: { executeScript: (o: { files?: string[] }, cb: () => void) => { calls.injected.push(String(o?.files?.[0] ?? "")); cb(); } },
    storage: { local: {
      get: (k: string | string[], cb: (r: Record<string, unknown>) => void) => {
        const key = Array.isArray(k) ? k[0] : k;
        if (opts.holdStorageGet && key === opts.holdStorageGet) { calls.heldGets.push({ key, release: () => cb({ [key]: storage[key] }) }); return; }
        cb({ [key]: storage[key] });
      },
      set: (o: Record<string, unknown>, cb?: () => void) => { Object.assign(storage, o); cb?.(); },
    } },
    tabs: {
      query: (q: { url: string[] | string }, cb: (t: unknown[]) => void) => cb(tabFor(q.url)),
      sendMessage: (id: number, msg: { type: string; row?: { id?: string; store_id?: string; gm_id?: string }; tokenRetry?: boolean; nightWarm?: boolean }, cb0: (r: unknown) => void) => {
        calls.sendMessage.push({ type: msg.type, tabId: id, rowId: msg.row?.id, tokenRetry: msg.tokenRetry, nightWarm: msg.nightWarm });
        const emap = emapTabs.find((t) => t.id === id);
        // slowChecks: a normal E-Map / myship check stays "open" for one macrotask (the frozen lane must not send meanwhile)
        const slow = Boolean(opts.slowChecks) && (msg.type === "PC_CHECK_STORE" || msg.type === "PC_CHECK_PHONE");
        if (slow) calls.openNormal += 1;
        const sim = opts.sim;
        const simDelay = !sim ? 0
          : msg.type === "PC_CHECK_STORE" ? sim.emapMs
            : msg.type === "PC_FROZEN_CHECK" ? Math.min(sim.emapMs, SIM_FROZEN_ABORT_MS)
              : msg.type === "PC_CHECK_PHONE" ? sim.phoneMs : sim.localMs;
        if (sim && msg.type === "PC_CHECK_STORE") sim.intervals.push({ kind: msg.row?.id ? "normal" : "keepalive", start: sim.now, end: sim.now + sim.emapMs, rowId: msg.row?.id });
        if (sim && msg.type === "PC_FROZEN_CHECK") sim.intervals.push({ kind: "frozen", start: sim.now, end: sim.now + simDelay, rowId: msg.row?.id });
        const cb = sim ? (r: unknown) => { simAdd(sim, simDelay, () => cb0(r)); }
          : slow ? (r: unknown) => { setImmediate(() => { calls.openNormal -= 1; cb0(r); }); } : cb0;
        if (msg.type === "PC_FROZEN_PING") {
          if (opts.onFrozenPing) opts.onFrozenPing();
          const present = !opts.frozenScriptNever && (opts.frozenScript !== false || calls.injected.includes("emap-frozen-711.js"));
          return present ? cb({ ok: true, script: "emap-frozen" }) : cb(undefined);
        }
        if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: opts.sflToken ? opts.sflToken() : fakeJwt() });
        if (msg.type === "SFL_REFRESH_TOKEN") { const r = opts.onSflRefresh ? opts.onSflRefresh() : { token: fakeJwt(), hadSession: true }; return cb({ ok: true, token: r.token ?? null, hadSession: r.hadSession === undefined ? null : r.hadSession }); }
        if (msg.type === "PC_PING") return cb({ ok: true, script: "x" });
        if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, script: "emap", guidFound: Boolean(emap && emap.guid), url: emap ? emap.url : "" });
        if (msg.type === "PC_CLICK_PICK_STORE") {
          const r = opts.onPickStoreClick ? opts.onPickStoreClick(emapTabs) : undefined;
          return cb(r ? { ok: true, clicked: r.clicked, reason: r.reason || "", text: "選擇取貨門市" } : { ok: true, clicked: true, reason: "", text: "選擇取貨門市" });
        }
        if (msg.type === "PC_FROZEN_CHECK" && opts.frozenReply) {
          if (calls.openNormal > 0) calls.frozenOverlap += 1;
          const r = opts.frozenReply(msg.row);
          return cb(r === null ? null : { ok: true, script: "emap-frozen", guidFound: true, endpoint: "/ecmap/byIDData.aspx", ...r });
        }
        if (msg.type === "PC_FROZEN_CHECK") {
          if (calls.openNormal > 0) calls.frozenOverlap += 1; // a frozen request while a normal one is open = the forbidden overlap
          const v = opts.sim && opts.sim.emapMs > SIM_FROZEN_ABORT_MS ? "unknown" // the content script aborted at 2.5 s
            : opts.frozenVerdict ? opts.frozenVerdict(msg.row) : "ok";
          if (v === "hang") return;                       // never answers
          if (v === "timeout" || (opts.sim && opts.sim.emapMs > SIM_FROZEN_ABORT_MS)) // the content script's 2.5 s abort (transient)
            return cb({ ok: true, script: "emap-frozen", frozen_store_status: "unknown", frozen_reason: "/ecmap/byIDData.aspx timeout (2.5s)", transient: true, guidFound: true, endpoint: "/ecmap/byIDData.aspx" });
          if (v === "throw") throw new Error("frozen stub threw");
          if (v === null) return cb(null);
          return cb({ ok: true, script: "emap-frozen", frozen_store_status: v, frozen_reason: v === "unknown" ? "sim unknown" : "", transient: false, guidFound: true, endpoint: "/ecmap/byIDData.aspx" });
        }
        if (msg.type === "PC_CHECK_STORE") {
          const v = emap && emap.guid ? (opts.storeVerdict ? opts.storeVerdict(msg.row) : "open") : "unknown";
          return cb({ ok: true, store_full_status: v, store_reason: v === "unknown" ? "eshopGuid not found on emap page" : "", guidFound: Boolean(emap && emap.guid), transient: Boolean(opts.storeTransient) && v === "unknown" });
        }
        if (msg.type === "PC_CHECK_PHONE" && opts.phoneReply) {
          const r = opts.phoneReply(msg.row, msg);
          if (!r) return cb(null);
          return cb({ ok: true, phone_check_status: r.status, phone_check_message: null, phone_restricted_until: null, phone_reason: r.status === "unknown" ? `sim ${r.kind}` : "", phone_fail_kind: r.kind || "", tokenMs: 100, postMs: 90 });
        }
        if (msg.type === "PC_CHECK_PHONE") {
          const v = opts.phoneVerdict ? opts.phoneVerdict() : "ok";
          return cb({ ok: true, phone_check_status: v, phone_check_message: null, phone_restricted_until: null, phone_reason: v === "unknown" ? "myship not responding" : "", tokenMs: 100, postMs: 90 });
        }
        cb({ ok: true });
      },
      update: (id: number, props: unknown, cb?: () => void) => { calls.update.push({ id, props }); cb?.(); },
      reload: (id: number) => { calls.reload.push(id); },
      remove: (id: number, cb?: () => void) => { calls.removed.push(id); const i = emapTabs.findIndex((t) => t.id === id); if (i >= 0) emapTabs.splice(i, 1); cb?.(); },
      onUpdated: { addListener: vi.fn() }, onCreated: { addListener: vi.fn() },
    },
  };
  const fetchNow = async (url: string, init?: { body?: string }) => {
    calls.fetch.push(url); calls.fetchBodies.push(String(init?.body ?? ""));
    if (opts.sim) { const b = simBody(opts.sim, url, init); if (b !== undefined) return { ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b), headers: { get: () => "application/json" } }; }
    const rows = opts.rows ?? [PENDING_ROW];
    if (/admin_parcel_worker_lease/.test(url) && opts.lease) {
      const r = opts.lease(JSON.parse(String(init?.body ?? "{}")));
      if (r === "throw") throw new Error("network down");
      if (r === "hang") return new Promise(() => {});
      const st = r.status ?? 200;
      return { ok: st >= 200 && st < 300, status: st, json: async () => r.json, text: async () => JSON.stringify(r.json), headers: { get: () => "application/json" } };
    }
    if (/admin_parcel_check_requeue/.test(url) && opts.requeueOk === false) return { ok: false, status: 404, json: async () => ({}), text: async () => "", headers: { get: () => "application/json" } };
    if (/rest\/v1\/app_settings\?/.test(url) && /frozen_warmup_enabled/.test(url)) {
      const rows = opts.warmupSwitch === "true" || opts.warmupSwitch === "false" ? [{ key: "frozen_warmup_enabled", value: opts.warmupSwitch }] : [];
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows), headers: { get: () => "application/json" } };
    }
    if (/admin_parcel_gave_up_count/.test(url)) {
      const g = typeof opts.gaveUp === "function" ? opts.gaveUp() : (opts.gaveUp ?? 0);
      if (g === "throw") throw new Error("network down");
      if (g === "error") return { ok: false, status: 500, json: async () => ({}), text: async () => "", headers: { get: () => "application/json" } };
      return { ok: true, status: 200, json: async () => g, text: async () => JSON.stringify(g), headers: { get: () => "application/json" } };
    }
    if (/admin_frozen_warmup_next/.test(url)) {
      if (opts.warmupNext === "error") return { ok: false, status: 500, json: async () => ({}), text: async () => "", headers: { get: () => "application/json" } };
      const rows = typeof opts.warmupNext === "function" ? opts.warmupNext(JSON.parse(String(init?.body ?? "{}"))) : (opts.warmupNext ?? []);
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows), headers: { get: () => "application/json" } };
    }
    if (/admin_frozen_warmup_(verdict|stop)/.test(url)) {
      const st = /stop/.test(url) ? (opts.warmupStopHttp ?? 200) : 200;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}), text: async () => "", headers: { get: () => "application/json" } };
    }
    if (/rest\/v1\/app_settings\?/.test(url)) {
      if (opts.frozenSwitch === "error") return { ok: false, status: 500, json: async () => ({}), text: async () => "", headers: { get: () => "application/json" } };
      const rows = opts.frozenSwitch === "true" || opts.frozenSwitch === "false" ? [{ key: "frozen_store_check_enabled", value: opts.frozenSwitch }] : [];
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows), headers: { get: () => "application/json" } };
    }
    if (/admin_parcel_frozen_pending/.test(url)) {
      if (opts.frozenPending === "error") return { ok: false, status: 500, json: async () => ({}), text: async () => "", headers: { get: () => "application/json" } };
      const rows = opts.frozenPending ?? [];
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows), headers: { get: () => "application/json" } };
    }
    if (/admin_parcel_frozen_verdict/.test(url)) {
      const st = opts.frozenVerdictHttp ?? 200;
      return { ok: st >= 200 && st < 300, status: st, json: async () => ({}), text: async () => "", headers: { get: () => "application/json" } };
    }
    const body = /admin_parcel_checks_pending/.test(url) ? rows
      : /admin_parcel_check_requeue/.test(url) ? 2
      : /admin_parcel_check_config/.test(url) ? { enabled: "true", healthy: "true", sender_phone: "0979593026", probe_buyer: "0919342192", sample_gm: "GM1" }
      : /rest\/v1\/parcel_scans/.test(url) ? (opts.legacyRows ?? [])
      : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => "application/json" } };
  };
  // sim: every database answer arrives after the sim's fetch delay
  const fetch = opts.sim
    ? (url: string, init?: { body?: string }) => new Promise((res, rej) => { const p = fetchNow(url, init); simAdd(opts.sim!, opts.sim!.fetchMs, () => { p.then(res, rej); }); })
    : fetchNow;
  // setTimeout: the row-gap/health sleeps (<=2s) resolve immediately; the boot
  // schedule (0) and the ~5s re-arm are recorded, NOT run — the test drives ticks.
  // sim: a real virtual timer.
  const setTimeout = opts.sim
    ? (fn: () => void, ms: number) => simAdd(opts.sim!, ms, fn)
    : (fn: () => void, ms: number) => { if (ms > 0 && ms <= 2000) fn(); else { calls.scheduled.push(ms); calls.timers.push({ ms, fn }); } return 1; };
  const clearTimeout = opts.sim ? (id: number) => { opts.sim!.cancelled.add(id); } : () => {};
  const now = opts.sim ? () => opts.sim!.now : opts.now;
  const DateCtor = now
    ? new Proxy(Date, { get: (t, k) => (k === "now" ? now : Reflect.get(t, k)), construct: (t, args) => new t(...(args.length ? (args as [number]) : [now()] as [number])) })
    : Date;
  const sandbox: Record<string, unknown> = {
    // importScripts (service-worker global): evaluates the named file(s) in the SAME context
    importScripts: (...files: string[]) => {
      for (const f of files) {
        let src: string;
        if (f === "frozen-check.js" && opts.frozenModuleSrc === null) throw new Error(`Failed to load '${f}' (ENOENT)`);
        if (f === "frozen-check.js" && typeof opts.frozenModuleSrc === "string") src = opts.frozenModuleSrc;
        else src = readFileSync(`${extDir}/${f}`, "utf8");
        vm.runInContext(src, sandbox as vm.Context, { filename: f });
      }
    },
    chrome, fetch, setTimeout, clearTimeout,
    console: { log: (...a: unknown[]) => calls.logs.push(a.join(" ")), warn: (...a: unknown[]) => calls.logs.push(a.join(" ")), error: (...a: unknown[]) => calls.logs.push(a.join(" ")) },
    Date: DateCtor, Promise, JSON, Math, Number, String, Boolean, Array, Object, Set, Map, URL, URLSearchParams, Error, RegExp, atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
  };
  vm.createContext(sandbox);
  vm.runInNewContext(src, sandbox, { filename: "background.js" }); // BOOT — throws here = dead worker
  const sb = sandbox as Record<string, (...a: unknown[]) => Promise<unknown>> & { chrome: typeof chrome };
  const status = () => (storage.pc_status as Record<string, unknown>) || {};
  // the boot status-reset is async (one storage write) — settle it before driving ticks
  const booted = new Promise<void>((r) => { let n = 0; const step = () => { if (++n > 20) return r(); Promise.resolve().then(step); }; step(); });
  const evalIn = (code: string): unknown => vm.runInContext(code, sandbox as vm.Context, { filename: "test-snippet.js" });
  return { sb, calls, storage, status, booted, emapTabs, evalIn };
}
