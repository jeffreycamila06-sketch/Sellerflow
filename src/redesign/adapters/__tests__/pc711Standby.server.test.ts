// @vitest-environment node
// STANDBY keepalive (Jeff 2026-11-20). The shadow switch OFF + the backup a follower with its switch on → the server
// checks NO parcel, it only keeps its E-Map store-search session ready the way the extension's standby does
// (background.js pcRunOnce: pick · keepalive every 5 min · repair), plus Jeff's open rule. So when the Lenovo stops,
// the backup's first store check runs on a session that answers.
//
// The REAL checker loop (pc711Shadow), the REAL backup job and the REAL kept E-Map session run on a fake 7-11 whose
// session dies after 20 idle minutes (an assumption — the real idle limit was never measured), a fake lease /
// database that follows the sql/179 rules, and a virtual clock. MAIN = a frozen copy of main's pc711Shadow.js
// (fixtures/pc711Shadow.main.js): with the shadow switch ON and while on duty, the branch sends exactly main's requests.
import { describe, it, expect, vi } from "vitest";
import { appendFileSync, readFileSync } from "node:fs";
import { createPc711Shadow as createBranchShadow } from "../../../../server/pc711Shadow.js";
import { createPc711Shadow as createMainShadow } from "./fixtures/pc711Shadow.main.js";
import { createPc711Backup } from "../../../../server/pc711Backup.js";
import { createPc711Emap, storeSessionWord, emapDerive, EMAP_KEEPALIVE_STORE, EMAP_KEEPALIVE_MS, EMAP_OPEN_RETRY_MS } from "../../../../server/pc711Emap.js";
import { dutyAnswer, createDutyReader, DUTY_STORE_SESSION } from "../../../../server/pc711Duty.js";
import { MIRROR_SWITCH } from "../../../../server/pc711Evidence.js";

const BG = readFileSync("chrome-extension/background.js", "utf8");
const SHADOW_SRC = readFileSync("server/pc711Shadow.js", "utf8");
const SERVER = readFileSync("server.js", "utf8");
const constOf = (src: string, name: string): unknown => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(src);
  if (!m) throw new Error(`no ${name}`);
  return new Function(`return (${m[1].split("//")[0]});`)();
};

const NOON = Date.parse("2026-11-20T04:00:00Z");   // 12:00 Taipei
const HOST = "emap.unipcsc.com.tw";
const PAGE = `https://${HOST}/mobilemap/default.aspx`;
const IDLE_MS = 20 * 60_000;                        // the fake session dies after 20 idle minutes (assumption)
const MIN = 60_000, HOUR = 60 * MIN;
// none of these may ever be in a log line
const MARK = { guid: "MARKGUID-1111-2222", cookie: "MARKCOOKIEval", name: "陳小美", sender: "0900000001", buyer: "0977000111" };
type R = Record<string, unknown>;
type Parcel = { id: string; phone: string; store_id: string; customer_name: string; gm_id: string; createdAt: number; store: string | null; storeAt: number; phoneStatus: string | null; phoneAt: number };
let seq = 0;
const sid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
const OPENED = () => ({ store: { emap: { cookies: { [HOST]: `ASP.NET_SessionId=${MARK.cookie}` }, guid: MARK.guid, pageUrl: PAGE }, kind: "",
  steps: [{ step: "store.cart", http: 200 }, { step: "store.detail", http: 200 }, { step: "store.map", http: 200 }, { step: "store.emap", http: 200 }] } });
const OPEN_FAILED = () => ({ store: { kind: "http", steps: [{ step: "store.cart", http: 503 }] } });
const PHONE_OK = { verdict: "ok", kind: "", steps: [{ step: "phone.token", http: 200, ok: true }, { step: "phone.validate", http: 200, ok: true }], message: null, until: null };
const iso = (ms: number) => new Date(ms).toISOString();

