// @vitest-environment node
// Build 11 (H2) — a stop queues the automatic receipt 10 minutes later. If the SAME live comes back
// (reconnect) before then, that waiting job must be put aside, so buyers get one complete receipt
// at the real end — never a partial one in the middle of the live. Real Facebook runtime
// (server/fbLive.js) with an in-memory jobs table that behaves like fb_auto_receipt_jobs.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbRuntime } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

type Job = { userId: string; pageId: string; liveVideoId: string; status: string };

function rig(o: { insertDelay?: () => Promise<void> } = {}) {
  const jobs: Job[] = [];
  const store = {
    async getPage() { return { user_id: "u1", page_id: "P1", active: true, access_token: encryptToken("TOK", CONFIG.tokenKey), token_expires_at: new Date(Date.now() + 30 * 86400e3).toISOString() }; },
    async listActivePages() { return []; },
    async setActive() {},
    insertAutoReceiptJob: vi.fn(async (j: { userId: string; pageId: string; liveVideoId: string }) => {
      if (o.insertDelay) await o.insertDelay();
      jobs.push({ ...j, status: "due" });
    }),
    cancelWaitingAutoReceiptJobs: vi.fn(async (j: { userId: string; pageId: string; liveVideoId: string }) => {
      let n = 0;
      for (const x of jobs) if (x.userId === j.userId && x.pageId === j.pageId && x.liveVideoId === j.liveVideoId && x.status === "due") { x.status = "skipped"; n++; }
      return n;
    }),
  };
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl: vi.fn(async () => ({ status: 404, json: async () => ({}) })), now: () => 1_000_000, log: () => {},
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
    stopReasonsEnabled: async () => true,
  });
  const start = (lv = "LV1") => rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: lv, sessionId: "S1" });
  const due = () => jobs.filter((j) => j.status === "due");
  return { rt, store, jobs, start, due };
}

describe("automatic receipt waits for the real end of the live", () => {
  it("Disconnect mid-live, then reconnect the same live → the waiting job is put aside; the real end queues one", async () => {
    const r = rig();
    const e = r.start();
    r.rt.stopPoller(e.key, "disconnect");
    await flush();
    expect(r.due()).toHaveLength(1);                 // queued 10 min out
    r.start();                                       // same live comes back
    await flush();
    expect(r.due()).toHaveLength(0);                 // nothing goes out mid-live
    expect(r.jobs[0].status).toBe("skipped");
    r.rt.stopPoller(liveKey("s", "Facebook", "P1"), "session_end");
    await flush();
    expect(r.due()).toHaveLength(1);                 // one complete receipt at the real end
  });

  it("idle stop then reconnect: same", async () => {
    const r = rig();
    r.rt.stopPoller(r.start().key, "idle");
    await flush();
    r.start();
    await flush();
    expect(r.due()).toHaveLength(0);
  });

  it("a very quick reconnect (job still being written) still puts it aside", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((res) => { release = res; });
    const r = rig({ insertDelay: () => gate });
    r.rt.stopPoller(r.start().key, "disconnect");
    await flush();
    const before = r.store.cancelWaitingAutoReceiptJobs.mock.calls.length;
    r.start();                                       // reconnect before the insert finished
    await flush();
    expect(r.store.cancelWaitingAutoReceiptJobs.mock.calls.length).toBe(before); // waits for the insert
    release();
    await flush();
    expect(r.jobs).toHaveLength(1);
    expect(r.due()).toHaveLength(0);
  });

  it("a live that ends right after it started still gets its receipt (the start's put-aside runs first)", async () => {
    const r = rig();
    r.rt.stopPoller(r.start().key, "session_end"); // same tick as the start
    await flush();
    expect(r.due()).toHaveLength(1);
  });

  it("a different live (new live video) is not touched — that live really ended", async () => {
    const r = rig();
    r.rt.stopPoller(r.start("LV1").key, "session_end");
    await flush();
    r.start("LV2");
    await flush();
    expect(r.due()).toEqual([expect.objectContaining({ liveVideoId: "LV1" })]);
  });

  it("server.js puts aside only waiting ('due') rows of that user + page + live", () => {
    const src = readFileSync("server.js", "utf8");
    const fn = src.slice(src.indexOf("async cancelWaitingAutoReceiptJobs("), src.indexOf("async claimJobs("));
    expect(fn).toContain('.update({ status: "skipped"');
    for (const col of ['.eq("user_id"', '.eq("page_id"', '.eq("live_video_id"', '.eq("status", "due")']) expect(fn).toContain(col);
  });
});
