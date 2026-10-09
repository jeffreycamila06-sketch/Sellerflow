// Build 1 — "Facebook connect safety" (switch fb_connect_v2), client half. Pins:
//   A. the live gate: not_live / plan / failure → stop (no session, reset, stop, dialog);
//   B. the confirmed switch: stop old BEFORE startSession BEFORE reset BEFORE connect; a failed
//      stop still switches; switch OFF = today's start → reset → connect;
//   C. Facebook Connect through the gap buffer: a Facebook initial batch arriving while the POST
//      runs on a NON-empty feed is buffered and flushed on ok, discarded on failure; Auto never
//      orders it; TikTok connect() unchanged;
//   + the adapters (fbLiveCheck, ttDisconnect) and the RedesignApp wiring (switch-off paths).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const H = vi.hoisted(() => ({ sockets: [] as Array<{ on: ReturnType<typeof vi.fn>; emit: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> }));
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => { const s = { on: vi.fn(), emit: vi.fn(), disconnect: vi.fn() }; H.sockets.push(s); return s; }),
}));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "JWT", user: { id: "u1" } } } }) } } }));
const connectPlatformMock = vi.fn();
vi.mock("../connect", async (orig) => ({ ...(await orig() as object), connectPlatform: (...a: unknown[]) => connectPlatformMock(...a) }));
const fbConnectMock = vi.fn();
vi.mock("../fb", async (orig) => ({ ...(await orig() as object), fbConnect: (...a: unknown[]) => fbConnectMock(...a) }));

import { useLiveFeed } from "../useLiveFeed";
import { liveGateOf, switchStopTargets, settleStops, runConfirmedSwitch } from "../fbConnectV2";
import { fbLiveCheck } from "../fb";
import { ttDisconnect } from "../connect";

type Wire = Partial<ProdComment> & { initial?: boolean; msgId?: string };
const wire = (n: number, over: Wire = {}): Wire => ({
  platform: "Facebook", handle: `Buyer ${n}`, name: `Buyer ${n}`, comment: `mine ${n}`,
  timestamp: new Date(1760000000000 + n * 1000).toISOString(), time: "9:41:00 PM", ...over,
});
const handlerFor = (event: string) => H.sockets[0].on.mock.calls.find((c) => c[0] === event)?.[1] as ((d?: unknown) => void) | undefined;
const fire = (event: string, d?: unknown) => act(() => { handlerFor(event)?.(d); });

beforeEach(() => { vi.clearAllMocks(); H.sockets.length = 0; localStorage.clear(); });

describe("A — liveGateOf", () => {
  it("ok → go; not_live / plan_expired / anything else → stop with the reason", () => {
    expect(liveGateOf({ ok: true })).toEqual({ go: true });
    expect(liveGateOf({ ok: false, reason: "not_live" })).toEqual({ go: false, why: "not_live" });
    expect(liveGateOf({ ok: false, error: "plan_expired" })).toEqual({ go: false, why: "plan_expired" });
    for (const r of [{ ok: false, error: "needs_reauth" }, { ok: false, error: "fb_check_failed", fbCode: 2 }, { ok: false, unreachable: true }, { ok: false, error: "too_many_requests" }]) {
      expect(liveGateOf(r)).toEqual({ go: false, why: "failed" });
    }
  });
});

