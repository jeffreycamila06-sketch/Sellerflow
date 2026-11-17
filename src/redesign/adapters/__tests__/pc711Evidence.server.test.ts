// @vitest-environment node
// 7-11 shadow checker — full evidence, re-checks, re-asks and mirror mode (server/pc711Evidence.js +
// the loop in server/pc711Shadow.js, sql/172). The REAL job runs on a fake database and a virtual clock.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createPc711Shadow, SHADOW_BRAKE_PAUSE_MS, SHADOW_ROW_GAP_MS } from "../../../../server/pc711Shadow.js";
import {
  selfStopDecision, SELF_STOP_EVERY_MS, SELF_STOP_WINDOW_MS, SELF_STOP_MIN_PARCELS, SELF_STOP_PHONE_MEDIAN_S, SELF_STOP_WAITED, SELF_STOP_STORE_UNKNOWN, SELF_STOP_SILENT_MS,
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

function harness(o: { health?: (fromIso: string) => Row | null; saveFails?: () => boolean; updateFails?: () => boolean; queue?: Row[]; mqueue?: Row[]; mirror?: boolean; check?: (i: Record<string, string>) => unknown; awaitingRows?: () => Row[]; parcels?: Record<string, Row | null>; start?: number; status?: () => Row } = {}) {
  let t = o.start ?? NOW;
  const logs: string[] = [], oldRows: Row[] = [], evRows: Row[] = [], updates: [unknown, Row][] = [];
  const settings: Record<string, string> = { pc711_shadow_enabled: "true", [MIRROR_SWITCH]: o.mirror ? "true" : "false" };
  const written = (r: Row) => evRows.some((x) => x.scan_id === r.scan_id && x.kind === r.kind && x.input === r.input);
  const queue = o.queue ?? [], mqueue = o.mqueue ?? [];
  // every database request the job makes (the parts INSIDE pc711_shadow_pass are not requests)
  const requests: string[] = [];
  const stops: Row[] = [], healthAsked: string[] = [];
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
    stopMirror: req("ev.stopMirror", async (rule: string, value: number, from: string, parcels: number) => {
      stops.push({ rule, value, from, parcels });
      if (settings[MIRROR_SWITCH] !== "true") return false;
      settings[MIRROR_SWITCH] = "false"; // the only write it can make
      return true;
    }),
    pass: req("ev.pass", async (_since: string, _limit: number, reaskLimit: number, mirrorAllowed: boolean, healthFrom: string | null = null) => {
      if (settings.pc711_shadow_enabled !== "true") return { shadow: false, waiting: 0, jobs: [], mirror: false, reasks: [], awaiting: [], mirrorQueue: null };
      const q = await part.pending();
      const mirror = settings[MIRROR_SWITCH] === "true";
      return { shadow: true, ...q, mirror, reasks: (await part.reasksDue(new Date(t).toISOString())).slice(0, reaskLimit), awaiting: await part.awaiting(),
        mirrorQueue: mirror && mirrorAllowed ? await part.mirrorPending() : null,
        health: mirror && mirrorAllowed && healthFrom ? (healthAsked.push(healthFrom), o.health ? o.health(healthFrom) : null) : null };
    }),
    insert: req("ev.insert", async (r: Row) => { if (o.saveFails?.()) throw new Error("db down"); evRows.push({ ...r, id: evRows.length + 1, reask_n: 0 }); }),
    update: req("ev.update", async (rid: unknown, p: Row) => { if (o.updateFails?.()) throw new Error("db down"); updates.push([rid, p]); const x = evRows.find((r) => r.id === rid); if (x) Object.assign(x, p); }),
    parcelForReask: req("ev.parcelForReask", async (sid: string) => (o.parcels && sid in o.parcels ? o.parcels[sid] : { phone: PHONE, customer_name: NAME, store_id: STORE })),
  };
  const check = vi.fn(async (i: Record<string, string>) => { t += 900; return o.check ? o.check(i) : OK(i as { kind: string }); });
  const job = createPc711Shadow({
    db, evidence: ev, check, pc711: { status: () => (o.status ? o.status() : { state: "connected", since: "c1" }) },
    readSetting: req("readSetting", async (k: string) => settings[k] ?? null), now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { t += ms; },
  });
  return { job, db, ev, check, logs, oldRows, evRows, updates, settings, requests, stops, healthAsked, at: () => t, advance: (ms: number) => { t += ms; } };
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
    expect(p).toMatchObject({ ext_verdict: "full", ext_late: true, match: false, first: null, first_by_ms: null, pair_closed: true }); // source unknown → no winner
    expect(p!.ext_age_s).toBe(-1200); // the answer came AFTER the server asked (negative age)
  });
  it("who finished first: only a FRESH extension answer counts; a remembered one (16 h old) or an unknown source has no winner", () => {
    const base = { id: 1, kind: "phone", input: PHONE, cur_input: PHONE, ext: "ok", srv_started_at: ago(1), srv_finished_at: ago(0.9), srv_verdict: "ok", gone: false, ext_timeout: false };
    const fresh = pairPatch({ ...base, source: "fresh", ext_at: ago(0.8) }, NOW)!;
    expect(fresh).toMatchObject({ first: "server", first_by_ms: 6000, ext_source: "fresh" });
    const old = pairPatch({ ...base, source: "remembered", ext_at: ago(16 * 60), cache_at: ago(16 * 60) }, NOW)!;
    expect(old).toMatchObject({ first: null, first_by_ms: null, ext_source: "remembered", match: true, pair_closed: true });
    for (const source of ["unknown", null, "weird"]) expect(pairPatch({ ...base, source, ext_at: ago(0.8) }, NOW)).toMatchObject({ first: null, first_by_ms: null, ext_source: "unknown" });
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
    it(`mirror ${mirror ? "on" : "off"}: an idle pass = ONE request (shadow switch, queue, re-asks, mirror switch, mirror queue, waiting pairs)`, async () => {
      const h = harness({ mirror });
      await h.job.tick(); // the first pass of a Taipei day also purges + loads the day's highest Waiting (once a day)
      h.requests.length = 0;
      for (let i = 0; i < 3; i++) { h.advance(5000); await h.job.tick(); }
      expect(h.requests).toEqual(["ev.pass", "ev.pass", "ev.pass"]);
      expect(h.ev.mirrorPending).toHaveBeenCalledTimes(mirror ? 4 : 0); // inside the pass call only
    });
  }
});

