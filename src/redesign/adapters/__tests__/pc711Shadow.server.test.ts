// @vitest-environment node
// 7-11 server checker SHADOW (server/pc711Shadow.js): compares the server's answer with the Chrome
// extension's on parcels the extension already checked. Pins: server → extension words; nothing
// when the switch is off or the 7-11 login is not connected; parcel_scans is only READ; one check
// at a time, ≥ 3 s apart, ≤ 300 a day; needs_login stops it until the next connect; logs carry no
// phone / store id / name; the admin summary; the sql/159 mirror.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPc711Shadow, createShadowDb, shadowSummary, toExtWord, noteWord, pickJobs, taipeiDay,
  STORE_WORDS, PHONE_WORDS, SHADOW_GAP_MS, SHADOW_DAY_MAX, SHADOW_LOOKBACK_MS, SHADOW_SWITCH,
} from "../../../../server/pc711Shadow.js";

const NOW = Date.parse("2026-11-14T04:00:00Z"); // 12:00 Taipei
const PHONE = "0912345678", NAME = "陳小美", STORE = "123456";
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const scan = (id: string, o: Record<string, unknown> = {}) => ({
  id, store_id: STORE, phone: PHONE, customer_name: NAME,
  store_full_status: "open", store_full_at: ago(2), phone_check_status: "ok", phone_check_at: ago(3), ...o,
});

