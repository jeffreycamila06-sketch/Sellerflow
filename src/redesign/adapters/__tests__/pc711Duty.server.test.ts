// GET /admin/pc711/duty — the read-only answer behind the Admin "Who is checking" card
// (server/pc711Duty.js). A fake database stands in for Supabase: it runs the same filters, answers
// at most 1,000 rows a read like the real one, and records every call (reads, function calls, writes).
//
//   A  the small pure rules (label, lease, missing table, last take-over, the answer's fixed keys)
//   B  the answer in each situation: sql/179 not applied, switch off, normal, on duty, logged out
//   C  the parcels answered in a duty: distinct parcels, paged, continued from the last answer
//   D  one read serves many requests (10 s), reads never pile up, a failed read is a clean 500
//   E  READ ONLY: no function call, no write — in the calls made and in the module's own text
//   F  nothing private in the answer: no phone, name, store number, tracking number, parcel id
//   G  the route: Admin only (the server's REAL admin check), the limiter, the wiring in server.js
import { describe, it, expect } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import {
  machineLabel, parseLease, isMissingTable, lastTakeOver, dutyAnswer, isoOrNull, codeWord,
  createDutyDb, createDutyReader, createDutyHandler,
  DUTY_PAGE, DUTY_MAX_PAGES, DUTY_CACHE_MS, DUTY_LOG_ROWS, DUTY_LEASE_KEY, DUTY_SWITCH_KEY, DUTY_ANSWER_KINDS,
} from "../../../../server/pc711Duty.js";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[] | { code?: string; message: string } | undefined>;
interface Call { table: string; cols: string; filters: string[]; limit: number | null }

/** The fake database. tables[name] = rows · an error object (every read of it fails) · undefined (the
 *  table does not exist). wide = it answers WHOLE rows, more than was asked (a hostile answer). */
function fakeSb(tables: Tables, { wide = false, missingCode = "PGRST205" } = {}) {
  const calls: Call[] = [];
  const rpcs: string[] = [];
  const writes: string[] = [];
  const from = (table: string) => {
    const call: Call = { table, cols: "", filters: [], limit: null };
    let rows: Row[] = [];
    let err: unknown = null;
    const pick = (r: Row) => (wide ? r : Object.fromEntries(call.cols.split(",").map((c) => [c, r[c]])));
    const write = (op: string) => () => { writes.push(`${table}.${op}`); throw new Error("a write was tried"); };
    const q = {
      select(cols: string) {
        call.cols = cols; calls.push(call);
        const src = tables[table];
        if (src === undefined) err = missingCode === "42P01" ? { code: "42P01", message: `relation "public.${table}" does not exist` } : { code: "PGRST205", message: `Could not find the table 'public.${table}' in the schema cache` };
        else if (!Array.isArray(src)) err = src;
        else rows = [...src];
        return q;
      },
      eq(k: string, v: unknown) { call.filters.push(`${k}=eq.${String(v)}`); rows = rows.filter((r) => r[k] === v); return q; },
      in(k: string, vs: unknown[]) { call.filters.push(`${k}=in.(${vs.join(",")})`); rows = rows.filter((r) => vs.includes(r[k])); return q; },
      gte(k: string, v: string) { call.filters.push(`${k}=gte.${v}`); rows = rows.filter((r) => Date.parse(String(r[k])) >= Date.parse(v)); return q; },
      gt(k: string, v: number) { call.filters.push(`${k}=gt.${v}`); rows = rows.filter((r) => Number(r[k]) > v); return q; },
      order(k: string, o: { ascending: boolean }) { rows = [...rows].sort((a, b) => (Number(a[k]) - Number(b[k])) * (o.ascending ? 1 : -1)); return q; },
      limit(n: number) { call.limit = n; rows = rows.slice(0, Math.min(n, 1000)); return q; },
      maybeSingle: async () => (err ? { data: null, error: err } : { data: rows[0] ? pick(rows[0]) : null, error: null }),
      then(ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) {
        return Promise.resolve(err ? { data: null, error: err } : { data: rows.map(pick), error: null }).then(ok, bad);
      },
      insert: write("insert"), update: write("update"), upsert: write("upsert"), delete: write("delete"),
    };
    return q;
  };
  const rpc = async (fn: string) => { rpcs.push(fn); return { data: null, error: { message: "a function was called" } }; };
  return { sb: { from, rpc } as never, calls, rpcs, writes };
}

