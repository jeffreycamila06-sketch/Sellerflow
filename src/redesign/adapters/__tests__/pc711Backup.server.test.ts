// @vitest-environment node
// The 7-11 server BACKUP checker (server/pc711Backup.js, sql/179; Jeff 2026-11-18). The REAL backup job, the REAL
// checker loop (pc711Shadow) and the REAL kept E-Map session run on a fake 7-11, a fake lease / database that
// follows the sql/179 rules, a fake Telegram and a virtual clock. No real request is ever made.
// (The SQL itself is proved on a real Postgres by scripts/sql179-behaviour.mjs.)
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPc711Backup, createBackupDb, pickFrozenRows, healthShop,
  BACKUP_STORE_GIVE_UP, BACKUP_REQUEUE_RETRY_MS, BACKUP_HEALTH_INTERVAL_MS, BACKUP_HEALTH_CONFIRM_MS, BACKUP_HEALTH_STORE_ID,
  BACKUP_FROZEN_LIMIT, BACKUP_FROZEN_QUEUE_MAX_AGE_MS, BACKUP_FROZEN_EMPTY_WAIT_MS, BACKUP_STORE_VERDICTS, BACKUP_SWITCH,
  BACKUP_OFF_RECHECK_MS, BACKUP_ALERTS,
} from "../../../../server/pc711Backup.js";
import { createPc711Shadow, SHADOW_ROW_GAP_MS, SHADOW_LIMIT, SHADOW_STORE_BACKOFF_MS, SHADOW_PHONE_BACKOFF_MS, SHADOW_MAINT_RETRY_MS, SHADOW_BRAKE_ERRORS, SHADOW_BRAKE_PAUSE_MS, SHADOW_FROZEN_STORE_GAP_MS, SHADOW_FROZEN_SLOW_PAUSE_MS, SHADOW_LOOKBACK_MS } from "../../../../server/pc711Shadow.js";
import { createPc711Emap, EMAP_KEEPALIVE_STORE, EMAP_OPEN_RETRY_MS } from "../../../../server/pc711Emap.js";
import { runPcServerProbe } from "../../../../server/pcServerProbe.js";
import { ALERT_TEXTS } from "../../../../server/telegramAlert.js";
import { MIRROR_SWITCH } from "../../../../server/pc711Evidence.js";

const BG = readFileSync("chrome-extension/background.js", "utf8");
const FROZEN_JS = readFileSync("chrome-extension/frozen-check.js", "utf8");
const SRC = readFileSync("server/pc711Backup.js", "utf8");
const SERVER = readFileSync("server.js", "utf8");
const SQL = readFileSync("sql/179_pc711_backup.sql", "utf8");
const constOf = (src: string, name: string): unknown => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(src);
  if (!m) throw new Error(`no ${name}`);
  return new Function(`return (${m[1].split("//")[0]});`)();
};

const NOW = Date.parse("2026-11-18T04:00:00Z");   // 12:00 Taipei
const NIGHT = Date.parse("2026-11-18T18:00:00Z"); // 02:00 Taipei
const FIVE_AM = Date.parse("2026-11-18T21:00:00Z");
const HOST = "emap.unipcsc.com.tw";
const PAGE = `https://${HOST}/mobilemap/default.aspx`;
// none of these may ever be in a log line
const MARK = { guid: "MARKGUID-1111-2222", cookie: "MARKCOOKIEval", name: "陳小美", sender: "0900000001", buyer: "0977000111", msg: "此手機號碼因多次未取紀錄，已被限制使用取貨付款功能，預計2027年01月31日 才能再次使用取貨付款功能" };
const GM1 = "GM1111111", GM2 = "GM2222222", GM3 = "GM3333333";
type R = Record<string, unknown>;
type Reply = { status?: number; body?: string; location?: string } | "timeout" | "network";
type Parcel = { id: string; phone: string; store_id: string; customer_name: string; gm_id: string; createdAt: number; store: string | null; storeAt: number; phoneStatus: string | null; phoneAt: number; message: string | null; until: string | null; frozen?: boolean; frozenStatus?: string | null; frozenAt?: number };
let seq = 0;
const sid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
const OPENED = () => ({ store: { emap: { cookies: { [HOST]: `ASP.NET_SessionId=${MARK.cookie}` }, guid: MARK.guid, pageUrl: PAGE }, kind: "", steps: [{ step: "store.emap", http: 200 }] } });
const PHONE_OK = { verdict: "ok", kind: "", steps: [{ step: "phone.token", http: 200, ok: true }, { step: "phone.validate", http: 200, ok: true }], message: null, until: null };
const PHONE_RESTRICTED = { verdict: "restricted", kind: "", steps: [{ step: "phone.token" }, { step: "phone.validate" }], message: MARK.msg, until: "2027-01-31" };
const tokenFail = (kind = "timeout") => ({ verdict: "unknown", kind, steps: [{ step: "phone.token", http: 0, ok: false }] });
const postFail = (kind: string, http = 200) => ({ verdict: "unknown", kind, steps: [{ step: "phone.token", http: 200, ok: true }, { step: "phone.validate", http, ok: false }] });

