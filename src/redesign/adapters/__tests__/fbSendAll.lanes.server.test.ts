// @vitest-environment node
// FB-2 fix — Send all jobs of DIFFERENT sellers run at the same time; ONE job at a time per seller (the
// 10-a-minute limit stays per seller). A job claimed while its seller's other job runs waits in line and
// keeps a heartbeat (the database takes a job back as stale_running after 3 minutes without one).
// The clock is moved by hand: sleep() only ends when the test moves the clock past its end.
import { describe, it, expect } from "vitest";
import { createSendAllRunner, SEND_ALL_RATE_MAX, WAITER_BEAT_MS } from "../../../../server/fbSendAll.js";

const A = "aaaaaaaa-1111-2222-3333-444444444444";
const B = "bbbbbbbb-1111-2222-3333-444444444444";
const S1 = "11111111-2222-3333-4444-555555555555";
const S2 = "22222222-2222-3333-4444-555555555555";
const STALE_MS = 3 * 60 * 1000; // claim_fb_send_all_jobs: heartbeat older than 3 minutes = stale_running
type Row = Record<string, unknown>;

function world(buyers: Record<string, number>) { // "<user>|<session>" → buyer count
  let t = Date.parse("2026-11-26T08:00:00Z");
  const t0 = t;
  const iso = () => new Date(t).toISOString();
  const jobs: Row[] = [];
  const sends: { uid: string; s: string; n: number; t: number }[] = [];
  const beats: { id: number; t: number }[] = [];
  const sleepers: { at: number; go: () => void }[] = [];
  const rows = (uid: string, s: string) => Array.from({ length: buyers[`${uid}|${s}`] || 0 }, (_, i) => ({
    id: i + 1, session_id: s, buyer_number: i + 1, handle: `b${i + 1}`, price: 100, qty: 1,
  }));
  const store = {
    hasReceiptAccess: async () => true,
    isAdmin: async () => true,
    insertSendAllJob: async (row: Row) => {
      if (jobs.some((j) => j.user_id === row.user_id && j.session_id === row.session_id && ["queued", "running"].includes(String(j.status)))) return { conflict: true };
      const j = { id: jobs.length + 1, attempts: 0, created_at: iso(), ...row }; jobs.push(j); return { id: j.id };
    },
    // = claim_fb_send_all_jobs: stale running jobs back to queued, then every queued job claimed
    claimSendAllJobs: async () => {
      for (const j of jobs) if (j.status === "running" && t - Date.parse(String(j.heartbeat_at)) > STALE_MS) Object.assign(j, { status: "queued", note: "stale_running" });
      const q = jobs.filter((j) => j.status === "queued");
      for (const j of q) Object.assign(j, { status: "running", attempts: Number(j.attempts) + 1, claimed_at: iso(), heartbeat_at: iso() });
      return q.map((j) => ({ ...j }));
    },
    touchSendAllJob: async (id: number, patch: Row) => {
      const j = jobs.find((x) => x.id === id);
      if (j && j.status === "running") { Object.assign(j, patch); if (patch.heartbeat_at) beats.push({ id, t }); }
    },
    finishSendAllJob: async (id: number, patch: Row) => { const j = jobs.find((x) => x.id === id); if (j && j.status === "running") Object.assign(j, patch); },
    latestSendAllJob: async () => null,
    listSessionFbRows: async (uid: string, s: string) => rows(uid, s),
    listInvoiceSkips: async () => [],
    listLineCancels: async () => [],
    getSendAllSettings: async () => ({ opening: "", note: "", qrImage: null, shippingFee: 0 }),
  };
  const receipt = {
    sendOne: async (uid: string, target: { sessionId: string; buyerNumber: number }) => {
      sends.push({ uid, s: target.sessionId, n: target.buyerNumber, t: t - t0 });
      return { status: 200, json: { ok: true } };
    },
  };
  const runner = createSendAllRunner({
    store, receipt, enabled: async () => true, draw: async () => Buffer.alloc(8), now: () => t, log: () => {},
    sleep: (ms: number) => new Promise<void>((go) => { sleepers.push({ at: t + ms, go }); }),
  });
  const settle = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r)); };
  // move the clock; every sleep that ends by then is woken
  const advance = async (ms: number) => {
    t += ms;
    for (const s of sleepers.splice(0)) { if (s.at <= t) s.go(); else sleepers.push(s); }
    await settle();
  };
  // the database's stale check at this moment: any running job without a heartbeat for > 3 minutes?
  const staleNow = () => jobs.filter((j) => j.status === "running" && t - Date.parse(String(j.heartbeat_at)) > STALE_MS).map((j) => j.id);
  return { jobs, sends, beats, runner, settle, advance, staleNow, start: (uid: string, s: string) => runner.start(uid, { sessionId: s, lang: "en", currency: "NT$" }) };
}