const T0 = Date.parse("2026-11-18T05:46:00Z");          // the duty starts (13:46 Taipei)
const iso = (ms: number) => new Date(ms).toISOString();
const LEASE = (over: Row = {}) => JSON.stringify({ leader_label: "Lenovo", leader_at: iso(T0 + 22 * 60_000 - 4000), leader_id: "w-3f9a1c", leader_state: { degraded: false }, seen: { "w-3f9a1c": iso(T0) }, ...over });
const settings = (enabled: string | null, lease: string | null = LEASE()) => [
  ...(enabled === null ? [] : [{ key: DUTY_SWITCH_KEY, value: enabled }]),
  ...(lease === null ? [] : [{ key: DUTY_LEASE_KEY, value: lease }]),
  { key: "something_else", value: "x" },
];
const STATE_IDLE = { id: 1, on_duty: false, reason: "silent", since: iso(T0 - 26 * 3600_000), handed_back_at: iso(T0 - 26 * 3600_000 + 46 * 60_000) };
const STATE_DUTY = { id: 1, on_duty: true, reason: "silent", since: iso(T0), handed_back_at: iso(T0 - 26 * 3600_000 + 46 * 60_000) };
let logId = 0;
const logRow = (at: number, kind: string, word: string | null, result: string, scan: string | null = null): Row => ({ id: ++logId, at: iso(at), kind, word, result, scan_id: scan });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** n parcels answered after T0: a store row and a phone row each, both written */
const answered = (n: number, from = 0) => Array.from({ length: n }, (_, i) => [
  logRow(T0 + 60_000 + (from + i) * 10, "store", "open", "written", uuid(from + i)),
  logRow(T0 + 60_000 + (from + i) * 10 + 5, "phone", "ok", "written", uuid(from + i)),
]).flat();
const reader = (tables: Tables, opt: { wide?: boolean; missingCode?: string; login?: string | null; nowRef?: { ms: number }; logs?: string[] } = {}) => {
  const f = fakeSb(tables, opt);
  const nowRef = opt.nowRef ?? { ms: T0 + 22 * 60_000 };
  const r = createDutyReader({ db: createDutyDb(f.sb), loginState: () => opt.login ?? "connected", now: () => nowRef.ms, log: (l: string) => { (opt.logs ?? []).push(l); } });
  return { ...f, r, nowRef };
};
const KEYS = ["answered", "answeredMore", "backup", "checker", "last", "loggedOut", "now", "onDuty", "reason", "since"];