function harness(o: { start?: number; enabled?: boolean; byid?: (store: string, cate: string) => Reply; phone?: (i: R) => R; open?: () => unknown; status?: () => R;
  queue?: R[]; settings?: Record<string, string>; telegram?: (kind: string) => Promise<unknown>; dutyFails?: () => boolean; shared?: SharedDb } = {}) {
  let t = o.start ?? NOW;
  const logs: string[] = [], events: string[] = [], phoneInputs: R[] = [];
  const emapCalls: { k: string; cate: string; at: number }[] = [];
  const f = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    const u = new URL(url);
    t += 600;
    let rep: Reply;
    if (u.pathname.endsWith("/byIDData.aspx")) {
      const b = new URLSearchParams(String(init.body ?? "")); const k = b.get("k") || "", cate = b.get("cate") || "";
      emapCalls.push({ k, cate, at: t });
      events.push(`emap:${cate === "27" ? "frozen" : k === EMAP_KEEPALIVE_STORE ? "keepalive" : "store"}`);
      rep = o.byid ? o.byid(k, cate) : { body: "OK;123456+店+addr+enable+0++門市" };
    } else { events.push("reload"); rep = { status: 302, location: "/mobilemap/error.aspx" }; }
    if (rep === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (rep === "network") throw new TypeError("fetch failed");
    const r = rep;
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 300, headers: { get: (k: string) => (k.toLowerCase() === "location" ? r.location ?? null : null), getSetCookie: () => [] }, text: async () => r.body ?? "" };
  });
  const opens = vi.fn(async () => { events.push("open"); t += 3200; return o.open ? o.open() : OPENED(); });
  const emap = createPc711Emap({ open: opens, fetchImpl: f as unknown as typeof fetch, now: () => t, log: (l: string) => logs.push(l), random: () => 0.5 });
  const S = o.shared ?? sharedDb(o.enabled ?? true, t);
  const settings: Record<string, string> = { parcel_check_sender_phone: MARK.sender, parcel_check_probe_buyer: MARK.buyer, parcel_check_shared_gms: JSON.stringify([GM1]), parcel_check_sender_healthy: "true",
    pc711_shadow_enabled: "true", [MIRROR_SWITCH]: "false", ...(o.settings || {}) };
  // the fake database: the sql/179 rules (the real SQL is proved by scripts/sql179-behaviour.mjs)
  const dutyNow = () => S.enabled && S.onDuty && S.lease.readable && !(S.lease.leaderAt > S.since && !S.lease.degraded);
  const need = (p: Parcel) => ({ need_store: !p.frozen && p.store === null, need_phone: !p.frozen && p.phoneStatus === null });
  const bdb = {
    duty: vi.fn(async (loggedOut: boolean) => {
      S.calls.push("duty");
      if (o.dutyFails?.()) throw new Error("db down");
      let change: string | null = null;
      const L = S.lease;
      if (!S.enabled) { if (S.onDuty) { S.onDuty = false; S.handedBackAt = t; change = "switch_off"; } }
      else if (S.onDuty) { if (L.readable && L.leaderAt > S.since && !L.degraded) { S.onDuty = false; S.handedBackAt = t; S.alerts.push("handed_back"); change = "handed_back"; } }
      else if (L.readable) {
        const take = L.anyAt <= t - 120_000 ? "silent" : L.leaderAt > t - 120_000 && L.degraded ? "degraded" : null;
        if (take) { S.onDuty = true; S.reason = take; S.since = t; S.alerts.push(loggedOut ? "took_over_logged_out" : "took_over"); change = "took_over"; }
      }
      return { enabled: S.enabled, onDuty: S.enabled && S.onDuty && L.readable, reason: S.reason, change, alerts: [...S.alerts], floor: S.handedBackAt };
    }),
    alertDone: vi.fn(async (k: string) => { S.calls.push(`alertDone:${k}`); if (S.alerts[0] === k) S.alerts.shift(); }),
    pending: vi.fn(async (limit: number) => {
      S.calls.push("pending");
      if (!dutyNow()) return { onDuty: false, readAt: null, rows: [] };
      if (settings.parcel_check_sender_healthy !== "true") return { onDuty: true, readAt: new Date(t).toISOString(), rows: [] };
      const rows = [...S.parcels.values()].filter((p) => need(p).need_store || need(p).need_phone).slice(0, limit)
        .map((p) => ({ id: p.id, phone: p.phone, store_id: p.store_id, customer_name: p.customer_name, gm_id: p.gm_id, sender_phone: MARK.sender, ...need(p), queue_depth: 0, created_at: new Date(t - 60_000).toISOString() }));
      return { onDuty: true, readAt: new Date(t).toISOString(), rows };
    }),
    verdict: vi.fn(async (v: R) => {
      if (!dutyNow()) { S.writes.push({ ...v, result: "not_on_duty", at: t }); return "not_on_duty"; }
      const p = S.parcels.get(String(v.id));
      if (!p) return "gone";
      const seen = v.seenAt ? Date.parse(String(v.seenAt)) : null;
      if (v.store != null && v.expectedStore === p.store_id && !(seen !== null && p.storeAt > seen) && !(v.store === "unknown" && p.store && p.store !== "unknown")) { p.store = String(v.store); p.storeAt = t; }
      if (v.phone != null && v.expectedPhone === p.phone && !(seen !== null && p.phoneAt > seen)) { p.phoneStatus = String(v.phone); p.phoneAt = t; p.message = (v.message as string) ?? null; p.until = (v.until as string) ?? null; }
      S.writes.push({ ...v, result: "written", at: t });
      return "written";
    }),
    requeue: vi.fn(async (sinceMs: number) => {
      S.calls.push("requeue");
      if (!dutyNow()) return -1;
      let n = 0;
      for (const p of S.parcels.values()) if (p.store === "unknown" && p.createdAt >= sinceMs) { p.store = null; p.storeAt = 0; n++; }
      S.requeues.push({ at: t, sinceMs, n });
      return n;
    }),
    frozenPending: vi.fn(async (limit: number) => {
      S.calls.push("frozenPending");
      if (!dutyNow()) return { onDuty: false, readAt: null, rows: [] };
      const rows = [...S.parcels.values()].filter((p) => p.frozen && (p.frozenStatus == null || (p.frozenStatus === "unknown" && t - (p.frozenAt || 0) >= 10 * 60_000))).slice(0, limit).map((p) => ({ id: p.id, store_id: p.store_id }));
      return { onDuty: true, readAt: new Date(t).toISOString(), rows };
    }),
    frozenVerdict: vi.fn(async (v: R) => {
      if (!dutyNow()) { S.frozenWrites.push({ ...v, result: "not_on_duty", at: t }); return "not_on_duty"; }
      const p = S.parcels.get(String(v.id));
      if (p) { p.frozenStatus = String(v.status); p.frozenAt = t; }
      S.frozenWrites.push({ ...v, result: "written", at: t });
      return "written";
    }),
    senderHealth: vi.fn(async (ok: boolean) => { if (!dutyNow()) return "not_on_duty"; settings.parcel_check_sender_healthy = ok ? "true" : "false"; S.health.push({ ok, at: t }); return "written"; }),
  };
  const phoneCheck = vi.fn(async (i: R) => { phoneInputs.push({ ...i, at: t }); events.push("phone"); t += 900; return o.phone ? o.phone(i) : PHONE_OK; });
  const sent: string[] = [];
  const alert = { deliver: vi.fn(async (kind: string) => { sent.push(kind); return o.telegram ? o.telegram(kind) : { ok: true }; }) };
  const status = () => (o.status ? o.status() : { state: "connected", since: "c1" });
  const backup = createPc711Backup({ db: bdb, emap, phoneCheck, pc711: { status }, readSetting: async (k: string) => settings[k] ?? null, alert, now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { events.push(`sleep:${ms}`); t += ms; } });
  // the follower side: the shadow's own queue (parcels the extension answered) and its own check
  const queue = o.queue ?? [];
  const evRows: R[] = [];
  const evPass = vi.fn(async (since: string) => {
    S.calls.push("ev.pass"); S.evSince.push(since);
    const w = queue.filter((r) => !evRows.some((x) => x.scan_id === r.scan_id && x.kind === r.kind));
    return { shadow: true, waiting: w.length, jobs: w, mirror: false, reasks: [], awaiting: [], mirrorQueue: null, health: null };
  });
  const ev = { pass: evPass, insert: vi.fn(async (r: R) => { evRows.push(r); }), update: vi.fn(async () => {}), stopMirror: vi.fn(async () => false), parcelForReask: vi.fn(async () => null) };
  const sdb = { pending: vi.fn(), dayMax: vi.fn(async () => ({})), saveDayMax: vi.fn(async () => {}), insert: vi.fn(async () => {}), purgeBefore: vi.fn(async () => {}) };
  const shadowCheck = vi.fn(async (i: R) => { events.push("shadow-phone"); t += 900; return o.phone ? o.phone(i) : { verdict: "ok", http: 200, ms: 900, kind: "", raw: "Status:true", steps: [] }; });
  const job = createPc711Shadow({ db: sdb, evidence: ev, check: shadowCheck, pc711: { status }, readSetting: async (k: string) => settings[k] ?? null, emap, backup, now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { events.push(`sleep:${ms}`); t += ms; } });
  const add = (over: Partial<Parcel> = {}): Parcel => { const p: Parcel = { id: sid(), phone: `09${String(10000000 + S.parcels.size).padStart(8, "0")}`, store_id: String(151000 + S.parcels.size), customer_name: MARK.name, gm_id: GM1, createdAt: t, store: null, storeAt: 0, phoneStatus: null, phoneAt: 0, message: null, until: null, ...over }; S.parcels.set(p.id, p); return p; };
  return {
    job, backup, bdb, emap, S, logs, events, phoneInputs, emapCalls, opens, sent, alert, settings, evPass, shadowCheck, add, phoneCheck,
    /** the phone checks of PARCELS (the sender health probe left out) */
    pp: () => phoneInputs.filter((x) => x.phone !== MARK.buyer),
    at: () => t, set: (x: number) => { t = x; }, advance: (ms: number) => { t += ms; },
    lenovo: {
      silent: (sec: number) => { S.lease.leaderAt = t - sec * 1000; S.lease.anyAt = t - sec * 1000; },
      calls: (degraded = false) => { S.lease.leaderAt = t; S.lease.anyAt = t; S.lease.degraded = degraded; },
    },
    pass: async (n = 1, gap = 5000) => { for (let i = 0; i < n; i++) { await job.tick(); t += gap; } },
    flush: async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); },
  };
}
type SharedDb = ReturnType<typeof sharedDb>;
function sharedDb(enabled: boolean, t: number) {
  return { enabled, onDuty: false, reason: null as string | null, since: 0, handedBackAt: 0, alerts: [] as string[], calls: [] as string[], evSince: [] as string[],
    lease: { leaderAt: t - 600_000, anyAt: t - 600_000, degraded: false, readable: true },   // the Lenovo has been silent for 10 minutes
    parcels: new Map<string, Parcel>(), writes: [] as R[], frozenWrites: [] as R[], requeues: [] as R[], health: [] as R[] };
}
const noData = (lines: string[], h: ReturnType<typeof harness>) => {
  const all = lines.join("\n");
  for (const p of h.S.parcels.values()) { expect(all).not.toContain(p.phone); expect(all).not.toContain(p.store_id); }
  for (const v of [MARK.guid, MARK.cookie, MARK.name, MARK.sender, MARK.buyer, MARK.msg, GM1, GM2, BACKUP_HEALTH_STORE_ID, EMAP_KEEPALIVE_STORE]) expect(all).not.toContain(v);
  expect(all).not.toMatch(/09\d{8}/);
};

// ═══ the numbers = the extension's ═══════════════════════════════════════════════════════════════
describe("B0 numbers = the extension's", () => {
  it("give-up, re-queue, sender health, frozen queue", () => {
    expect(BACKUP_STORE_GIVE_UP).toBe(constOf(BG, "PC_STORE_GIVE_UP"));
    expect(BACKUP_REQUEUE_RETRY_MS).toBe(constOf(BG, "PC_REQUEUE_RETRY_MS"));
    expect(BACKUP_HEALTH_INTERVAL_MS).toBe(constOf(BG, "PC_HEALTH_INTERVAL_MS"));
    expect(BACKUP_HEALTH_CONFIRM_MS).toBe(constOf(BG, "PC_HEALTH_CONFIRM_MS"));
    expect(BACKUP_HEALTH_STORE_ID).toBe(constOf(BG, "PC_HEALTH_STORE_ID"));
    expect(BACKUP_STORE_VERDICTS).toEqual(constOf(BG, "PC_STORE_VERDICTS"));
    expect(SHADOW_LOOKBACK_MS).toBe(constOf(BG, "PC_REQUEUE_SINCE_MS"));
    expect(BACKUP_FROZEN_LIMIT).toBe(constOf(FROZEN_JS, "PENDING_LIMIT"));
    expect(BACKUP_FROZEN_QUEUE_MAX_AGE_MS).toBe(constOf(FROZEN_JS, "QUEUE_MAX_AGE_MS"));
    expect(BACKUP_FROZEN_EMPTY_WAIT_MS).toBe(constOf(FROZEN_JS, "EMPTY_WAIT_MS"));
  });
  it("the switch name; the database's 120 s", () => {
    expect(BACKUP_SWITCH).toBe("pc711_backup_enabled");
    expect(SQL).toContain("insert into public.app_settings(key, value) values ('pc711_backup_enabled', 'false') on conflict (key) do nothing;");
    expect(SQL).toContain("v_ttl constant interval := interval '120 seconds';");
  });
});

// ═══ B1 the switch ═══════════════════════════════════════════════════════════════════════════════
describe("B1 the switch off (the default): the server is only a follower", () => {
  it("a silent Lenovo and waiting parcels → no take-over, no check, no write, no alert; the database is asked once a minute", async () => {
    const h = harness({ enabled: false });
    h.add(); h.add();
    await h.pass(36); // 3 minutes
    expect(h.S.onDuty).toBe(false);
    expect([h.phoneInputs.length, h.S.writes.length, h.sent.length]).toEqual([0, 0, 0]);
    expect(h.emapCalls.filter((c) => c.k !== EMAP_KEEPALIVE_STORE).length).toBe(0);
    expect(h.bdb.pending).not.toHaveBeenCalled();
    expect(BACKUP_OFF_RECHECK_MS).toBe(60_000);
    expect(h.bdb.duty.mock.calls.length).toBe(3); // 0 s, 60 s, 120 s
    expect(h.evPass.mock.calls.length).toBe(36);  // the follower's own pass runs every time
  });
  it("turned off while on duty → the next pass stops at once (no alert)", async () => {
    const h = harness();
    await h.pass(1);
    expect(h.S.onDuty).toBe(true);
    h.S.enabled = false;
    h.add();
    await h.pass(3);
    expect(h.S.onDuty).toBe(false);
    expect(h.S.writes.length).toBe(0);
    expect(h.sent).toEqual(["took_over"]);
  });
});

// ═══ B2 take-over and hand-back ══════════════════════════════════════════════════════════════════
describe("B2 take-over: 120 s of silence, or a calling Lenovo that reports degraded", () => {
  it("silent 119 s → follower; 120 s → on duty, ONE alert, and the parcel is checked and written", async () => {
    const h = harness();
    h.lenovo.silent(119);
    const p = h.add();
    await h.job.tick();
    expect([h.S.onDuty, h.phoneInputs.length]).toEqual([false, 0]);
    h.advance(1000);
    await h.pass(2);
    expect(h.S.onDuty).toBe(true);
    expect(h.S.reason).toBe("silent");
    expect(p.phoneStatus).toBe("ok");
    await h.pass(1);
    expect(p.store).toBe("open"); // the E-Map session was opened at the end of the first pass
    await h.flush();
    expect(h.sent).toEqual(["took_over"]);
    expect(h.logs).toContain("[PC711_BACKUP] took_over reason=silent logged_out=0");
  });
  it("the Lenovo is still calling but reports degraded → take-over (reason degraded)", async () => {
    const h = harness();
    h.lenovo.calls(true);
    const p = h.add();
    await h.pass(2);
    expect([h.S.onDuty, h.S.reason, p.phoneStatus]).toEqual([true, "degraded", "ok"]);
    expect(h.logs).toContain("[PC711_BACKUP] took_over reason=degraded logged_out=0");
  });
  it("a calling, healthy Lenovo → never a take-over", async () => {
    const h = harness();
    h.add();
    for (let i = 0; i < 30; i++) { h.lenovo.calls(false); await h.pass(1); }
    expect([h.S.onDuty, h.phoneInputs.length, h.sent.length]).toEqual([false, 0, 0]);
  });
});

