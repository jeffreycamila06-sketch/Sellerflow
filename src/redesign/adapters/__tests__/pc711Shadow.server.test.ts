// @vitest-environment node
// 7-11 server checker SHADOW (server/pc711Shadow.js): compares the server's answer with the Chrome
// extension's on parcels the extension already checked (store / phone / frozen). Every error and
// every mismatch says EXACTLY where it happened. Pins: words per kind; nothing when off / not
// connected; parcel_scans is only READ; one at a time, ≥ 3 s apart, ≤ 300 a day (all kinds);
// needs_login stops until the next connect; each failing step → its fail_step / http / reason with
// match NULL; a real difference → match false with raw + gap; steps JSON holds no data; frozen
// ext unknown → NULL (not counted); newest first; history filter + paging; errors by step; day
// totals; one log line per check with no data; the sql/159 mirror.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPc711Shadow, createShadowDb, shadowSummary, shadowHistory, totalsOf, dayWindow, toExtWord, noteWord, pickJobs, taipeiDay,
  shadowRow, shadowLogLine, safeSteps, failReasonOf,
  STORE_WORDS, PHONE_WORDS, FROZEN_WORDS, SHADOW_GAP_MS, SHADOW_DAY_MAX, SHADOW_LOOKBACK_MS, SHADOW_SWITCH, SHADOW_PAGE,
} from "../../../../server/pc711Shadow.js";

const NOW = Date.parse("2026-11-14T04:00:00Z"); // 12:00 Taipei
const PHONE = "0912345678", NAME = "陳小美", STORE = "123456", GUID = "MARKGUID-1234-5678";
const ago = (min: number, from = NOW) => new Date(from - min * 60_000).toISOString();
const scan = (id: string, o: Record<string, unknown> = {}) => ({
  id, store_id: STORE, phone: PHONE, customer_name: NAME,
  store_full_status: "open", store_full_at: ago(2), phone_check_status: "ok", phone_check_at: ago(3),
  frozen_store_status: null, frozen_store_checked_at: null, ...o,
});

// A fake Supabase that records every query (table + ops) and answers through `answer(table, ops)`.
type Op = [string, ...unknown[]];
function fakeSb(answer: (table: string, ops: Op[]) => unknown) {
  const queries: { table: string; ops: Op[] }[] = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    queries.push({ table, ops });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "or", "in", "gte", "lt", "eq", "is", "not", "order", "limit", "range", "update", "delete", "insert"]) {
      chain[m] = (...a: unknown[]) => { ops.push([m, ...a]); return chain; };
    }
    chain.upsert = (row: unknown, o?: unknown) => { ops.push(["upsert", row, o]); return Promise.resolve({ error: null }); };
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer(table, ops)).then(ok, bad);
    return chain;
  };
  return { sb: { from }, queries };
}
const has = (ops: Op[], m: string, ...a: unknown[]) => ops.some((o) => o[0] === m && a.every((x, i) => JSON.stringify(o[i + 1]) === JSON.stringify(x)));

// The job wired to the REAL createShadowDb on that fake.
const setup = (o: { scans?: unknown[]; done?: unknown[]; count?: number; on?: string; pc711?: unknown; check?: (i: { kind: string }) => Promise<unknown>; start?: number } = {}) => {
  const f = fakeSb((table, ops) => {
    if (table === "parcel_scans") return { data: o.scans ?? [scan("s1")], error: null };
    if (has(ops, "select", "id", { count: "exact", head: true })) return { count: o.count ?? 0, error: null };
    if (ops.some((x) => x[0] === "delete")) return { error: null };
    return { data: o.done ?? [], error: null };
  });
  const logs: string[] = [];
  const sleeps: number[] = [];
  let t = o.start ?? NOW;
  const ok = (i: { kind: string }) => ({ verdict: i.kind === "phone" ? "ok" : "open", http: 200, ms: 900, kind: "", raw: i.kind === "phone" ? "Status:true" : "enable", steps: [] });
  const check = vi.fn(o.check ?? (async (i: { kind: string }) => { t += 900; return ok(i); }));
  const job = createPc711Shadow({
    db: createShadowDb(f.sb as never), check: check as never, pc711: (o.pc711 ?? { status: () => ({ state: "connected", since: "2026-11-14T00:00:00Z" }) }) as never,
    readSetting: async (k: string) => (k === SHADOW_SWITCH ? (o.on ?? "true") : null),
    now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
  });
  const inserted = () => f.queries.filter((q) => q.table === "pc711_shadow").flatMap((q) => q.ops.filter((x) => x[0] === "upsert").map((x) => x[1] as Record<string, unknown>));
  return { job, check, logs, sleeps, queries: f.queries, inserted, advance: (ms: number) => { t += ms; } };
};