describe("B — switch order", () => {
  const live = (tt: boolean, fb: boolean, sh = false, ig = false) => ({
    TikTok: { connected: tt, id: "shop_a" }, Facebook: { connected: fb, id: "P1" }, Shopee: { connected: sh, id: "9" }, Instagram: { connected: ig, id: "" },
  });
  it("stops every OTHER connected platform, never the target", () => {
    expect(switchStopTargets("Facebook", live(true, false))).toEqual([{ platform: "TikTok", id: "shop_a" }]);
    expect(switchStopTargets("TikTok", live(false, true))).toEqual([{ platform: "Facebook", id: "P1" }]);
    expect(switchStopTargets("Facebook", live(true, true, true, true))).toEqual([{ platform: "TikTok", id: "shop_a" }, { platform: "Shopee", id: "9" }, { platform: "Instagram", id: "" }]);
    expect(switchStopTargets("Facebook", live(false, false))).toEqual([]);
  });
  it("v2: stop old → startSession → reset → connect", async () => {
    const order: string[] = [];
    await runConfirmedSwitch({
      v2: true,
      stopOld: async () => { order.push("stop"); },
      start: async () => { order.push("start"); return "sid"; },
      reset: () => order.push("reset"), connect: () => order.push("connect"), startFailed: () => order.push("failed"),
    });
    expect(order).toEqual(["stop", "start", "reset", "connect"]);
  });
  it("switch OFF: today's start → reset → connect (no stop)", async () => {
    const order: string[] = [];
    await runConfirmedSwitch({
      v2: false,
      stopOld: async () => { order.push("stop"); },
      start: async () => { order.push("start"); return "sid"; },
      reset: () => order.push("reset"), connect: () => order.push("connect"), startFailed: () => order.push("failed"),
    });
    expect(order).toEqual(["start", "reset", "connect"]);
  });
  it("a failed / refused stop still switches; a failed start aborts before the reset", async () => {
    const fails: string[] = [];
    const order: string[] = [];
    await runConfirmedSwitch({
      v2: true,
      stopOld: () => settleStops([{ name: "TikTok", p: Promise.reject(new Error("x")) }, { name: "Facebook", p: Promise.resolve(false) }], (n) => fails.push(n)),
      start: async () => { order.push("start"); return "sid"; },
      reset: () => order.push("reset"), connect: () => order.push("connect"), startFailed: () => order.push("failed"),
    });
    expect(fails.sort()).toEqual(["Facebook", "TikTok"]);
    expect(order).toEqual(["start", "reset", "connect"]);
    const o2: string[] = [];
    await runConfirmedSwitch({ v2: true, stopOld: async () => {}, start: async () => null, reset: () => o2.push("reset"), connect: () => o2.push("connect"), startFailed: () => o2.push("failed") });
    expect(o2).toEqual(["failed"]);
  });
  it("settleStops is bounded: a stop that never answers cannot hold the switch", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void settleStops([{ name: "TikTok", p: new Promise(() => {}) }], () => {}, 4000).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(3999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe("adapters", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fbLiveCheck → POST /fb/live-check { page_id } only (no session id), same mapping as fbConnect", async () => {
    const f = vi.fn(async () => ({ status: 200, json: async () => ({ ok: false, reason: "not_live" }) }));
    vi.stubGlobal("fetch", f);
    expect(await fbLiveCheck("P1")).toEqual({ ok: false, reason: "not_live", error: undefined });
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toMatch(/\/fb\/live-check\?sfl_codes=1$/);
    expect(JSON.parse(init.body)).toEqual({ page_id: "P1" });
    expect(init.headers.Authorization).toBe("Bearer JWT");
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 409, json: async () => ({ ok: false, error: "needs_reauth" }) })));
    expect(await fbLiveCheck("P1")).toEqual({ ok: false, reason: undefined, error: "needs_reauth" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, json: async () => ({ ok: false, error: "fb_check_failed", fb_code: 2 }) })));
    expect(await fbLiveCheck("P1")).toEqual({ ok: false, error: "fb_check_failed", fbCode: 2 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fbLiveCheck("P1")).toMatchObject({ ok: false, unreachable: true });
  });
  it("ttDisconnect → POST /disconnect/tiktok { username } cleaned; true only on ok; never throws", async () => {
    const f = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, stopped: true }) }));
    expect(await ttDisconnect("@Shop_A", f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toMatch(/\/disconnect\/tiktok\?sfl_codes=1$/);
    expect(JSON.parse(init.body)).toEqual({ username: "shop_a" });
    expect(await ttDisconnect("a", (async () => { throw new Error("x"); }) as unknown as typeof fetch)).toBe(false);
    expect(await ttDisconnect("a", (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch)).toBe(false);
  });
  it("ttDisconnect gives up after 3 s", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))));
      const p = ttDisconnect("a", f as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await p).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});