describe("B3 hand-back: the first lease call of a Lenovo that is NOT degraded", () => {
  it("on duty → the Lenovo calls → follower on the next pass, ONE alert; the next parcel is left to the Lenovo", async () => {
    const h = harness();
    await h.pass(2);
    h.lenovo.calls(false);
    const p = h.add();
    await h.pass(3);
    expect(h.S.onDuty).toBe(false);
    expect([p.phoneStatus, p.store, h.S.writes.length]).toEqual([null, null, 0]);
    await h.flush();
    expect(h.sent).toEqual(["took_over", "handed_back"]);
  });
  it("NO hand-back to a degraded Lenovo: it keeps calling degraded → the server stays on duty and keeps writing", async () => {
    const h = harness();
    h.lenovo.calls(true);
    await h.pass(2);
    for (let i = 0; i < 10; i++) { h.lenovo.calls(true); h.add(); await h.pass(1); }
    expect(h.S.onDuty).toBe(true);
    expect(h.S.writes.filter((w) => w.result === "written").length).toBe(10);
    expect(h.sent).toEqual(["took_over"]);
    h.lenovo.calls(false); // its tabs are back
    await h.pass(1); await h.flush();
    expect(h.S.onDuty).toBe(false);
    expect(h.sent).toEqual(["took_over", "handed_back"]);
  });
  it("a new duty starts with a clean memory: a parcel that was waiting on its retry timer is checked at once", async () => {
    let fail = true;
    const h = harness({ phone: (i) => (fail && i.phone !== MARK.buyer ? postFail("html") : PHONE_OK) });
    await h.pass(1);
    const p = h.add({ store: "open" });
    for (let i = 0; i < 4; i++) { await h.job.tick(); h.advance(20_000); } // failures → the retry timer is at 60 s or more
    expect([...h.backup._state().backoff.values()][0].phoneFails).toBeGreaterThanOrEqual(3);
    h.lenovo.calls(false); await h.pass(1);
    expect(h.S.onDuty).toBe(false);
    h.lenovo.silent(125); fail = false;
    const before = h.pp().length;
    await h.job.tick();                  // on duty again: checked in this very pass
    expect([h.S.onDuty, h.pp().length - before, p.phoneStatus]).toEqual([true, 1, "ok"]);
  });
  it("a new duty does not inherit the earlier duty's sender-health strike", async () => {
    const h = harness({ phone: (i) => (i.phone === MARK.buyer ? PHONE_RESTRICTED : PHONE_OK) });
    await h.pass(1);                        // duty 1: the probe says restricted once (1 of 2)
    expect(h.backup._state().strikes).toBe(1);
    h.lenovo.calls(false); await h.pass(1); // handed back before the confirmation
    expect(h.S.onDuty).toBe(false);
    h.advance(130_000);                     // the Lenovo stops again: 130 s with no call
    await h.job.tick();                     // duty 2: its first probe says restricted → 1 of 2 again, the sender is NOT paused
    expect([h.S.onDuty, h.backup._state().strikes, h.S.health.length]).toEqual([true, 1, 0]);
  });
  it("a new take-over needs the full condition again: 60 s of silence after a hand-back is not enough, 120 s is", async () => {
    const h = harness();
    await h.pass(1);
    h.lenovo.calls(false);
    await h.pass(1);
    expect(h.S.onDuty).toBe(false);
    h.lenovo.silent(0);
    await h.pass(12); // 60 s
    expect(h.S.onDuty).toBe(false);
    await h.pass(13); // past 120 s
    expect(h.S.onDuty).toBe(true);
  });
});

// ═══ B4 the Lenovo returns in the middle of a check ══════════════════════════════════════════════
describe("B4 the Lenovo returns mid-check: the database refuses the write, the server stops at once", () => {
  it("the answer in flight is NOT written; no further parcel is checked in that pass", async () => {
    const h = harness({ phone: (i) => { if (i.phone !== MARK.buyer) h.lenovo.calls(false); return PHONE_OK; } }); // the Lenovo calls while a parcel's phone check is on its way
    await h.pass(1);
    const a = h.add(), b = h.add(), c = h.add();
    await h.job.tick();
    expect(h.S.writes.map((w) => w.result)).toEqual(["not_on_duty"]);
    expect([a.phoneStatus, b.phoneStatus, c.phoneStatus]).toEqual([null, null, null]);
    expect(h.pp().length).toBe(1);
    expect(h.logs).toContain("[PC711_BACKUP] write refused not_on_duty");
    h.advance(5000);
    await h.pass(2); await h.flush();
    expect(h.S.onDuty).toBe(false);
    expect(h.sent).toEqual(["took_over", "handed_back"]);
    expect(h.pp().length).toBe(1);
  });
  it("the pending read itself says 'not on duty' → nothing is checked", async () => {
    const h = harness();
    await h.pass(1);
    h.add();
    h.bdb.duty.mockImplementationOnce(async () => ({ enabled: true, onDuty: true, reason: "silent", change: null, alerts: [], floor: 0 }));
    h.lenovo.calls(false);
    const before = h.emapCalls.length;
    await h.job.tick();
    expect([h.pp().length, h.S.writes.length]).toEqual([0, 0]);
    expect(h.logs).toContain("[PC711_BACKUP] write refused not_on_duty");
    // the pass stops right there: no frozen read, no keepalive, no re-queue
    expect([h.bdb.frozenPending.mock.calls.length, h.emapCalls.length - before, h.S.requeues.length]).toEqual([0, 0, 1]);
  });
  it("a long pass with nothing to write: the duty is asked again before a parcel once the last answer is 10 s old → no 7-11 request after the Lenovo's return", async () => {
    let n = 0;
    const h = harness({ byid: (k) => { if (k === EMAP_KEEPALIVE_STORE) return { body: "OK;1+a+b+enable+0++門市" }; if (++n === 1) h.lenovo.calls(false); return { body: "<html>" }; } });
    await h.pass(1);
    for (let i = 0; i < 5; i++) h.add({ phoneStatus: "ok" }); // only the store half is waiting; every answer is unusable → no write
    await h.job.tick();
    // a parcel takes about 3 s (its requests + the 2 s wait): the 5th would start more than 10 s after the duty was read
    expect(new Set(h.emapCalls.filter((c) => c.k !== EMAP_KEEPALIVE_STORE).map((c) => c.k)).size).toBe(4);
    expect(h.S.writes.length).toBe(0);
    expect(h.S.onDuty).toBe(false);
  });
});

// ═══ B5 what is written ══════════════════════════════════════════════════════════════════════════
describe("B5 the answer the seller sees = the extension's write", () => {
  it("store word + phone word + 7-11's message + the date, with the values that were checked and the read time", async () => {
    const h = harness({ phone: () => PHONE_RESTRICTED, byid: () => ({ body: "OK;1+a+b+disable+0++門市" }) });
    await h.pass(1);
    const p = h.add();
    await h.job.tick();
    expect(h.S.writes.length).toBe(1);
    const w = h.S.writes[0];
    expect(w).toMatchObject({ id: p.id, store: "full", phone: "restricted", message: MARK.msg, until: "2027-01-31", expectedPhone: p.phone, expectedStore: p.store_id, result: "written" });
    expect(typeof w.seenAt).toBe("string");
    expect(Date.parse(String(w.seenAt))).toBeLessThanOrEqual(Number(w.at));
    expect([p.store, p.phoneStatus, p.message, p.until]).toEqual(["full", "restricted", MARK.msg, "2027-01-31"]);
  });
  it("every store word: enable / disable / close / NO2 → open / full / company / not_found", async () => {
    for (const [body, word] of [["OK;1+a+b+enable+0++門市", "open"], ["OK;1+a+b+disable+0++門市", "full"], ["OK;1+a+b+close+0++門市", "company"], ["NO2", "not_found"]]) {
      const h = harness({ byid: (k) => (k === EMAP_KEEPALIVE_STORE ? { body: "OK;1+a+b+enable+0++門市" } : { body }) });
      await h.pass(1);
      const p = h.add();
      await h.job.tick();
      expect(p.store).toBe(word);
    }
  });
  it("ok carries no message and no date; nothing learned → no write at all", async () => {
    const h = harness({ phone: () => ({ ...PHONE_OK, message: "x", until: "2027-01-01" }) });
    await h.pass(1);
    h.add();
    await h.job.tick();
    expect(h.S.writes[0]).toMatchObject({ phone: "ok", message: null, until: null });
    const n = harness({ phone: () => tokenFail(), byid: () => "timeout" });
    await n.pass(1); n.add(); await n.job.tick();
    expect(n.S.writes.length).toBe(0);
  });
});

// ═══ B6 the row loop ═════════════════════════════════════════════════════════════════════════════
describe("B6 per parcel: store, then phone, then 2 s; at most 5 parcels a pass", () => {
  it("order of one pass with 2 parcels", async () => {
    const h = harness();
    await h.pass(1);
    h.add(); h.add();
    h.events.length = 0;
    await h.job.tick();
    expect(h.events.slice(0, 6)).toEqual(["emap:store", "phone", `sleep:${SHADOW_ROW_GAP_MS}`, "emap:store", "phone", `sleep:${SHADOW_ROW_GAP_MS}`]);
  });
  it("7 parcels → 5 this pass, 2 the next", async () => {
    const h = harness();
    await h.pass(1);
    for (let i = 0; i < 7; i++) h.add();
    await h.job.tick();
    expect(h.S.writes.length).toBe(SHADOW_LIMIT);
    h.advance(5000); await h.job.tick();
    expect(h.S.writes.length).toBe(7);
  });
  it("no E-Map session → the store half is left unanswered (never 'unknown'), the phone half is still checked", async () => {
    const h = harness({ open: () => ({ store: { kind: "no_session", steps: [] } }) });
    const p = h.add();
    await h.pass(3);
    expect([p.store, p.phoneStatus]).toEqual([null, "ok"]);
    expect(h.S.writes.every((w) => w.store === null)).toBe(true);
  });
});

