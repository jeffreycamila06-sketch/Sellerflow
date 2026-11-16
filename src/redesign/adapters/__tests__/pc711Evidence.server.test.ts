// @vitest-environment node
// 7-11 shadow checker — full evidence, re-checks, re-asks and mirror mode (server/pc711Evidence.js +
// the loop in server/pc711Shadow.js, sql/172). The REAL job runs on a fake database and a virtual clock.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createPc711Shadow, SHADOW_BRAKE_PAUSE_MS, SHADOW_ROW_GAP_MS } from "../../../../server/pc711Shadow.js";
import {
  badInputRule, changeFlagOf, sameInstant, evidenceJobs, evidenceRow, pairPatch, oldRowFromPair, reaskWord, nextReaskAt,
  MIRROR_SWITCH, EXT_LIMIT_MS, REASK_AFTER_MS, EVIDENCE_KEEP_DAYS,
} from "../../../../server/pc711Evidence.js";

const NOW = Date.parse("2026-11-17T04:00:00Z"); // 12:00 Taipei
const PHONE = "0912345678", NEW_PHONE = "0920000000", NAME = "陳小美", STORE = "151003";
const ago = (min: number, from = NOW) => new Date(from - min * 60_000).toISOString();
let seq = 0;
const id = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
type Row = Record<string, unknown>;
// one row as pc711_evidence_pending returns it
const pend = (kind: string, o: Row = {}): Row => {
  const at = (o.at as string) ?? ago(2);
  return {
    scan_id: id(), kind, ext: kind === "phone" ? "ok" : "open", at, store_id: STORE, phone: kind === "phone" ? PHONE : null,
    customer_name: kind === "phone" ? NAME : null, input: kind === "phone" ? PHONE : STORE, seller_id: "seller-1", created_at: ago(3),
    msg: null, until: null, cache_at: kind === "phone" ? at : null, source: "fresh", prev_input: null, prev_ext_at: null, round: 1, ...o,
  };
};
// one row as pc711_mirror_pending returns it (no extension verdict yet)
const mpend = (kind: string, o: Row = {}): Row => ({
  scan_id: id(), kind, store_id: STORE, phone: kind === "phone" ? PHONE : null, customer_name: kind === "phone" ? NAME : null,
  input: kind === "phone" ? PHONE : STORE, seller_id: "seller-1", at: ago(0.2), created_at: ago(0.2), round: 1, ...o,
});
const OK = (i: { kind: string }) => ({ verdict: i.kind === "phone" ? "ok" : "open", http: 200, ms: 900, kind: "", raw: i.kind === "phone" ? "Status:true" : "enable", steps: [] });
const RESTRICTED = () => ({ verdict: "restricted", http: 200, ms: 900, kind: "", raw: "Status:false-restricted", steps: [] });
const REFUSE = () => ({ verdict: "unknown", http: 429, ms: 300, kind: "http", steps: [{ step: "phone.token", http: 429, ms: 300, ok: false, note: "kind=http" }] });

