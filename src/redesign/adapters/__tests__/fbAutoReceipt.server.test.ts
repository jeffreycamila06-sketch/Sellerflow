// @vitest-environment node
// B1 — automatic Messenger receipt after a Facebook live. Pins the job runner end to end with the
// REAL fbReceipt send path (claim → upload → one Graph call): gates (switch, plan, access,
// toggle), one receipt per buyer (sent / pending / no-private-reply rows block, sold-out rows do
// not), can_reply_privately false → no send and never retried, at most 10 sends a minute (the
// rest a minute later, attempt given back), at most 3 attempts, counts-only notes, and the
// fbLive.js stop hook (only session_end / idle / max_session queue a job).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbReceipt, AUTO_NO_PRIVATE_REPLY, hasAutoBlockingRow } from "../../../../server/fbReceipt.js";
import { createAutoReceiptRunner, groupBuyers, planAllowsAutoReceipt, AUTO_RECEIPT_RATE_MAX } from "../../../../server/fbAutoReceipt.js";
import { createFbRuntime } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "a", appSecret: "s", tokenKey: "tk" };
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const LV = "LV9";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const page = { user_id: U, page_id: "111", active: true, can_message: true, access_token: encryptToken("TOK", CONFIG.tokenKey) };

type Row = Record<string, unknown>;
function world(nBuyers: number, o: { canReply?: boolean | null; graphError?: number; access?: boolean } = {}) {
  const receipts: Row[] = [];
  const liveRows: Row[] = [];
  for (let b = 1; b <= nBuyers; b++) liveRows.push({ id: b, session_id: S, buyer_number: b, handle: `buyer${b}`, customer_name: "", product: "Dress", price: 100, qty: 1, created_at: new Date(1_000 + b).toISOString() });
  const posts: string[] = [];
  const gets: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body!).recipient.comment_id);
      if (o.graphError) return { status: 400, json: async () => ({ error: { code: o.graphError, message: "x" } }) };
      return { status: 200, json: async () => ({ message_id: `m${posts.length}`, recipient_id: "PSID" }) };
    }
    gets.push(url);
    return { status: 200, json: async () => (o.canReply === null ? {} : { can_reply_privately: o.canReply ?? true }) };
  });
  const rstore = {
    hasReceiptAccess: async () => o.access ?? true,
    getPage: async () => ({ ...page }),
    listReceiptOrders: async (_u: string, _s: string, b: number) => [{ comment_msg_id: `c${b}`, platform_meta: { page_id: "111", live_video_id: LV }, handle: `buyer${b}`, created_at: new Date(1_000 + b).toISOString() }],
    listReceiptRows: async (ids: string[]) => receipts.filter((r) => ids.includes(String(r.comment_id))),
    insertReceipt: async (row: Row) => {
      if (receipts.some((r) => r.comment_id === row.comment_id && r.status !== "failed")) return { conflict: true };
      const r = { kind: "receipt", ...row, id: receipts.length + 1 }; receipts.push(r); return { id: r.id };
    },
    updateReceipt: async (id: number, patch: Row) => { Object.assign(receipts.find((r) => r.id === id)!, patch); return {}; },
    deleteReceipt: async (id: number) => { const i = receipts.findIndex((r) => r.id === id); if (i >= 0) receipts.splice(i, 1); return true; },
    uploadReceiptImage: async (p: string) => `https://cdn.test/${p}`,
  };
  const finished: Row[] = [];
  const jstore = {
    claimJobs: vi.fn(async () => [] as Row[]),
    finishJob: async (id: number, patch: Row) => { finished.push({ id, ...patch }); },
    readProfile: vi.fn(async () => ({ plan: "pro", plan_status: "active" })),
    getAutoReceiptSettings: vi.fn(async () => ({ enabled: true, opening: "", note: "", qrImage: null, lang: "en", currency: "NT$" })),
    listLiveRows: async () => liveRows,
  };
  let t = 10_000_000;
  const logs: string[] = [];
  const receipt = createFbReceipt({ config: CONFIG, store: rstore, fetchImpl, now: () => t });
  const flag = vi.fn(async () => true);
  const draw = vi.fn(async () => PNG);
  const runner = createAutoReceiptRunner({
    store: jstore, flag, receipt, hasAccess: rstore.hasReceiptAccess, fetchImpl, draw, now: () => t, log: (l: string) => logs.push(l),
  });
  const job = (attempts = 1) => ({ id: 7, user_id: U, page_id: "111", live_video_id: LV, attempts, status: "running" });
  return { receipts, liveRows, posts, gets, jstore, finished, runner, flag, draw, logs, job, rstore, advance: (ms: number) => { t += ms; } };
}