// ═══ B7 the store ladder and the give-up ═════════════════════════════════════════════════════════
describe("B7 store: 15 / 30 / 60 / 120 s from the pass start; 'unknown' on the 5th failure; then back in the queue", () => {
  const bad = (k: string) => (k === EMAP_KEEPALIVE_STORE ? { body: "OK;1+a+b+enable+0++門市" } : { body: "<html>" }) as Reply;
  it("the waits between tries, and the 5th failure writes 'unknown' for the store half only", async () => {
    const h = harness({ byid: bad });
    await h.pass(1);
    const p = h.add({ phoneStatus: "ok" });
    const tries: number[] = [];
    for (let i = 0; i < 400 && p.store === null; i++) { const n = h.emapCalls.filter((c) => c.k === p.store_id).length; const s = h.at(); await h.job.tick(); if (h.emapCalls.filter((c) => c.k === p.store_id).length > n) tries.push(s); h.advance(1000); }
    expect(tries.length).toBe(BACKUP_STORE_GIVE_UP);
    tries.slice(1).forEach((x, i) => { expect(x - tries[i]).toBeGreaterThanOrEqual(SHADOW_STORE_BACKOFF_MS[i]); expect(x - tries[i]).toBeLessThan(SHADOW_STORE_BACKOFF_MS[i] + 4000); });
    expect(p.store).toBe("unknown");
    expect(h.S.writes).toHaveLength(1);
    expect(h.S.writes[0]).toMatchObject({ store: "unknown", phone: null });
  });
  it("exactly: the next try is due 15 s after the PASS START", async () => {
    const h = harness({ byid: bad });
    await h.pass(1);
    h.add({ phoneStatus: "ok" });
    const start = h.at();
    await h.job.tick();
    expect([...h.backup._state().backoff.values()][0]).toMatchObject({ storeFails: 1, storeNextAt: start + SHADOW_STORE_BACKOFF_MS[0] });
  });
  it("given-up stores go back in the queue at 05:00 (the end of the 7-ELEVEN night window)", async () => {
    const h = harness({ start: FIVE_AM - 4 * 60_000 });
    h.S.onDuty = true; h.S.since = h.at() - 1;
    const p = h.add({ phoneStatus: "ok", store: "unknown" });
    await h.pass(1, 1000); // still night
    expect(h.S.requeues.length).toBe(0);
    h.set(FIVE_AM + 1000);
    await h.job.tick();
    expect(h.S.requeues.length).toBe(1);
    expect(h.S.requeues[0].sinceMs).toBe(Number(h.S.requeues[0].at) - SHADOW_LOOKBACK_MS);
    expect(p.store).toBeNull();
    expect(h.logs.some((l) => l.startsWith("[PC711_BACKUP] requeue after maintenance_end rows=1"))).toBe(true);
  });
  it("… and after an E-Map recovery (the session is opened again): once per opening, and every backoff is forgotten", async () => {
    const h = harness({ byid: bad });
    await h.pass(1);                     // take-over: its ONE re-queue (the session opened in that same pass adds none)
    expect(h.S.requeues.length).toBe(1);
    const p = h.add({ phoneStatus: "ok" });
    await h.pass(3);                     // one failure → backoff; no further re-queue while the session lives
    expect(h.backup._state().backoff.size).toBe(1);
    expect(h.S.requeues.length).toBe(1);
    p.store = "unknown";                 // (as if it had been given up)
    h.emap._e().error = true;            // the session dies …
    h.advance(EMAP_OPEN_RETRY_MS + 1000);
    await h.job.tick();                  // … and is opened again at the end of this pass → re-queue
    expect(h.S.requeues.length).toBe(2);
    expect(h.backup._state().backoff.size).toBe(0);
    expect(p.store).toBeNull();
    h.advance(5000); await h.pass(5);
    expect(h.S.requeues.length).toBe(2);
  });
  it("a failed re-queue is tried again 60 s later, not sooner", async () => {
    const h = harness({ start: FIVE_AM - 60_000 });
    h.S.onDuty = true; h.S.since = h.at() - 1;
    await h.pass(1, 1000);
    h.set(FIVE_AM + 1000);
    let fail = true;
    const real = h.bdb.requeue.getMockImplementation()!;
    h.bdb.requeue.mockImplementation(async (s: number) => { if (fail) throw new Error("db"); return real(s); });
    await h.job.tick();
    const first = h.at();
    for (let i = 0; i < 5; i++) { h.advance(5000); await h.job.tick(); }
    expect(h.bdb.requeue.mock.calls.length).toBe(1);
    fail = false;
    h.set(first + BACKUP_REQUEUE_RETRY_MS + 1000);
    await h.job.tick();
    expect(h.bdb.requeue.mock.calls.length).toBe(2);
    expect(h.S.requeues.length).toBe(1);
  });
});

// ═══ B7b the take-over re-queue (Jeff 2026-11-18) ════════════════════════════════════════════════
describe("B7b at take-over the stores given up in the last 6 hours go back in the queue — once", () => {
  const ONE_AM = Date.parse("2026-11-18T17:00:00Z"); // 01:00 Taipei
  // a follower that already keeps an E-Map session open (the usual state when the Lenovo stops)
  const follower = async (o: Parameters<typeof harness>[0] = {}) => {
    const h = harness(o);
    h.lenovo.calls(false);
    await h.pass(1);
    h.emap.onLogin(); await h.emap.refresh(false, null);
    expect(h.emap.usable()).toBe(true);
    return h;
  };
  const takeOverLine = "[PC711_BACKUP] requeue after took_over rows=1";

  it("a store the Lenovo gave up before it stopped is put back at take-over, checked by the server and gets a real answer — in the pass of the take-over", async () => {
    const h = await follower();
    const p = h.add({ phoneStatus: "ok", store: "unknown", storeAt: h.at() - 600_000 }); // given up 10 minutes ago
    h.lenovo.silent(130);
    const from = h.S.calls.length;
    await h.job.tick();
    expect(h.S.onDuty).toBe(true);
    expect(h.S.requeues).toHaveLength(1);
    expect(h.logs).toContain(takeOverLine);
    const calls = h.S.calls.slice(from).filter((c) => c === "requeue" || c === "pending");
    expect(calls).toEqual(["requeue", "pending"]); // put back BEFORE the first read of the duty
    expect(p.store).toBe("open");
    expect(h.S.writes).toHaveLength(1);
    expect(h.S.writes[0]).toMatchObject({ id: p.id, store: "open", phone: null, result: "written" });
  });
  it("once per take-over, not every pass: a store given up later is not put back by the next passes", async () => {
    const h = await follower();
    h.add({ phoneStatus: "ok", store: "unknown" });
    h.lenovo.silent(130);
    await h.pass(1);
    expect(h.S.requeues).toHaveLength(1);
    const later = h.add({ phoneStatus: "ok", store: "unknown" }); // (given up after the take-over)
    await h.pass(40);
    expect(h.bdb.requeue.mock.calls.length).toBe(1);
    expect(later.store).toBe("unknown");
    expect(h.logs.filter((l) => l.startsWith("[PC711_BACKUP] requeue after")).length).toBe(1);
  });
  it("a new take-over: once again", async () => {
    const h = await follower();
    h.lenovo.silent(130);
    await h.pass(2);
    h.lenovo.calls(false); await h.pass(1);
    expect([h.S.onDuty, h.S.requeues.length]).toEqual([false, 1]);
    const p = h.add({ phoneStatus: "ok", store: "unknown" });
    for (let i = 0; i < 10; i++) { h.lenovo.calls(false); await h.pass(1); }   // a follower never puts anything back
    expect([h.S.requeues.length, p.store]).toEqual([1, "unknown"]);
    h.lenovo.silent(125);
    await h.pass(1);
    expect([h.S.onDuty, h.S.requeues.length, p.store]).toEqual([true, 2, "open"]);
    await h.pass(20);
    expect(h.S.requeues.length).toBe(2);
  });
  it("no session open yet at take-over (it opens at the end of that pass): still ONE re-queue, the store is answered right after", async () => {
    const h = harness();
    const p = h.add({ phoneStatus: "ok", store: "unknown" });
    await h.job.tick();
    expect([h.S.onDuty, h.S.requeues.length, p.store, h.opens.mock.calls.length]).toEqual([true, 1, null, 1]);
    h.advance(5000); await h.pass(3);
    expect([p.store, h.S.requeues.length]).toEqual(["open", 1]);
  });
  it("only the last 6 hours (the extension's window): an older give-up stays as it is", async () => {
    const h = await follower();
    const old = h.add({ phoneStatus: "ok", store: "unknown", createdAt: h.at() - 7 * 3600_000 });
    const recent = h.add({ phoneStatus: "ok", store: "unknown", createdAt: h.at() - 5 * 3600_000 });
    h.lenovo.silent(130);
    await h.pass(2);
    expect(h.S.requeues[0].sinceMs).toBe(Number(h.S.requeues[0].at) - SHADOW_LOOKBACK_MS);
    expect([old.store, recent.store]).toEqual(["unknown", "open"]);
  });
  it("a take-over between 01:00 and 05:00 Taipei: no re-queue then (the extension never does one in that window) — the 05:00 one does it, once", async () => {
    const h = await follower({ start: NOW });            // a session opened by day …
    h.set(NIGHT); h.lenovo.silent(130);                  // … the Lenovo stops at 02:00
    const p = h.add({ phoneStatus: "ok", store: "unknown", createdAt: NIGHT - 3600_000 });
    await h.pass(40);
    expect(h.S.onDuty).toBe(true);
    expect(h.bdb.requeue).not.toHaveBeenCalled();
    expect(p.store).toBe("unknown");
    h.set(FIVE_AM + 1000);
    await h.pass(3);
    expect(h.bdb.requeue.mock.calls.length).toBe(1);
    expect(h.logs).toContain("[PC711_BACKUP] requeue after maintenance_end rows=1");
    expect(p.store).not.toBe("unknown");
    await h.pass(20);
    expect(h.bdb.requeue.mock.calls.length).toBe(1);
  });
  it("a take-over re-queue that fails is tried again 60 s later, and still counts once", async () => {
    const h = await follower();
    const p = h.add({ phoneStatus: "ok", store: "unknown" });
    let fail = true;
    const real = h.bdb.requeue.getMockImplementation()!;
    h.bdb.requeue.mockImplementation(async (s: number) => { if (fail) throw new Error("db"); return real(s); });
    h.lenovo.silent(130);
    await h.job.tick();
    const first = h.at();
    expect(h.logs).toContain("[PC711_BACKUP] requeue after took_over failed next=60s");
    for (let i = 0; i < 8; i++) { h.advance(5000); await h.job.tick(); }
    expect([h.bdb.requeue.mock.calls.length, p.store]).toEqual([1, "unknown"]);
    fail = false;
    h.set(first + BACKUP_REQUEUE_RETRY_MS + 1000);
    await h.job.tick();
    expect([h.bdb.requeue.mock.calls.length, h.S.requeues.length, p.store]).toEqual([2, 1, "open"]);
    await h.pass(20);
    expect(h.bdb.requeue.mock.calls.length).toBe(2);
  });
  it("… and when 01:00 comes before it could be done, it is left to the 05:00 re-queue", async () => {
    const h = await follower({ start: ONE_AM - 45_000 });
    const p = h.add({ phoneStatus: "ok", store: "unknown" });
    let fail = true;
    const real = h.bdb.requeue.getMockImplementation()!;
    h.bdb.requeue.mockImplementation(async (s: number) => { if (fail) throw new Error("db"); return real(s); });
    h.lenovo.silent(130);
    await h.job.tick();                                  // 00:59 — the take-over; its re-queue fails
    expect(h.at()).toBeLessThan(ONE_AM);
    expect(h.bdb.requeue.mock.calls.length).toBe(1);
    fail = false;
    h.set(ONE_AM + 30_000);
    await h.pass(30);                                    // 01:00 … 01:03
    expect([h.bdb.requeue.mock.calls.length, p.store]).toEqual([1, "unknown"]);
    h.set(FIVE_AM + 1000);
    await h.pass(3);
    expect(h.bdb.requeue.mock.calls.length).toBe(2);
    expect(p.store).not.toBe("unknown");
  });
  it("a follower never puts anything back (switch off, or the Lenovo alive)", async () => {
    const off = harness({ enabled: false });
    off.add({ phoneStatus: "ok", store: "unknown" });
    await off.pass(30);
    expect(off.bdb.requeue).not.toHaveBeenCalled();
    const on = harness();
    const p = on.add({ phoneStatus: "ok", store: "unknown" });
    for (let i = 0; i < 30; i++) { on.lenovo.calls(false); await on.pass(1); }
    expect(on.bdb.requeue).not.toHaveBeenCalled();
    expect(p.store).toBe("unknown");
  });
});

