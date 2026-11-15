// @vitest-environment node
// 7-11 server checker SHADOW (server/pc711Shadow.js): the extension's whole-day job, same rules and
// timing. Pins: every mirrored number = chrome-extension/background.js's constant; the queue (sql/162
// RPC) oldest first, ≤ 5 a pass, 25 fetched to look past backoff, 2 s apart, one at a time, no daily
// cap; the failure ladders (store/frozen 15·30·60·120 s, phone 5·10·20·60·120 s, then the error row);
// 01–05 Taipei not counted + 10 min retry + catch-up after 05:00; the safety brake (5 refusals → 15 min,
// ONE paused_http row); Waiting + per-day max; needs_login stop; nothing written to parcel_scans; no
// data in rows / logs; history + totals; the sql/159 + sql/162 mirrors.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPc711Shadow, createShadowDb, shadowSummary, shadowHistory, totalsOf, dayWindow, toExtWord, noteWord, taipeiDay,
  shadowRow, shadowLogLine, safeSteps, failReasonOf, jobsFromPending, selectJobs, inShadowMaint, isRefusal, ladderFor,
  STORE_WORDS, PHONE_WORDS, FROZEN_WORDS, SHADOW_SWITCH, SHADOW_PAGE,
  SHADOW_POLL_MS, SHADOW_LIMIT, SHADOW_FETCH_LIMIT, SHADOW_ROW_GAP_MS, SHADOW_LOOKBACK_MS, SHADOW_MAINT_RETRY_MS,
  SHADOW_MAINT_START_H, SHADOW_MAINT_END_H, SHADOW_STORE_BACKOFF_MS, SHADOW_PHONE_BACKOFF_MS, SHADOW_BRAKE_ERRORS, SHADOW_BRAKE_PAUSE_MS,
} from "../../../../server/pc711Shadow.js";
import * as shadowMod from "../../../../server/pc711Shadow.js";

const NOW = Date.parse("2026-11-14T04:00:00Z"); // 12:00 Taipei
const PHONE = "0912345678", NAME = "陳小美", STORE = "123456", GUID = "MARKGUID-1234-5678";
const ago = (min: number, from = NOW) => new Date(from - min * 60_000).toISOString();
let seq = 0;
const pend = (kind: string, minAgo: number, o: Record<string, unknown> = {}) => ({
  scan_id: `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`, kind, ext: kind === "phone" ? "ok" : kind === "frozen" ? "no_frozen" : "open",
  at: ago(minAgo), store_id: STORE, phone: kind === "phone" ? PHONE : null, customer_name: kind === "phone" ? NAME : null, ...o,
});

// A fake Supabase that records every query (table / rpc + ops). The pending RPC is answered from
// `queue` minus the parcels that got a pc711_shadow row (= sql/162's anti-join), oldest first.
type Op = [string, ...unknown[]];
function fakeSb(o: { queue?: Record<string, unknown>[]; answer?: (table: string, ops: Op[]) => unknown; pendingError?: boolean; stored?: Record<string, number> } = {}) {
  const queries: { table: string; ops: Op[] }[] = [];
  const rows: Record<string, unknown>[] = [];
  const days: Record<string, number> = { ...(o.stored || {}) };
  const from = (table: string) => {
    const ops: Op[] = [];
    queries.push({ table, ops });
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "or", "in", "gte", "lt", "eq", "is", "not", "order", "limit", "range", "update", "delete", "insert"]) {
      chain[m] = (...a: unknown[]) => { ops.push([m, ...a]); return chain; };
    }
    chain.upsert = (row: Record<string, unknown>, opt?: unknown) => {
      ops.push(["upsert", row, opt]);
      if (table === "pc711_shadow") rows.push(row);
      if (table === "pc711_shadow_days") days[String(row.day)] = Number(row.max_waiting);
      return Promise.resolve({ error: null });
    };
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
      const v = o.answer ? o.answer(table, ops) : table === "pc711_shadow_days" && ops[0]?.[0] === "select"
        ? { data: Object.entries(days).map(([day, max_waiting]) => ({ day, max_waiting })), error: null }
        : { data: [], error: null };
      return Promise.resolve(v).then(ok, bad);
    };
    return chain;
  };
  const rpc = (fn: string, args: { p_since: string; p_limit: number }) => {
    queries.push({ table: `rpc:${fn}`, ops: [["rpc", args]] });
    if (o.pendingError) return Promise.resolve({ data: null, error: { message: "no function" } });
    const done = new Set(rows.map((r) => `${r.scan_id}:${r.kind}`));
    const w = (o.queue || []).filter((j) => !done.has(`${j.scan_id}:${j.kind}`) && Date.parse(String(j.at)) >= Date.parse(args.p_since))
      .sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)));
    return Promise.resolve({ data: { waiting: w.length, jobs: w.slice(0, Math.min(args.p_limit, 50)) }, error: null });
  };
  return { sb: { from, rpc }, queries, rows, days };
}