describe("Send all: sellers side by side, one job at a time per seller", () => {
  it("two sellers tap at once → BOTH send in the first minute (seller B does not wait for seller A's whole job)", async () => {
    const w = world({ [`${A}|${S1}`]: SEND_ALL_RATE_MAX + 2, [`${B}|${S1}`]: SEND_ALL_RATE_MAX + 2 });
    await Promise.all([w.start(A, S1), w.start(B, S1)]);
    await w.settle();
    const firstMinute = (uid: string) => w.sends.filter((x) => x.uid === uid && x.t < 60_000).length;
    expect(firstMinute(A)).toBe(SEND_ALL_RATE_MAX); // each seller its own 10 a minute
    expect(firstMinute(B)).toBe(SEND_ALL_RATE_MAX);
    await w.advance(60_000);
    expect(w.sends.filter((x) => x.uid === A)).toHaveLength(SEND_ALL_RATE_MAX + 2);
    expect(w.sends.filter((x) => x.uid === B)).toHaveLength(SEND_ALL_RATE_MAX + 2);
    expect(w.jobs.map((j) => j.status)).toEqual(["done", "done"]);
    expect(w.runner._lanes.size).toBe(0);
  });

  it("a seller who taps WHILE another seller's job is waiting on its limit starts at once (a new pass claims it)", async () => {
    const w = world({ [`${A}|${S1}`]: SEND_ALL_RATE_MAX + 5, [`${B}|${S1}`]: 2 });
    await w.start(A, S1);
    await w.settle();
    expect(w.sends.filter((x) => x.uid === A)).toHaveLength(SEND_ALL_RATE_MAX); // A waits for a free place
    await w.start(B, S1);
    await w.settle();
    expect(w.sends.filter((x) => x.uid === B).map((x) => x.t)).toEqual([0, 0]); // B right away, A still waiting
    expect(w.jobs[1].status).toBe("done");
    expect(w.jobs[0].status).toBe("running");
  });

  it("same seller, two sessions → one job after the other, never both at once; the waiting one keeps a heartbeat", async () => {
    const big = SEND_ALL_RATE_MAX * 5 + 3; // the first job needs 5 minutes (5 waits for a free place) — longer than the 3-minute stale limit
    const w = world({ [`${A}|${S1}`]: big, [`${A}|${S2}`]: 3 });
    await Promise.all([w.start(A, S1), w.start(A, S2)]);
    await w.settle();
    expect(w.jobs.map((j) => j.status)).toEqual(["running", "running"]); // both claimed, one waits in line
    expect(w.sends.filter((x) => x.s === S2)).toHaveLength(0);
    for (let i = 0; i < 7; i++) {
      await w.advance(60_000);
      expect(w.staleNow()).toEqual([]); // never a stale_running at the database's check
      const s1Done = w.sends.filter((x) => x.s === S1).length === big;
      if (!s1Done) expect(w.sends.filter((x) => x.s === S2)).toHaveLength(0);
    }
    expect(w.beats.some((b) => b.id === 2)).toBe(true); // the waiting job got heartbeats
    const lastS1 = Math.max(...w.sends.filter((x) => x.s === S1).map((x) => x.t));
    const firstS2 = Math.min(...w.sends.filter((x) => x.s === S2).map((x) => x.t));
    expect(firstS2).toBeGreaterThanOrEqual(lastS1); // one after the other
    const order = w.sends.map((x) => x.s);
    expect(order.lastIndexOf(S1)).toBeLessThan(order.indexOf(S2));
    expect(w.jobs.map((j) => j.status)).toEqual(["done", "done"]);
    expect(w.jobs.every((j) => j.note !== "stale_running")).toBe(true);
    // the 10-a-minute limit stays per seller across the two jobs
    for (const x of w.sends) expect(w.sends.filter((y) => y.uid === A && y.t > x.t - 60_000 && y.t <= x.t).length).toBeLessThanOrEqual(SEND_ALL_RATE_MAX);
  });

  it("a job claimed and waiting is beaten by the pass timer too (kick), at most every WAITER_BEAT_MS", async () => {
    const w = world({ [`${A}|${S1}`]: SEND_ALL_RATE_MAX + 1, [`${A}|${S2}`]: 1 });
    await Promise.all([w.start(A, S1), w.start(A, S2)]);
    await w.settle();
    const beatsOf2 = () => w.beats.filter((b) => b.id === 2).length;
    const before = beatsOf2();
    w.runner.kick(); await w.settle();
    expect(beatsOf2()).toBe(before);                    // too soon: no extra write
    await w.advance(WAITER_BEAT_MS + 1000);             // the running job still waits for its place (60 s)
    w.runner.kick(); await w.settle();
    expect(beatsOf2()).toBe(before + 1);                // the timer's pass beats the waiting job
    expect(w.jobs[1].status).toBe("running");
  });
});