// ═══ B8 the phone: never given up; "rejected" is retried ═════════════════════════════════════════
describe("B8 phone: never given up, never 'unknown'; a 'rejected' answer is retried, never written", () => {
  it("40 failed tries in a row → still retried, nothing written, the wait never above 2 min", async () => {
    const h = harness({ phone: () => tokenFail() });
    await h.pass(1);
    const p = h.add({ store: "open" });
    const at: number[] = [];
    for (let i = 0; i < 6000 && at.length < 40; i++) { const n = h.pp().length; await h.job.tick(); if (h.pp().length > n) at.push(Number(h.pp()[n].at)); h.advance(1000); }
    expect(at.length).toBe(40);
    expect(p.phoneStatus).toBeNull();
    expect(h.S.writes.length).toBe(0);
    const gaps = at.slice(1).map((x, i) => x - at[i]);
    SHADOW_PHONE_BACKOFF_MS.forEach((ms, i) => expect(gaps[i]).toBeGreaterThanOrEqual(ms));
    for (const g of gaps.slice(5)) { expect(g).toBeGreaterThanOrEqual(120_000); expect(g).toBeLessThan(120_000 + 8000); }
  });
  it("'rejected' (a 7-11 refusal that is not the no-pickup restriction): nothing written, retried on the SLOW ladder (15 s, 30 s)", async () => {
    const h = harness({ phone: () => postFail("rejected") });
    await h.pass(1);
    const p = h.add({ store: "open" });
    const s = h.at();
    await h.job.tick();
    expect(h.S.writes.length).toBe(0);
    expect(p.phoneStatus).toBeNull();
    expect([...h.backup._state().backoff.values()][0]).toMatchObject({ phoneFails: 1, phoneNextAt: s + 900 + SHADOW_STORE_BACKOFF_MS[0] }); // from the END of the try
    const at: number[] = [s];
    for (let i = 0; i < 200 && at.length < 3; i++) { h.advance(1000); const n = h.pp().length; const b = h.at(); await h.job.tick(); if (h.pp().length > n) at.push(b); }
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(SHADOW_STORE_BACKOFF_MS[1]);
  });
  it("the token GET: 5 s, one immediate retry only while fewer than 2 failures, never at night", async () => {
    const h = harness({ phone: () => tokenFail() });
    await h.pass(1);
    h.add({ store: "open" });
    for (let i = 0; i < 400 && h.pp().length < 4; i++) { await h.job.tick(); h.advance(1000); }
    expect(h.pp().map((x) => [x.tokenMs, x.tokenRetry])).toEqual([[5000, true], [5000, true], [5000, false], [5000, false]]);
    const n = harness({ start: NIGHT });
    n.S.onDuty = true; n.S.since = n.at() - 1;
    n.add({ store: "open" });
    await n.job.tick();
    expect(n.pp()[0].tokenRetry).toBe(false);
  });
});

// ═══ B9 each parcel's own shop ═══════════════════════════════════════════════════════════════════
describe("B9 each parcel is checked with its OWN shop and the sender phone of the read", () => {
  it("the shop and sender of each row go into its phone check", async () => {
    const h = harness();
    await h.pass(1);
    const a = h.add({ gm_id: GM1 }), b = h.add({ gm_id: GM2 });
    await h.job.tick();
    expect(h.pp().map((x) => [x.phone, x.gm, x.sender, x.storeId, x.name])).toEqual([[a.phone, GM1, MARK.sender, a.store_id, MARK.name], [b.phone, GM2, MARK.sender, b.store_id, MARK.name]]);
  });
  it("one shop with no answer: that shop's other parcels wait this pass, another shop goes on; store halves go on", async () => {
    const h = harness({ phone: (i) => (i.gm === GM1 ? tokenFail() : PHONE_OK) });
    await h.pass(1);
    h.add({ gm_id: GM1 }); const b = h.add({ gm_id: GM1 }); const c = h.add({ gm_id: GM2 });
    await h.job.tick();
    expect(h.pp().map((x) => x.gm)).toEqual([GM1, GM2]);
    expect([b.phoneStatus, b.store, c.phoneStatus]).toEqual([null, "open", "ok"]);
  });
  it("two shops with no answer: every remaining phone waits this pass", async () => {
    const h = harness({ phone: () => tokenFail() });
    await h.pass(1);
    h.add({ gm_id: GM1 }); h.add({ gm_id: GM2 }); const c = h.add({ gm_id: GM3 });
    await h.job.tick();
    expect(h.pp().map((x) => x.gm)).toEqual([GM1, GM2]);
    expect(c.store).toBe("open");
  });
  it("a POST with no answer stalls the shop too; a real answer that is not ok/restricted does not", async () => {
    const h = harness({ phone: (i) => (i.gm === GM1 ? postFail("timeout", 0) : postFail("html")) });
    await h.pass(1);
    h.add({ gm_id: GM1 }); h.add({ gm_id: GM1 }); h.add({ gm_id: GM2 }); h.add({ gm_id: GM2 });
    await h.job.tick();
    expect(h.pp().map((x) => x.gm)).toEqual([GM1, GM2, GM2]);
  });
  it("a store number that is not 6 digits: no phone request (the extension's rule), retried on the slow ladder", async () => {
    const h = harness();
    await h.pass(1);
    const p = h.add({ store_id: "12AB" });
    await h.job.tick();
    expect(h.pp().length).toBe(0);
    expect(p.phoneStatus).toBeNull();
    expect([...h.backup._state().backoff.values()][0]).toMatchObject({ phoneFails: 1 });
  });
});

// ═══ B10 logged out ══════════════════════════════════════════════════════════════════════════════
describe("B10 the server is logged out of 7-11 at take-over", () => {
  it("the logged-out alert text; phone checks keep running; a store check runs while the kept E-Map session lives", async () => {
    let state = "connected";
    const h = harness({ status: () => ({ state, since: "c1" }) });
    h.lenovo.calls(false);
    await h.pass(1);              // follower
    h.emap.onLogin(); await h.emap.refresh(false, null); // the follower kept an E-Map session open
    state = "needs_login";
    h.lenovo.silent(130);
    const p = h.add();
    await h.pass(2); await h.flush();
    expect(h.sent).toEqual(["took_over_logged_out"]);
    expect(h.logs).toContain("[PC711_BACKUP] took_over reason=silent logged_out=1");
    expect([p.phoneStatus, p.store]).toEqual(["ok", "open"]);
  });
  it("logged out with no E-Map session: phones are answered; stores stay unanswered (never 'unknown')", async () => {
    const h = harness({ status: () => ({ state: "needs_login", since: "c1" }), open: () => ({ store: { kind: "no_session", steps: [{ step: "store.skip", http: 0 }] } }) });
    const a = h.add(), b = h.add();
    await h.pass(90); // 7.5 minutes: far past the 5 tries of the store ladder (225 s)
    expect([a.phoneStatus, b.phoneStatus, a.store, b.store]).toEqual(["ok", "ok", null, null]);
    expect(h.S.writes.every((w) => w.store === null)).toBe(true);
    expect(h.sent).toEqual(["took_over_logged_out"]);
  });
});

// ═══ B11 the sender health check ═════════════════════════════════════════════════════════════════
describe("B11 sender health: a known-clean buyer every 5 min; two 'restricted' in a row pause all checks", () => {
  it("the probe: the clean buyer, the fixed store, the pool shop of this 5-minute slot, no token retry; once per 5 min", async () => {
    const h = harness({ settings: { parcel_check_shared_gms: JSON.stringify([GM1, GM2, "bad"]) } });
    await h.pass(1);
    const probes = () => h.phoneInputs.filter((x) => x.phone === MARK.buyer);
    expect(probes().length).toBe(1);
    expect(probes()[0]).toMatchObject({ phone: MARK.buyer, name: "SFL sender health", storeId: BACKUP_HEALTH_STORE_ID, sender: MARK.sender, tokenRetry: false, gm: healthShop(JSON.stringify([GM1, GM2, "bad"]), Number(probes()[0].at)) });
    await h.pass(58, 5000); // < 5 min
    expect(probes().length).toBe(1);
    await h.pass(3, 5000);
    expect(probes().length).toBe(2);
    expect(Number(probes()[1].at) - Number(probes()[0].at)).toBeGreaterThanOrEqual(BACKUP_HEALTH_INTERVAL_MS);
  });
  it("restricted once → confirmed 1 minute later; twice → the sender is paused and no parcel is checked", async () => {
    const h = harness({ phone: (i) => (i.phone === MARK.buyer ? PHONE_RESTRICTED : PHONE_OK) });
    await h.pass(1);
    expect(h.S.health.length).toBe(0);
    const first = Number(h.phoneInputs[0].at);
    for (let i = 0; i < 30 && h.S.health.length === 0; i++) await h.pass(1);
    expect(h.S.health).toMatchObject([{ ok: false }]);
    const probes = h.phoneInputs.filter((x) => x.phone === MARK.buyer);
    expect(probes.length).toBe(2);
    expect(Number(probes[1].at) - first).toBeGreaterThanOrEqual(BACKUP_HEALTH_CONFIRM_MS);
    expect(Number(probes[1].at) - first).toBeLessThan(BACKUP_HEALTH_CONFIRM_MS + 10_000);
    const p = h.add();
    await h.pass(5);
    expect(p.phoneStatus).toBeNull(); // the pending read gives nothing while the sender is unhealthy
  });
  it("restricted then ok → no pause; a paused sender that answers ok again → un-paused", async () => {
    let n = 0;
    const h = harness({ phone: (i) => (i.phone === MARK.buyer ? (n++ === 0 ? PHONE_RESTRICTED : PHONE_OK) : PHONE_OK) });
    await h.pass(20);
    expect(h.S.health.length).toBe(0);
    const g = harness({ settings: { parcel_check_sender_healthy: "false" } });
    await g.pass(1);
    expect(g.S.health).toMatchObject([{ ok: true }]);
    expect(g.settings.parcel_check_sender_healthy).toBe("true");
  });
  it("an 'unknown' probe changes nothing", async () => {
    const h = harness({ phone: (i) => (i.phone === MARK.buyer ? tokenFail() : PHONE_OK) });
    await h.pass(80);
    expect(h.S.health.length).toBe(0);
  });
  it("healthShop: a pool shop, another one every 5 minutes; no pool → no probe", () => {
    const pool = JSON.stringify([GM1, GM2]);
    const a = healthShop(pool, 0), b = healthShop(pool, 300_000);
    expect(new Set([a, b])).toEqual(new Set([GM1, GM2]));
    expect(healthShop(pool, 299_999)).toBe(a);
    expect([healthShop("[]", 0), healthShop("not json", 0), healthShop(null, 0)]).toEqual(["", "", ""]);
  });
});