describe("the shadow switch comes back in the same call", () => {
  it("off stops everything on the next pass: no check, no re-ask, no mirror, no write — and on again resumes", async () => {
    const mis = pend("phone", { ext: "restricted" });
    const h = harness({ queue: [mis, pend("store")], mirror: true, mqueue: [mpend("phone")] });
    await h.job.tick();
    const checks = h.check.mock.calls.length;
    expect(checks).toBeGreaterThan(0);
    h.settings.pc711_shadow_enabled = "false";
    h.requests.length = 0;
    h.advance(31_000); // a re-ask is due
    expect(await h.job.tick()).toEqual({ skipped: "off" });
    expect(h.check.mock.calls.length).toBe(checks);
    expect(h.requests).toEqual(["ev.pass"]); // one request, nothing written
    h.settings.pc711_shadow_enabled = "true";
    h.advance(5000); await h.job.tick();
    expect(h.check.mock.calls.length).toBeGreaterThan(checks);
  });
  it("no database request at all while 7-11 is not connected or the brake is on", async () => {
    const h = harness();
    await h.job.tick();
    h.requests.length = 0;
    // the brake: force a pause through 5 refusals is covered elsewhere; here: not connected
    const st = { state: "needs_login", since: "c1" };
    const j2 = createPc711Shadow({ db: { pending: vi.fn(), dayMax: vi.fn(), saveDayMax: vi.fn(), insert: vi.fn(), purgeBefore: vi.fn() }, evidence: h.ev, check: h.check,
      pc711: { status: () => st }, readSetting: vi.fn(), now: () => NOW, log: () => {}, sleep: async () => {} });
    expect(await j2.tick()).toEqual({ skipped: "not_connected" });
    expect(h.requests).toEqual([]);
  });
});