function harness(o: { queue?: Row[]; mqueue?: Row[]; mirror?: boolean; check?: (i: Record<string, string>) => unknown; awaitingRows?: () => Row[]; parcels?: Record<string, Row | null>; start?: number } = {}) {
  let t = o.start ?? NOW;
  const logs: string[] = [], oldRows: Row[] = [], evRows: Row[] = [], updates: [unknown, Row][] = [];
  const settings: Record<string, string> = { pc711_shadow_enabled: "true", [MIRROR_SWITCH]: o.mirror ? "true" : "false" };
  const written = (r: Row) => evRows.some((x) => x.scan_id === r.scan_id && x.kind === r.kind && x.input === r.input);
  const queue = o.queue ?? [], mqueue = o.mqueue ?? [];
  // every database request the job makes (the parts INSIDE pc711_shadow_pass are not requests)
  const requests: string[] = [];
  const req = <A extends unknown[], R>(name: string, f: (...a: A) => R) => vi.fn((...a: A) => { requests.push(name); return f(...a); });
  const db = {
    pending: req("db.pending", async () => ({ waiting: 0, jobs: [] })), dayMax: req("db.dayMax", async () => ({})), saveDayMax: req("db.saveDayMax", async () => {}),
    insert: req("db.insert", async (r: Row) => { oldRows.push(r); }), purgeBefore: req("db.purgeBefore", async () => {}),
  };
  // the parts of the one pass call (sql/172 pc711_shadow_pass), each a fake of its SQL function
  const part = {
    pending: vi.fn(async () => { const w = queue.filter((r) => !written(r)); return { waiting: w.length, jobs: w }; }),
    mirrorPending: vi.fn(async () => { const w = mqueue.filter((r) => !written(r)); return { waiting: w.length, jobs: w }; }),
    awaiting: vi.fn(async () => (o.awaitingRows ? o.awaitingRows() : [])),
    reasksDue: vi.fn(async (nowIso: string) => evRows.filter((r) => r.reask_next_at && Date.parse(String(r.reask_next_at)) <= Date.parse(nowIso))
      .map((r) => ({ id: r.id, scan_id: r.scan_id, kind: r.kind, phone: r.phone, store_id: r.store_id, reask_n: r.reask_n, srv_finished_at: r.srv_finished_at }))),
  };
  const ev = {
    ...part,
    pass: req("ev.pass", async (_since: string, _limit: number, reaskLimit: number, mirrorAllowed: boolean) => {
      const q = await part.pending();
      const mirror = settings[MIRROR_SWITCH] === "true";
      return { ...q, mirror, reasks: (await part.reasksDue(new Date(t).toISOString())).slice(0, reaskLimit), awaiting: await part.awaiting(),
        mirrorQueue: mirror && mirrorAllowed ? await part.mirrorPending() : null };
    }),
    insert: req("ev.insert", async (r: Row) => { evRows.push({ ...r, id: evRows.length + 1, reask_n: 0 }); }),
    update: req("ev.update", async (rid: unknown, p: Row) => { updates.push([rid, p]); const x = evRows.find((r) => r.id === rid); if (x) Object.assign(x, p); }),
    parcelForReask: req("ev.parcelForReask", async (sid: string) => (o.parcels && sid in o.parcels ? o.parcels[sid] : { phone: PHONE, customer_name: NAME, store_id: STORE })),
  };
  const check = vi.fn(async (i: Record<string, string>) => { t += 900; return o.check ? o.check(i) : OK(i as { kind: string }); });
  const job = createPc711Shadow({
    db, evidence: ev, check, pc711: { status: () => ({ state: "connected", since: "c1" }) },
    readSetting: req("readSetting", async (k: string) => settings[k] ?? null), now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { t += ms; },
  });
  return { job, db, ev, check, logs, oldRows, evRows, updates, settings, requests, at: () => t, advance: (ms: number) => { t += ms; } };
}
const noPhoneIn = (lines: string[]) => lines.every((l) => !/09\d{8}/.test(l) && !l.includes(NAME));

describe("pure helpers", () => {
  it("bad_input names WHICH rule failed (never the value)", () => {
    expect(badInputRule({ kind: "phone", phone: "" })).toBe("phone_empty");
    expect(badInputRule({ kind: "phone", phone: "0912-345-678" })).toBe("phone_not_digits");
    expect(badInputRule({ kind: "phone", phone: "0812345678" })).toBe("phone_not_09");
    expect(badInputRule({ kind: "phone", phone: "091234567" })).toBe("phone_length");
    expect(badInputRule({ kind: "phone", phone: " 0912345678 " })).toBeNull(); // the probe trims too
    expect(badInputRule({ kind: "store", storeId: "" })).toBe("store_empty");
    expect(badInputRule({ kind: "store", storeId: "15100A" })).toBe("store_not_digits");
    expect(badInputRule({ kind: "frozen", storeId: "15100" })).toBe("store_length");
    expect(badInputRule({ kind: "store", storeId: STORE })).toBeNull();
  });
  it("a changed value with the SAME verdict time → *_changed_verdict_kept; a new verdict time → no flag", () => {
    const at = "2026-11-17 03:58:00.123456+00";
    expect(changeFlagOf({ kind: "phone", value: NEW_PHONE, prevInput: PHONE, prevExtAt: at, extAtRaw: at })).toBe("phone_changed_verdict_kept");
    expect(changeFlagOf({ kind: "store", value: "222222", prevInput: STORE, prevExtAt: at, extAtRaw: at })).toBe("store_changed_verdict_kept");
    expect(changeFlagOf({ kind: "phone", value: NEW_PHONE, prevInput: PHONE, prevExtAt: at, extAtRaw: "2026-11-17 03:59:00+00" })).toBeNull();
    expect(changeFlagOf({ kind: "phone", value: PHONE, prevInput: null, prevExtAt: null, extAtRaw: at })).toBeNull();
    expect(sameInstant("2026-11-17 03:58:00.123456+00", "2026-11-17 03:58:00.123456+00")).toBe(true);
  });
  it("re-ask words + times: ~30 s, then ~5 min after the check; no third", () => {
    expect(REASK_AFTER_MS).toEqual([30_000, 300_000]);
    expect(reaskWord("ok", null)).toBe("ok");
    expect(reaskWord("unknown", "timeout")).toBe("err_timeout");
    const row = { srv_finished_at: new Date(NOW).toISOString() };
    expect(nextReaskAt(row, 1, NOW + 31_000)).toBe(new Date(NOW + 300_000).toISOString());
    expect(nextReaskAt(row, 2, NOW + 301_000)).toBeNull();
  });
  it("the limits: extension late after 15 min; evidence kept 7 days", () => {
    expect(EXT_LIMIT_MS).toBe(15 * 60_000);
    expect(EVIDENCE_KEEP_DAYS).toBe(7);
  });
});