// ═══ B12 no safety brake on duty; the brake still works as a follower ═══════════════════════════
describe("B12 no safety brake while on duty (Jeff's decision); as a follower it is unchanged", () => {
  it("on duty: 30 refusals in a row (HTTP 429) → no 15-minute pause; the tries follow the extension's timers", async () => {
    const h = harness({ phone: () => postFail("http", 429), byid: (k) => (k === EMAP_KEEPALIVE_STORE ? { body: "OK;1+a+b+enable+0++門市" } : { status: 429 }) });
    await h.pass(1);
    for (let i = 0; i < 6; i++) h.add();
    await h.pass(60);
    expect(h.job.state().pausedUntil).toBeNull();
    expect(h.logs.some((l) => l.includes("pause 15m"))).toBe(false);
    expect(h.phoneInputs.filter((x) => x.phone !== MARK.buyer).length).toBeGreaterThan(SHADOW_BRAKE_ERRORS * 2);
  });
  it("on duty: a re-open of the E-Map session that is refused 5 times does not pause anything either", async () => {
    const h = harness({ open: () => ({ store: { kind: "cart_form_missing", steps: [{ step: "store.cart", http: 429 }] } }) });
    const p = h.add();
    await h.pass(200);
    expect(h.job.state().pausedUntil).toBeNull();
    expect(p.phoneStatus).toBe("ok");
    // ~17 minutes: one try, one more at once, then one every 2 minutes — never held back by a brake
    expect(h.opens.mock.calls.length).toBe(10);
  });
  it("as a follower: 5 refusals in a row still pause the checker for 15 minutes", async () => {
    const q = Array.from({ length: 8 }, (_, i) => ({ scan_id: sid(), kind: "phone", ext: "ok", at: new Date(NOW - 60_000).toISOString(), store_id: "151003", phone: `09120000${String(i).padStart(2, "0")}`, customer_name: "x", input: `0912${i}`, seller_id: "s", created_at: new Date(NOW - 120_000).toISOString(), msg: null, until: null, cache_at: null, source: "fresh", prev_input: null, prev_ext_at: null, round: 1 }));
    const h = harness({ enabled: false, queue: q, phone: () => ({ verdict: "unknown", http: 429, ms: 300, kind: "http", steps: [{ step: "phone.token", http: 429, ms: 300, ok: false, note: "kind=http" }] }) });
    await h.pass(4);
    expect(h.job.state().pausedUntil).not.toBeNull();
    expect(Number(h.job.state().pausedUntil) - h.at()).toBeGreaterThan(SHADOW_BRAKE_PAUSE_MS - 60_000);
    expect(h.shadowCheck.mock.calls.length).toBe(SHADOW_BRAKE_ERRORS);
  });
  it("a brake pause from the follower time does not hold the server back once it is on duty", async () => {
    const q = Array.from({ length: 8 }, (_, i) => ({ scan_id: sid(), kind: "phone", ext: "ok", at: new Date(NOW - 60_000).toISOString(), store_id: "151003", phone: `09130000${String(i).padStart(2, "0")}`, customer_name: "x", input: `0913${i}`, seller_id: "s", created_at: new Date(NOW - 120_000).toISOString(), msg: null, until: null, cache_at: null, source: "fresh", prev_input: null, prev_ext_at: null, round: 1 }));
    let refuse = true;
    const h = harness({ queue: q, phone: (i) => (refuse && i.kind === "phone" ? { verdict: "unknown", http: 429, ms: 300, kind: "http", steps: [{ step: "phone.token", http: 429, ms: 300, ok: false, note: "kind=http" }] } : PHONE_OK) });
    h.lenovo.calls(false);
    await h.pass(4);
    expect(h.job.state().pausedUntil).not.toBeNull();
    refuse = false;
    h.lenovo.silent(130);
    const p = h.add();
    await h.pass(2);
    expect([h.S.onDuty, p.phoneStatus]).toEqual([true, "ok"]);
  });
});

// ═══ B13 comparing pauses on duty ════════════════════════════════════════════════════════════════
describe("B13 comparing with the extension pauses while on duty, and never compares the server with itself", () => {
  it("on duty: the follower's pass is not run at all; after the hand-back it starts again from the hand-back time", async () => {
    const h = harness();
    await h.pass(6);
    expect(h.evPass).not.toHaveBeenCalled();
    h.lenovo.calls(false);
    await h.pass(1);
    const handedBack = h.S.handedBackAt;
    expect(handedBack).toBeGreaterThan(0);
    expect(h.evPass.mock.calls.length).toBe(1);   // the pass of the hand-back itself already compares again
    for (let i = 0; i < 3; i++) { h.lenovo.calls(false); await h.pass(1); }
    expect(h.evPass.mock.calls.length).toBe(4);
    for (const s of h.S.evSince) expect(Date.parse(s)).toBe(handedBack); // not 6 h back: those answers were the server's own
  });
  it("a follower that was never on duty keeps its 6-hour look-back", async () => {
    const h = harness({ enabled: false });
    const t0 = h.at();
    await h.job.tick();
    expect(Date.parse(h.S.evSince[0])).toBe(t0 - SHADOW_LOOKBACK_MS);
  });
});

// ═══ B14 alerts ══════════════════════════════════════════════════════════════════════════════════
describe("B14 Telegram alerts: fixed texts, once per change, kept across a restart", () => {
  it("the three texts, word for word", () => {
    expect(BACKUP_ALERTS).toEqual(["took_over", "took_over_logged_out", "handed_back"]);
    expect(ALERT_TEXTS.took_over).toBe("Lenovo stopped. The server is checking now.");
    expect(ALERT_TEXTS.took_over_logged_out).toBe("Lenovo stopped. The server is checking now, but it is logged out of 7-11. Log in from Admin.");
    expect(ALERT_TEXTS.handed_back).toBe("Lenovo is back. The server is a follower again.");
  });
  it("one alert per change — not one per pass", async () => {
    const h = harness();
    await h.pass(40); await h.flush();
    expect(h.sent).toEqual(["took_over"]);
    expect(h.S.alerts).toEqual([]);
  });
  it("any hour: a take-over at 02:00 Taipei alerts too", async () => {
    const h = harness({ start: NIGHT });
    await h.pass(1); await h.flush();
    expect(h.sent).toEqual(["took_over"]);
  });
  it("a restart before the alert went out: the new server sends it (once); an alert already sent is not sent again", async () => {
    let hold: (v: unknown) => void = () => {};
    const a = harness({ telegram: () => new Promise((res) => { hold = res; }) });
    await a.pass(2);
    expect(a.sent).toEqual(["took_over"]);
    expect(a.S.alerts).toEqual(["took_over"]); // still queued in the database: Telegram has not answered
    // the server restarts (memory gone, the database kept)
    const b = harness({ shared: a.S, start: a.at() + 60_000 });
    await b.pass(3); await b.flush();
    expect(b.sent).toEqual(["took_over"]);
    expect(b.S.alerts).toEqual([]);
    const c = harness({ shared: a.S, start: b.at() + 60_000 });
    await c.pass(3); await c.flush();
    expect(c.sent).toEqual([]);
    hold({ ok: true });
  });
  it("in order, one at a time: the hand-back alert waits for the take-over alert", async () => {
    const release: ((v: unknown) => void)[] = [];
    const h = harness({ telegram: () => new Promise((res) => { release.push(res); }) });
    await h.pass(1);
    h.lenovo.calls(false);
    await h.pass(2);
    expect(h.sent).toEqual(["took_over"]);
    expect(h.S.alerts).toEqual(["took_over", "handed_back"]);
    release[0]({ ok: true }); await h.flush();
    h.lenovo.calls(false); await h.pass(1); await h.flush();
    expect(h.sent).toEqual(["took_over", "handed_back"]);
  });
  it("two alerts waiting after a restart: the oldest first, each once", async () => {
    const S = sharedDb(true, NOW);
    S.alerts.push("took_over", "handed_back");
    S.lease = { leaderAt: NOW, anyAt: NOW, degraded: false, readable: true };
    const h = harness({ shared: S });
    for (let i = 0; i < 4; i++) { h.lenovo.calls(false); await h.pass(1); await h.flush(); }
    expect(h.sent).toEqual(["took_over", "handed_back"]);
    expect(S.alerts).toEqual([]);
  });
  it("Telegram down or alerts off: the checker is never held, and the alert leaves the queue after its tries", async () => {
    const h = harness({ telegram: async () => ({ ok: false, word: "off" }) });
    const p = h.add();
    await h.pass(2); await h.flush();
    expect(p.phoneStatus).toBe("ok");
    expect(h.S.alerts).toEqual([]);
    const g = harness({ telegram: () => Promise.reject(new Error("boom")) });
    await g.pass(2); await g.flush();
    expect(g.S.alerts).toEqual([]);
  });
});