describe("a failed evidence save never causes repeat checks", () => {
  const drive = async (h: ReturnType<typeof harness>, minutes: number) => { for (let i = 0; i < minutes * 12; i++) { h.advance(5000); await h.job.tick(); } };
  it("after-mode re-check: not asked again for 10 min, at most 3 tries, then left — one line each, no data", async () => {
    const at = ago(10);
    const re = pend("phone", { input: NEW_PHONE, phone: NEW_PHONE, at, prev_input: PHONE, prev_ext_at: ago(20), round: 2 });
    const h = harness({ queue: [re], saveFails: () => true });
    await h.job.tick();
    expect(h.check).toHaveBeenCalledTimes(1);
    await drive(h, 9);                       // the queue offers it every pass (nothing was saved) …
    expect(h.check).toHaveBeenCalledTimes(1); // … but 7-11 is not asked again for 10 minutes
    await drive(h, 2);
    expect(h.check).toHaveBeenCalledTimes(2); // try 2
    await drive(h, 11);
    expect(h.check).toHaveBeenCalledTimes(3); // try 3
    await drive(h, 60);
    expect(h.check).toHaveBeenCalledTimes(3); // left
    const lines = h.logs.filter((l) => l.includes("evidence save failed"));
    expect(lines).toEqual([
      "[PC711_SHADOW] evidence save failed kind=phone mode=after try=1/3 next=600s",
      "[PC711_SHADOW] evidence save failed kind=phone mode=after try=2/3 next=600s",
      "[PC711_SHADOW] evidence save failed kind=phone mode=after try=3/3 left",
    ]);
    expect(noPhoneIn(h.logs)).toBe(true);
  });
  it("a save that works again clears the block (the next value is checked normally)", async () => {
    let fail = true;
    const h = harness({ queue: [pend("store")], saveFails: () => fail });
    await h.job.tick();
    fail = false;
    await drive(h, 11);
    expect(h.check).toHaveBeenCalledTimes(2);
    expect(h.evRows).toHaveLength(1);
    await drive(h, 5);
    expect(h.check).toHaveBeenCalledTimes(2); // saved → no job any more
  });
  it("mirror: the same rule (the mirror queue offers it again every pass)", async () => {
    const h = harness({ mirror: true, mqueue: [mpend("phone")], saveFails: () => true });
    await h.job.tick();
    expect(h.check).toHaveBeenCalledTimes(1);
    await drive(h, 9);
    expect(h.check).toHaveBeenCalledTimes(1);
    await drive(h, 25);
    expect(h.check).toHaveBeenCalledTimes(3);
    await drive(h, 60);
    expect(h.check).toHaveBeenCalledTimes(3);
    expect(h.logs.filter((l) => l.includes("evidence save failed kind=phone mode=mirror"))).toHaveLength(3);
  });
  it("a re-ask whose answer can't be saved is not asked again every pass", async () => {
    let failUpdates = false;
    const h = harness({ queue: [pend("phone", { ext: "restricted" })], updateFails: () => failUpdates });
    await h.job.tick();
    failUpdates = true;
    h.advance(31_000); await h.job.tick();
    expect(h.check).toHaveBeenCalledTimes(2);
    await drive(h, 9);
    expect(h.check).toHaveBeenCalledTimes(2);
    expect(h.logs.some((l) => l === "[PC711_SHADOW] evidence save failed kind=phone mode=reask try=1/3 next=600s")).toBe(true);
  });
});