describe("A — the small rules", () => {
  it("machineLabel: one plain word or the extension's own \"<platform> <4 id characters>\"; anything else is not answered", () => {
    expect(machineLabel("Lenovo")).toBe("Lenovo");
    expect(machineLabel("  Lenovo  ")).toBe("Lenovo");
    expect(machineLabel("Lenovo-2")).toBe("Lenovo-2");
    expect(machineLabel("Mac fe08")).toBe("Mac fe08");
    expect(machineLabel("Windows 3b9c")).toBe("Windows 3b9c");
    for (const bad of ["Maria Santos", "王小美", "0912345678", "Store 151003", "F12345678", "Lenovo 0912345678", "a".repeat(21), "Lenovo <b>", "Lenovo\nx", "", "   ", "12345"]) {
      expect(machineLabel(bad), bad).toBe("");
    }
    for (const notText of [null, undefined, 5, {}, ["Lenovo"]]) expect(machineLabel(notText)).toBe("");
  });
  it("parseLease: label + the leader's last call; text or object; garbage never throws", () => {
    expect(parseLease(LEASE())).toEqual({ label: "Lenovo", lastCallAt: iso(T0 + 22 * 60_000 - 4000) });
    expect(parseLease({ leader_label: "Mac fe08", leader_at: "2026-11-18T05:00:00+00:00" })).toEqual({ label: "Mac fe08", lastCallAt: "2026-11-18T05:00:00.000Z" });
    for (const bad of [null, undefined, "", "not json", "[]", "5", 5, [], '{"leader_at":"yesterday"}']) {
      expect(parseLease(bad)).toEqual({ label: "", lastCallAt: null });
    }
  });
  it("isMissingTable: only \"the table does not exist\" (sql/179 not applied) — never another error", () => {
    expect(isMissingTable({ code: "42P01", message: 'relation "public.pc711_backup_state" does not exist' })).toBe(true);
    expect(isMissingTable({ code: "PGRST205", message: "Could not find the table 'public.pc711_backup_log' in the schema cache" })).toBe(true);
    expect(isMissingTable({ message: 'relation "pc711_backup_state" does not exist' })).toBe(true);
    for (const other of [{ code: "57014", message: "canceling statement due to statement timeout" }, { code: "42501", message: "permission denied for table pc711_backup_state" }, { message: "fetch failed" }, new Error("boom"), null, undefined]) {
      expect(isMissingTable(other)).toBe(false);
    }
  });
  it("lastTakeOver: the newest hand-back and the take-over before it", () => {
    const rows = [
      { at: iso(T0), word: "took_over_degraded" },                  // the duty running now — not finished
      { at: iso(T0 - 3600_000), word: "handed_back" },
      { at: iso(T0 - 3600_000 - 46 * 60_000), word: "took_over_silent" },
      { at: iso(T0 - 9 * 3600_000), word: "switch_off" },
      { at: iso(T0 - 10 * 3600_000), word: "took_over_degraded" },
    ];
    expect(lastTakeOver(rows, STATE_DUTY)).toEqual({ start: iso(T0 - 3600_000 - 46 * 60_000), end: iso(T0 - 3600_000), reason: "silent" });
    // a switch-off ends a take-over too
    expect(lastTakeOver(rows.slice(3), STATE_IDLE)).toEqual({ start: iso(T0 - 10 * 3600_000), end: iso(T0 - 9 * 3600_000), reason: "degraded" });
  });
  it("lastTakeOver: nothing when there was none; the state row's own times when the log no longer has the pair", () => {
    expect(lastTakeOver([], null)).toBeNull();
    expect(lastTakeOver([], { on_duty: false, since: null, handed_back_at: null, reason: null })).toBeNull();
    expect(lastTakeOver([{ at: iso(T0), word: "took_over_silent" }], STATE_DUTY)).toBeNull();      // first duty, still running
    expect(lastTakeOver([], STATE_IDLE)).toEqual({ start: STATE_IDLE.since, end: STATE_IDLE.handed_back_at, reason: "silent" });
    // on duty now: the state's `since` is THIS duty, so it is never paired with the older hand-back
    expect(lastTakeOver([], STATE_DUTY)).toBeNull();
    // an end with no take-over before it in the log, and a state whose times do not fit → nothing
    expect(lastTakeOver([{ at: iso(T0), word: "handed_back" }], { on_duty: false, since: iso(T0 + 5), handed_back_at: iso(T0), reason: "silent" })).toBeNull();
    for (const junk of [null, undefined, "x", [null, 5, {}, { at: "nope", word: "handed_back" }]]) expect(lastTakeOver(junk, null)).toBeNull();
  });
  it("dutyAnswer: always the same ten keys, whatever goes in", () => {
    for (const a of [dutyAnswer(), dutyAnswer({ enabled: true, state: STATE_DUTY, lease: parseLease(LEASE()), answered: 3 }), dutyAnswer({ enabled: true, state: { on_duty: true, extra: "x", phone: "0912345678" } as never })]) {
      expect(Object.keys(a).sort()).toEqual(KEYS);
      expect(Object.keys(a.checker).sort()).toEqual(["label", "lastCallAt"]);
    }
    expect(isoOrNull("2026-11-18T05:00:00+08:00")).toBe("2026-11-17T21:00:00.000Z");
    for (const v of [null, undefined, "", "x", 5]) expect(isoOrNull(v)).toBeNull();
  });
});