// ═══ B15 the night ═══════════════════════════════════════════════════════════════════════════════
describe("B15 01:00–05:00 Taipei on duty: failures are not counted, retry in 10 min, the session is not opened", () => {
  it("a store and a phone failure at night: no count, the next try 10 minutes later", async () => {
    const h = harness({ byid: (k) => (k === EMAP_KEEPALIVE_STORE ? { body: "OK;1+a+b+enable+0++門市" } : { body: "<html>" }), phone: () => postFail("html") });
    await h.pass(1); // by day: on duty, session open
    h.set(NIGHT);
    h.add();
    const start = h.at();
    await h.job.tick();
    const b = [...h.backup._state().backoff.values()][0];
    expect(b).toMatchObject({ storeFails: 0, phoneFails: 0, storeNextAt: start + SHADOW_MAINT_RETRY_MS });
    expect(b.phoneNextAt).toBeGreaterThanOrEqual(start + SHADOW_MAINT_RETRY_MS);
    expect(h.emap._e().misses).toBe(0);
  });
  it("a take-over at night with no session: phones are checked, the E-Map session is not opened before 05:00", async () => {
    const h = harness({ start: NIGHT });
    const p = h.add();
    await h.pass(20);
    expect(h.opens).not.toHaveBeenCalled();
    expect([p.phoneStatus, p.store]).toEqual(["ok", null]);
  });
});

// ═══ B16 frozen ══════════════════════════════════════════════════════════════════════════════════
describe("B16 frozen parcels on duty = the extension's frozen lane", () => {
  const fz = (k: string, cate: string, word: string): Reply => (cate === "27" ? { body: `OK;${k}+a+b+${word}+0++門市` } : { body: "OK;1+a+b+enable+0++門市" });
  it("one frozen request a pass, after the parcels; ok / no_frozen written with the store that was checked", async () => {
    const h = harness({ byid: (k, c) => fz(k, c, k === "200002" ? "disable" : "enable") });
    await h.pass(1);
    const a = h.add({ frozen: true, store_id: "200001", store: "open", phoneStatus: "ok" }), b = h.add({ frozen: true, store_id: "200002", store: "open", phoneStatus: "ok" });
    await h.pass(1); // the read for the next pass
    expect(h.S.frozenWrites.length).toBe(0);
    await h.pass(1);
    expect(h.S.frozenWrites.length).toBe(1);
    await h.pass(1);
    expect(h.S.frozenWrites.map((w) => [w.id, w.status, w.expectedStore])).toEqual([[a.id, "ok", "200001"], [b.id, "no_frozen", "200002"]]);
    expect(h.emapCalls.filter((c) => c.cate === "27").length).toBe(2);
  });
  it("no answer by day: 'unknown' is written and no frozen request for 10 minutes; at night no pause", async () => {
    const h = harness({ byid: (_k, c) => (c === "27" ? "timeout" : { body: "OK;1+a+b+enable+0++門市" }) });
    await h.pass(1);
    h.add({ frozen: true, store_id: "200001", store: "open", phoneStatus: "ok" }); h.add({ frozen: true, store_id: "200002", store: "open", phoneStatus: "ok" });
    await h.pass(2);
    expect(h.S.frozenWrites.map((w) => w.status)).toEqual(["unknown"]);
    const first = h.emapCalls.filter((c) => c.cate === "27")[0].at;
    for (let i = 0; i < 12 * 12 && h.emapCalls.filter((c) => c.cate === "27").length < 2; i++) await h.pass(1);
    expect(h.emapCalls.filter((c) => c.cate === "27")[1].at - first).toBeGreaterThanOrEqual(SHADOW_FROZEN_SLOW_PAUSE_MS);
    const n = harness({ byid: (_k, c) => (c === "27" ? "timeout" : { body: "OK;1+a+b+enable+0++門市" }) });
    await n.pass(1);
    n.set(NIGHT);
    n.add({ frozen: true, store_id: "200001", store: "open", phoneStatus: "ok" }); n.add({ frozen: true, store_id: "200002", store: "open", phoneStatus: "ok" });
    await n.pass(3);
    expect(n.emapCalls.filter((c) => c.cate === "27").length).toBe(2);
    expect(n.backup._state().frozen.pauseUntil).toBe(0);
  });
  it("a store is asked for frozen at most once per 10 minutes; an empty read is not repeated for 60 s", async () => {
    const h = harness({ byid: (k, c) => fz(k, c, "enable") });
    await h.pass(1);
    h.add({ frozen: true, store_id: "200001", store: "open", phoneStatus: "ok" }); h.add({ frozen: true, store_id: "200001", store: "open", phoneStatus: "ok" });
    for (let i = 0; i < 12 * 13 && h.emapCalls.filter((c) => c.cate === "27").length < 2; i++) await h.pass(1);
    const c = h.emapCalls.filter((x) => x.cate === "27");
    expect(c[1].at - c[0].at).toBeGreaterThanOrEqual(SHADOW_FROZEN_STORE_GAP_MS);
    const e = harness();
    await e.pass(13); // 65 s
    expect(e.bdb.frozenPending.mock.calls.length).toBe(1);
    await e.pass(2);
    expect(e.bdb.frozenPending.mock.calls.length).toBe(2);
    expect(pickFrozenRows([{ id: "a", store_id: "1" }, { id: "b", store_id: "1" }, { id: "c", store_id: "2" }, { id: "d", store_id: "3" }, { id: "e", store_id: "4" }], new Map([["2", 1000]]), 2000)).toEqual([{ id: "a", store_id: "1" }, { id: "d", store_id: "3" }, { id: "e", store_id: "4" }]);
  });
  it("the Lenovo returns before a frozen write → refused, follower", async () => {
    const h = harness({ byid: (k, c) => { if (c === "27") h.lenovo.calls(false); return { body: `OK;${k}+a+b+enable+0++門市` }; } });
    await h.pass(1);
    const p = h.add({ frozen: true, store_id: "200001", store: "open", phoneStatus: "ok" });
    await h.pass(2);
    expect(h.S.frozenWrites.map((w) => w.result)).toEqual(["not_on_duty"]);
    expect(p.frozenStatus ?? null).toBeNull();
    expect(h.bdb.frozenPending.mock.calls.length).toBe(1); // nothing more is read after the refusal
  });
});

// ═══ B17 fail-safe ═══════════════════════════════════════════════════════════════════════════════
describe("B17 fail-safe", () => {
  it("sql/179 not applied yet (the duty function is missing): follower, asked once a minute, ONE log line an hour", async () => {
    const h = harness({ enabled: false, dutyFails: () => true });
    h.add();
    await h.pass(12 * 90); // 90 minutes
    expect([h.pp().length, h.S.writes.length, h.sent.length]).toEqual([0, 0, 0]);
    expect(h.bdb.duty.mock.calls.length).toBeGreaterThanOrEqual(85);
    expect(h.bdb.duty.mock.calls.length).toBeLessThanOrEqual(91);
    expect(h.logs.filter((l) => l === "[PC711_BACKUP] duty read failed").length).toBe(2);
    expect(h.evPass.mock.calls.length).toBe(12 * 90); // the follower's own work is untouched
  });
  it("the duty read fails (database unreachable) → follower: nothing is checked or written; one log line", async () => {
    let down = false;
    const h = harness({ dutyFails: () => down });
    await h.pass(1);
    down = true;
    h.add();
    await h.pass(30);
    expect([h.phoneInputs.filter((x) => x.phone !== MARK.buyer).length, h.S.writes.length]).toEqual([0, 0]);
    expect(h.logs.filter((l) => l === "[PC711_BACKUP] duty read failed").length).toBe(1);
    down = false;
    await h.pass(2);
    expect(h.S.writes.length).toBe(1);
  });
  it("a write that fails (database error) is not counted as written; the parcel is checked again later", async () => {
    const h = harness();
    await h.pass(1);
    const p = h.add();
    h.bdb.verdict.mockImplementationOnce(async () => { throw new Error("db"); });
    await h.pass(1);
    expect(p.phoneStatus).toBeNull();
    await h.pass(1);
    expect(p.phoneStatus).toBe("ok");
  });
  it("a job that throws inside never stops the checker loop", async () => {
    const h = harness();
    h.bdb.pending.mockImplementation(async () => { throw new Error("db"); });
    await expect(h.pass(3)).resolves.toBeUndefined();
  });
});

// ═══ B18 the server only READS the lease ═════════════════════════════════════════════════════════
describe("B18 the server never calls the lease and never writes the extension's worker state", () => {
  it("the database adapter calls ONLY the sql/179 functions", async () => {
    const names: string[] = [];
    const db = createBackupDb({ rpc: async (fn: string) => { names.push(fn); return { data: fn.includes("pending") ? { on_duty: true, read_at: "2026-11-18T04:00:00Z", rows: [] } : fn.includes("duty") ? { enabled: true, on_duty: false } : "written", error: null }; } });
    await db.duty(false); await db.alertDone("took_over"); await db.pending(5); await db.verdict({ id: "x" }); await db.requeue(NOW); await db.frozenPending(3); await db.frozenVerdict({ id: "x", status: "ok" }); await db.senderHealth(true);
    expect(names).toEqual(["pc711_backup_duty", "pc711_backup_alert_done", "pc711_backup_pending", "pc711_backup_verdict", "pc711_backup_requeue", "pc711_backup_frozen_pending", "pc711_backup_frozen_verdict", "pc711_backup_sender_health"]);
    expect(names.every((n) => n.startsWith("pc711_backup_"))).toBe(true);
  });
  it("the module names no extension function, no lease call, no worker state, no login", () => {
    const code = SRC.split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).map((l) => l.split(" // ")[0]).join("\n");
    expect(code).not.toMatch(/admin_[a-z_]+|parcel_check_worker_(lease|state)|quickRelogin|openpoint/i);
    const sqlCode = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(sqlCode).not.toMatch(/admin_parcel_worker_lease\s*\(|parcel_check_worker_state/);                     // never called / never written
    expect(sqlCode.match(/parcel_check_worker_lease/g)?.length).toBe(1);                                           // read in ONE place
    expect(sqlCode).not.toMatch(/(update|insert into|delete from)\s+(public\.)?app_settings[^;]*parcel_check_worker/i);
  });
  it("server.js: the backup job gets the service-role database, the kept session, a phone check with NO login session, and the alert module", () => {
    expect(SERVER).toContain("const pc711Backup = createPc711Backup({ db: createBackupDb(serviceSb), emap: pc711Emap, phoneCheck: pc711BackupPhone, pc711, readSetting, alert: adminAlert });");
    expect(SERVER).toContain("emap: pc711Emap, backup: pc711Backup });");
    const line = SERVER.split("\n").find((l) => l.includes('target: { kind: "phone", ...input }')) || "";
    expect(line).toContain("runPcServerProbe({ readSetting, target:");
    expect(line).not.toContain("session");
    expect(SERVER.split("relogin: pc711.quickRelogin").length - 1).toBe(3); // unchanged: main's two + the E-Map open
  });
});