describe("server answer → the extension's words", () => {
  it("store / phone / frozen words kept, anything else → unknown", () => {
    for (const w of STORE_WORDS) expect(toExtWord("store", w)).toBe(w);
    for (const w of PHONE_WORDS) expect(toExtWord("phone", w)).toBe(w);
    for (const w of FROZEN_WORDS) expect(toExtWord("frozen", w)).toBe(w);
    expect(toExtWord("store", "ok")).toBe("unknown");
    expect(toExtWord("phone", "open")).toBe("unknown");
    expect(toExtWord("frozen", "full")).toBe("unknown");
    expect(noteWord("")).toBeNull();
  });
});

describe("which parcels (newest first)", () => {
  it("100 recent scans, the newest 3 not compared yet → exactly those 3", () => {
    const rows = Array.from({ length: 100 }, (_, i) => scan(`s${i}`, { store_full_at: new Date(NOW - (i + 1) * 15_000).toISOString(), phone_check_status: null }));
    const done = rows.slice(3).map((r) => ({ scan_id: r.id, kind: "store" }));
    expect(pickJobs(rows, done, NOW - SHADOW_LOOKBACK_MS, 3).map((j) => j.scanId)).toEqual(["s0", "s1", "s2"]);
  });
  it("store, phone and frozen jobs carry the extension's inputs; older than 30 min → skipped", () => {
    const jobs = pickJobs([scan("a", { frozen_store_status: "no_frozen", frozen_store_checked_at: ago(1), phone_check_at: ago(40) })], [], NOW - SHADOW_LOOKBACK_MS, 3);
    expect(jobs.map((j) => j.kind)).toEqual(["frozen", "store"]);
    expect(jobs[0]).toMatchObject({ ext: "no_frozen", input: { kind: "frozen", storeId: STORE } });
  });
  it("recentScans = one read per kind (≥ since, newest first, 30 each), merged by id", async () => {
    const f = fakeSb((_t, ops) => {
      const col = (ops.find((o) => o[0] === "gte") || [])[1];
      return { data: col === "store_full_at" ? [scan("a"), scan("b")] : col === "phone_check_at" ? [scan("b"), scan("c")] : [scan("d")], error: null };
    });
    const got = await createShadowDb(f.sb as never).recentScans(ago(30));
    expect(f.queries.map((q) => q.table)).toEqual(["parcel_scans", "parcel_scans", "parcel_scans"]);
    for (const [i, col] of ["store_full_at", "phone_check_at", "frozen_store_checked_at"].entries()) {
      const ops = f.queries[i].ops;
      expect(ops.some((o) => o[0] === "gte" && o[1] === col)).toBe(true);
      expect(ops.find((o) => o[0] === "order")).toEqual(["order", col, { ascending: false }]);
      expect(has(ops, "limit", 30)).toBe(true);
    }
    expect(got.map((r: { id: string }) => r.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("the job", () => {
  it("switch off / not connected → nothing checked, nothing written", async () => {
    const off = setup({ on: "false" });
    expect(await off.job.tick()).toEqual({ skipped: "off" });
    expect(off.queries).toEqual([]);
    for (const state of ["not_connected", "needs_login", "key_missing"]) {
      const s = setup({ pc711: { status: () => ({ state, since: null }) } });
      expect(await s.job.tick()).toEqual({ skipped: "not_connected" });
      expect(s.check).not.toHaveBeenCalled();
      expect(s.inserted()).toEqual([]);
    }
  });
  it("parcel_scans is only ever READ; rows carry no phone / name / store id", async () => {
    const s = setup({ scans: [scan("s1", { frozen_store_status: "ok", frozen_store_checked_at: ago(1) })] });
    await s.job.tick();
    expect(s.inserted()).toHaveLength(3);
    const onScans = s.queries.filter((q) => q.table === "parcel_scans");
    expect(onScans.length).toBe(3);
    for (const q of onScans) expect(q.ops.every((o) => ["select", "gte", "order", "limit"].includes(o[0]))).toBe(true);
    expect(s.queries.every((q) => q.table === "parcel_scans" || q.table === "pc711_shadow")).toBe(true);
    expect(JSON.stringify(s.inserted())).not.toMatch(new RegExp(`${PHONE}|${NAME}|${STORE}`));
  });
  it("one at a time; ≥ 3 s between checks", async () => {
    let released = false;
    let release!: () => void;
    const answer = { verdict: "open", http: 200, ms: 0, kind: "", steps: [] };
    const s = setup({ scans: [scan("s1", { phone_check_at: ago(90) }), scan("s2", { phone_check_at: ago(90) })],
      check: () => (released ? Promise.resolve(answer) : new Promise((r) => { release = () => { released = true; r(answer); }; })) });
    const first = s.job.tick();
    await vi.waitFor(() => expect(s.check).toHaveBeenCalledTimes(1));
    expect(await s.job.tick()).toEqual({ skipped: "running" });
    release();
    await first;
    expect(s.check).toHaveBeenCalledTimes(2);
    expect(s.sleeps).toEqual([SHADOW_GAP_MS]);
  });
  it(`${SHADOW_DAY_MAX} a Taipei day covers all three kinds (frozen included)`, async () => {
    const s = setup({ count: SHADOW_DAY_MAX - 1, scans: [scan("s1", { frozen_store_status: "ok", frozen_store_checked_at: ago(1) })] });
    expect(await s.job.tick()).toEqual({ checked: 1 });
    expect(s.check).toHaveBeenCalledWith({ kind: "frozen", storeId: STORE }); // the newest job used the last slot
    expect(await s.job.tick()).toEqual({ skipped: "day_max" });
    expect(s.check).toHaveBeenCalledTimes(1);
  });
  it("needs_login → one NULL row (login), stops until the next connect, then resumes", async () => {
    const pc = { since: "2026-11-14T00:00:00Z", status: () => ({ state: "connected", since: pc.since }) };
    let answer: Record<string, unknown> = { verdict: "unknown", http: 200, ms: 5, kind: "login_not_accepted", steps: [{ step: "store.cart", http: 200, ms: 5, ok: false, note: "kind=login_not_accepted" }] };
    const s = setup({ pc711: pc, check: async () => answer });
    await s.job.tick();
    expect(s.inserted()).toEqual([expect.objectContaining({ match: null, fail_step: "login", fail_reason: "needs_login" })]);
    expect(s.logs[0]).toMatch(/stop=needs_login$/);
    expect(await s.job.tick()).toEqual({ skipped: "stopped" });
    pc.since = "2026-11-14T03:00:00Z";
    answer = { verdict: "open", http: 200, ms: 5, kind: "", raw: "enable", steps: [] };
    s.advance(SHADOW_GAP_MS);
    expect((await s.job.tick()).checked).toBeGreaterThan(0);
  });
  it("01–05 Taipei keeps running, maint=1 in the log", async () => {
    const twoAm = Date.parse("2026-11-14T18:00:00Z");
    const s = setup({ start: twoAm, scans: [scan("s1", { store_full_at: ago(2, twoAm), phone_check_at: ago(3, twoAm) })] });
    await s.job.tick();
    expect(s.check).toHaveBeenCalled();
    expect(s.logs.every((l) => /maint=1/.test(l))).toBe(true);
  });
});

describe("every error says where it happened (match NULL)", () => {
  const job = { scanId: "s1", kind: "store", ext: "open", at: NOW - 120_000, input: {} };
  const okStep = (step: string) => ({ step, http: 200, path: "myship.7-11.com.tw/x", ms: 100, ok: true, note: `bytes=999 form=1 guid=${GUID} k=${STORE}` });
  const ORDER = ["store.cart", "store.detail", "store.map", "store.emap", "store.byid"];
  const cases: [string, string, number, string, string][] = [
    // [failing step, probe kind, http, expected fail_step, expected fail_reason]
    ["phone.token", "html", 200, "phone.token", "html"],
    ["phone.validate", "timeout", 0, "phone.validate", "timeout"],
    ["store.cart", "cart_form_missing", 200, "store.cart", "no_form"],
    ["store.detail", "http", 500, "store.detail", "http"],
    ["store.map", "map_form_missing", 200, "store.map", "no_form"],
    ["store.emap", "guid_missing", 200, "store.emap", "no_guid"],
    ["store.byid", "unexpected_answer", 200, "store.byid", "unexpected_answer"],
    ["frozen.byid", "timeout", 0, "frozen.byid", "timeout"],
    ["store.config", "bad_input", 0, "input", "bad_input"],
  ];
  it.each(cases)("%s fails (%s, http %i) → fail_step %s, fail_reason %s, its http, match NULL", (step, kind, http, failStep, reason) => {
    const upto = step === "frozen.byid" ? 4 : ORDER.indexOf(step);
    const before = upto > 0 ? ORDER.slice(0, upto).map(okStep) : [];
    const row = shadowRow(job, { verdict: "unknown", http, ms: 2000, kind, steps: [...before, { step, http, ms: 400, ok: false, note: `bytes=0 kind=${kind}` }] }, NOW);
    expect(row).toMatchObject({ match: null, fail_step: failStep, fail_http: http, fail_reason: reason, srv_verdict: "unknown", note: reason });
    expect((row.steps as unknown[]).length).toBe(before.length + 1);
  });
  it("a thrown check → fail_reason threw, match NULL", async () => {
    const s = setup({ scans: [scan("s1", { phone_check_at: ago(90) })], check: async () => { throw new Error("boom"); } });
    await s.job.tick();
    expect(s.inserted()).toEqual([expect.objectContaining({ kind: "store", match: null, fail_reason: "threw" })]);
    expect(s.logs[0]).toMatch(/match=err/);
  });
  it("a REAL different answer (server full, extension open) → match false, with raw + gap", () => {
    const row = shadowRow(job, { verdict: "full", http: 200, ms: 1800, kind: "", raw: "disable", steps: [okStep("store.byid")] }, NOW + 180_000);
    expect(row).toMatchObject({ match: false, ext_verdict: "open", srv_verdict: "full", raw: "disable", gap_s: 300, fail_step: null, fail_http: null, fail_reason: null });
  });
  it("steps JSON: step name / http / ms / ok / one word — never a phone, name, store id, guid, path or page text", () => {
    const steps = safeSteps([
      { step: "store.cart", http: 200, path: `myship.7-11.com.tw/cart/easy/GM123?x=${PHONE}`, ms: 120.4, ok: true, note: `bytes=1 ${PHONE} ${NAME} k=${STORE} guid=${GUID}` },
      { step: "store.emap", http: 200, path: "emap.pcsc.com.tw/ecmap/default.aspx", ms: 80, ok: false, note: `bytes=1 guid=0 kind=guid_missing ${STORE}` },
      { step: "evil", http: 999, ms: 1, ok: false, note: PHONE },          // a bare number is never kept as the word
    ]);
    expect(steps).toEqual([
      { s: "store.cart", http: 200, ms: 120, ok: true },
      { s: "store.emap", http: 200, ms: 80, ok: false, w: "guid_missing" },
      { s: "other", http: 999, ms: 1, ok: false },
    ]);
    const json = JSON.stringify(steps);
    for (const bad of [PHONE, NAME, STORE, GUID, "myship", "emap.", "?", "bytes"]) expect(json).not.toContain(bad);
  });
  it("frozen: the extension's own word unknown → still checked, match NULL, note ext_unknown, not an error", () => {
    const row = shadowRow({ scanId: "s1", kind: "frozen", ext: "unknown", at: NOW, input: {} }, { verdict: "no_frozen", http: 200, ms: 900, kind: "", raw: "disable", steps: [] }, NOW);
    expect(row).toMatchObject({ match: null, note: "ext_unknown", fail_step: null, fail_reason: null, srv_verdict: "no_frozen", raw: "disable" });
    const t = totalsOf([{ kind: "frozen", match: null, fail_reason: null, srv_ms: 900 }, { kind: "frozen", match: true, srv_ms: 800 }]);
    expect(t.frozen).toEqual({ n: 1, matchPct: 100, errors: 0 });
    expect(t.errors).toBe(0);
    expect(shadowLogLine(row, false)).toMatch(/match=skip/);
  });
  it("one log line per check, no data", () => {
    const err = shadowRow(job, { verdict: "unknown", http: 0, ms: 4000, kind: "timeout", steps: [{ step: "store.emap", http: 0, ms: 4000, ok: false, note: "kind=timeout" }] }, NOW);
    expect(shadowLogLine(err, false)).toBe("[PC711_SHADOW] kind=store match=err step=store.emap http=0 ms=4000 gap=120 maint=0");
    const ok = shadowRow(job, { verdict: "open", http: 200, ms: 900, kind: "", raw: "enable", steps: [] }, NOW);
    expect(shadowLogLine(ok, true)).toBe("[PC711_SHADOW] kind=store match=1 step=- http=200 ms=900 gap=120 maint=1");
  });
  it("probe kinds → one reason word", () => {
    expect(failReasonOf("cart_form_missing")).toBe("no_form");
    expect(failReasonOf("no_session")).toBe("needs_login");
    expect(failReasonOf("weird kind!")).toBe("weirdkind");
  });
});

describe("admin reads", () => {
  it("today: compared / match % per kind (NULL excluded) / errors per kind / avg ms (real answers) / errors by step", () => {
    const t = totalsOf([
      { kind: "store", match: true, srv_ms: 1000 }, { kind: "store", match: false, srv_ms: 1000 },
      { kind: "store", match: null, srv_ms: 9000, fail_step: "store.emap", fail_reason: "no_guid" },
      { kind: "store", match: null, srv_ms: 9000, fail_step: "store.emap", fail_reason: "timeout" },
      { kind: "phone", match: true, srv_ms: 400 }, { kind: "phone", match: null, srv_ms: 5000, fail_step: "phone.token", fail_reason: "html" },
      { kind: "frozen", match: false, srv_ms: 1600 },
    ]);
    expect(t.store).toEqual({ n: 2, matchPct: 50, errors: 2 });
    expect(t.phone).toEqual({ n: 1, matchPct: 100, errors: 1 });
    expect(t.frozen).toEqual({ n: 1, matchPct: 0, errors: 0 });
    expect(t.avgMs).toBe(1000);
    expect(t.errorsByStep).toEqual({ "store.emap": 2, "phone.token": 1 });
    expect(t.errors).toBe(3);
  });
  it("summary reads today's rows (Taipei day)", async () => {
    const f = fakeSb(() => ({ data: [{ at: ago(1), kind: "store", match: true, srv_ms: 1000 }], error: null }));
    const out = await shadowSummary(createShadowDb(f.sb as never), async () => "true", NOW);
    expect(out.enabled).toBe(true);
    expect(out.today.compared).toBe(1);
    expect(has(f.queries[0].ops, "gte", "at", taipeiDay(NOW).startIso)).toBe(true);
  });
  it("history query: filter, kind, newest first, a page of 20 (+1 to know there is more)", async () => {
    const f = fakeSb(() => ({ data: [], error: null }));
    const db = createShadowDb(f.sb as never);
    await db.history("A", "B", "mismatch", 2, "frozen");
    await db.history("A", "B", "error", 0, "all");
    const [mis, err] = f.queries.map((q) => q.ops);
    expect(has(mis, "eq", "match", false)).toBe(true);
    expect(has(mis, "eq", "kind", "frozen")).toBe(true);
    expect(mis.find((o) => o[0] === "range")).toEqual(["range", 40, 60]);
    expect(has(err, "not", "fail_reason", "is", null)).toBe(true);
    expect(err.some((o) => o[0] === "eq" && o[1] === "kind")).toBe(false);
    expect(mis.find((o) => o[0] === "order")).toEqual(["order", "at", { ascending: false }]);
  });
  it("history: 21 rows → 20 shown + more; results / per-day totals; no ids", async () => {
    const base = Date.parse("2026-11-14T02:00:00Z");
    const rows = Array.from({ length: 21 }, (_, i) => ({
      at: new Date(base - i * 3600_000).toISOString(), kind: i % 3 === 0 ? "frozen" : "store", scan_id: "SECRET-ID",
      ext_verdict: "open", srv_verdict: i % 2 ? "full" : "open", raw: "disable", gap_s: 120, match: i === 4 ? null : i % 2 === 0,
      fail_step: i === 4 ? "store.emap" : null, fail_http: i === 4 ? 0 : null, fail_reason: i === 4 ? "timeout" : null, srv_ms: 1000,
      steps: [{ s: "store.cart", http: 200, ms: 100, ok: true }],
    }));
    const db = {
      history: vi.fn(async () => rows),
      rowsBetween: vi.fn(async () => rows.map((r) => ({ at: r.at, kind: r.kind, match: r.match, srv_ms: r.srv_ms, fail_step: r.fail_step, fail_reason: r.fail_reason }))),
    };
    const out = await shadowHistory(db as never, { day: "7days", filter: "all", page: 0, kind: "all" }, NOW);
    expect(out.more).toBe(true);
    expect(out.rows).toHaveLength(SHADOW_PAGE);
    expect(out.rows[4]).toMatchObject({ result: "error", failStep: "store.emap", failReason: "timeout", failHttp: 0 });
    expect(out.rows[1]).toMatchObject({ result: "mismatch", ext: "open", srv: "full", raw: "disable", gapS: 120 });
    expect(out.rows[0]).toMatchObject({ result: "match", kind: "frozen" });
    expect(Object.keys(out.days).sort()).toEqual(["2026-11-13", "2026-11-14"]);
    expect(out.days["2026-11-14"]).toEqual({ compared: 10, matchPct: 50, errors: 1 }); // 06:00 Taipei had the store.emap timeout
    expect(out.days["2026-11-13"].errors).toBe(0);
    expect(JSON.stringify(out)).not.toContain("SECRET-ID");
  });
  it("day windows (Taipei days): today / yesterday / 2 days ago / last 7 days / all 30 days", () => {
    const start = taipeiDay(NOW).startMs;
    expect(dayWindow("today", NOW)).toEqual({ from: start, to: NOW + 1 });
    expect(dayWindow("yesterday", NOW)).toEqual({ from: start - 86400_000, to: start });
    expect(dayWindow("2days", NOW)).toEqual({ from: start - 2 * 86400_000, to: start - 86400_000 });
    expect(dayWindow("7days", NOW).from).toBe(start - 6 * 86400_000);
    expect(dayWindow("30days", NOW).from).toBe(NOW - 30 * 86400_000);
  });
});

describe("wiring + sql/159", () => {
  it("server.js: probe in target mode (silent), admin-only summary + history routes", () => {
    const src = readFileSync(new URL("../../../../server.js", import.meta.url), "utf8");
    expect(src).toMatch(/target: input, gate: false, log: \(\) => \{\}/);
    expect(src).toContain('app.get("/admin/pc711/shadow", requireAuth, requireAdmin,');
    expect(src).toContain('app.get("/admin/pc711/shadow/history", requireAuth, requireAdmin,');
  });
  it("the shadow module never writes parcel_scans and never touches /cart/finish", () => {
    const src = readFileSync(new URL("../../../../server/pc711Shadow.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/parcel_scans"\)[^;]*\.(insert|update|upsert|delete)\(/);
    expect(src).not.toMatch(/cart\/finish/);
  });
  it("sql/159: the columns (no personal data), kinds, steps / raw checks, RLS, service_role only, switch off", () => {
    const sql = readFileSync(new URL("../../../../sql/159_pc711_shadow.sql", import.meta.url), "utf8");
    const table = sql.slice(sql.indexOf("create table"), sql.indexOf("\n);", sql.indexOf("create table")));
    const cols = table.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((c) => /^[a-z_]+$/.test(c) && !["create", "unique"].includes(c));
    expect(cols).toEqual(["id", "scan_id", "at", "kind", "ext_verdict", "srv_verdict", "srv_ms", "srv_http", "match", "note", "fail_step", "fail_http", "fail_reason", "steps", "gap_s", "raw"]);
    expect(table).toContain("check (kind in ('store', 'phone', 'frozen'))");
    expect(table).toContain("'frozen.byid'");
    expect(table).toContain("fail_reason ~ '^[a-z0-9_]{0,32}$'");
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    for (const r of ["public", "anon", "authenticated"]) expect(sql).toContain(`revoke all on table public.pc711_shadow from ${r};`);
    expect(sql).toContain("grant all on table public.pc711_shadow to service_role;");
    expect(sql).toMatch(/\('pc711_shadow_enabled', 'false'\)/);
  });
});