const has = (ops: Op[], m: string, ...a: unknown[]) => ops.some((o) => o[0] === m && a.every((x, i) => JSON.stringify(o[i + 1]) === JSON.stringify(x)));

// The job wired to the REAL createShadowDb on that fake; a virtual clock.
type Check = (i: { kind: string; storeId?: string }) => Promise<unknown>;
const OK = (i: { kind: string }) => ({ verdict: i.kind === "phone" ? "ok" : i.kind === "frozen" ? "no_frozen" : "open", http: 200, ms: 900, kind: "", raw: i.kind === "phone" ? "Status:true" : "enable", steps: [] });
const FAIL = (http = 0, kind = "timeout", step = "store.byid") => ({ verdict: "unknown", http, ms: 300, kind, steps: [{ step, http, ms: 300, ok: false, note: `kind=${kind}` }] });
const setup = (o: { queue?: Record<string, unknown>[]; on?: string; pc711?: unknown; check?: Check; start?: number; pendingError?: boolean; stored?: Record<string, number> } = {}) => {
  const f = fakeSb({ queue: o.queue ?? [pend("store", 10)], pendingError: o.pendingError, stored: o.stored });
  const logs: string[] = [];
  const sleeps: number[] = [];
  let t = o.start ?? NOW;
  const check = vi.fn(o.check ?? (async (i: { kind: string }) => { t += 900; return OK(i); }));
  const job = createPc711Shadow({
    db: createShadowDb(f.sb as never), check: check as never, pc711: (o.pc711 ?? { status: () => ({ state: "connected", since: "2026-11-14T00:00:00Z" }) }) as never,
    readSetting: async (k: string) => (k === SHADOW_SWITCH ? (o.on ?? "true") : null),
    now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
  });
  return { job, check, logs, sleeps, f, queries: f.queries, inserted: () => f.rows, advance: (ms: number) => { t += ms; }, now: () => t };
};

// ── the extension's numbers, read from the extension itself ──────────────────
const EXT = readFileSync(new URL("../../../../chrome-extension/background.js", import.meta.url), "utf8");
const extConst = (name: string): unknown => {
  const m = new RegExp(`(?:const|,)\\s*${name}\\s*=\\s*([^;,\\n]+(?:\\[[^\\]]*\\])?)`).exec(EXT);
  if (!m) throw new Error(`extension constant ${name} not found`);
  const expr = m[1].startsWith("[") ? m[1] : m[1].trim();
  return new Function(`return (${expr.startsWith("[") ? EXT.slice(m.index).match(/\[[^\]]*\]/)![0] : expr});`)();
};

