// @vitest-environment node
// Build 2 — "Stop reasons", server half. Pins:
//   • every stop carries its reason on the status (session_end, disconnect, restart, shutdown…);
//     server.js relays it as platform_status.reason (absent on connected:true);
//   • switch ON: every 5 min (whatever the comment activity) one live-status read — ENDED → stop
//     session_end, LIVE / unreadable → go on, never a 2nd read before the next 5 min;
//   • switch OFF: zero extra status reads over a 30-minute busy live;
//   • Disconnect queues the automatic receipt only with the switch ON; restart / auth / shutdown never.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbRuntime, LIVE_RECHECK_MS } from "../../../../server/fbLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, page: string) => `${seller}:${platform}:${page}`;
const flush = () => new Promise((r) => setTimeout(r, 0));

function rig(o: { on: boolean; status?: () => ReturnType<typeof mkRes> } ) {
  let t = 1_000_000;
  let n = 0;
  const statusReads: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    if (/\/comments\?/.test(url)) { n++; return mkRes(200, { data: [{ id: `c${n}`, message: "mine", from: { id: `u${n}`, name: `B${n}` }, created_time: "2026-10-09T00:00:00+0000" }] }); }
    if (/fields=status/.test(url) || /fields=live_status/.test(url)) { statusReads.push(url); return o.status ? o.status() : mkRes(200, { status: "LIVE" }); }
    return mkRes(404, {});
  });
  const store = {
    async getPage() { return { user_id: "u1", page_id: "P1", active: true, access_token: encryptToken("TOK", CONFIG.tokenKey), token_expires_at: new Date(t + 30 * 86400e3).toISOString() }; },
    async listActivePages() { return []; },
    async setActive() {},
    insertAutoReceiptJob: vi.fn(async () => {}),
  };
  const statusEmit = vi.fn();
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit, liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl, now: () => t, log: () => {}, setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
    stopReasonsEnabled: async () => o.on,
  });
  const entry = rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1", sessionId: "S1" });
  return { rt, entry, store, statusEmit, statusReads, advance: (ms: number) => { t += ms; } };
}

describe("reason on every stop", () => {
  it("stopPoller → statusEmit carries the reason; restart and shutdown too", () => {
    const r = rig({ on: false });
    r.rt.stopPoller(r.entry.key, "disconnect");
    expect(r.statusEmit).toHaveBeenLastCalledWith("s", expect.objectContaining({ connected: false, reason: "disconnect", scopeKey: "mypage", sessionId: "S1" }));
    r.rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1", sessionId: "A" });
    r.rt.startPoller({ sellerId: "s", userId: "u1", pageId: "P1", pageUsername: "mypage", liveVideoId: "LV1", sessionId: "B" });
    const restart = r.statusEmit.mock.calls.find((c) => c[1].connected === false && c[1].sessionId === "A");
    expect(restart?.[1].reason).toBe("restart");                    // the replaced phone hears why
    r.rt.stopAll();
    expect(r.statusEmit).toHaveBeenLastCalledWith("s", expect.objectContaining({ connected: false, reason: "shutdown", sessionId: "B" }));
    for (const c of r.statusEmit.mock.calls.filter((x) => x[1].connected === true)) expect(c[1].reason).toBeUndefined();
  });
  it("server.js relays the reason only on a stop (source contract)", () => {
    const src = readFileSync("server.js", "utf8");
    expect(src).toContain('statusEmit: (sellerId, { connected, scopeKey, sessionId, reason }) => {');
    expect(src).toContain('...(!connected && reason ? { reason: String(reason) } : {})');
    expect(src).toContain("stopReasonsEnabled: fbStopReasonsFlag,");
    expect(src).toContain('.eq("key", "fb_stop_reasons")');
  });
});

describe("5-minute live check", () => {
  it("ON: busy live, Facebook says ENDED at 5 min → stop session_end", async () => {
    const r = rig({ on: true, status: () => mkRes(200, { status: "VOD" }) });
    expect((await r.rt.pollOnce(r.entry)).stop).toBe(false);
    r.advance(LIVE_RECHECK_MS);
    expect(await r.rt.pollOnce(r.entry)).toMatchObject({ stop: true, reason: "session_end" });
    expect(r.statusReads).toHaveLength(1);
  });
  it("ON: LIVE → goes on; no second read before the next 5 min; unreadable → goes on", async () => {
    let answer = mkRes(200, { status: "LIVE" });
    const r = rig({ on: true, status: () => answer });
    r.advance(LIVE_RECHECK_MS);
    expect((await r.rt.pollOnce(r.entry)).stop).toBe(false);
    for (let i = 0; i < 9; i++) { r.advance(30_000); expect((await r.rt.pollOnce(r.entry)).stop).toBe(false); }
    expect(r.statusReads).toHaveLength(1);                           // 4.5 min later: still one read
    answer = mkRes(500, {});
    r.advance(30_000);
    expect((await r.rt.pollOnce(r.entry)).stop).toBe(false);         // unreadable never stops here
    expect(r.statusReads).toHaveLength(2);
  });
  it("OFF: zero status reads over a 30-minute busy live", async () => {
    const r = rig({ on: false, status: () => mkRes(200, { status: "VOD" }) });
    for (let i = 0; i < 60; i++) { r.advance(30_000); expect((await r.rt.pollOnce(r.entry)).stop).toBe(false); }
    expect(r.statusReads).toHaveLength(0);
  });
  it("the existing idle path still owns quiet rooms (no double read in one tick)", () => {
    const src = readFileSync("server/fbLive.js", "utf8");
    const poll = src.slice(src.indexOf("async function pollOnce("), src.indexOf("function scheduleNext("));
    expect(poll.indexOf("if (!idleCheckDue && nowMs - (entry.liveCheckedAtMs || entry.startedAtMs) >= LIVE_RECHECK_MS")).toBeGreaterThan(poll.indexOf("if (idleDue && nowMs >= (entry.idleRecheckAtMs || 0)) {"));
    expect(poll.indexOf("LIVE_RECHECK_MS")).toBeLessThan(poll.indexOf("res = await fetchCommentPages(")); // Build 3: the comments call is the paged variant
  });
});

describe("automatic receipt on Disconnect", () => {
  it("ON: disconnect queues one job; restart / auth / shutdown never", async () => {
    const r = rig({ on: true });
    r.rt.stopPoller(r.entry.key, "disconnect");
    await flush();
    expect(r.store.insertAutoReceiptJob).toHaveBeenCalledTimes(1);
    expect(r.store.insertAutoReceiptJob).toHaveBeenCalledWith({ userId: "u1", pageId: "P1", liveVideoId: "LV1" });
    for (const reason of ["restart", "auth", "shutdown", "inactive", "no_token", "feature_gate", "fetch_error"]) {
      const x = rig({ on: true });
      x.rt.stopPoller(x.entry.key, reason);
      await flush();
      expect(x.store.insertAutoReceiptJob, reason).not.toHaveBeenCalled();
    }
  });
  it("OFF: disconnect queues nothing (session_end still does, as before)", async () => {
    const r = rig({ on: false });
    r.rt.stopPoller(r.entry.key, "disconnect");
    await flush();
    expect(r.store.insertAutoReceiptJob).not.toHaveBeenCalled();
    const e = rig({ on: false });
    e.rt.stopPoller(e.entry.key, "session_end");
    await flush();
    expect(e.store.insertAutoReceiptJob).toHaveBeenCalledTimes(1);
  });
});