// ═══ B19 the phone check with a parcel's own shop (the real probe on a fake 7-11) ═══════════════
describe("B19 the phone check: the parcel's own shop + sender; 7-11's message and date handed back, never logged", () => {
  const run = async (target: R, body: unknown) => {
    const calls: { url: string; body: string }[] = []; const logs: string[] = [];
    const f = vi.fn(async (url: string, init: { body?: string }) => {
      calls.push({ url, body: String(init.body ?? "") });
      if (url.includes("/cart/easy/")) return { status: 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, text: async () => "<script>var tokenID = 'T:1';</script>" };
      return { status: 200, ok: true, headers: { get: (k: string) => (k === "content-type" ? "application/json" : null), getSetCookie: () => [] }, text: async () => JSON.stringify(body) };
    });
    const settings = async (k: string) => ({ parcel_check_shared_gms: JSON.stringify([GM1]), parcel_check_sender_phone: "0900000009" } as Record<string, string>)[k] ?? null;
    const r = await runPcServerProbe({ fetchImpl: f as never, now: () => NOW, log: (l: string) => logs.push(l), readSetting: settings, gate: false, target: { kind: "phone", ...target } as never });
    return { r, calls, logs };
  };
  it("the row's shop is the page asked and the Cgdm_Id sent; the row's sender is ordMobile", async () => {
    const { r, calls } = await run({ phone: "0912345678", name: MARK.name, storeId: "151003", gm: GM2, sender: MARK.sender }, { Status: true });
    expect(r.phone.verdict).toBe("ok");
    expect(new URL(calls[0].url).pathname).toBe(`/cart/easy/${GM2}`);
    expect(Object.fromEntries(new URLSearchParams(calls[1].body))).toMatchObject({ Cgdm_Id: GM2, ordMobile: MARK.sender, revMobile: "0912345678", RcvStoreID: "151003" });
  });
  it("restricted: the message and its date come back to the caller; no log line and no step holds them", async () => {
    const { r, logs } = await run({ phone: "0912345678", name: MARK.name, storeId: "151003", gm: GM2, sender: MARK.sender }, { Status: false, Message: MARK.msg });
    expect(r.phone).toMatchObject({ verdict: "restricted", message: MARK.msg, until: "2027-01-31" });
    expect(`${logs.join("\n")}\n${JSON.stringify({ ...r.phone, message: "", until: "" })}`).not.toMatch(/多次未取|2027/); // only .message and .until carry it
    const { r: r2 } = await run({ phone: "0912345678", storeId: "151003", gm: GM2, sender: MARK.sender }, { Status: false, Message: "您因多次未取紀錄遭檢舉，暫無法於平台成立訂單" });
    expect(r2.phone).toMatchObject({ verdict: "restricted", until: null });
  });
  it("a refusal that is not the restriction wording → 'rejected' (never restricted); a shop or sender that is not one → no request at all", async () => {
    const { r } = await run({ phone: "0912345678", storeId: "151003", gm: GM2, sender: MARK.sender }, { Status: false, Message: "門市錯誤" });
    expect(r.phone).toMatchObject({ verdict: "unknown", kind: "rejected" });
    expect(r.phone.message).toBeUndefined();
    for (const bad of [{ gm: "GM12", sender: MARK.sender }, { gm: "https://x/GM1111111", sender: MARK.sender }, { gm: GM2, sender: "12345" }, { gm: GM2 }]) {
      const x = await run({ phone: "0912345678", storeId: "151003", ...bad }, { Status: true });
      expect(x.r.phone.kind).toBe("config_missing");
      expect(x.calls.length).toBe(0);
    }
  });
  it("without a shop in the target the probe is as before (the first shop of the setting)", async () => {
    const { calls } = await run({ phone: "0912345678", storeId: "151003" }, { Status: true });
    expect(new URL(calls[0].url).pathname).toBe(`/cart/easy/${GM1}`);
    expect(new URLSearchParams(calls[1].body).get("ordMobile")).toBe("0900000009");
  });
});

// ═══ B20 logs ════════════════════════════════════════════════════════════════════════════════════
describe("B20 logs hold no phone, name, store number, shop, cookie, message or guid", () => {
  it("a busy duty with every kind of event", async () => {
    let n = 0;
    const h = harness({ phone: (i) => (i.phone === MARK.buyer ? PHONE_OK : n++ % 4 === 0 ? PHONE_RESTRICTED : n % 4 === 1 ? tokenFail() : n % 4 === 2 ? postFail("rejected") : PHONE_OK),
      byid: (k, c) => (c === "27" ? "timeout" : k === EMAP_KEEPALIVE_STORE ? { body: "OK;1+a+b+enable+0++門市" } : n % 3 === 0 ? { body: "<html>" } : { body: "NO2" }) });
    for (let i = 0; i < 80; i++) { if (i % 4 === 0) { h.add({ gm_id: i % 8 ? GM1 : GM2 }); h.add({ frozen: true, store_id: String(200000 + i), store: "open", phoneStatus: "ok" }); } await h.pass(1); }
    h.lenovo.calls(false);
    await h.pass(2); await h.flush();
    const mine = h.logs.filter((l) => l.startsWith("[PC711_BACKUP]"));
    expect(mine.some((l) => l.includes("wrote store="))).toBe(true);
    expect(mine.some((l) => l.includes("phone no answer"))).toBe(true);
    expect(mine.some((l) => l.includes("wrote frozen="))).toBe(true);
    expect(mine).toContain("[PC711_BACKUP] handed_back");
    noData(h.logs, h);
    for (const l of mine) expect(l).toMatch(/^\[PC711_BACKUP\] [a-z0-9_ =.:/-]+$/i);
  });
});

// ═══ B21 the SQL file (its behaviour is proved on a real Postgres by scripts/sql179-behaviour.mjs) ═══════════
describe("B21 sql/179: the duty check is inside every function the server can write or read parcels with", () => {
  const ROLLBACK = readFileSync("sql/179_pc711_backup_rollback.sql", "utf8");
  const body = (name: string) => {
    const a = SQL.indexOf(`create or replace function public.${name}(`);
    expect(a).toBeGreaterThan(-1);
    const b = SQL.indexOf("create or replace function public.", a + 10);
    return SQL.slice(a, b === -1 ? SQL.indexOf("do $grants$", a) === -1 ? SQL.length : SQL.indexOf("do $grants$", a) : b);
  };
  const GATED = ["pc711_backup_pending_rows", "pc711_backup_pending", "pc711_backup_verdict", "pc711_backup_requeue", "pc711_backup_frozen_pending_rows", "pc711_backup_frozen_pending", "pc711_backup_frozen_verdict", "pc711_backup_sender_health"];
  it("each one asks pc711_backup_on_duty() BEFORE its first change of a parcel, a cache or a setting", () => {
    for (const f of GATED) {
      const b = body(f);
      const gate = b.indexOf("if not public.pc711_backup_on_duty() then");
      expect(gate, f).toBeGreaterThan(-1);
      const firstWrite = b.search(/\n\s*(update|delete from|insert into)\s+public\.(parcel_scans|phone_check_cache|store_check_cache|store_frozen_cache|store_frozen_check_log|app_settings)/);
      if (firstWrite !== -1) expect(gate, f).toBeLessThan(firstWrite);
    }
  });
  it("pc711_backup_on_duty() reads the switch, the duty row and the lease; no function is security definer; only the service role may call", () => {
    const b = body("pc711_backup_on_duty");
    expect(b).toContain("pc711_backup_enabled");
    expect(b).toContain("pc711_backup_state");
    expect(b).toContain("pc711_backup_lease()");
    expect(SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")).not.toMatch(/security\s+definer/i);
    expect(SQL).toContain("execute format('revoke all on function public.%s from public, anon, authenticated', f);");
    expect(SQL).toContain("execute format('grant execute on function public.%s to service_role', f);");
    for (const t of ["pc711_backup_state", "pc711_backup_log"]) {
      expect(SQL).toContain(`alter table public.${t} enable row level security;`);
      expect(SQL).toContain(`revoke all on public.${t} from public, anon, authenticated;`);
      expect(SQL).not.toMatch(new RegExp(`create policy[^;]*${t}`));
    }
  });
  it("the log table takes words only (no free text can be stored)", () => {
    const a = SQL.indexOf("create table if not exists public.pc711_backup_log");
    const t = SQL.slice(a, SQL.indexOf(");", a));
    expect(t).toContain("'^[a-z_]{1,24}$'");
    const cols = t.split("\n").slice(1).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
    expect(cols).toEqual(["id", "at", "scan_id", "kind", "word", "result"]); // no column for a phone, a name, a store or 7-11's message
  });
  it("the log clean-up lives inside the duty call: 30 days, once a Taipei day, the day marked before the delete, never failing the call; no cron job", () => {
    const b = body("pc711_backup_duty");
    expect(b).toContain("v_keep constant interval := interval '30 days';");
    expect(b).toContain("v_today date := (v_now at time zone 'Asia/Taipei')::date;");
    const gate = b.indexOf("if st.log_purged_on is distinct from v_today then");
    const mark = b.indexOf("update pc711_backup_state set log_purged_on = v_today where id = 1;");
    const del = b.indexOf("delete from pc711_backup_log where at < v_now - v_keep;");
    expect(gate).toBeGreaterThan(-1);
    expect(mark).toBeGreaterThan(gate);
    expect(del).toBeGreaterThan(mark);
    expect(b.slice(del, del + 120)).toContain("exception when others then null;");
    const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code.match(/delete from pc711_backup_log/g)?.length).toBe(1);   // the one place a log row is deleted
    expect(code).not.toMatch(/cron\./);
    expect(SQL).toContain("log_purged_on   date,");
  });
  it("the rollback removes every function and table of 179 and the switch row", () => {
    const made = [...SQL.matchAll(/create or replace function public\.(pc711_backup_[a-z_]+)\(/g)].map((m) => m[1]);
    expect(made.length).toBe(12);
    for (const f of made) expect(ROLLBACK).toMatch(new RegExp(`drop function if exists public\\.${f}\\(`));
    expect(ROLLBACK).toContain("drop table if exists public.pc711_backup_log;");
    expect(ROLLBACK).toContain("drop table if exists public.pc711_backup_state;");
    expect(ROLLBACK).toContain("delete from public.app_settings where key = 'pc711_backup_enabled';");
  });
  it("the proof script and the live copies of the extension's functions are in the repo", () => {
    const proof = readFileSync("scripts/sql179-behaviour.mjs", "utf8");
    expect(proof).toContain("pc711_backup_originals_live.sql");
    const fx = readFileSync("scripts/fixtures/pc711_backup_originals_live.sql", "utf8");
    for (const f of ["admin_parcel_checks_pending", "admin_parcel_check_verdict", "admin_parcel_check_requeue", "admin_parcel_frozen_pending", "admin_parcel_frozen_verdict", "admin_set_parcel_sender_health"]) expect(fx).toContain(f);
  });
});