describe("mirrored from the extension (chrome-extension/background.js)", () => {
  it.each([
    ["SHADOW_POLL_MS", SHADOW_POLL_MS, "PC_POLL_MS"], ["SHADOW_LIMIT", SHADOW_LIMIT, "PC_LIMIT"], ["SHADOW_FETCH_LIMIT", SHADOW_FETCH_LIMIT, "PC_FETCH_LIMIT"],
    ["SHADOW_ROW_GAP_MS", SHADOW_ROW_GAP_MS, "PC_ROW_GAP_MS"], ["SHADOW_LOOKBACK_MS", SHADOW_LOOKBACK_MS, "PC_REQUEUE_SINCE_MS"],
    ["SHADOW_MAINT_RETRY_MS", SHADOW_MAINT_RETRY_MS, "PC_MAINT_RETRY_MS"], ["SHADOW_MAINT_START_H", SHADOW_MAINT_START_H, "PC_MAINT_START_H"],
    ["SHADOW_MAINT_END_H", SHADOW_MAINT_END_H, "PC_MAINT_END_H"],
  ])("%s = %s = the extension's %s", (_n, mine, ext) => { expect(mine).toBe(extConst(ext)); });
  it("store ladder = PC_BACKOFF_MS; phone ladder = PC_PHONE_FAST_BACKOFF_MS; the store gives up where the extension does (PC_STORE_GIVE_UP)", () => {
    expect(SHADOW_STORE_BACKOFF_MS).toEqual(extConst("PC_BACKOFF_MS"));
    expect(SHADOW_PHONE_BACKOFF_MS).toEqual(extConst("PC_PHONE_FAST_BACKOFF_MS"));
    expect(SHADOW_STORE_BACKOFF_MS.length + 1).toBe(extConst("PC_STORE_GIVE_UP"));
    expect(ladderFor("frozen")).toBe(SHADOW_STORE_BACKOFF_MS);
    expect(ladderFor("phone")).toBe(SHADOW_PHONE_BACKOFF_MS);
  });
  it("maintenance hours = the extension's pcInMaintenanceAt, every hour of a day", () => {
    const fn = new Function(`${EXT.match(/const PC_MAINT_START_H[^\n]*\n/)![0]}${EXT.match(/function pcTaipeiHour[\s\S]*?\n}\n/)![0]}${EXT.match(/function pcInMaintenanceAt[\s\S]*?\n}\n/)![0]} return pcInMaintenanceAt;`)() as (ms: number) => boolean;
    for (let h = 0; h < 48; h++) { const ms = Date.UTC(2026, 10, 14) + h * 1800_000; expect(inShadowMaint(ms)).toBe(fn(ms)); }
  });
  it("no daily cap any more; the brake numbers are the shadow's own (5 refusals → 15 min)", () => {
    expect("SHADOW_DAY_MAX" in shadowMod).toBe(false);
    expect([SHADOW_BRAKE_ERRORS, SHADOW_BRAKE_PAUSE_MS]).toEqual([5, 15 * 60_000]);
  });
});

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