describe("Part 1 — evidence for every check", () => {
  it("each check writes the full evidence row: parcel, seller, store, FULL phone, times, both verdicts, source, waiting — never the name", async () => {
    const q = [pend("phone", { source: "fresh" }), pend("store", { source: "fresh" })];
    const h = harness({ queue: q });
    await h.job.tick();
    expect(h.evRows).toHaveLength(2);
    const p = h.evRows.find((r) => r.kind === "phone")!;
    expect(p).toMatchObject({ scan_id: q[0].scan_id, seller_id: "seller-1", round: 1, mode: "after", input: PHONE, phone: PHONE, store_id: STORE,
      parcel_created_at: q[0].created_at, ext_at: q[0].at, ext_verdict: "ok", ext_source: "fresh", srv_verdict: "ok", srv_raw: "Status:true", match: true, queue_waiting: 2 });
    expect(Date.parse(String(p.srv_finished_at)) - Date.parse(String(p.srv_started_at))).toBe(900);
    const s = h.evRows.find((r) => r.kind === "store")!;
    expect(s.phone).toBeNull();
    expect(s.ext_age_s).toBe(Math.round((Date.parse(String(s.srv_started_at)) - Date.parse(String(q[1].at))) / 1000)); // how old the extension's answer was
    expect(JSON.stringify(h.evRows)).not.toContain(NAME);
    expect(h.oldRows).toHaveLength(2); // pc711_shadow keeps its first-check row (existing totals)
  });
  it("a REMEMBERED 'restricted' vs a fresh server 'ok' is labelled remembered, with the cache time, the message and the date", async () => {
    const q = [pend("phone", { ext: "restricted", source: "remembered", cache_at: ago(300), msg: "此手機號碼暫停服務至2026/11/30", until: "2026-11-30" })];
    const h = harness({ queue: q });
    await h.job.tick();
    expect(h.evRows[0]).toMatchObject({ ext_verdict: "restricted", srv_verdict: "ok", match: false, ext_source: "remembered", ext_cache_at: ago(300),
      ext_message: "此手機號碼暫停服務至2026/11/30", ext_restricted_until: "2026-11-30" });
  });
  it("a number changed after 'restricted' gets a SECOND shadow row (round 2, same parcel, the new number)", async () => {
    const first = pend("phone", { ext: "restricted", at: ago(10) });
    const h = harness({ queue: [first], check: () => RESTRICTED() });
    await h.job.tick();
    expect(h.evRows).toHaveLength(1);
    // the seller changes the number; the extension checks the new one
    (h.ev.pending as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(async () => ({ waiting: 1, jobs: [
      { ...first, phone: NEW_PHONE, input: NEW_PHONE, ext: "ok", at: ago(1), prev_input: PHONE, prev_ext_at: first.at, round: 2 }] }));
    h.check.mockImplementation(async () => OK({ kind: "phone" }));
    h.advance(6000);
    await h.job.tick();
    expect(h.evRows).toHaveLength(2);
    expect(h.evRows[1]).toMatchObject({ scan_id: first.scan_id, round: 2, input: NEW_PHONE, phone: NEW_PHONE, ext_verdict: "ok", flag: null });
    expect(h.check.mock.calls[1][0]).toMatchObject({ kind: "phone", phone: NEW_PHONE });
  });
  it("a changed phone / store whose verdict was KEPT is flagged", async () => {
    const at = ago(10);
    const h = harness({ queue: [pend("phone", { input: NEW_PHONE, phone: NEW_PHONE, at, prev_input: PHONE, prev_ext_at: at, round: 2 }),
      pend("store", { input: "222222", store_id: "222222", at, prev_input: STORE, prev_ext_at: at, round: 2 })] });
    await h.job.tick();
    expect(h.evRows.map((r) => r.flag).sort()).toEqual(["phone_changed_verdict_kept", "store_changed_verdict_kept"]);
  });
  it("bad_input records the rule name", async () => {
    const h = harness({ queue: [pend("phone", { phone: "0912-345-678", input: "0912-345-678" })],
      check: () => ({ verdict: "unknown", http: 0, ms: 1, kind: "bad_input", steps: [{ step: "phone.config", http: 0, ms: 0, ok: false, note: "bad_input" }] }) });
    for (let i = 0; i < 7; i++) { await h.job.tick(); h.advance(130_000); } // past the phone ladder → the error row
    expect(h.evRows[0]).toMatchObject({ bad_input_rule: "phone_not_digits", fail_reason: "bad_input", fail_step: "input" });
    expect(h.evRows[0].fail_at).toBeTruthy();
  });
  it("lateness: the row records how many jobs were waiting when it was picked", async () => {
    const h = harness({ queue: [pend("store"), pend("store"), pend("store")] });
    await h.job.tick();
    expect(h.evRows.map((r) => r.queue_waiting)).toEqual([3, 3, 3]);
  });
});

describe("re-asks (a real phone mismatch only)", () => {
  it("a real mismatch gets TWO re-asks (~30 s and ~5 min) with their words and times; a match gets none", async () => {
    const mis = pend("phone", { ext: "restricted" });
    const h = harness({ queue: [mis, pend("phone", { phone: "0933333333", input: "0933333333" })] });
    await h.job.tick();
    const row = h.evRows.find((r) => r.scan_id === mis.scan_id)!;
    expect(row.match).toBe(false);
    expect(Date.parse(String(row.reask_next_at)) - Date.parse(String(row.srv_finished_at))).toBe(30_000);
    expect(h.evRows.find((r) => r.scan_id !== mis.scan_id)!.reask_next_at).toBeNull(); // a match: no re-ask
    h.advance(31_000); await h.job.tick();
    expect(row).toMatchObject({ reask_n: 1, reask1_word: "ok" });
    expect(row.reask1_at).toBeTruthy();
    expect(Date.parse(String(row.reask_next_at)) - Date.parse(String(row.srv_finished_at))).toBe(300_000);
    h.advance(60_000); await h.job.tick();
    expect(row.reask_n).toBe(1); // not due yet
    h.advance(240_000); await h.job.tick();
    expect(row).toMatchObject({ reask_n: 2, reask2_word: "ok", reask_next_at: null });
    const asks = h.check.mock.calls.filter((c) => (c[0] as { phone: string }).phone === PHONE);
    expect(asks).toHaveLength(3); // the check + 2 re-asks
    expect(asks[1][0]).toMatchObject({ kind: "phone", phone: PHONE, name: NAME }); // the name comes from the parcel, never stored
  });
  it("a phone changed before the re-ask → recorded as phone_changed, nothing asked", async () => {
    const mis = pend("phone", { ext: "restricted" });
    const h = harness({ queue: [mis], parcels: { [String(mis.scan_id)]: { phone: NEW_PHONE, customer_name: NAME, store_id: STORE } } });
    await h.job.tick();
    h.advance(31_000); await h.job.tick();
    expect(h.evRows[0]).toMatchObject({ reask_n: 1, reask1_word: "phone_changed", reask_next_at: null });
    expect(h.check).toHaveBeenCalledTimes(1);
  });
});

describe("the safety brake covers re-asks and mirror checks", () => {
  it("brake on → no re-ask and no mirror check until the pause ends", async () => {
    const mis = pend("phone", { ext: "restricted" });
    const fails = Array.from({ length: 5 }, () => pend("store"));
    let refuse = false;
    const h = harness({ queue: [mis, ...fails], mirror: true, mqueue: [mpend("phone")], check: (i) => (refuse ? REFUSE() : OK(i as { kind: string })) });
    // the mismatch is checked first (re-ask due later); then 7-11 refuses everything → the brake
    (h.ev.mirrorPending as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(async () => ({ waiting: 0, jobs: [] }));
    await h.job.tick();
    refuse = true;
    for (let i = 0; i < 20 && !h.logs.some((l) => l.includes(" pause ")); i++) { h.advance(20_000); await h.job.tick(); }
    expect(h.logs.some((l) => l.includes(" pause 15m"))).toBe(true);
    const calls = h.check.mock.calls.length, due = h.ev.reasksDue.mock.calls.length, mp = h.ev.mirrorPending.mock.calls.length;
    (h.ev.mirrorPending as unknown as { mockImplementation: (f: () => unknown) => void }).mockImplementation(async () => ({ waiting: 1, jobs: [mpend("phone")] }));
    for (let i = 0; i < 5; i++) { h.advance(60_000); expect(await h.job.tick()).toEqual({ skipped: "paused" }); }
    expect(h.check.mock.calls.length).toBe(calls);        // nothing asked of 7-11
    expect(h.ev.reasksDue.mock.calls.length).toBe(due);   // no re-ask
    expect(h.ev.mirrorPending.mock.calls.length).toBe(mp); // no mirror check
    h.advance(SHADOW_BRAKE_PAUSE_MS); refuse = false;
    await h.job.tick();
    expect(h.check.mock.calls.length).toBeGreaterThan(calls); // resumes after the pause
  });
  it("a refused re-ask counts towards the brake like any other request", async () => {
    const rows = Array.from({ length: 5 }, () => pend("phone", { ext: "restricted", phone: PHONE, input: PHONE }));
    const h = harness({ queue: rows });
    await h.job.tick(); // 5 mismatches → 5 re-asks due
    h.check.mockImplementation(async () => { h.advance(300); return REFUSE(); });
    h.advance(31_000); await h.job.tick();
    expect(h.logs.some((l) => l.includes(" pause 15m"))).toBe(true);
    expect(h.evRows.filter((r) => r.reask1_word === "err_http")).toHaveLength(5);
  });
});

describe("Part 2 — mirror mode", () => {
  it("switch on: the server checks a parcel still waiting for the extension, then pairs: who was first, by how many ms", async () => {
    const m = mpend("phone");
    let awaiting: Row[] = [];
    const h = harness({ mirror: true, mqueue: [m], awaitingRows: () => awaiting });
    await h.job.tick();
    const row = h.evRows[0];
    expect(row).toMatchObject({ mode: "mirror", scan_id: m.scan_id, phone: PHONE, ext_verdict: null, match: null, srv_verdict: "ok" });
    expect(row.seen_waiting_at).toBe(new Date(NOW).toISOString());
    expect(h.oldRows).toHaveLength(0); // the pc711_shadow row waits for the pair
    // the extension answers 4 s after the server finished
    const extAt = new Date(Date.parse(String(row.srv_finished_at)) + 4000).toISOString();
    awaiting = [{ ...row, id: row.id, cur_input: PHONE, ext: "ok", ext_at: extAt, source: "fresh", cache_at: extAt, gone: false, ext_timeout: false }];
    h.advance(5000); await h.job.tick();
    const patch = h.updates.find(([rid]) => rid === row.id)![1];
    expect(patch).toMatchObject({ ext_verdict: "ok", match: true, first: "server", first_by_ms: 4000, ext_late: false, pair_closed: true, ext_source: "fresh" });
    expect(h.oldRows).toHaveLength(1); // now the existing totals count it too
  });
  it("the extension answers after 15 min → the SAME row, marked late (the pair is kept)", () => {
    const p = pairPatch({ id: 1, kind: "store", input: STORE, cur_input: STORE, ext: "full", ext_at: ago(0), srv_started_at: ago(20), srv_finished_at: ago(19.9),
      srv_verdict: "open", source: "unknown", ext_timeout: true, gone: false }, NOW);
    expect(p).toMatchObject({ ext_verdict: "full", ext_late: true, match: false, first: "server", pair_closed: true });
    expect(p!.ext_age_s).toBe(-1200); // the answer came AFTER the server asked (negative age)
  });
  it("no answer yet → keep waiting; deleted parcel or changed value → stop waiting with the reason", () => {
    const base = { id: 1, kind: "phone", input: PHONE, srv_finished_at: ago(1), srv_verdict: "ok" };
    expect(pairPatch({ ...base, cur_input: PHONE, ext: null, gone: false }, NOW)).toBeNull();
    expect(pairPatch({ ...base, gone: true }, NOW)).toEqual({ pair_closed: true, flag: "parcel_gone" });
    expect(pairPatch({ ...base, cur_input: NEW_PHONE, ext: "ok", gone: false }, NOW)).toEqual({ pair_closed: true, flag: "value_changed_before_answer" });
  });
  it("a mirror mismatch on a phone schedules the two re-asks at pairing", () => {
    const p = pairPatch({ id: 1, kind: "phone", input: PHONE, cur_input: PHONE, ext: "restricted", ext_at: ago(0.5), srv_finished_at: ago(0.6), srv_verdict: "ok", source: "remembered", gone: false }, NOW);
    expect(p).toMatchObject({ match: false, ext_source: "remembered" });
    expect(Date.parse(p!.reask_next_at as string)).toBe(NOW); // finished + 30 s is already past → now
    expect(oldRowFromPair({ scan_id: "s", kind: "phone", srv_verdict: "ok", srv_ms: 9, srv_http: 200, steps: [], srv_raw: "Status:true" }, p!)).toMatchObject({ note: "mirror", match: false, ext_verdict: "restricted" });
  });
  it("switch OFF = exactly Part 1: no mirror queue read, no mirror check, same checks in the same order", async () => {
    const q = [pend("store"), pend("phone"), pend("store")];
    const off = harness({ queue: q });
    await off.job.tick();
    expect(off.ev.mirrorPending).not.toHaveBeenCalled();
    expect(off.evRows.every((r) => r.mode === "after")).toBe(true);
    expect(off.check.mock.calls.map((c) => c[0])).toEqual(q.map((r) => r.kind === "phone" ? { kind: "phone", phone: PHONE, name: NAME, storeId: STORE } : { kind: "store", storeId: STORE }));
    // rows left waiting from an earlier mirror run are read INSIDE the one pass call (no extra request)
    off.advance(6000); await off.job.tick();
    expect(off.ev.mirrorPending).not.toHaveBeenCalled();
  });
  it("switching off takes effect on the next poll", async () => {
    const h = harness({ mirror: true, mqueue: [mpend("phone"), mpend("phone", { phone: "0933333333", input: "0933333333" })] });
    h.check.mockImplementationOnce(async (i) => { h.advance(900); return OK(i as { kind: string }); });
    await h.job.tick();
    const n = h.ev.mirrorPending.mock.calls.length;
    h.settings[MIRROR_SWITCH] = "false";
    h.advance(5000); await h.job.tick();
    expect(h.ev.mirrorPending.mock.calls.length).toBe(n);
  });
  it("01:00–05:00 Taipei: mirror is not run (after-mode only)", async () => {
    const h = harness({ mirror: true, mqueue: [mpend("phone")], start: Date.parse("2026-11-16T18:30:00Z") }); // 02:30 Taipei
    await h.job.tick();
    expect(h.ev.mirrorPending).not.toHaveBeenCalled();
    expect(h.logs.some((l) => l.includes("mirror=1"))).toBe(false);
  });
  it("mirror checks keep the 2 s gap with every other request", async () => {
    const h = harness({ mirror: true, mqueue: [mpend("phone"), mpend("store")], queue: [pend("store")] });
    const starts: number[] = [];
    h.check.mockImplementation(async (i) => { starts.push(h.at()); h.advance(900); return OK(i as { kind: string }); });
    await h.job.tick();
    expect(starts).toHaveLength(3);
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(900 + SHADOW_ROW_GAP_MS - 900);
  });
});

describe("database requests per idle pass", () => {
  for (const mirror of [false, true]) {
    it(`mirror ${mirror ? "on" : "off"}: an idle pass = the shadow switch + ONE pass call (queue, re-asks, mirror switch, mirror queue, waiting pairs)`, async () => {
      const h = harness({ mirror });
      await h.job.tick(); // the first pass of a Taipei day also purges + loads the day's highest Waiting (once a day)
      h.requests.length = 0;
      for (let i = 0; i < 3; i++) { h.advance(5000); await h.job.tick(); }
      expect(h.requests).toEqual(["readSetting", "ev.pass", "readSetting", "ev.pass", "readSetting", "ev.pass"]);
      expect(h.ev.mirrorPending).toHaveBeenCalledTimes(mirror ? 4 : 0); // inside the pass call only
    });
  }
});

describe("logs and privacy", () => {
  it("no phone (and no name) in ANY log line, across checks, re-checks, re-asks, mirror and errors", async () => {
    const mis = pend("phone", { ext: "restricted" });
    let awaiting: Row[] = [];
    const h = harness({ queue: [mis, pend("phone", { phone: "0912-345-678", input: "0912-345-678" })], mirror: true, mqueue: [mpend("phone")], awaitingRows: () => awaiting });
    await h.job.tick();
    const mrow = h.evRows.find((r) => r.mode === "mirror")!;
    awaiting = [{ ...mrow, cur_input: PHONE, ext: "restricted", ext_at: ago(0), source: "fresh", gone: false }];
    for (let i = 0; i < 12; i++) { h.advance(30_000); await h.job.tick(); }
    expect(h.logs.length).toBeGreaterThan(5);
    expect(h.logs.some((l) => l.includes("reask"))).toBe(true);
    expect(h.logs.some((l) => l.includes("mirror pair"))).toBe(true);
    expect(noPhoneIn(h.logs)).toBe(true);
    expect(h.logs.join("\n")).not.toContain("此手機");
  });
  it("evidenceRow never carries the buyer's name; evidenceJobs keeps the name only on the in-memory input", () => {
    const [j] = evidenceJobs([pend("phone")], "after");
    expect(j.input).toMatchObject({ name: NAME });
    const r = evidenceRow(j, { srv_verdict: "ok", raw: "Status:true", srv_http: 200, srv_ms: 900, match: true, fail_reason: null, steps: [] }, {}, NOW, NOW + 900, 1, NOW);
    expect(JSON.stringify(r)).not.toContain(NAME);
  });
});

describe("wiring", () => {
  const server = readFileSync("server.js", "utf8");
  it("the evidence routes are Admin only (requireAuth + requireAdmin) and the job gets the evidence store", () => {
    for (const r of ['"/admin/pc711/evidence/totals"', '"/admin/pc711/evidence"', '"/admin/pc711/evidence/:id"']) {
      expect(server).toContain(`app.get(${r}, requireAuth, requireAdmin,`);
    }
    expect(server).toContain("createPc711Shadow({ db: pc711ShadowDb, evidence: pc711EvidenceDb, check: pc711ShadowCheck, pc711, readSetting })");
  });
  it("neither module writes parcel_scans or touches /cart/finish; the evidence module only READS one parcel for a re-ask", () => {
    for (const f of ["server/pc711Evidence.js", "server/pc711Shadow.js"]) {
      const src = readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"); // code only
      expect(src).not.toMatch(/from\("parcel_scans"\)\.(update|insert|upsert|delete)/);
      expect(src).not.toContain("cart/finish");
    }
    const ev = readFileSync("server/pc711Evidence.js", "utf8");
    expect(ev.match(/from\("parcel_scans"\)/g)).toHaveLength(1);
    expect(ev).toContain('from("parcel_scans").select("phone,customer_name,store_id").eq("id", scanId).limit(1)');
  });
  it("no log call in the evidence code prints a phone, a message or a name variable", () => {
    const src = readFileSync("server/pc711Shadow.js", "utf8");
    for (const line of src.split("\n").filter((l) => l.includes("say(`"))) {
      expect(line).not.toMatch(/\.phone|customer_name|\.msg|ext_message|\.name\b|input\b/);
    }
  });
});