describe("B — the answer in each situation", () => {
  it("sql/179 not applied (the two tables do not exist) → \"off\", cleanly, with the Lenovo's last call", async () => {
    for (const missingCode of ["PGRST205", "42P01"]) {
      const h = reader({ app_settings: settings(null) }, { missingCode });
      const a = await h.r.get();
      expect(a).toEqual({
        backup: "off", onDuty: false, loggedOut: false, reason: null, since: null, answered: null, answeredMore: false,
        checker: { label: "Lenovo", lastCallAt: iso(T0 + 22 * 60_000 - 4000) }, last: null, now: iso(T0 + 22 * 60_000),
      });
      // … also when the switch row was created by hand before the tables
      const h2 = reader({ app_settings: settings("true") }, { missingCode });
      expect((await h2.r.get()).backup).toBe("off");
    }
  });
  it("the switch must be exactly 'true': anything else is \"off\" — and nothing of a stale duty is answered", async () => {
    for (const v of ["false", null, "TRUE", " true", "1", "", "yes"]) {
      const h = reader({ app_settings: settings(v), pc711_backup_state: [STATE_DUTY], pc711_backup_log: answered(3) });
      const a = await h.r.get();
      expect({ v, backup: a.backup, onDuty: a.onDuty, since: a.since, reason: a.reason, answered: a.answered }).toEqual({ v, backup: "off", onDuty: false, since: null, reason: null, answered: null });
      expect(h.calls.some((c) => c.cols === "id,scan_id")).toBe(false);          // off → the parcels are not even read
    }
  });
  it("normal: backup on, the Lenovo is checking, the last take-over from the log", async () => {
    logId = 0;
    const log = [logRow(T0 - 26 * 3600_000, "duty", "took_over_silent", "written"), ...answered(2), logRow(T0 - 26 * 3600_000 + 46 * 60_000, "duty", "handed_back", "written")];
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_IDLE], pc711_backup_log: log });
    expect(await h.r.get()).toEqual({
      backup: "on", onDuty: false, loggedOut: false, reason: null, since: null, answered: null, answeredMore: false,
      checker: { label: "Lenovo", lastCallAt: iso(T0 + 22 * 60_000 - 4000) },
      last: { start: iso(T0 - 26 * 3600_000), end: iso(T0 - 26 * 3600_000 + 46 * 60_000), reason: "silent" }, now: iso(T0 + 22 * 60_000),
    });
  });
  it("backup on but the duty function never ran yet (no state row) → on, not on duty", async () => {
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [], pc711_backup_log: [] });
    const a = await h.r.get();
    expect([a.backup, a.onDuty, a.last]).toEqual(["on", false, null]);
  });
  it("server on duty: since when, why, how many parcels — both reasons", async () => {
    for (const reason of ["silent", "degraded"]) {
      logId = 0;
      const log = [logRow(T0, "duty", `took_over_${reason}`, "written"), ...answered(37)];
      const h = reader({ app_settings: settings("true"), pc711_backup_state: [{ ...STATE_DUTY, reason }], pc711_backup_log: log });
      const a = await h.r.get();
      expect({ backup: a.backup, onDuty: a.onDuty, reason: a.reason, since: a.since, answered: a.answered, more: a.answeredMore, loggedOut: a.loggedOut })
        .toEqual({ backup: "on", onDuty: true, reason, since: iso(T0), answered: 37, more: false, loggedOut: false });
    }
  });
  it("a reason that is not one of the two words is never passed on", async () => {
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [{ ...STATE_DUTY, reason: "0912345678" }], pc711_backup_log: [] });
    expect((await h.r.get()).reason).toBeNull();
  });
  it("server on duty AND logged out of 7-11 → loggedOut (from the login module's memory, no extra read)", async () => {
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: answered(1) }, { login: "needs_login" });
    const a = await h.r.get();
    expect([a.onDuty, a.loggedOut]).toEqual([true, true]);
    for (const login of ["connected", "not_connected", "key_missing", null]) {
      const x = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: [] }, { login });
      expect((await x.r.get()).loggedOut).toBe(false);
    }
    // a login module that throws never fails the answer
    const f = fakeSb({ app_settings: settings("true"), pc711_backup_state: [STATE_IDLE], pc711_backup_log: [] });
    const r = createDutyReader({ db: createDutyDb(f.sb), loginState: () => { throw new Error("x"); }, log: () => {} });
    expect((await r.get()).loggedOut).toBe(false);
  });
  it("no lease yet / a label that is not a machine word → no label, no time; the answer still stands", async () => {
    const h = reader({ app_settings: settings("true", null), pc711_backup_state: [STATE_IDLE], pc711_backup_log: [] });
    expect((await h.r.get()).checker).toEqual({ label: "", lastCallAt: null });
    const h2 = reader({ app_settings: settings("true", LEASE({ leader_label: "Maria Santos" })), pc711_backup_state: [STATE_IDLE], pc711_backup_log: [] });
    expect((await h2.r.get()).checker.label).toBe("");
  });
});