describe("the queue (sql/162 RPC): oldest first, the last 6 h, ≤ 5 a pass", () => {
  it("one RPC a pass: since = now − 6 h, 25 fetched; parcel_scans is never read directly", async () => {
    const s = setup();
    await s.job.tick();
    const rpc = s.queries.filter((q) => q.table === "rpc:pc711_shadow_pending");
    expect(rpc).toHaveLength(1);
    expect(rpc[0].ops[0][1]).toEqual({ p_since: new Date(NOW - SHADOW_LOOKBACK_MS).toISOString(), p_limit: SHADOW_FETCH_LIMIT });
    expect(s.queries.some((q) => q.table === "parcel_scans")).toBe(false);
  });
  it("12 waiting → the OLDEST 5 this pass (2 s apart), the next 5 the next pass, … nothing skipped", async () => {
    const queue = Array.from({ length: 12 }, (_, i) => pend("store", 300 - i * 20)); // 5 h ago … 1 h20 ago
    const s = setup({ queue });
    expect(await s.job.tick()).toEqual({ checked: 5, waiting: 12 });
    expect(s.inserted().map((r) => r.scan_id)).toEqual(queue.slice(0, 5).map((q) => q.scan_id));
    expect(s.sleeps.every((ms) => ms > 0 && ms <= SHADOW_ROW_GAP_MS)).toBe(true);
    expect(s.sleeps).toHaveLength(4); // between parcels (the first one comes ≥ 2 s after the previous pass)
    s.advance(SHADOW_POLL_MS);
    expect(await s.job.tick()).toEqual({ checked: 5, waiting: 7 });
    s.advance(SHADOW_POLL_MS);
    expect(await s.job.tick()).toEqual({ checked: 2, waiting: 2 });
    expect(s.inserted().map((r) => r.scan_id)).toEqual(queue.map((q) => q.scan_id));
    expect(s.check).toHaveBeenCalledTimes(12);
  });
  it("after an outage the 6 h backlog is caught up (no daily cap): 400 parcels → all checked", async () => {
    const queue = Array.from({ length: 400 }, (_, i) => pend(i % 2 ? "phone" : "store", 350 - i * 0.8));
    const s = setup({ queue });
    for (let i = 0; i < 80; i++) { await s.job.tick(); s.advance(SHADOW_POLL_MS); }
    expect(s.inserted()).toHaveLength(400);
  });
  it("a parcel in backoff is passed over so the ones behind it get their turn (the extension's PC_FETCH_LIMIT)", () => {
    const jobs = jobsFromPending([pend("store", 30), pend("store", 20), pend("phone", 10)]);
    const backoff = new Map([[`${jobs[0].scanId}:store`, { fails: 1, nextAt: NOW + 10_000, seenAt: NOW }]]);
    expect(selectJobs(jobs, backoff, NOW, 5).map((j) => j.scanId)).toEqual([jobs[1].scanId, jobs[2].scanId]);
    expect(selectJobs(jobs, backoff, NOW + 10_000, 2).map((j) => j.scanId)).toEqual([jobs[0].scanId, jobs[1].scanId]);
  });
  it("jobs carry the extension's inputs: phone = phone + name + store; store / frozen = the store only", () => {
    const [ph, st, fz] = jobsFromPending([pend("phone", 3), pend("store", 2), pend("frozen", 1)]);
    expect(ph.input).toEqual({ kind: "phone", phone: PHONE, name: NAME, storeId: STORE });
    expect(st.input).toEqual({ kind: "store", storeId: STORE });
    expect(fz).toMatchObject({ ext: "no_frozen", input: { kind: "frozen", storeId: STORE } });
  });
  it("one check at a time (a second pass while one runs = skipped)", async () => {
    let release!: () => void;
    const s = setup({ queue: [pend("store", 5), pend("store", 4)], check: () => new Promise((r) => { release = () => r(OK({ kind: "store" })); }) });
    const first = s.job.tick();
    await vi.waitFor(() => expect(s.check).toHaveBeenCalledTimes(1));
    expect(await s.job.tick()).toEqual({ skipped: "running" });
    release();
    await vi.waitFor(() => expect(s.check).toHaveBeenCalledTimes(2));
    release();
    await first;
  });
  it("the loop re-arms 5 s after a pass finishes (like the extension's pcScheduleLoop)", async () => {
    const s = setup({ on: "false" });
    const delays: number[] = [];
    let fire!: () => void;
    s.job.start(((fn: () => void, ms: number) => { delays.push(ms); fire = fn; return { unref() {} }; }) as never);
    expect(delays).toEqual([SHADOW_POLL_MS]);
    fire();
    await vi.waitFor(() => expect(delays).toEqual([SHADOW_POLL_MS, SHADOW_POLL_MS]));
    s.job.stop();
  });
  it("no sql/162 yet → one log line a minute, nothing checked, nothing written", async () => {
    const s = setup({ pendingError: true });
    expect(await s.job.tick()).toEqual({ skipped: "error" });
    await s.job.tick();
    expect(s.logs).toEqual(["[PC711_SHADOW] pending read failed"]);
    expect(s.check).not.toHaveBeenCalled();
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
  it("only pc711_shadow / pc711_shadow_days / the RPC are touched; rows + logs carry no phone / name / store id", async () => {
    const s = setup({ queue: [pend("store", 3), pend("phone", 2), pend("frozen", 1)] });
    await s.job.tick();
    expect(s.inserted()).toHaveLength(3);
    expect(s.queries.every((q) => ["pc711_shadow", "pc711_shadow_days", "rpc:pc711_shadow_pending"].includes(q.table))).toBe(true);
    expect(JSON.stringify(s.inserted()) + s.logs.join("\n")).not.toMatch(new RegExp(`${PHONE}|${NAME}|${STORE}`));
  });
  it("needs_login → one NULL row (login), stops until the next connect, then resumes", async () => {
    const pc = { since: "2026-11-14T00:00:00Z", status: () => ({ state: "connected", since: pc.since }) };
    let answer: Record<string, unknown> = { verdict: "unknown", http: 200, ms: 5, kind: "login_not_accepted", steps: [{ step: "store.cart", http: 200, ms: 5, ok: false, note: "kind=login_not_accepted" }] };
    const s = setup({ pc711: pc, queue: [pend("store", 3), pend("store", 2)], check: async () => answer });
    await s.job.tick();
    expect(s.inserted()).toEqual([expect.objectContaining({ match: null, fail_step: "login", fail_reason: "needs_login" })]);
    expect(s.logs.at(-1)).toMatch(/stop=needs_login$/);
    expect(await s.job.tick()).toEqual({ skipped: "stopped" });
    pc.since = "2026-11-14T03:00:00Z";
    answer = { verdict: "open", http: 200, ms: 5, kind: "", raw: "enable", steps: [] };
    s.advance(SHADOW_ROW_GAP_MS);
    expect((await s.job.tick()).checked).toBe(1);
  });
});

describe("failure ladder (the extension's per-parcel backoff)", () => {
  async function ladder(kind: "store" | "phone" | "frozen") {
    // a NON-refusal error (http 200, an answer we can't read) — 7-11 answered, so the brake never pulls
    const s = setup({ queue: [pend(kind, 30)], check: async () => FAIL(200, "unexpected_answer", kind === "phone" ? "phone.token" : kind === "frozen" ? "frozen.byid" : "store.byid") });
    const waits: number[] = [];
    for (let i = 0; i < 20 && !s.inserted().length; i++) {
      const before = s.check.mock.calls.length;
      await s.job.tick();
      if (s.check.mock.calls.length > before && !s.inserted().length) {
        const b = [...s.job._state().backoff.values()][0];
        waits.push(b.nextAt - s.now());
        s.advance(b.nextAt - s.now() - 1);
        expect(await s.job.tick()).toEqual({ checked: 0, waiting: 1 }); // 1 ms early: not yet
        s.advance(1);
      }
    }
    return { s, waits };
  }
  it("store + frozen: 15 s · 30 s · 60 s · 2 min, then the 5th failure writes the error row", async () => {
    for (const k of ["store", "frozen"] as const) {
      const { s, waits } = await ladder(k);
      expect(waits).toEqual(SHADOW_STORE_BACKOFF_MS);
      expect(s.check).toHaveBeenCalledTimes(SHADOW_STORE_BACKOFF_MS.length + 1);
      expect(s.inserted()).toEqual([expect.objectContaining({ kind: k, match: null, fail_reason: "unexpected_answer", fail_http: 200 })]);
      expect(s.inserted()[0].steps).toEqual([expect.objectContaining({ ok: false, w: "unexpected_answer" })]);
    }
  });
  it("phone: 5 s · 10 s · 20 s · 60 s · 2 min, then the 6th failure writes the error row", async () => {
    const { s, waits } = await ladder("phone");
    expect(waits).toEqual(SHADOW_PHONE_BACKOFF_MS);
    expect(s.check).toHaveBeenCalledTimes(SHADOW_PHONE_BACKOFF_MS.length + 1);
    expect(s.inserted()).toEqual([expect.objectContaining({ kind: "phone", fail_step: "phone.token", fail_reason: "unexpected_answer" })]);
  });
  it("an answer after failures = the normal comparison row (no error row); the ladder is cleared", async () => {
    let n = 0;
    const s = setup({ check: async (i) => (++n <= 2 ? FAIL() : OK(i)) });
    await s.job.tick(); s.advance(SHADOW_STORE_BACKOFF_MS[0]);
    await s.job.tick(); s.advance(SHADOW_STORE_BACKOFF_MS[1]);
    await s.job.tick();
    expect(s.inserted()).toEqual([expect.objectContaining({ match: true, fail_reason: null })]);
    expect(s.job._state().backoff.size).toBe(0);
  });
  it("the SAME parcel timing out 5 times in a row also pulls the brake (5 refusals in a row)", async () => {
    const s = setup({ check: async () => FAIL(0, "timeout") });
    for (const w of SHADOW_STORE_BACKOFF_MS) { await s.job.tick(); s.advance(w); }
    await s.job.tick();
    expect(s.inserted().map((r) => r.fail_reason)).toEqual(["timeout", "paused_http"]); // the 5th failure = past the ladder AND the 5th refusal
  });
  it("a thrown check is a failure on the ladder; past the ladder → fail_reason threw", async () => {
    const s = setup({ check: async () => { throw new Error("boom"); } });
    for (const w of [...SHADOW_STORE_BACKOFF_MS, 0]) { await s.job.tick(); s.advance(w); }
    expect(s.inserted()).toEqual([expect.objectContaining({ kind: "store", match: null, fail_reason: "threw" })]);
    expect(s.logs.at(-1)).toMatch(/match=err/);
  });
});

describe("7-ELEVEN maintenance 01:00–05:00 Taipei", () => {
  const TWO_AM = Date.parse("2026-11-14T18:00:00Z"); // 02:00 Taipei
  it("a failure there is not counted and retries every 10 min; nothing is written", async () => {
    const s = setup({ start: TWO_AM, queue: [{ ...pend("store", 0), at: new Date(TWO_AM - 60_000).toISOString() }], check: async () => FAIL(503, "http") });
    for (let i = 0; i < 6; i++) {
      await s.job.tick();
      const b = [...s.job._state().backoff.values()][0];
      expect(b.fails).toBe(0);
      expect(b.nextAt - s.now()).toBe(SHADOW_MAINT_RETRY_MS);
      s.advance(SHADOW_MAINT_RETRY_MS);
    }
    expect(s.inserted()).toEqual([]);
    expect(s.job._state().pausedUntil).toBe(0); // refusals in maintenance never pull the brake
    expect(s.logs.every((l) => / maint=1 /.test(l))).toBe(true);
  });
  it("an answer there is written as usual; the first pass after 05:00 catches up from the oldest", async () => {
    const FOUR_59 = Date.parse("2026-11-14T20:59:00Z");
    const queue = Array.from({ length: 3 }, (_, i) => ({ ...pend("store", 0), at: new Date(FOUR_59 - (200 - i) * 60_000).toISOString() }));
    let up = false;
    const s = setup({ start: FOUR_59, queue, check: async (i) => (up ? OK(i) : FAIL(0, "timeout")) });
    await s.job.tick();
    expect(s.inserted()).toEqual([]);
    up = true;
    s.advance(SHADOW_MAINT_RETRY_MS); // 05:09 Taipei
    expect(inShadowMaint(s.now())).toBe(false);
    expect(await s.job.tick()).toEqual({ checked: 3, waiting: 3 });
    expect(s.inserted().map((r) => r.scan_id)).toEqual(queue.map((q) => q.scan_id));
  });
});

describe("safety brake", () => {
  it("5 refusals in a row (403 / 429 / 5xx / timeout) → 15 min pause, ONE paused_http row (not a parcel's), then resumes", async () => {
    const queue = Array.from({ length: 8 }, (_, i) => pend("store", 60 - i));
    const codes = [403, 429, 500, 503, 0];
    let n = 0, up = false;
    const s = setup({ queue, check: async (i) => (up ? OK(i) : FAIL(codes[n % 5], codes[n++ % 5] ? "http" : "timeout")) });
    await s.job.tick();
    expect(s.check).toHaveBeenCalledTimes(5);
    const rows = s.inserted();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fail_reason: "paused_http", note: "paused_15m", match: null, ext_verdict: null });
    expect(queue.map((q) => q.scan_id)).not.toContain(rows[0].scan_id);
    expect(s.logs.at(-1)).toMatch(/^\[PC711_SHADOW\] pause 15m after 5 refusals/);
    const until = s.job.state().pausedUntil!;
    expect(until - s.now()).toBe(SHADOW_BRAKE_PAUSE_MS);
    s.advance(SHADOW_BRAKE_PAUSE_MS - 1);
    expect(await s.job.tick()).toEqual({ skipped: "paused" });
    up = true;
    s.advance(1);
    expect((await s.job.tick()).checked).toBe(5);
    expect(s.job.state().pausedUntil).toBeNull();
  });
  it("a pause row is NOT an error: only under paused — not in errors, errors per kind or errors by step", () => {
    const t = totalsOf([
      { kind: "store", match: null, fail_step: "store.byid", fail_reason: "paused_http" },
      { kind: "store", match: null, fail_step: "store.byid", fail_reason: "timeout" },
      { kind: "store", match: true, srv_ms: 900 },
    ]);
    expect(t.paused).toBe(1);
    expect(t.errors).toBe(1);
    expect(t.store.errors).toBe(1);
    expect(t.errorsByStep).toEqual({ "store.byid": 1 });
  });
  it("an answer or a non-refusal error (e.g. no_form, http 200) breaks the row", async () => {
    const plan = [FAIL(503, "http"), FAIL(503, "http"), FAIL(200, "cart_form_missing", "store.cart"), FAIL(503, "http"), FAIL(503, "http"), FAIL(503, "http"), FAIL(503, "http")];
    let n = 0;
    const s = setup({ queue: Array.from({ length: 7 }, (_, i) => pend("store", 60 - i)), check: async () => plan[n++] });
    await s.job.tick(); s.advance(SHADOW_POLL_MS);
    await s.job.tick();
    expect(s.check).toHaveBeenCalledTimes(7);
    expect(s.job.state().pausedUntil).toBeNull();
    expect(isRefusal({ fail_http: 429 })).toBe(true);
    expect(isRefusal({ fail_http: 404 })).toBe(false);
    expect(isRefusal({ fail_http: 0, fail_reason: "timeout" })).toBe(true);
    expect(isRefusal({ fail_http: 0, fail_reason: "network" })).toBe(false);
  });
});

