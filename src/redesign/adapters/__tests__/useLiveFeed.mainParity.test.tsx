// TikTok / Facebook unchanged — the branch's useLiveFeed against main's own copy (fixtures/useLiveFeed.main.ts,
// main 360ce26c). Both hooks get the SAME socket events (TikTok, Facebook AND the new Shopee ones) on the same fake
// clock; after every step every TikTok / Facebook output must be identical. Shopee outputs may differ (that is the
// change: socket-loss grace + the stop reason).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));

import { useLiveFeed } from "../useLiveFeed";
import { useLiveFeed as useLiveFeedMain } from "./fixtures/useLiveFeed.main";

type Hook = ReturnType<typeof useLiveFeed>;
const fire = (i: number, event: string, d?: unknown) => {
  const h = H.sockets[i].on.mock.calls.filter((c) => c[0] === event).map((c) => c[1] as (x?: unknown) => void);
  for (const f of h) f(d);
};
const ttFb = (r: Hook) => ({
  ttConnected: r.ttConnected, fbConnected: r.fbConnected, ttRecovering: r.ttRecovering, fbRecovering: r.fbRecovering,
  tt: r.activeAccounts.TikTok, fb: r.activeAccounts.Facebook, ttViewers: r.ttViewers, fbLastStop: r.fbLastStop?.reason ?? null,
  connected: r.connected,
  comments: r.comments.map((c) => `${c.platform}|${c.handle}|${c.text}`),
  initial: r.initialComments.map((c) => `${c.platform}|${c.handle}|${c.text}`),
  emits: [] as string[],
});

beforeEach(() => { vi.useFakeTimers(); H.sockets.length = 0; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); });

type Step = [string, unknown?] | ["wait", number];
const ST = (p: Record<string, unknown>): Step => ["platform_status", p];
const CM = (p: Record<string, unknown>): Step => ["comment", { timestamp: "2026-11-22T05:00:00.000Z", ...p }];
const SCRIPTS: Record<string, Step[]> = {
  "green, socket blip, back within the grace": [
    ST({ platform: "TikTok", connected: true, username: "shop_a" }), ST({ platform: "Shopee", connected: true, username: "777" }),
    ["disconnect"], ["wait", 4000], ["connect"], ST({ platform: "TikTok", connected: true, username: "shop_a" }), ST({ platform: "Shopee", connected: true, username: "777" }),
    ["wait", 9000],
  ],
  "socket gone for good (server restart)": [
    ST({ platform: "TikTok", connected: true, username: "shop_a" }), ST({ platform: "Facebook", connected: true, username: "page1" }),
    ST({ platform: "Shopee", connected: true, username: "777" }), ["disconnect"], ["wait", 7000], ["connect_error"], ["wait", 2000], ["wait", 60000],
  ],
  "health-cycle reconnect + Shopee stops with reasons": [
    ST({ platform: "TikTok", connected: true, username: "shop_a" }), ST({ platform: "TikTok", connected: false, reconnecting: true, username: "shop_a" }),
    ST({ platform: "Shopee", connected: true, username: "777" }), ST({ platform: "Shopee", connected: false, username: "777", reason: "restart" }),
    ["wait", 30000], ST({ platform: "TikTok", connected: true, username: "shop_a" }), ST({ platform: "Shopee", connected: false, username: "777", reason: "session_end" }),
    ST({ platform: "Facebook", connected: false, username: "page1", reason: "session_end" }), ["wait", 61000],
  ],
  "comments of every platform, initial + live, then the session ends": [
    CM({ handle: "a", name: "A", comment: "mine 1", platform: "TikTok", sourceUsername: "", msgId: "t1" }),
    CM({ handle: "b", name: "B", comment: "mine 2", platform: "Facebook", sourceUsername: "", msgId: "f1" }),
    CM({ handle: "c", name: "C", comment: "mine 3", platform: "Shopee", sourceUsername: "777", msgId: "s1" }),
    CM({ handle: "d", name: "D", comment: "old", platform: "Shopee", sourceUsername: "777", msgId: "s0", initial: true }),
    ST({ platform: "Shopee", connected: true, username: "777" }), ["disconnect"], ["wait", 9000], ["live_session_ended", {}],
    CM({ handle: "e", name: "E", comment: "mine 4", platform: "TikTok", sourceUsername: "", msgId: "t2" }),
  ],
  "viewers + a terminal TikTok stop while Shopee waits on its grace": [
    ST({ platform: "TikTok", connected: true, username: "shop_a" }), ["platform_viewers", { platform: "TikTok", username: "shop_a", count: 12 }],
    ST({ platform: "Shopee", connected: true, username: "777" }), ["disconnect"], ["wait", 3000],
    ST({ platform: "TikTok", connected: false, username: "shop_a", reason: "live_session_ended" }), ["wait", 6000], ["connect"],
  ],
};

describe("useLiveFeed — TikTok / Facebook identical to main", () => {
  for (const [name, steps] of Object.entries(SCRIPTS)) {
    it(name, () => {
      const branch = renderHook(() => useLiveFeed(true, "g@x.com"));
      const main = renderHook(() => useLiveFeedMain(true, "g@x.com"));
      expect(H.sockets.length).toBe(2);
      let n = 0;
      for (const [ev, arg] of steps) {
        if (ev === "wait") act(() => { vi.advanceTimersByTime(arg as number); });
        else act(() => { fire(0, ev, arg); fire(1, ev, arg); });
        expect(ttFb(branch.result.current as Hook), `step ${n} (${ev})`).toEqual(ttFb(main.result.current as unknown as Hook));
        n++;
      }
      // and the wire: every emit the two hooks sent is the same
      expect(H.sockets[0].emit.mock.calls).toEqual(H.sockets[1].emit.mock.calls);
      expect(n).toBe(steps.length);
    });
  }
});