// A fake Supabase that records every call (table + method) — the job's db is the REAL createShadowDb.
function fakeSb(o: { scans?: unknown[]; done?: unknown[]; count?: number; rows?: unknown[]; mis?: unknown[] } = {}) {
  const calls: { table: string; op: string; arg?: unknown }[] = [];
  const inserted: Record<string, unknown>[] = [];
  const from = (table: string) => {
    const q: Record<string, unknown> = {};
    let op = "select";
    const result = () => {
      if (table === "parcel_scans") return { data: o.scans ?? [], error: null };
      if (op === "count") return { count: o.count ?? 0, error: null };
      if (op === "mismatch") return { data: o.mis ?? [], error: null };
      if (op === "rows") return { data: o.rows ?? [], error: null };
      return { data: o.done ?? [], error: null };
    };
    const chain = {
      select: (cols: string, opt?: { count?: string }) => { calls.push({ table, op: "select", arg: cols }); if (opt?.count) op = "count"; if (cols === "kind,match,srv_ms") op = "rows"; if (cols === "kind,ext_verdict,srv_verdict,at") op = "mismatch"; return chain; },
      or: () => chain, in: () => chain, gte: () => chain, lt: () => chain, eq: () => chain, order: () => chain, limit: () => chain,
      upsert: (row: Record<string, unknown>) => { calls.push({ table, op: "upsert", arg: row }); inserted.push(row); return Promise.resolve({ error: null }); },
      insert: (row: unknown) => { calls.push({ table, op: "insert", arg: row }); return Promise.resolve({ error: null }); },
      update: (row: unknown) => { calls.push({ table, op: "update", arg: row }); return chain; },
      delete: () => { calls.push({ table, op: "delete" }); return chain; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
    };
    void q;
    return chain;
  };
  return { sb: { from }, calls, inserted };
}

const connected = (since = "2026-11-14T00:00:00Z") => ({ status: vi.fn(() => ({ state: "connected", since })) });
const setup = (o: { scans?: unknown[]; done?: unknown[]; count?: number; on?: string; pc711?: unknown; check?: (i: unknown) => Promise<unknown> } = {}) => {
  const f = fakeSb({ scans: o.scans ?? [scan("s1")], done: o.done, count: o.count });
  const logs: string[] = [];
  const sleeps: number[] = [];
  let t = NOW;
  const check = vi.fn(o.check ?? (async (i: { kind: string }) => { t += 900; return { verdict: i.kind === "store" ? "open" : "ok", http: 200, ms: 900, kind: "" }; }));
  const readSetting = vi.fn(async (k: string) => (k === SHADOW_SWITCH ? (o.on ?? "true") : null));
  const job = createPc711Shadow({
    db: createShadowDb(f.sb as never), check, pc711: (o.pc711 ?? connected()) as never, readSetting,
    now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
  });
  return { job, check, logs, sleeps, ...f, advance: (ms: number) => { t += ms; } };
};

describe("server answer → the extension's words", () => {
  it("store: open / full / company / not_found / unknown kept; anything else → unknown", () => {
    for (const w of STORE_WORDS) expect(toExtWord("store", w)).toBe(w);
    for (const w of ["", "enable", "FULL", "ok", undefined, null]) expect(toExtWord("store", w)).toBe("unknown");
  });
  it("phone: ok / restricted / unknown kept; anything else → unknown", () => {
    for (const w of PHONE_WORDS) expect(toExtWord("phone", w)).toBe(w);
    for (const w of ["open", "Restricted", "", null]) expect(toExtWord("phone", w)).toBe("unknown");
  });
  it("note is one short safe word", () => {
    expect(noteWord("timeout")).toBe("timeout");
    expect(noteWord("")).toBeNull();
    expect(noteWord("0912345678 abc")).toBe("0912345678abc".slice(0, 32)); // only [a-z0-9_] survive (never a sentence)
  });
});

describe("which parcels", () => {
  it("only verdicts written in the last 30 min, not compared yet, newest first, at most 3", () => {
    const rows = [
      scan("a", { store_full_at: ago(1), phone_check_at: ago(40) }),          // phone too old
      scan("b", { store_full_at: ago(5), phone_check_at: ago(6) }),
      scan("c", { store_full_status: null, phone_check_at: ago(2) }),
      scan("d", { store_full_at: ago(31), phone_check_at: ago(31) }),         // both too old
    ];
    const jobs = pickJobs(rows, [{ scan_id: "b", kind: "store" }], NOW - SHADOW_LOOKBACK_MS, 3);
    expect(jobs.map((j) => `${j.scanId}:${j.kind}`)).toEqual(["a:store", "c:phone", "b:phone"]);
    expect(jobs[1].input).toEqual({ kind: "phone", phone: PHONE, name: NAME, storeId: STORE });
    expect(jobs[0].input).toEqual({ kind: "store", storeId: STORE });
  });
});

describe("the job", () => {
  it("switch off → nothing checked, nothing written", async () => {
    const s = setup({ on: "false" });
    expect(await s.job.tick()).toEqual({ skipped: "off" });
    expect(s.check).not.toHaveBeenCalled();
    expect(s.calls).toEqual([]);
  });
  it("7-11 login not connected → nothing checked, nothing written", async () => {
    for (const state of ["not_connected", "needs_login", "key_missing"]) {
      const s = setup({ pc711: { status: () => ({ state, since: null }) } });
      expect(await s.job.tick()).toEqual({ skipped: "not_connected" });
      expect(s.check).not.toHaveBeenCalled();
      expect(s.inserted).toEqual([]);
    }
  });
  it("compares and writes one row per (parcel, kind); parcel_scans is only ever READ", async () => {
    const s = setup({ scans: [scan("s1", { phone_check_status: "restricted" })] });
    expect(await s.job.tick()).toEqual({ checked: 2 });
    expect(s.check).toHaveBeenCalledWith({ kind: "store", storeId: STORE });
    expect(s.check).toHaveBeenCalledWith({ kind: "phone", phone: PHONE, name: NAME, storeId: STORE });
    expect(s.inserted).toEqual([
      { scan_id: "s1", kind: "store", ext_verdict: "open", srv_verdict: "open", srv_ms: 900, srv_http: 200, match: true, note: null },
      { scan_id: "s1", kind: "phone", ext_verdict: "restricted", srv_verdict: "ok", srv_ms: 900, srv_http: 200, match: false, note: null },
    ]);
    const onScans = s.calls.filter((c) => c.table === "parcel_scans");
    expect(onScans.length).toBeGreaterThan(0);
    expect(onScans.every((c) => c.op === "select")).toBe(true);
    expect(s.calls.every((c) => c.table === "parcel_scans" || c.table === "pc711_shadow")).toBe(true);
    // the rows hold no phone / name / store id
    expect(JSON.stringify(s.inserted)).not.toMatch(new RegExp(`${PHONE}|${NAME}|${STORE}`));
  });
  it("one at a time: a second tick while one runs does nothing", async () => {
    let released = false;
    let release!: () => void;
    const s = setup({ check: () => (released ? Promise.resolve({ verdict: "open", http: 200, ms: 1, kind: "" })
      : new Promise((r) => { release = () => { released = true; r({ verdict: "open", http: 200, ms: 1, kind: "" }); }; })) });
    const first = s.job.tick();
    await vi.waitFor(() => expect(s.check).toHaveBeenCalledTimes(1));
    expect(await s.job.tick()).toEqual({ skipped: "running" });
    release();
    await first;
  });
  it("at least 3 s between 7-11 checks", async () => {
    const s = setup({ scans: [scan("s1"), scan("s2", { store_full_at: ago(4), phone_check_at: ago(5) })], check: async () => ({ verdict: "open", http: 200, ms: 0, kind: "" }) });
    await s.job.tick();
    expect(s.check).toHaveBeenCalledTimes(3);
    expect(s.sleeps).toEqual([SHADOW_GAP_MS, SHADOW_GAP_MS]); // checks take 0 ms here → the full 3 s each time
  });
  it(`at most ${SHADOW_DAY_MAX} checks a Taipei day (counted from today's rows)`, async () => {
    const s = setup({ count: SHADOW_DAY_MAX - 1 });
    expect(await s.job.tick()).toEqual({ checked: 1 });
    expect(await s.job.tick()).toEqual({ skipped: "day_max" });
    expect(s.check).toHaveBeenCalledTimes(1);
  });
  it("01–05 Taipei keeps running, with a maint marker in the log", async () => {
    const twoAm = Date.parse("2026-11-14T18:00:00Z"); // 02:00 Taipei
    const near = (min: number) => new Date(twoAm - min * 60_000).toISOString();
    const s = setup({ scans: [scan("s1", { store_full_at: near(2), phone_check_at: near(3) })] });
    s.advance(twoAm - NOW);
    await s.job.tick();
    expect(s.check).toHaveBeenCalled();
    expect(s.logs.every((l) => l.endsWith("maint=1"))).toBe(true);
  });
  it("needs_login → stops (no row) until the next connect; then resumes", async () => {
    const pc = { since: "2026-11-14T00:00:00Z", status: () => ({ state: "connected", since: pc.since }) };
    let answer = { verdict: "unknown", http: 200, ms: 5, kind: "login_not_accepted" };
    const s = setup({ pc711: pc, check: async () => answer });
    await s.job.tick();
    expect(s.check).toHaveBeenCalledTimes(1);
    expect(s.inserted).toHaveLength(1);
    expect(s.inserted[0]).toMatchObject({ match: null, note: "needs_login" }); // not a mismatch
    expect(s.logs.some((l) => l.includes("stop=needs_login"))).toBe(true);
    expect(await s.job.tick()).toEqual({ skipped: "stopped" });
    expect(s.check).toHaveBeenCalledTimes(1);
    pc.since = "2026-11-14T03:00:00Z"; // a new connect
    answer = { verdict: "open", http: 200, ms: 5, kind: "" };
    s.advance(SHADOW_GAP_MS);
    expect((await s.job.tick()).checked).toBeGreaterThan(0);
    expect(s.inserted.some((r) => r.match === true)).toBe(true);
  });
  it("log lines: [PC711_SHADOW] kind=… match=0/1 ms=… http=… — never a phone, store id or name", async () => {
    const s = setup({ scans: [scan("s1", { phone_check_status: "restricted" })] });
    await s.job.tick();
    expect(s.logs).toHaveLength(2);
    for (const l of s.logs) {
      expect(l).toMatch(/^\[PC711_SHADOW\] kind=(store|phone) match=[01] ms=\d+ http=\d+ maint=[01]$/);
      expect(l).not.toContain(PHONE);
      expect(l).not.toContain(STORE);
      expect(l).not.toContain(NAME);
      expect(l).not.toContain("s1");
    }
  });
});

describe("server errors are not mismatches", () => {
  const cases: [string, (i: unknown) => Promise<unknown>, string][] = [
    ["thrown", async () => { throw new Error("boom"); }, "error"],
    ["timed out", async () => ({ verdict: "unknown", http: 0, ms: 4000, kind: "timeout" }), "timeout"],
    ["http 500", async () => ({ verdict: "unknown", http: 500, ms: 300, kind: "http" }), "http"],
    ["bad input", async () => ({ verdict: "unknown", http: 0, ms: 0, kind: "bad_input" }), "bad_input"],
    ["unexpected answer", async () => ({ verdict: "unknown", http: 200, ms: 900, kind: "unexpected_answer" }), "unexpected_answer"],
  ];
  it.each(cases)("%s → match NULL, note = the kind", async (_label, check, note) => {
    const s = setup({ scans: [scan("s1", { phone_check_at: ago(90) })], check: check as never }); // store job only
    await s.job.tick();
    expect(s.inserted).toEqual([expect.objectContaining({ scan_id: "s1", kind: "store", srv_verdict: "unknown", match: null, note })]);
    expect(s.logs[0]).toMatch(new RegExp(`^\\[PC711_SHADOW\\] kind=store match=- err=${note} ms=\\d+ http=\\d+ maint=[01]$`));
  });
  it("a REAL answer that differs (server full, extension open) is still a mismatch (match false)", async () => {
    const s = setup({ scans: [scan("s1", { phone_check_at: ago(90) })], check: async () => ({ verdict: "full", http: 200, ms: 800, kind: "" }) });
    await s.job.tick();
    expect(s.inserted).toEqual([expect.objectContaining({ kind: "store", ext_verdict: "open", srv_verdict: "full", match: false, note: null })]);
  });
  it("summary: match % = true / (true + false); NULL rows left out and counted as server errors per kind", async () => {
    const f = fakeSb({ rows: [
      { kind: "store", match: true, srv_ms: 1000 }, { kind: "store", match: false, srv_ms: 1000 },
      { kind: "store", match: null, srv_ms: 9000 }, { kind: "store", match: null, srv_ms: 9000 },
      { kind: "phone", match: true, srv_ms: 400 }, { kind: "phone", match: null, srv_ms: 5000 },
    ] });
    const out = await shadowSummary(createShadowDb(f.sb as never), async () => "true", NOW);
    expect(out.today.store).toEqual({ n: 2, matchPct: 50, errors: 2 });
    expect(out.today.phone).toEqual({ n: 1, matchPct: 100, errors: 1 });
    expect(out.today.avgMs).toBe(800); // real answers only (1000, 1000, 400)
    expect(out.today.n).toBe(6);
  });
});

describe("newest first", () => {
  it("100 recent scans, the newest 3 not compared yet → exactly those 3 are picked", () => {
    const rows = Array.from({ length: 100 }, (_, i) => scan(`s${i}`, { store_full_at: new Date(NOW - (i + 1) * 15_000).toISOString(), phone_check_status: null }));
    const done = rows.slice(3).map((r) => ({ scan_id: r.id, kind: "store" }));
    const jobs = pickJobs(rows, done, NOW - SHADOW_LOOKBACK_MS, 3);
    expect(jobs.map((j) => j.scanId)).toEqual(["s0", "s1", "s2"]);
  });
  it("recentScans = two reads (store_full_at / phone_check_at ≥ since, newest first, 30 each), merged by id", async () => {
    const q: { gte?: string; order?: string; asc?: boolean; limit?: number }[] = [];
    const sb = { from: (table: string) => {
      expect(table).toBe("parcel_scans");
      const me: { gte?: string; order?: string; asc?: boolean; limit?: number } = {};
      q.push(me);
      const chain = {
        select: () => chain,
        gte: (col: string) => { me.gte = col; return chain; },
        order: (col: string, o: { ascending: boolean }) => { me.order = col; me.asc = o.ascending; return chain; },
        limit: (n: number) => { me.limit = n; return Promise.resolve({ data: me.gte === "store_full_at" ? [scan("a"), scan("b")] : [scan("b"), scan("c")], error: null }); },
      };
      return chain;
    } };
    const got = await createShadowDb(sb as never).recentScans(ago(30));
    expect(q).toEqual([{ gte: "store_full_at", order: "store_full_at", asc: false, limit: 30 }, { gte: "phone_check_at", order: "phone_check_at", asc: false, limit: 30 }]);
    expect(got.map((r: { id: string }) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("admin summary", () => {
  it("today's compared / match % per kind / server average ms + the last mismatches (no ids)", async () => {
    const f = fakeSb({
      rows: [{ kind: "store", match: true, srv_ms: 1000 }, { kind: "store", match: false, srv_ms: 2000 }, { kind: "phone", match: true, srv_ms: 600 }],
      mis: [{ kind: "store", ext_verdict: "open", srv_verdict: "full", at: "2026-11-14T03:05:00Z", scan_id: "SECRET" }],
    });
    const out = await shadowSummary(createShadowDb(f.sb as never), async () => "true", NOW);
    expect(out).toEqual({
      enabled: true,
      today: { n: 3, store: { n: 2, matchPct: 50, errors: 0 }, phone: { n: 1, matchPct: 100, errors: 0 }, avgMs: 1200 },
      mismatches: [{ kind: "store", ext: "open", srv: "full", at: "2026-11-14T03:05:00Z" }],
    });
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });
  it("Taipei day start", () => {
    expect(taipeiDay(NOW)).toEqual({ key: "2026-11-14", startIso: "2026-11-13T16:00:00.000Z" });
  });
});

describe("wiring + sql/159", () => {
  it("server.js runs the probe in target mode, silent log, admin-only summary route", () => {
    const src = readFileSync(new URL("../../../../server.js", import.meta.url), "utf8");
    expect(src).toMatch(/target: input, gate: false, log: \(\) => \{\}/);
    expect(src).toContain('app.get("/admin/pc711/shadow", requireAuth, requireAdmin,');
    expect(src).toContain("createPc711Shadow({ db: pc711ShadowDb, check: pc711ShadowCheck, pc711, readSetting }).start()");
  });
  it("the shadow module never names parcel_scans in a write and never touches /cart/finish", () => {
    const src = readFileSync(new URL("../../../../server/pc711Shadow.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/parcel_scans"\)\s*\.(insert|update|upsert|delete)/);
    expect(src).not.toMatch(/cart\/finish/);
  });
  it("sql/159: table with no personal columns, RLS on, no policies, service_role only; switch off", () => {
    const sql = readFileSync(new URL("../../../../sql/159_pc711_shadow.sql", import.meta.url), "utf8");
    const table = sql.slice(sql.indexOf("create table"), sql.indexOf(");", sql.indexOf("create table")));
    const cols = table.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c) && c !== "create" && c !== "unique");
    expect(cols).toEqual(["id", "scan_id", "at", "kind", "ext_verdict", "srv_verdict", "srv_ms", "srv_http", "match", "note"]);
    expect(table).toMatch(/unique \(scan_id, kind\)/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    for (const r of ["public", "anon", "authenticated"]) expect(sql).toContain(`revoke all on table public.pc711_shadow from ${r};`);
    expect(sql).toContain("grant all on table public.pc711_shadow to service_role;");
    expect(sql).toMatch(/\('pc711_shadow_enabled', 'false'\)/);
  });
});