describe("Waiting", () => {
  it("each pass records Waiting and the day's highest; a restart never lowers the stored highest", async () => {
    const s = setup({ queue: Array.from({ length: 9 }, (_, i) => pend("store", 50 - i)), stored: { "2026-11-14": 20 } });
    await s.job.tick();
    expect(s.job.state()).toMatchObject({ waiting: 9, dayMax: { "2026-11-14": 20 } });
    expect(s.f.queries.some((q) => q.table === "pc711_shadow_days" && q.ops.some((o) => o[0] === "upsert"))).toBe(false);
    const t = setup({ queue: Array.from({ length: 30 }, (_, i) => pend("store", 50 - i)), stored: { "2026-11-14": 20 } });
    await t.job.tick();
    expect(t.f.days["2026-11-14"]).toBe(30);
  });
  it("summary: Waiting = a fresh count (limit 0), the brake time, and checked · match % · errors · max Waiting for the last 3 Taipei days", async () => {
    const f = fakeSb({ queue: [pend("store", 30), pend("phone", 20)], stored: { "2026-11-12": 41, "2026-11-13": 7 } });
    const day = (d: string, h: number) => new Date(Date.parse(`${d}T00:00:00Z`) + h * 3600_000).toISOString();
    const rows = [
      { at: day("2026-11-14", 1), kind: "store", match: true, srv_ms: 900 }, { at: day("2026-11-14", 2), kind: "phone", match: false, srv_ms: 900 },
      { at: day("2026-11-13", 3), kind: "store", match: null, fail_step: "store.byid", fail_reason: "timeout" },
      { at: day("2026-11-13", 4), kind: "store", match: null, fail_step: "store.byid", fail_reason: "paused_http" },
      { at: day("2026-11-12", 2), kind: "store", match: true, srv_ms: 900 },
    ];
    const db = { ...createShadowDb(f.sb as never), rowsBetween: vi.fn(async () => rows) };
    const out = await shadowSummary(db as never, async () => "true", NOW, { pausedUntil: NOW + 600_000, waiting: 3, dayMax: { "2026-11-14": 12 } });
    expect(out.waiting).toBe(2);
    expect(f.queries.find((q) => q.table === "rpc:pc711_shadow_pending")!.ops[0][1]).toEqual({ p_since: new Date(NOW - SHADOW_LOOKBACK_MS).toISOString(), p_limit: 0 });
    expect(out.pausedUntil).toBe(new Date(NOW + 600_000).toISOString());
    expect(out.days).toEqual([
      { day: "2026-11-14", checked: 2, matchPct: 50, errors: 0, maxWaiting: 12 },
      { day: "2026-11-13", checked: 1, matchPct: null, errors: 1, maxWaiting: 7 },
      { day: "2026-11-12", checked: 1, matchPct: 100, errors: 0, maxWaiting: 41 },
    ]);
    expect(out.today.compared).toBe(2);
    const past = await shadowSummary(db as never, async () => "true", NOW, { pausedUntil: NOW - 1, waiting: 0, dayMax: {} });
    expect(past.pausedUntil).toBeNull();
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
  it("history query: filter, kind, newest first, a page of 20 (+1 to know there is more)", async () => {
    const f = fakeSb({ answer: () => ({ data: [], error: null }) });
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

describe("wiring + sql/159 + sql/162", () => {
  it("sql/162: the pending RPC (anti-join on pc711_shadow, oldest first, limit ≤ 50) + pc711_shadow_days — service_role only", () => {
    const sql = readFileSync(new URL("../../../../sql/162_pc711_shadow_queue.sql", import.meta.url), "utf8");
    expect(sql).toContain("create or replace function public.pc711_shadow_pending(p_since timestamptz, p_limit integer)");
    expect(sql).toContain("not exists (select 1 from public.pc711_shadow x where x.scan_id = j.scan_id and x.kind = j.kind)");
    expect(sql).toContain("order by at, scan_id, kind");
    expect(sql).toContain("least(coalesce(p_limit, 0), 50)");
    for (const c of ["store_full_at >= p_since", "phone_check_at >= p_since", "frozen_store_checked_at >= p_since"]) expect(sql).toContain(c);
    expect(sql).toContain("revoke all on function public.pc711_shadow_pending(timestamptz, integer) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.pc711_shadow_pending(timestamptz, integer) to service_role;");
    for (const r of ["public", "anon", "authenticated"]) expect(sql).toContain(`revoke all on table public.pc711_shadow_days from ${r};`);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).not.toMatch(/parcel_scans\s+set|insert into public\.parcel_scans|update public\.parcel_scans/i);
    for (const ix of [
      "create index if not exists parcel_scans_store_full_at_idx on public.parcel_scans (store_full_at) where store_full_status is not null;",
      "create index if not exists parcel_scans_phone_check_at_idx on public.parcel_scans (phone_check_at) where phone_check_status is not null;",
      "create index if not exists parcel_scans_frozen_checked_at_idx on public.parcel_scans (frozen_store_checked_at) where frozen_store_status is not null;",
    ]) expect(sql).toContain(ix);
    expect(sql.indexOf("parcel_scans_frozen_checked_at_idx")).toBeLessThan(sql.indexOf("create or replace function public.pc711_shadow_pending"));
    const rb = readFileSync(new URL("../../../../sql/162_pc711_shadow_queue_rollback.sql", import.meta.url), "utf8");
    for (const ix of ["parcel_scans_store_full_at_idx", "parcel_scans_phone_check_at_idx", "parcel_scans_frozen_checked_at_idx"]) expect(rb).toContain(`drop index if exists public.${ix};`);
    expect(rb).toContain("drop function if exists public.pc711_shadow_pending(timestamptz, integer);");
    expect(rb).toContain("drop table if exists public.pc711_shadow_days;");
  });
  it("server.js: probe in target mode (silent), admin-only summary + history routes", () => {
    const src = readFileSync(new URL("../../../../server.js", import.meta.url), "utf8");
    expect(src).toMatch(/target: input, gate: false, log: \(\) => \{\}/);
    expect(src).toContain('app.get("/admin/pc711/shadow", requireAuth, requireAdmin,');
    expect(src).toContain("shadowSummary(pc711ShadowDb, readSetting, Date.now(), pc711ShadowJob.state())");
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