describe("C — the parcels answered in a duty", () => {
  it("distinct parcels with a WRITTEN answer since the duty started — nothing else is counted", async () => {
    logId = 0;
    const log = [
      logRow(T0 - 60_000, "store", "open", "written", uuid(900)),          // before this duty
      logRow(T0 - 60_000, "phone", "ok", "written", uuid(900)),
      logRow(T0, "duty", "took_over_silent", "written"),
      ...answered(5),                                                       // 5 parcels, store + phone each
      logRow(T0 + 70_000, "frozen", "ok", "written", uuid(2)),             // a third answer of parcel 2
      logRow(T0 + 70_000, "frozen", "ok", "written", uuid(50)),            // a frozen-only parcel
      logRow(T0 + 80_000, "store", "open", "kept", uuid(60)),              // the Lenovo's answer was kept
      logRow(T0 + 80_000, "phone", "ok", "not_on_duty", uuid(61)),         // arrived after the hand-back
      logRow(T0 + 80_000, "store", "open", "gone", uuid(62)),
      logRow(T0 + 90_000, "requeue", null, "written"),                     // not a parcel
      logRow(T0 + 90_000, "sender_health", "ok", "written"),
    ];
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: log });
    expect((await h.r.get()).answered).toBe(6);
    const c = h.calls.find((x) => x.cols === "id,scan_id")!;
    expect(c.filters).toEqual([`at=gte.${iso(T0)}`, "id=gt.0", "result=eq.written", `kind=in.(${DUTY_ANSWER_KINDS.join(",")})`]);
    expect(c.limit).toBe(DUTY_PAGE);
  });
  it("more than 1,000 rows: read page by page, the count is complete", async () => {
    logId = 0;
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: [logRow(T0, "duty", "took_over_silent", "written"), ...answered(1250)] });
    const a = await h.r.get();
    expect([a.answered, a.answeredMore]).toEqual([1250, false]);
    expect(h.calls.filter((x) => x.cols === "id,scan_id")).toHaveLength(3);    // 2,500 rows = 1000 + 1000 + 500
  });
  it("the next answer reads only the rows after the last one it saw", async () => {
    logId = 0;
    const log = [logRow(T0, "duty", "took_over_silent", "written"), ...answered(40)];
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: log });
    expect((await h.r.get()).answered).toBe(40);
    const lastSeen = logId;
    log.push(...answered(3, 40));
    h.nowRef.ms += DUTY_CACHE_MS + 1;
    expect((await h.r.get()).answered).toBe(43);
    const reads = h.calls.filter((x) => x.cols === "id,scan_id");
    expect(reads).toHaveLength(2);
    expect(reads[1].filters).toContain(`id=gt.${lastSeen}`);
  });
  it("a very long duty: one answer reads at most 10 pages and says there is more; the next answers go on", async () => {
    logId = 0;
    const parcels = (DUTY_PAGE * DUTY_MAX_PAGES) / 2 + 300;                     // 10,600 rows
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: [logRow(T0, "duty", "took_over_silent", "written"), ...answered(parcels)] });
    const a = await h.r.get();
    expect([a.answered, a.answeredMore]).toEqual([(DUTY_PAGE * DUTY_MAX_PAGES) / 2, true]);
    expect(h.calls.filter((x) => x.cols === "id,scan_id")).toHaveLength(DUTY_MAX_PAGES);
    h.nowRef.ms += DUTY_CACHE_MS + 1;
    const b = await h.r.get();
    expect([b.answered, b.answeredMore]).toEqual([parcels, false]);
  });
  it("a new duty starts its count again", async () => {
    logId = 0;
    const state = { ...STATE_DUTY };
    const log = [logRow(T0, "duty", "took_over_silent", "written"), ...answered(8)];
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [state], pc711_backup_log: log });
    expect((await h.r.get()).answered).toBe(8);
    state.on_duty = false; state.handed_back_at = iso(T0 + 30 * 60_000);
    h.nowRef.ms += DUTY_CACHE_MS + 1;
    expect((await h.r.get()).answered).toBeNull();
    const t1 = T0 + 3600_000;
    state.on_duty = true; state.since = iso(t1);
    log.push(logRow(t1, "duty", "took_over_degraded", "written"), logRow(t1 + 5000, "phone", "ok", "written", uuid(7000)));
    h.nowRef.ms = t1 + 60_000;
    const a = await h.r.get();
    expect([a.answered, a.since]).toEqual([1, iso(t1)]);
  });
  it("the count cannot be read → no number this time; the rest of the answer still stands", async () => {
    const f = fakeSb({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: [] });
    const db = createDutyDb(f.sb);
    const logs: string[] = [];
    const r = createDutyReader({ db: { ...db, answeredPage: async () => { throw { code: "57014", message: "canceling statement due to statement timeout" }; } }, now: () => T0 + 60_000, log: (l: string) => { logs.push(l); } });
    const a = await r.get();
    expect([a.onDuty, a.since, a.answered, a.answeredMore]).toEqual([true, iso(T0), null, false]);
    expect(logs).toEqual(["[PC711_DUTY] read failed 57014"]);
  });
});