type World = ReturnType<typeof world>;
function world(o: { which?: "branch" | "main"; start?: number; shadow?: boolean; backup?: boolean; lenovoAlive?: boolean; idleMs?: number;
  openFails?: () => boolean; status?: () => R; queue?: R[] } = {}) {
  let t = o.start ?? NOW_DEFAULT();
  const start = t;
  const reqs: string[] = [];               // EVERY 7-11 request and every check, in order, with its time
  const logs: string[] = [];
  const at = () => `${Math.round((t - start) / 1000)}s`;
  // the fake 7-11 E-Map session
  const sess = { alive: false, lastUse: 0, idleMs: o.idleMs ?? IDLE_MS, kills: 0 };
  const touch = () => { if (sess.alive && t - sess.lastUse > sess.idleMs) sess.alive = false; if (sess.alive) sess.lastUse = t; return sess.alive; };
  const f = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    const u = new URL(url);
    const b = new URLSearchParams(String(init.body ?? ""));
    const kind = u.pathname.endsWith("/byIDData.aspx") ? (b.get("cate") === "27" ? "frozen" : b.get("k") === EMAP_KEEPALIVE_STORE ? "keepalive" : "store") : "reload";
    reqs.push(`${at()} ${kind}`);
    t += 400;
    const ok = touch();
    const r = !ok ? { status: 302, location: "/mobilemap/error.aspx", body: "" }
      : kind === "reload" ? { status: 200, body: `<script>var eshopGuid="${MARK.guid}";</script>` }
      : { status: 200, body: "OK;123456+店+addr+enable+0++門市" };
    return { status: r.status, ok: r.status < 300, headers: { get: (k: string) => (k.toLowerCase() === "location" ? r.location ?? null : null), getSetCookie: () => [] }, text: async () => r.body };
  });
  const opens = vi.fn(async () => {
    reqs.push(`${at()} open`);
    t += 3200;
    if (o.openFails && o.openFails()) return OPEN_FAILED();
    sess.alive = true; sess.lastUse = t;
    return OPENED();
  });
  const emap = createPc711Emap({ open: opens, fetchImpl: f as unknown as typeof fetch, now: () => t, log: (l: string) => logs.push(l), random: () => 0.5 });
  // the fake database (the sql/179 rules — the real SQL is proved by scripts/sql179-behaviour.mjs)
  const S = { enabled: o.backup ?? true, shadow: o.shadow ?? false, onDuty: false, reason: null as string | null, since: 0, handedBackAt: 0, alerts: [] as string[],
    lease: { leaderAt: t, anyAt: t, degraded: false, readable: true }, parcels: new Map<string, Parcel>(), writes: [] as R[], pending: 0 };
  if (o.lenovoAlive === false) { S.lease.leaderAt = t - 10 * MIN; S.lease.anyAt = t - 10 * MIN; }
  const settings: Record<string, string> = { parcel_check_sender_phone: MARK.sender, parcel_check_probe_buyer: MARK.buyer, parcel_check_shared_gms: JSON.stringify(["GM1111111"]),
    parcel_check_sender_healthy: "true", pc711_shadow_enabled: "true", [MIRROR_SWITCH]: "false" };
  const dutyNow = () => S.enabled && S.onDuty && !(S.lease.leaderAt > S.since && !S.lease.degraded);
  const need = (p: Parcel) => ({ need_store: p.store === null, need_phone: p.phoneStatus === null });
  const bdb = {
    duty: vi.fn(async (loggedOut: boolean) => {
      let change: string | null = null;
      const L = S.lease;
      if (!S.enabled) { if (S.onDuty) { S.onDuty = false; S.handedBackAt = t; change = "switch_off"; } }
      else if (S.onDuty) { if (L.leaderAt > S.since && !L.degraded) { S.onDuty = false; S.handedBackAt = t; change = "handed_back"; } }
      else {
        const take = L.anyAt <= t - 120_000 ? "silent" : L.leaderAt > t - 120_000 && L.degraded ? "degraded" : null;
        if (take) { S.onDuty = true; S.reason = take; S.since = t; S.alerts.push(loggedOut ? "took_over_logged_out" : "took_over"); change = "took_over"; }
      }
      return { enabled: S.enabled, onDuty: S.enabled && S.onDuty, reason: S.reason, change, alerts: [...S.alerts], floor: S.handedBackAt };
    }),
    alertDone: vi.fn(async (k: string) => { if (S.alerts[0] === k) S.alerts.shift(); }),
    pending: vi.fn(async (limit: number) => {
      S.pending += 1;
      if (!dutyNow()) return { onDuty: false, readAt: null, rows: [] };
      const rows = [...S.parcels.values()].filter((p) => need(p).need_store || need(p).need_phone).slice(0, limit)
        .map((p) => ({ id: p.id, phone: p.phone, store_id: p.store_id, customer_name: p.customer_name, gm_id: p.gm_id, sender_phone: MARK.sender, ...need(p) }));
      return { onDuty: true, readAt: iso(t), rows };
    }),
    verdict: vi.fn(async (v: R) => {
      if (!dutyNow()) return "not_on_duty";
      const p = S.parcels.get(String(v.id));
      if (!p) return "gone";
      if (v.store != null && v.expectedStore === p.store_id) { p.store = String(v.store); p.storeAt = t; }
      if (v.phone != null && v.expectedPhone === p.phone) { p.phoneStatus = String(v.phone); p.phoneAt = t; }
      S.writes.push({ ...v, at: t });
      return "written";
    }),
    requeue: vi.fn(async (sinceMs: number) => {
      if (!dutyNow()) return -1;
      let n = 0;
      for (const p of S.parcels.values()) if (p.store === "unknown" && p.createdAt >= sinceMs) { p.store = null; n++; }
      return n;
    }),
    frozenPending: vi.fn(async () => (dutyNow() ? { onDuty: true, readAt: iso(t), rows: [] } : { onDuty: false, readAt: null, rows: [] })),
    frozenVerdict: vi.fn(async () => "written"),
    senderHealth: vi.fn(async () => "written"),
  };
  const phoneCheck = vi.fn(async (i: R) => { reqs.push(`${at()} phone${i.phone === MARK.buyer ? "-health" : ""}`); t += 900; return PHONE_OK; });
  const status = () => (o.status ? o.status() : { state: "connected", since: "c1" });
  const backup = createPc711Backup({ db: bdb, emap, phoneCheck, pc711: { status }, readSetting: async (k: string) => settings[k] ?? null, alert: null,
    now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { t += ms; } });
  // the follower's own queue: parcels the extension answered (the shadow's evidence queue)
  const queue = o.queue ?? [];
  const evRows: R[] = [];
  const ev = {
    pass: vi.fn(async () => {
      const w = queue.filter((r) => !evRows.some((x) => x.scan_id === r.scan_id && x.kind === r.kind) && Date.parse(String(r.at)) <= t);
      return { shadow: S.shadow, waiting: w.length, jobs: w, mirror: false, reasks: [], awaiting: [], mirrorQueue: null, health: null };
    }),
    insert: vi.fn(async (r: R) => { evRows.push(r); }), update: vi.fn(async () => {}), stopMirror: vi.fn(async () => false), parcelForReask: vi.fn(async () => null),
  };
  const sdb = { pending: vi.fn(), dayMax: vi.fn(async () => ({})), saveDayMax: vi.fn(async () => {}), insert: vi.fn(async () => {}), purgeBefore: vi.fn(async () => {}) };
  const check = vi.fn(async (i: R) => { reqs.push(`${at()} shadow-${String(i.kind)}`); t += 900; return { verdict: "ok", http: 200, ms: 900, kind: "", raw: "Status:true", steps: [] }; });
  const make = o.which === "main" ? createMainShadow : createBranchShadow;
  const job = make({ db: sdb, evidence: ev, check, pc711: { status }, readSetting: async (k: string) => settings[k] ?? null, emap, backup,
    now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { t += ms; } });
  const add = (over: Partial<Parcel> = {}) => { const p: Parcel = { id: sid(), phone: `09${String(10000000 + S.parcels.size).padStart(8, "0")}`, store_id: String(151000 + S.parcels.size), customer_name: MARK.name, gm_id: "GM1111111", createdAt: t, store: null, storeAt: 0, phoneStatus: null, phoneAt: 0, ...over }; S.parcels.set(p.id, p); return p; };
  return {
    job, backup, bdb, emap, S, sess, reqs, logs, opens, f, check, phoneCheck, sdb, ev, evRows, add, settings,
    at: () => t, set: (x: number) => { t = x; },
    /** run passes like the real loop (the next pass 5 s after this one finished); the Lenovo calls every pass while alive */
    run: async (ms: number, lenovo: "alive" | "silent" = "alive") => {
      const end = t + ms;
      while (t < end) {
        if (lenovo === "alive") { S.lease.leaderAt = t; S.lease.anyAt = t; }
        await job.tick();
        t += 5000;
      }
    },
    silentFrom: () => { S.lease.leaderAt = t; S.lease.anyAt = t; },
  };
}
function NOW_DEFAULT() { return NOON; }
// the database writes without the parcel id (each run makes its own ids)
const writesOf = (w: World) => w.S.writes.map(({ id: _id, ...rest }) => rest);
const count = (w: World, kind: string) => w.reqs.filter((x) => x.endsWith(` ${kind}`)).length;
const noData = (w: World) => {
  const all = w.logs.join("\n");
  for (const v of [MARK.guid, MARK.cookie, MARK.name, MARK.sender, MARK.buyer, EMAP_KEEPALIVE_STORE]) expect(all).not.toContain(v);
  for (const p of w.S.parcels.values()) { expect(all).not.toContain(p.phone); expect(all).not.toContain(p.store_id); }
  expect(all).not.toMatch(/09\d{8}/);
};