describe("mirror self-stop", () => {
  const H = (o: Row = {}): Row => ({ checked: 40, medianS: 3.6, waited: 1, storeUnknown: 0, lastAnswerAt: new Date(NOW - 30_000).toISOString(), ...o });
  it("the numbers: every 10 min, last 60 min, >= 20 parcels; 7 s; 10 waited; 3 store unknown; silent after 10 min", () => {
    expect([SELF_STOP_EVERY_MS, SELF_STOP_WINDOW_MS, SELF_STOP_MIN_PARCELS, SELF_STOP_PHONE_MEDIAN_S, SELF_STOP_WAITED, SELF_STOP_STORE_UNKNOWN, SELF_STOP_SILENT_MS])
      .toEqual([600_000, 3_600_000, 20, 7, 10, 3, 600_000]);
  });
  it("the rules at their edges", () => {
    expect(selfStopDecision(H(), NOW)).toMatchObject({ stop: false, why: "healthy", silentSince: null });
    expect(selfStopDecision(H({ checked: 19, medianS: 30, waited: 50, storeUnknown: 9 }), NOW)).toMatchObject({ stop: false, why: "too_few" });
    expect(selfStopDecision(H({ medianS: 7 }), NOW).stop).toBe(false);
    expect(selfStopDecision(H({ medianS: 7.1 }), NOW)).toMatchObject({ stop: true, rule: "phone_time", value: 7.1 });
    expect(selfStopDecision(H({ waited: 9 }), NOW).stop).toBe(false);
    expect(selfStopDecision(H({ waited: 10 }), NOW)).toMatchObject({ stop: true, rule: "waited", value: 10 });
    expect(selfStopDecision(H({ storeUnknown: 2 }), NOW).stop).toBe(false);
    expect(selfStopDecision(H({ storeUnknown: 3 }), NOW)).toMatchObject({ stop: true, rule: "store_unknown", value: 3 });
  });
  it("rule b is skipped when the regular checker wrote no answer for 10 min (an outage), with 'silent since'", () => {
    const last = new Date(NOW - 11 * 60_000).toISOString();
    const d = selfStopDecision(H({ waited: 25, lastAnswerAt: last }), NOW);
    expect(d).toMatchObject({ stop: false, silentSince: last });
    expect(selfStopDecision(H({ waited: 25, lastAnswerAt: new Date(NOW - 9 * 60_000).toISOString() }), NOW)).toMatchObject({ stop: true, rule: "waited" });
    // a and c still apply while silent
    expect(selfStopDecision(H({ storeUnknown: 3, lastAnswerAt: last }), NOW)).toMatchObject({ stop: true, rule: "store_unknown" });
  });
  it("the loop: numbers asked INSIDE the pass call every 10 min of mirror-on time (window = last 60 min of it), no extra request", async () => {
    const h = harness({ mirror: true, health: () => H() });
    for (let i = 0; i < 12 * 35; i++) { await h.job.tick(); h.advance(5000); } // 35 minutes
    expect(h.healthAsked).toHaveLength(3); // at 10, 20, 30 min
    expect(h.healthAsked[0]).toBe(new Date(NOW).toISOString()); // mirror on for < 60 min → from when it was switched on
    expect(h.requests.filter((r) => r !== "ev.pass" && !r.startsWith("db."))).toEqual([]); // nothing but the pass call
    for (let i = 0; i < 12 * 40; i++) { await h.job.tick(); h.advance(5000); }
    expect(Date.parse(h.healthAsked.at(-1)!)).toBeGreaterThan(NOW); // after an hour the window no longer starts at switch-on
    const last = h.healthAsked.at(-1)!, prev = h.healthAsked.at(-2)!;
    expect(Date.parse(last) - Date.parse(prev)).toBe(SELF_STOP_EVERY_MS); // the 60-min window slides with each check
  });
  it("mirror off: the numbers are never asked", async () => {
    const h = harness({ mirror: false, health: () => H({ medianS: 30 }) });
    for (let i = 0; i < 12 * 25; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.healthAsked).toEqual([]);
    expect(h.stops).toEqual([]);
  });
  it("a rule fires → it writes ONLY pc711_mirror_enabled = 'false' (one call), mirror stops on that pass, never turns itself on", async () => {
    let bad = false;
    const h = harness({ mirror: true, mqueue: [mpend("phone"), mpend("phone", { phone: "0933333333", input: "0933333333" })], health: () => H(bad ? { medianS: 9.2 } : {}) });
    for (let i = 0; i < 12 * 9; i++) { await h.job.tick(); h.advance(5000); }
    bad = true;
    for (let i = 0; i < 12 * 2; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.stops).toEqual([{ rule: "phone_time", value: 9.2, from: new Date(NOW).toISOString(), parcels: 40 }]);
    expect(h.settings[MIRROR_SWITCH]).toBe("false");
    expect(h.logs.filter((l) => l.includes("self-stop"))).toEqual(["[PC711_SHADOW] mirror self-stop rule=phone_time value=9.2 parcels=40 switched_off"]);
    const mp = h.ev.mirrorPending.mock.calls.length;
    for (let i = 0; i < 12 * 30; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.ev.mirrorPending.mock.calls.length).toBe(mp); // stays off
    expect(h.settings[MIRROR_SWITCH]).toBe("false"); // never turned on again
    expect(h.stops).toHaveLength(1);
  });
  it("Admin state: 'silent since' and the last check time", async () => {
    const last = new Date(NOW - 20 * 60_000).toISOString();
    const h = harness({ mirror: true, health: () => H({ waited: 40, lastAnswerAt: last }) });
    for (let i = 0; i < 12 * 11; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.job.state().selfStop).toMatchObject({ silentSince: last });
    expect(h.stops).toEqual([]); // an outage, not a slowdown
  });
  it("the code: the only writes to the mirror switch are 'false' (server + sql/172)", () => {
    const src = ["server/pc711Shadow.js", "server/pc711Evidence.js", "server.js"].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(src).not.toMatch(/pc711_mirror_enabled[^\n]*(update|upsert|insert)/i);
    const sql = readFileSync("sql/172_pc711_shadow_evidence.sql", "utf8");
    const writes = sql.match(/update public\.app_settings set value = '[a-z]+' where key = 'pc711_mirror_enabled'[^;]*/g) || [];
    expect(writes).toEqual(["update public.app_settings set value = 'false' where key = 'pc711_mirror_enabled' and value = 'true'"]);
  });
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

// sql/173: the server lost its 7-11 login while mirror was on → mirror switches itself off ONCE (the
// existing stop function, rule login_lost — it only ever writes 'false'); nothing else is sent while logged out.
describe("mirror stops itself when the login is lost (login_lost)", () => {
  const LOST_STATES = ["needs_login"] as const;
  it("needs_login while mirror is on → ONE stop (rule login_lost), the switch becomes 'false', no other request", async () => {
    let st: Row = { state: "connected", since: "c1" };
    const h = harness({ mirror: true, status: () => st });
    await h.job.tick(); // a normal pass: the job sees the mirror switch on
    expect(h.settings[MIRROR_SWITCH]).toBe("true");
    for (const state of LOST_STATES) {
      st = { state, since: "c1" };
      h.requests.length = 0;
      h.check.mockClear();
      for (let i = 0; i < 6; i++) { h.advance(5_000); await h.job.tick(); }
      expect(h.stops).toEqual([{ rule: "login_lost", value: null, from: expect.any(String), parcels: null }]);
      expect(h.settings[MIRROR_SWITCH]).toBe("false");
      expect(h.requests).toEqual(["ev.stopMirror"]); // the one write; no pass, no check, no insert
      expect(h.check).not.toHaveBeenCalled();
      expect(h.logs.filter((l) => l.includes("rule=login_lost"))).toEqual(["[PC711_SHADOW] mirror self-stop rule=login_lost switched_off"]);
    }
  });
  it("mirror already off → no stop call at all; logged out = zero requests", async () => {
    let st: Row = { state: "connected", since: "c1" };
    const h = harness({ mirror: false, status: () => st });
    await h.job.tick();
    st = { state: "needs_login", since: "c1" };
    h.requests.length = 0;
    for (let i = 0; i < 4; i++) { h.advance(5_000); await h.job.tick(); }
    expect(h.stops).toEqual([]);
    expect(h.requests).toEqual([]);
  });
  it("the stop write fails → tried again on the next tick; after one success, never again in that logged-out spell", async () => {
    let st: Row = { state: "connected", since: "c1" };
    const h = harness({ mirror: true, status: () => st });
    await h.job.tick();
    let fail = 2;
    const real = h.ev.stopMirror.getMockImplementation()!;
    h.ev.stopMirror.mockImplementation(async (...a: Parameters<typeof real>) => { if (fail-- > 0) { h.stops.push({ failed: true }); throw new Error("db down"); } return real(...a); });
    st = { state: "needs_login", since: "c1" };
    for (let i = 0; i < 6; i++) { h.advance(61_000); await h.job.tick(); }
    expect(h.ev.stopMirror).toHaveBeenCalledTimes(3); // 2 failures + 1 success, then nothing
    expect(h.settings[MIRROR_SWITCH]).toBe("false");
    expect(h.logs.filter((l) => l.includes("rule=login_lost write_failed")).length).toBe(2);
  });
  it("a check that sees the logged-out cart page stops the job; the next tick stops mirror once", async () => {
    const st: Row = { state: "connected", since: "c1" };
    const h = harness({ mirror: true, status: () => st, queue: [pend("store")], check: () => ({ verdict: "unknown", http: 200, ms: 500, kind: "login_not_accepted", steps: [] }) });
    await h.job.tick(); // the check comes back logged out → the job stops (status stays "connected", same since)
    expect(h.stops).toEqual([]);
    for (let i = 0; i < 3; i++) { h.advance(5_000); await h.job.tick(); }
    expect(h.stops.map((x) => x.rule)).toEqual(["login_lost"]);
    expect(h.settings[MIRROR_SWITCH]).toBe("false");
  });
  it("logged in again (a new connect) and lost again → a new spell may stop again, only if mirror was switched back on", async () => {
    let st: Row = { state: "connected", since: "c1" };
    const h = harness({ mirror: true, status: () => st });
    await h.job.tick();
    st = { state: "needs_login", since: "c1" };
    await h.job.tick();
    expect(h.stops.length).toBe(1);
    st = { state: "connected", since: "c2" };
    await h.job.tick(); // mirror is off now → the pass reads it off
    st = { state: "needs_login", since: "c2" };
    await h.job.tick();
    expect(h.stops.length).toBe(1); // mirror was off: nothing to stop
    st = { state: "connected", since: "c3" };
    h.settings[MIRROR_SWITCH] = "true";
    await h.job.tick();
    st = { state: "needs_login", since: "c3" };
    await h.job.tick(); await h.job.tick();
    expect(h.stops.length).toBe(2);
    expect(h.settings[MIRROR_SWITCH]).toBe("false");
  });
  it("no log line carries a phone, a name, a store number, a cookie or a token", async () => {
    let st: Row = { state: "connected", since: "c1" };
    const h = harness({ mirror: true, status: () => st, queue: [pend("phone")] });
    await h.job.tick();
    st = { state: "needs_login", since: "c1" };
    await h.job.tick();
    expect(noPhoneIn(h.logs)).toBe(true);
    for (const l of h.logs) { expect(l).not.toContain(STORE); expect(l).not.toMatch(/cookie|token|=[A-Za-z0-9+/]{20,}/i); }
  });
});

// Checks stay paused while logged out, and start again by themselves when the login is back (a new since).
describe("checks stay paused while logged out", () => {
  it("needs_login → no check and no database request on any tick; connected again (new since) → checks run", async () => {
    let st: Row = { state: "needs_login", since: "c1" };
    const h = harness({ mirror: false, status: () => st, queue: [pend("phone"), pend("store")] });
    for (let i = 0; i < 20; i++) { h.advance(30_000); await h.job.tick(); }
    expect(h.check).not.toHaveBeenCalled();
    expect(h.requests).toEqual([]);
    st = { state: "connected", since: "c2" };
    await h.job.tick();
    expect(h.check).toHaveBeenCalledTimes(2);
  });
  it("a check that comes back logged out stops the job; same since → still paused; a new since → resumes", async () => {
    let st: Row = { state: "connected", since: "c1" };
    let out = true;
    const h = harness({ status: () => st, queue: [pend("store"), pend("store")], check: (i) => (out ? { verdict: "unknown", http: 200, ms: 500, kind: "login_not_accepted", steps: [] } : OK(i as { kind: string })) });
    await h.job.tick();
    expect(h.check).toHaveBeenCalledTimes(1);
    st = { state: "needs_login", since: "c1" };
    for (let i = 0; i < 5; i++) { h.advance(30_000); await h.job.tick(); }
    st = { state: "connected", since: "c1" }; // same connect → still stopped
    for (let i = 0; i < 3; i++) { h.advance(30_000); await h.job.tick(); }
    expect(h.check).toHaveBeenCalledTimes(1);
    out = false;
    st = { state: "connected", since: "c2" }; // logged in again (the passive read or Jeff)
    await h.job.tick();
    expect(h.check).toHaveBeenCalledTimes(2);
  });
});