describe("D — one read serves many requests; a failed read is clean", () => {
  it("the same answer for 10 s, then a new read", async () => {
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_IDLE], pc711_backup_log: [] });
    const a = await h.r.get();
    const perRead = h.calls.length;
    expect(perRead).toBe(3);                                                    // settings, state, the duty rows
    h.nowRef.ms += DUTY_CACHE_MS - 1;
    expect(await h.r.get()).toBe(a);
    expect(h.calls).toHaveLength(perRead);
    h.nowRef.ms += 2;
    const b = await h.r.get();
    expect(b).not.toBe(a);
    expect(h.calls).toHaveLength(perRead * 2);
    expect(h.calls.map((c) => `${c.table}:${c.cols}`).slice(0, 3)).toEqual(["app_settings:key,value", "pc711_backup_state:on_duty,reason,since,handed_back_at", "pc711_backup_log:at,word"]);
    expect(h.calls[2].limit).toBe(DUTY_LOG_ROWS);
  });
  it("requests that arrive while a read is running share it", async () => {
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_IDLE], pc711_backup_log: [] });
    const all = await Promise.all([h.r.get(), h.r.get(), h.r.get(), h.r.get()]);
    expect(new Set(all).size).toBe(1);
    expect(h.calls).toHaveLength(3);
  });
  it("a real read error (not \"no such table\") is NOT turned into \"off\": the request fails, one log line with a code only", async () => {
    for (const tables of [
      { app_settings: { code: "57014", message: "timeout while reading 0912345678" } },
      { app_settings: settings("true"), pc711_backup_state: { code: "42501", message: "permission denied for table pc711_backup_state" } },
      { app_settings: settings("true"), pc711_backup_state: [STATE_IDLE], pc711_backup_log: { code: "08006", message: "connection failure" } },
    ] as Tables[]) {
      const logs: string[] = [];
      const h = reader(tables, { logs });
      await expect(h.r.get()).rejects.toBeTruthy();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/^\[PC711_DUTY\] read failed ([0-9A-Z]{5}|PGRST\d{3})$/);
      // a failed read is not kept: the next request reads again (and the log says so at most once a minute)
      const readsSoFar = h.calls.length;
      await expect(h.r.get()).rejects.toBeTruthy();
      expect(h.calls.length).toBeGreaterThan(readsSoFar);
      expect(logs).toHaveLength(1);
      h.nowRef.ms += 60_001;
      await expect(h.r.get()).rejects.toBeTruthy();
      expect(logs).toHaveLength(2);
    }
  });
  it("no database client at all → the request fails (never a made-up \"off\")", async () => {
    const r = createDutyReader({ db: null, log: () => {} });
    await expect(r.get()).rejects.toBeTruthy();
  });
});