describe("gates", () => {
  it("switch off / plan / plan not active / no access / toggle off → skipped, nothing sent", async () => {
    const cases: [string, (w: ReturnType<typeof world>) => void][] = [
      ["switch_off", (w) => w.flag.mockResolvedValue(false)],
      ["plan", (w) => w.jstore.readProfile.mockResolvedValue({ plan: "basic", plan_status: "active" })],
      ["plan", (w) => w.jstore.readProfile.mockResolvedValue({ plan: "pro", plan_status: "expired" })],
      ["plan", (w) => w.jstore.readProfile.mockResolvedValue(null)],
      ["toggle_off", (w) => w.jstore.getAutoReceiptSettings.mockResolvedValue({ enabled: false } as never)],
      ["toggle_off", (w) => w.jstore.getAutoReceiptSettings.mockResolvedValue(null as never)],
    ];
    for (const [note, set] of cases) {
      const w = world(2);
      set(w);
      await w.runner.runJob(w.job());
      expect(w.finished).toEqual([expect.objectContaining({ status: "skipped", note })]);
      expect(w.posts).toEqual([]);
      expect(w.draw).not.toHaveBeenCalled();
    }
    const w = world(2, { access: false });
    await w.runner.runJob(w.job());
    expect(w.finished).toEqual([expect.objectContaining({ status: "skipped", note: "no_access" })]);
    expect(w.posts).toEqual([]);
  });
  it("plans: plus / pro / master active only", () => {
    for (const p of ["plus", "Pro", "MASTER"]) expect(planAllowsAutoReceipt({ plan: p, plan_status: "active" })).toBe(true);
    for (const p of ["free", "basic", "", "admin"]) expect(planAllowsAutoReceipt({ plan: p, plan_status: "active" })).toBe(false);
    expect(planAllowsAutoReceipt({ plan: "pro", plan_status: "pending" })).toBe(false);
  });
});

describe("sending", () => {
  it("one receipt per buyer through the existing claim → send path; note = counts only", async () => {
    const w = world(3);
    await w.runner.runJob(w.job());
    expect(w.posts).toEqual(["c1", "c2", "c3"]);
    expect(w.receipts.map((r) => r.status)).toEqual(["sent", "sent", "sent"]);
    expect(w.finished).toEqual([expect.objectContaining({ status: "done", note: "buyers sent=3 skipped=0 failed=0 unknown=0 retry=0 left=0" })]);
    expect(w.logs.join("\n")).not.toMatch(/buyer\d|c\d|PSID|TOK/);
    // the same job again: everyone already has a receipt → nothing sent
    await w.runner.runJob(w.job());
    expect(w.posts).toHaveLength(3);
    expect(w.finished[1]).toMatchObject({ status: "done", note: expect.stringContaining("sent=0 skipped=3") });
  });
  it("skip-existing: sent or pending receipt rows block the buyer; a sold-out row does not", async () => {
    const w = world(4);
    w.receipts.push({ id: 101, user_id: U, comment_id: "c2", status: "sent", kind: "receipt" });
    w.receipts.push({ id: 102, user_id: U, comment_id: "c3", status: "pending", kind: "receipt" });
    w.receipts.push({ id: 103, user_id: U, comment_id: "c4", status: "sent", kind: "soldout" });
    await w.runner.runJob(w.job());
    expect(w.posts).toEqual(["c1"]); // c4's only comment is used by the sold-out reply → none_left
    expect(w.finished[0]).toMatchObject({ status: "done", note: expect.stringContaining("sent=1 skipped=3") });
    expect(hasAutoBlockingRow([{ user_id: U, status: "failed", kind: "receipt" }], U)).toBe(false);
    expect(hasAutoBlockingRow([{ user_id: U, status: "failed", error_code: AUTO_NO_PRIVATE_REPLY }], U)).toBe(true);
    expect(hasAutoBlockingRow([{ user_id: "other", status: "sent" }], U)).toBe(false);
  });
  it("can_reply_privately false → no upload, no send, buyer never retried", async () => {
    const w = world(1, { canReply: false });
    await w.runner.runJob(w.job());
    expect(w.posts).toEqual([]);
    expect(w.receipts).toEqual([expect.objectContaining({ comment_id: "c1", status: "failed", error_code: AUTO_NO_PRIVATE_REPLY })]);
    expect(w.finished[0]).toMatchObject({ status: "done", note: expect.stringContaining("skipped=1") });
    expect(w.gets).toHaveLength(1);
    await w.runner.runJob(w.job());
    expect(w.gets).toHaveLength(1); // not asked again
    expect(w.posts).toEqual([]);
  });
  it("can_reply_privately unreadable → the send decides", async () => {
    const w = world(1, { canReply: null });
    await w.runner.runJob(w.job());
    expect(w.posts).toEqual(["c1"]);
  });
  it(`at most ${AUTO_RECEIPT_RATE_MAX} sends a minute; the rest a minute later without using an attempt`, async () => {
    const w = world(12);
    await w.runner.runJob(w.job(2));
    expect(w.posts).toHaveLength(10);
    expect(w.finished[0]).toMatchObject({ status: "due", attempts: 1, note: expect.stringContaining("left=2") });
    expect(Date.parse(String(w.finished[0].due_at))).toBe(10_000_000 + 60_000);
    w.advance(61_000);
    await w.runner.runJob(w.job(2));
    expect(w.posts).toHaveLength(12);
    expect(w.finished[1]).toMatchObject({ status: "done", note: expect.stringContaining("sent=2 skipped=10") });
  });
  it("skipped buyers do not use the minute's sends", async () => {
    const w = world(12);
    for (let b = 1; b <= 5; b++) w.receipts.push({ id: 200 + b, user_id: U, comment_id: `c${b}`, status: "sent", kind: "receipt" });
    await w.runner.runJob(w.job());
    expect(w.posts).toHaveLength(7);
    expect(w.finished[0]).toMatchObject({ status: "done" });
  });
  it("nothing delivered (Graph code 2) → retry in 5 minutes; failed at the 3rd attempt", async () => {
    const w = world(1, { graphError: 2 });
    await w.runner.runJob(w.job(1));
    expect(w.receipts).toEqual([]); // claim given back
    expect(w.finished[0]).toMatchObject({ status: "due", note: expect.stringContaining("retry=1") });
    await w.runner.runJob(w.job(3));
    expect(w.finished[1]).toMatchObject({ status: "failed" });
  });
  it("tick: claims, runs one by one, never throws", async () => {
    const w = world(1);
    w.jstore.claimJobs.mockResolvedValueOnce([w.job()]);
    expect(await w.runner.tick()).toBe(1);
    expect(w.posts).toEqual(["c1"]);
    w.jstore.claimJobs.mockRejectedValueOnce(new Error("db down"));
    expect(await w.runner.tick()).toBe(0);
  });
  it("groupBuyers: per session + buyer number; rows without a session are left out", () => {
    const g = groupBuyers([
      { session_id: S, buyer_number: 2 }, { session_id: S, buyer_number: 1 }, { session_id: S, buyer_number: 2 },
      { session_id: null, buyer_number: 3 }, { session_id: S, buyer_number: 0 },
    ]);
    expect(g.map((x) => [x.buyerNumber, x.rows.length])).toEqual([[1, 1], [2, 2]]);
  });
});