describe("C — Facebook Connect through the gap buffer", () => {
  function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
  it("non-empty feed: a Facebook initial batch during the POST is buffered, then flushed on ok; Auto never sees it", async () => {
    const seam = vi.fn();
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com", seam));
    fire("comment", wire(1));                                  // a live comment already in the feed
    expect(result.current.comments).toHaveLength(1);
    seam.mockClear();
    const d = deferred<{ ok: boolean }>();
    fbConnectMock.mockReturnValue(d.promise);
    let p!: Promise<unknown>;
    act(() => { p = result.current.connectFacebook("P1", "mypage"); });
    fire("comment", wire(2, { initial: true, msgId: "P1_2" }));  // arrives mid-POST
    fire("comment", wire(3, { initial: true, msgId: "P1_3" }));
    expect(result.current.initialComments).toHaveLength(0);    // held, not dropped
    await act(async () => { d.resolve({ ok: true }); await p; });
    expect(fbConnectMock).toHaveBeenCalledWith("P1");
    expect(result.current.initialComments.map((c) => c.msgId).sort()).toEqual(["P1_2", "P1_3"]); // display order = newest first
    expect(result.current.comments).toHaveLength(0);            // feed cleared on ok
    expect(seam).not.toHaveBeenCalled();                       // initial lane never reaches Auto
  });
  it("failure → the buffered batch is discarded and the old feed stays", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", wire(1));
    const d = deferred<{ ok: boolean; reason?: string }>();
    fbConnectMock.mockReturnValue(d.promise);
    let p!: Promise<unknown>;
    act(() => { p = result.current.connectFacebook("P1", "mypage"); });
    fire("comment", wire(2, { initial: true, msgId: "P1_2" }));
    await act(async () => { d.resolve({ ok: false, reason: "not_live" }); await p; });
    expect(result.current.initialComments).toHaveLength(0);
    expect(result.current.comments).toHaveLength(1);
  });
  it("after the window closes, a late initial batch on a non-empty feed is still dropped (handler unchanged)", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", wire(1));
    fbConnectMock.mockResolvedValue({ ok: false });
    await act(async () => { await result.current.connectFacebook("P1", "mypage"); });
    fire("comment", wire(2, { initial: true, msgId: "late" }));
    expect(result.current.initialComments).toHaveLength(0);
  });
  it("TikTok connect() is unchanged: same connectPlatform call, same buffer behaviour", async () => {
    const { result } = renderHook(() => useLiveFeed(true, "s@x.com"));
    fire("comment", wire(1, { platform: "TikTok", handle: "a" }));
    const d = deferred<{ ok: boolean; account: string }>();
    connectPlatformMock.mockReturnValue(d.promise);
    let p!: Promise<unknown>;
    act(() => { p = result.current.connect("TikTok", { username: "@Shop_A" }); });
    fire("comment", wire(2, { platform: "TikTok", handle: "b", initial: true, msgId: "t2" }));
    await act(async () => { d.resolve({ ok: true, account: "shop_a" }); await p; });
    expect(connectPlatformMock).toHaveBeenCalledWith("TikTok", { username: "@Shop_A" }, "s@x.com");
    expect(result.current.initialComments.map((c) => c.msgId)).toEqual(["t2"]);
    expect(fbConnectMock).not.toHaveBeenCalled();
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const body = (name: string) => { const s = src.indexOf(`const ${name} = `); const a = src.slice(s); const n = a.slice(10).search(/\n {2}const [a-zA-Z]+ = /); return n < 0 ? a : a.slice(0, n + 10); };
  it("A: the live gate runs only with the switch on, only for Facebook, BEFORE the dialog and BEFORE the picker/owner start", () => {
    const b = body("runSessionAware");
    const gate = 'featureSw.fbConnectV2 && target.platform === "Facebook" && !(await fbLiveGate(target.pageId))';
    expect(b.split(gate)).toHaveLength(3);
    expect(b.indexOf(gate)).toBeLessThan(b.indexOf("askSwitch(target)"));
    // Build 11 (M2): the picker / owner Start now sit in openFirstConnect, reached after the gate.
    expect(b.lastIndexOf(gate)).toBeLessThan(b.indexOf("openFirstConnect(pendingOfTarget(target));"));
    expect(body("openFirstConnect")).toContain("if (sessionV2) setOwnerStart(pending); else setPickerConnect(pending);");
    expect(b).toContain("runTargetConnect(target); return; // same platform → continue"); // reconnect branch untouched
    expect(body("fbLiveGate")).toContain("tApp.rd_fb_live_first");
    expect(body("fbLiveGate")).not.toContain("startSession");
  });
  it("B: confirmSwitch goes through runConfirmedSwitch with the switch as v2; still exactly 3 startSession sites", () => {
    const b = body("confirmSwitch");
    expect(b).toContain("v2: featureSw.fbConnectV2,");
    expect(b).toContain("stopOld: () => stopOtherPlatforms(target.platform),");
    expect(b).toContain("start: () => sessionInstance.startSession(days, target.platform, true),");
    expect((src.match(/sessionInstance\.startSession\(/g) || []).length).toBe(3);
  });
  it("C: doFbConnect uses connectFacebook only with the switch on; off = today's ensureJoined + fbConnect", () => {
    const b = body("doFbConnect");
    expect(b).toContain("if (featureSw.fbConnectV2) r = await liveFeed.connectFacebook(pageId, scopeKey || pageId);");
    expect(b).toContain("else { liveFeed.ensureJoined(); r = await fbConnect(pageId); }");
  });
  it("the plain Disconnect stays local (no server stop added to it)", () => {
    const b = body("onConnectFacebook");
    expect(b).toContain('if (fbChip.action.kind === "disconnect") { setFbOff(true); void fbDisconnect(fbChip.action.pageId); return; }');
    expect(src).not.toMatch(/setTtOff\(true\);\s*void ttDisconnect/);
  });
});