describe("E — READ ONLY", () => {
  it("in every situation: selects on three tables, no function call, no write", async () => {
    logId = 0;
    const scenes: Tables[] = [
      { app_settings: settings(null) },
      { app_settings: settings("false"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: answered(2) },
      { app_settings: settings("true"), pc711_backup_state: [STATE_IDLE], pc711_backup_log: [] },
      { app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: [logRow(T0, "duty", "took_over_silent", "written"), ...answered(1200)] },
    ];
    for (const tables of scenes) {
      const h = reader(tables, { login: "needs_login" });
      await h.r.get();
      h.nowRef.ms += DUTY_CACHE_MS + 1;
      await h.r.get();
      expect(h.rpcs).toEqual([]);
      expect(h.writes).toEqual([]);
      expect([...new Set(h.calls.map((c) => c.table))].sort().every((t) => ["app_settings", "pc711_backup_log", "pc711_backup_state"].includes(t))).toBe(true);
      // only the two setting keys are asked for
      expect(h.calls.filter((c) => c.table === "app_settings").every((c) => c.filters.join() === `key=in.(${DUTY_SWITCH_KEY},${DUTY_LEASE_KEY})`)).toBe(true);
    }
  });
  it("the module's own text: no function call, no write, and the duty function is never named in code", () => {
    const src = readFileSync("server/pc711Duty.js", "utf8");
    const code = src.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\.rpc\s*\(/);
    for (const w of [".insert(", ".update(", ".upsert(", ".delete(", "pc711_backup_duty", "admin_parcel_worker_lease", "fetch("]) expect(code, w).not.toContain(w);
    expect(code.match(/\.from\("([a-z0-9_]+)"\)/g)).toEqual(['.from("app_settings")', '.from("pc711_backup_state")', '.from("pc711_backup_log")', '.from("pc711_backup_log")']);
    expect(src).not.toMatch(/^import /m);                                       // it imports nothing
  });
});

describe("F — nothing private in the answer", () => {
  const PHONE = "0912345678", NAME = "王小美", NAME2 = "Maria Santos", STORE = "151003", TRACK = "F12345678", SELLER = "5d7e1c1a-0b8f-4a63-9c2e-1f0a2b3c4d5e", WORKER = "w-3f9a1c";
  const hostile = (label: string): Tables => {
    logId = 0;
    const dirty = (r: Row, n: number) => ({ ...r, phone: PHONE, buyer_name: NAME, receiver: NAME2, store_id: STORE, tracking_no: TRACK, seller_id: SELLER, note: `${NAME} ${PHONE} ${n}` });
    return {
      app_settings: [
        { key: DUTY_SWITCH_KEY, value: "true" },
        { key: DUTY_LEASE_KEY, value: JSON.stringify({ leader_label: label, leader_at: iso(T0), leader_id: WORKER, prev_leader_label: NAME2, leader_state: { phone: PHONE, store: STORE, queue: 3 }, seen: { [WORKER]: iso(T0) } }) },
      ],
      pc711_backup_state: [{ ...STATE_DUTY, reason: "silent", note: NAME, phone: PHONE, alerts: [PHONE, NAME] }],
      pc711_backup_log: [dirty(logRow(T0 - 3600_000, "duty", "took_over_silent", "written"), 0), dirty(logRow(T0 - 1800_000, "duty", "handed_back", "written"), 1),
        ...answered(4).map(dirty), dirty(logRow(T0 + 5, "phone", PHONE, "written", uuid(77)), 9)],
    };
  };
  it("a database that answers MORE than was asked (phone, name, store, tracking number, ids): none of it is in the answer", async () => {
    for (const label of [PHONE, NAME, NAME2, `Store ${STORE}`, TRACK, "Lenovo"]) {
      const h = reader(hostile(label), { wide: true, login: "needs_login" });
      const a = await h.r.get();
      const text = JSON.stringify(a);
      for (const secret of [PHONE, NAME, NAME2, STORE, TRACK, SELLER, WORKER, uuid(0), uuid(77), "0000-4000-8000"]) expect(text, `${label} → ${secret}`).not.toContain(secret);
      expect(a.checker.label).toBe(label === "Lenovo" ? "Lenovo" : "");
      expect(a.answered).toBe(5);
    }
  });
  it("every value is a fixed word, a yes/no, a count, a time — or the plain machine label", async () => {
    const h = reader(hostile("Lenovo"), { wide: true });
    const a = await h.r.get() as Record<string, unknown>;
    expect(Object.keys(a).sort()).toEqual(KEYS);
    const time = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
    expect(["on", "off"]).toContain(a.backup);
    for (const k of ["onDuty", "loggedOut", "answeredMore"]) expect(typeof a[k], k).toBe("boolean");
    expect(["silent", "degraded", null]).toContain(a.reason);
    expect(String(a.since)).toMatch(time);
    expect(String(a.now)).toMatch(time);
    expect(Number.isInteger(a.answered)).toBe(true);
    const checker = a.checker as Record<string, unknown>;
    expect(checker).toEqual({ label: "Lenovo", lastCallAt: iso(T0) });
    const last = a.last as Record<string, unknown>;
    expect(Object.keys(last).sort()).toEqual(["end", "reason", "start"]);
    expect(String(last.start)).toMatch(time);
    expect(String(last.end)).toMatch(time);
    expect(["silent", "degraded", null]).toContain(last.reason);
  });
  it("the log line of a failed read carries a code only — never the database's own words", async () => {
    const logs: string[] = [];
    const h = reader({ app_settings: { code: "XX000", message: `could not read row of ${NAME} ${PHONE} store ${STORE} ${TRACK}` } }, { logs });
    await expect(h.r.get()).rejects.toBeTruthy();
    expect(logs).toEqual(["[PC711_DUTY] read failed XX000"]);
    // no code, or a "code" that is not a database code (it could be anything) → the word "error"
    for (const code of [undefined, PHONE, `${NAME}`, STORE, TRACK, "x".repeat(40), "42p01", 42501]) {
      const logs2: string[] = [];
      const h2 = reader({ app_settings: { code: code as never, message: `${NAME} ${PHONE}` } }, { logs: logs2 });
      await expect(h2.r.get()).rejects.toBeTruthy();
      expect(logs2, String(code)).toEqual(["[PC711_DUTY] read failed error"]);
    }
    expect(["57014", "42P01", "XX000", "PGRST205"].map(codeWord)).toEqual(["57014", "42P01", "XX000", "PGRST205"]);
    expect([PHONE, STORE, TRACK, NAME, "", null, undefined, 5, "PGRST20", "pgrst205", "4250"].map(codeWord)).toEqual(Array(11).fill("error"));
  });
});

describe("G — the route", () => {
  const server = readFileSync("server.js", "utf8");
  // The REAL requireAdmin, lifted word for word from server.js and run with a fake "is this an admin?" answer.
  const from = server.indexOf("async function requireAdmin(req, res, next) {");
  const adminSrc = server.slice(from, server.indexOf("// ====", from));
  const realRequireAdmin = (isAdmin: unknown) => new Function("sb", "SUPABASE_URL", "SUPABASE_KEY", "createClient", `${adminSrc}; return requireAdmin;`)(
    {}, "https://x.supabase.co", "anon", () => ({ rpc: async () => (isAdmin instanceof Error ? { data: null, error: isAdmin } : { data: isAdmin, error: null }) }),
  ) as express.RequestHandler;
  const call = async (isAdmin: unknown, { token = true, allowed = true } = {}) => {
    const h = reader({ app_settings: settings("true"), pc711_backup_state: [STATE_DUTY], pc711_backup_log: answered(2) });
    const app = express();
    app.get("/admin/pc711/duty", (req, _res, next) => { (req as unknown as { authToken: string }).authToken = token ? "jwt" : ""; next(); }, realRequireAdmin(isAdmin),
      createDutyHandler({ reader: h.r, allowed: () => allowed }));
    const srv = app.listen(0);
    const port = (srv.address() as { port: number }).port;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/admin/pc711/duty`);
      return { status: r.status, body: await r.json() as Record<string, unknown>, reads: h.calls.length };
    } finally { srv.close(); }
  };
  it("the admin check is the real one (found in server.js)", () => {
    expect(from).toBeGreaterThan(0);
    expect(adminSrc).toContain('userSb.rpc("is_admin")');
    expect(adminSrc).toContain("if (error || data !== true) return deny();");
  });
  it("NOT an admin → 403, and the database is not read at all", async () => {
    for (const notAdmin of [false, null, "true", 1, new Error("database down")]) {
      const r = await call(notAdmin);
      expect({ status: r.status, body: r.body, reads: r.reads }).toEqual({ status: 403, body: { success: false, error: "forbidden" }, reads: 0 });
    }
  });
  it("no login token → 403, nothing read", async () => {
    const r = await call(true, { token: false });
    expect([r.status, r.reads]).toEqual([403, 0]);
  });
  it("an admin → the answer", async () => {
    const r = await call(true);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(KEYS);
    expect([r.body.backup, r.body.onDuty, r.body.answered]).toEqual(["on", true, 2]);
  });
  it("the limiter refuses → 429, nothing read", async () => {
    const r = await call(true, { allowed: false });
    expect({ status: r.status, body: r.body, reads: r.reads }).toEqual({ status: 429, body: { error: "rate_limited" }, reads: 0 });
  });
  it("a failed read → 500 with one fixed word", async () => {
    const res = { code: 0, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await createDutyHandler({ reader: { get: async () => { throw new Error("0912345678"); } } })({ authUserId: "a" }, res);
    expect([res.code, res.body]).toEqual([500, { error: "failed" }]);
  });
  it("server.js: the route is behind requireAuth THEN requireAdmin, GET only, and the reader gets no way to write", () => {
    expect(server).toContain('import { createDutyDb, createDutyReader, createDutyHandler } from "./server/pc711Duty.js";');
    expect(server).toContain('const pc711DutyReader = createDutyReader({ db: serviceSb ? createDutyDb(serviceSb) : null, loginState: () => pc711.status().state });');
    expect(server).toContain('app.get("/admin/pc711/duty", requireAuth, requireAdmin, createDutyHandler({ reader: pc711DutyReader, allowed: pc711StatusAllowed }));');
    expect(server.match(/\/admin\/pc711\/duty/g)).toHaveLength(1);                // one route, one method
    expect(server.match(/pc711DutyReader/g)).toHaveLength(2);                     // made once, used once
  });
});