describe("fbLive.js stop hook", () => {
  const rt = (insert: (j: unknown) => unknown) => createFbRuntime({
    config: CONFIG, store: { insertAutoReceiptJob: insert }, liveKey: (s: string, p: string, id: string) => `${s}:${p}:${id}`,
    emitComment: () => {}, statusEmit: () => {}, renderUrl: "https://r.test", setLoop: () => 1, clearLoop: () => {},
  });
  it("queues a job only for session_end / idle / max_session", () => {
    for (const [reason, n] of [["session_end", 1], ["idle", 1], ["max_session", 1], ["feature_gate", 0], ["restart", 0], ["disconnect", 0], ["shutdown", 0], ["stopped", 0]] as const) {
      const insert = vi.fn(async () => {});
      const r = rt(insert);
      r.startPoller({ sellerId: "s", userId: U, pageId: "111", pageUsername: "shop", liveVideoId: LV });
      expect(r.stopPoller("s:Facebook:111", reason)).toBe(true);
      expect(insert).toHaveBeenCalledTimes(n);
      if (n) expect(insert).toHaveBeenCalledWith({ userId: U, pageId: "111", liveVideoId: LV });
    }
  });
  it("a throwing or rejecting insert never breaks the stop", () => {
    for (const insert of [() => { throw new Error("x"); }, async () => { throw new Error("x"); }]) {
      const r = rt(insert);
      r.startPoller({ sellerId: "s", userId: U, pageId: "111", pageUsername: "shop", liveVideoId: LV });
      expect(r.stopPoller("s:Facebook:111", "idle")).toBe(true);
      expect(r.listPollers("s")).toEqual([]);
    }
  });
  it("the hook is the only change in fbLive.js: one try/catch line inside stopPoller", () => {
    const src = readFileSync("server/fbLive.js", "utf8");
    expect(src.match(/insertAutoReceiptJob/g)).toHaveLength(2);
    const stop = src.slice(src.indexOf("function stopPoller("), src.indexOf("function listPollers("));
    expect(stop).toContain('try { if ((reason === "session_end" || reason === "idle" || reason === "max_session") && typeof store.insertAutoReceiptJob === "function") Promise.resolve(store.insertAutoReceiptJob(');
    expect(stop).toContain(".catch(() => {}); } catch { /* best effort */ }");
  });
});