// ═══ S0 the extension's standby, the numbers ════════════════════════════════════════════════════
describe("S0 the extension's standby is what the server copies", () => {
  it("the extension: standby sets lastAnyNeedStore = false; pick, keepalive and repair run for both roles; the re-open is leader-only", () => {
    expect(BG).toContain("pcEv.lastAnyNeedStore = false; // no pending read on standby → the E-Map keepalive keeps running");
    expect(BG).toContain("// Both roles: tab pick, E-Map keepalive, local status (= standby stays ready).");
    expect(BG).toContain("if (remintable && e.remint && !e.remint.tried && !inMaint && pcPassLeader(pass)) {");
    expect(EMAP_KEEPALIVE_MS).toBe(constOf(BG, "PC_KEEPALIVE_MS"));
    expect(EMAP_KEEPALIVE_STORE).toBe(constOf(BG, "PC_KEEPALIVE_STORE"));
  });
  it("the standby step = onLogin kick · pick · keepalive(nothing waits) · refresh with NO brake hooks, in that order", () => {
    const body = /async function standbyKeep\(st\) \{([\s\S]*?)\n {2}\}/.exec(SHADOW_SRC)![1];
    const i = (s: string) => body.indexOf(s);
    expect(i("emap.onLogin()")).toBeGreaterThan(0);
    expect(i("emap.pick(")).toBeGreaterThan(i("emap.onLogin()"));
    expect(i("await emap.keepalive(false,")).toBeGreaterThan(i("emap.pick("));
    expect(i("await emap.refresh(inShadowMaint(now()), null)")).toBeGreaterThan(i("await emap.keepalive(false,"));
    expect(body).toContain("backup.state().enabled === true");
    expect(body).not.toMatch(/checkStore|checkFrozen|check\(|runJob|evidence\.|db\.insert/);
  });
});

// ═══ S1 standby: the session is kept, nothing else ═══════════════════════════════════════════════
describe("S1 shadow OFF + backup on + the Lenovo checking → standby", () => {
  it("opens at once, then only the keepalive every 5 min: 0 parcel checks, 0 shadow checks, 0 writes; the session stays alive for 3 hours", async () => {
    const w = world({ queue: [{ scan_id: sid(), kind: "store", ext: "open", at: iso(NOON), store_id: "151003", input: "151003" }] });
    await w.run(3 * HOUR);
    expect(w.opens).toHaveBeenCalledTimes(1);
    expect(count(w, "store") + count(w, "frozen") + count(w, "reload")).toBe(0);
    expect(w.check).not.toHaveBeenCalled();
    expect(w.phoneCheck).not.toHaveBeenCalled();
    expect(w.ev.insert).not.toHaveBeenCalled();
    expect(w.sdb.insert).not.toHaveBeenCalled();
    expect(w.bdb.pending).not.toHaveBeenCalled();
    expect(w.bdb.verdict).not.toHaveBeenCalled();
    expect(count(w, "keepalive")).toBeGreaterThanOrEqual(3 * 12);       // one right after the open, then one every 5 min
    expect(count(w, "keepalive")).toBeLessThanOrEqual(3 * 12 + 1);
    const ka = w.reqs.filter((x) => x.endsWith(" keepalive")).map((x) => parseInt(x, 10));
    for (let i = 1; i < ka.length; i++) expect(ka[i] - ka[i - 1]).toBeGreaterThanOrEqual(EMAP_KEEPALIVE_MS / 1000);
    expect(w.sess.alive).toBe(true);
    expect(w.emap.sessionWord(false, true)).toBe("ready");
  });
  it("one log line when standby starts and one when the shadow switch goes ON again — words only", async () => {
    const w = world();
    await w.run(10 * MIN);
    w.S.shadow = true;
    await w.run(10 * MIN);
    w.S.shadow = false;
    await w.run(10 * MIN);
    expect(w.logs.filter((l) => l.startsWith("[PC711_STANDBY]"))).toEqual(["[PC711_STANDBY] on", "[PC711_STANDBY] off", "[PC711_STANDBY] on"]);
    noData(w);
  });
  it("the backup switch OFF → no standby: not one 7-11 request in a day (main's behaviour)", async () => {
    const w = world({ backup: false });
    await w.run(24 * HOUR);
    expect(w.reqs).toEqual([]);
    expect(w.logs.some((l) => l.startsWith("[PC711_STANDBY]"))).toBe(false);
  });
  it("a session that cannot be opened: one try, one more right away to confirm, then one every 2 min — no 15-min pause, no shadow row", async () => {
    const w = world({ openFails: () => true });
    await w.run(20 * MIN);
    const at = w.reqs.filter((x) => x.endsWith(" open")).map((x) => parseInt(x, 10));
    expect(at[1] - at[0]).toBeLessThan(10);                           // the confirm, in the same pass
    for (let i = 2; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(EMAP_OPEN_RETRY_MS / 1000);
    expect(at.length).toBeGreaterThanOrEqual(10);
    expect(at.length).toBeLessThanOrEqual(12);
    expect(w.sdb.insert).not.toHaveBeenCalled();                      // the shadow's brake writes a pause row — not on standby
    expect(w.emap.sessionWord(false, true)).toBe("opening");
  });
  it("a new 7-11 login → the dead session is opened at once (no 2-min wait)", async () => {
    let st = { state: "connected", since: "c1" };
    const w = world({ openFails: () => st.since === "c1", status: () => st });
    await w.run(3 * MIN);
    const before = w.opens.mock.calls.length;
    st = { state: "connected", since: "c2" };
    await w.run(5000);
    expect(w.opens.mock.calls.length).toBe(before + 1);
    expect(w.sess.alive).toBe(true);
  });
  it("the server's session is reset (e.g. 7-11 restarts it): the keepalive misses, the repair re-loads, the session is opened again", async () => {
    const w = world();
    await w.run(10 * MIN);
    w.sess.alive = false;
    await w.run(40 * MIN);
    expect(count(w, "reload")).toBeGreaterThanOrEqual(1);
    expect(w.opens).toHaveBeenCalledTimes(2);
    expect(w.sess.alive).toBe(true);
    noData(w);
  });
});

describe("S2 a lost 7-11 login: today's rule", () => {
  it("logged out while the kept session answers → the keepalive keeps it alive; no open, no login request", async () => {
    let st = { state: "connected", since: "c1" };
    const w = world({ status: () => st });
    await w.run(10 * MIN);
    st = { state: "needs_login", since: "c1" };
    await w.run(2 * HOUR);
    expect(w.opens).toHaveBeenCalledTimes(1);
    expect(count(w, "keepalive")).toBeGreaterThanOrEqual(2 + 24);
    expect(w.sess.alive).toBe(true);
    expect(w.emap.sessionWord(false, false)).toBe("ready");
  });
  it("logged out and the session dies → repaired once, then nothing at all (no open) until the next login", async () => {
    let st = { state: "connected", since: "c1" };
    const w = world({ status: () => st });
    await w.run(10 * MIN);
    st = { state: "needs_login", since: "c1" };
    w.sess.alive = false;
    await w.run(30 * MIN);
    const n = w.reqs.length;
    await w.run(2 * HOUR);
    expect(w.reqs.length).toBe(n);                                    // silent: logged out with no session
    expect(w.opens).toHaveBeenCalledTimes(1);
    expect(w.emap.sessionWord(false, false)).toBe("not_ready");
    st = { state: "connected", since: "c2" };
    await w.run(10_000);
    expect(w.opens).toHaveBeenCalledTimes(2);                         // the login is back → opened at once
    expect(w.sess.alive).toBe(true);
  });
  it("never logged in, no session → no request at all", async () => {
    const w = world({ status: () => ({ state: "needs_login", since: null }) });
    await w.run(HOUR);
    expect(w.reqs).toEqual([]);
  });
});

describe("S3 01:00–05:00 Taipei: the extension's night rules", () => {
  it("the keepalive runs all night; a session that dies at night is not repaired or opened before 05:00, then it is", async () => {
    const t0 = Date.parse("2026-11-20T16:30:00Z");                    // 00:30 Taipei
    const w = world({ start: t0 });
    await w.run(60 * MIN);                                            // → 01:30
    w.sess.alive = false;                                             // dies at 01:30
    const night = Date.parse("2026-11-20T21:00:00Z");                 // 05:00 Taipei
    await w.run(night - w.at());
    const inNight = (x: string) => { const s = t0 + parseInt(x, 10) * 1000; return s >= Date.parse("2026-11-20T17:00:00Z") && s < night; };
    expect(w.reqs.filter((x) => inNight(x) && (x.endsWith(" reload") || x.endsWith(" open")))).toEqual([]);
    expect(w.reqs.filter((x) => inNight(x) && x.endsWith(" keepalive")).length).toBeGreaterThanOrEqual(47);
    expect(w.emap.sessionWord(true, true)).toBe("not_ready");
    await w.run(30 * MIN);                                            // after 05:00: repaired / opened again
    expect(w.opens).toHaveBeenCalledTimes(2);
    expect(w.sess.alive).toBe(true);
  });
});

// ═══ S4 the take-over table (the STEP 0 simulation, with standby) ═══════════════════════════════════
type Row = { which: string; offMin: number; parcels: number; firstAnswerS: number | null; unknowns: number; opensAtTakeOver: number };
async function takeOver(which: "branch" | "main", offMin: number, parcels: number): Promise<Row> {
  const w = world({ which, shadow: true });
  await w.run(10 * MIN);                                              // shadow ON for 10 min: the session is opened and used
  w.S.shadow = false;
  await w.run(offMin * MIN);                                          // shadow OFF, the Lenovo still checking
  for (let i = 0; i < parcels; i++) w.add();
  w.silentFrom();                                                     // the Lenovo stops
  const stop = w.at(), opensBefore = w.opens.mock.calls.length;
  let first: number | null = null;
  while (w.at() - stop < 20 * MIN) {
    await w.job.tick();
    w.set(w.at() + 5000);
    if (first === null) { const real = w.S.writes.find((x) => x.store != null && x.store !== "unknown"); if (real) first = Number(real.at) - stop; }
  }
  return { which, offMin, parcels, firstAnswerS: first === null ? null : Math.round(first / 1000), unknowns: w.S.writes.filter((x) => x.store === "unknown").length,
    opensAtTakeOver: w.opens.mock.calls.length - opensBefore };
}
describe("S4 the Lenovo stops after the shadow was OFF for 10 / 60 min", () => {
  it("branch: the first real store answer comes in the take-over pass (≈ 2 min after the stop), 0 'unknown', no open needed", async () => {
    const rows: Row[] = [];
    for (const offMin of [10, 60]) for (const parcels of [1, 2, 3]) {
      const b = await takeOver("branch", offMin, parcels);
      const m = await takeOver("main", offMin, parcels);
      rows.push(b, m);
      expect(b.firstAnswerS, `branch off=${offMin} parcels=${parcels}`).not.toBeNull();
      expect(b.firstAnswerS!).toBeGreaterThanOrEqual(120);            // the take-over itself (120 s of silence) is the database's rule
      expect(b.firstAnswerS!).toBeLessThanOrEqual(135);               // the store check of the take-over pass answers
      expect(b.unknowns).toBe(0);
      expect(b.opensAtTakeOver).toBe(0);                              // the kept session is used at once
      if (offMin === 60) { expect(m.firstAnswerS ?? Infinity).toBeGreaterThan(200); }   // main: the dead session costs minutes (the test bites)
    }
    if (process.env.SFL_STANDBY_TABLE) appendFileSync(process.env.SFL_STANDBY_TABLE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }, 60_000);
});

// ═══ S5 main's requests, unchanged ═════════════════════════════════════════════════════════════════
const queueOver = (from: number, hours: number) => {
  const q: R[] = [];
  for (let m = 0; m < hours * 60; m += 7) {
    const s = sid(), a = iso(from + m * MIN);
    q.push({ scan_id: s, kind: "store", ext: "open", at: a, store_id: "151003", input: "151003" },
      { scan_id: s, kind: "phone", ext: "ok", at: a, store_id: "151003", phone: "0912345678", customer_name: MARK.name, input: "0912345678" });
    if (m % 63 === 0) q.push({ scan_id: sid(), kind: "frozen", ext: "ok", at: a, store_id: "151004", input: "151004" });
  }
  return q;
};
async function script(which: "branch" | "main", opts: { shadow: boolean; backup: boolean; dutyFirst?: boolean; untilHandBack?: boolean }) {
  let st = { state: "connected", since: "c1" };
  const w = world({ which, shadow: opts.shadow, backup: opts.backup, lenovoAlive: !opts.dutyFirst, queue: queueOver(NOON, 4), status: () => st });
  if (opts.dutyFirst) {
    for (let i = 0; i < 4; i++) w.add();
    await w.run(30 * MIN, "silent");
    for (let i = 0; i < 3; i++) w.add();
    await w.run(20 * MIN, "silent");
    if (opts.untilHandBack) return w;
    await w.run(10 * MIN);                                           // the Lenovo is back
    return w;
  }
  await w.run(40 * MIN);
  w.sess.alive = false;                                             // 7-11 resets the session
  await w.run(40 * MIN);
  st = { state: "needs_login", since: "c1" };                       // the login is lost …
  await w.run(30 * MIN);
  st = { state: "connected", since: "c2" };                         // … and back
  await w.run(40 * MIN);
  w.silentFrom();
  for (let i = 0; i < 5; i++) w.add();
  await w.run(25 * MIN, "silent");                                  // a take-over …
  await w.run(15 * MIN);                                            // … and the hand-back
  return w;
}
describe("S5 shadow switch ON, and on duty: exactly main's requests", () => {
  it("shadow ON, backup on: the same requests at the same times as main (store, phone, frozen, keepalive, repair, open, take-over, hand-back)", async () => {
    const b = await script("branch", { shadow: true, backup: true });
    const m = await script("main", { shadow: true, backup: true });
    expect(b.reqs.length).toBeGreaterThan(100);
    expect(b.reqs).toEqual(m.reqs);
    expect(b.S.writes.length).toBeGreaterThan(0);
    expect(writesOf(b)).toEqual(writesOf(m));
    expect(b.evRows.length).toBe(m.evRows.length);
    expect(b.logs.some((l) => l.startsWith("[PC711_STANDBY]"))).toBe(false);
  }, 60_000);
  it("shadow ON, backup off: the same requests as main", async () => {
    const b = await script("branch", { shadow: true, backup: false });
    const m = await script("main", { shadow: true, backup: false });
    expect(b.reqs).toEqual(m.reqs);
  }, 60_000);
  it("on duty (shadow OFF, the Lenovo silent from the start): the same requests as main until the hand-back", async () => {
    const b = await script("branch", { shadow: false, backup: true, dutyFirst: true, untilHandBack: true });
    const m = await script("main", { shadow: false, backup: true, dutyFirst: true, untilHandBack: true });
    expect(b.S.onDuty).toBe(true);
    expect(b.reqs.filter((x) => x.endsWith(" store")).length).toBeGreaterThan(0);
    expect(b.reqs).toEqual(m.reqs);
    expect(b.S.writes.length).toBeGreaterThan(0);
    expect(writesOf(b)).toEqual(writesOf(m));
  }, 60_000);
  it("on duty with shadow ON before it: the same requests as main for the whole run", async () => {
    const b = await script("branch", { shadow: true, backup: true, dutyFirst: true });
    const m = await script("main", { shadow: true, backup: true, dutyFirst: true });
    expect(b.reqs).toEqual(m.reqs);
  }, 60_000);
  it("the only difference from main: shadow OFF + backup on as a follower (main sends nothing, the branch keeps the session)", async () => {
    const b = world({ which: "branch" }), m = world({ which: "main" });
    await b.run(HOUR); await m.run(HOUR);
    expect(m.reqs).toEqual([]);
    expect(count(b, "keepalive")).toBeGreaterThan(0);
  });
});

// ═══ S6 requests per simulated day (standby only) ═════════════════════════════════════════════════
describe("S6 one simulated day of standby", () => {
  it("about 288 keepalives + 1 open, nothing else", async () => {
    const w = world({ start: Date.parse("2026-11-20T16:00:00Z") });   // 00:00 Taipei
    await w.run(24 * HOUR);
    const out = { keepalive: count(w, "keepalive"), open: count(w, "open"), reload: count(w, "reload"), store: count(w, "store"), frozen: count(w, "frozen"),
      phone: w.phoneCheck.mock.calls.length, shadow: w.check.mock.calls.length, total: w.reqs.length };
    expect(out).toEqual({ keepalive: 288, open: 1, reload: 0, store: 0, frozen: 0, phone: 0, shadow: 0, total: 289 });
    if (process.env.SFL_STANDBY_TABLE) appendFileSync(process.env.SFL_STANDBY_TABLE, JSON.stringify({ day: out }) + "\n");
  }, 60_000);
});

// ═══ S7 the Admin card's "Store session" line (the card itself: components/__tests__/Pc711DutyCard.storeSession.test.tsx) ════════════════════════════════════════════════════
describe("S7 Store session: ready / opening / not ready", () => {
  it("the word", () => {
    expect(storeSessionWord("ok", true, false)).toBe("ready");
    expect(storeSessionWord("ok", false, true)).toBe("ready");
    for (const d of ["no_tab", "expired", "dead", "recovering", "guid_missing", "degraded", "stale"]) {
      expect(storeSessionWord(d, true, false)).toBe("opening");
      expect(storeSessionWord(d, false, false)).toBe("not_ready");
      expect(storeSessionWord(d, true, true)).toBe("not_ready");
    }
    expect(emapDerive(NOON, { present: false }, false)).toBe("no_tab");
  });
  it("the duty answer carries it only while the backup is on, and only one of the three words", async () => {
    expect(DUTY_STORE_SESSION).toEqual(["ready", "opening", "not_ready"]);
    expect(dutyAnswer({ enabled: true, storeSession: "ready" }).storeSession).toBe("ready");
    expect(dutyAnswer({ enabled: false, storeSession: "ready" }).storeSession).toBeNull();
    expect(dutyAnswer({ enabled: true, storeSession: "0912345678" }).storeSession).toBeNull();
    const db = { settings: async () => ({ enabled: "true", lease: null }), state: async () => null, dutyRows: async () => [], answeredPage: async () => [] };
    const r = createDutyReader({ db, storeSession: () => "opening", now: () => NOON });
    expect((await r.get()).storeSession).toBe("opening");
    const bad = createDutyReader({ db, storeSession: () => { throw new Error("x"); }, now: () => NOON });
    expect((await bad.get()).storeSession).toBeNull();
    expect(SERVER).toContain("pc711EmapForCard = pc711Emap;");
  });
});
