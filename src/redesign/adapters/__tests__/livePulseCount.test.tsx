// The Live Pulse tile's count (2026-11-27): the colour rule, the source of the number / limit, and WHEN it
// reads — once on the Admin screen, then every 60 s while the page is in front; never while hidden, never
// after the screen is left, never when not enabled.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { liveLevel, liveCountFrom, useLiveCount, LIVE_TILE_REFRESH_MS } from "../livePulseCount";

describe("colour rule", () => {
  it("green < 60 %, amber ≥ 60 %, red ≥ 70 % — at 59 / 60 / 69 / 70 of 100", () => {
    expect(liveLevel({ live: 59, limit: 100 })).toBe("ok");
    expect(liveLevel({ live: 60, limit: 100 })).toBe("warn");
    expect(liveLevel({ live: 69, limit: 100 })).toBe("warn");
    expect(liveLevel({ live: 70, limit: 100 })).toBe("bad");
    expect(liveLevel({ live: 100, limit: 100 })).toBe("bad");
    expect(liveLevel({ live: 0, limit: 100 })).toBe("ok");
  });
  it("follows the limit, whatever it is (no fixed number)", () => {
    expect(liveLevel({ live: 29, limit: 50 })).toBe("ok");
    expect(liveLevel({ live: 30, limit: 50 })).toBe("warn");
    expect(liveLevel({ live: 34, limit: 50 })).toBe("warn");
    expect(liveLevel({ live: 35, limit: 50 })).toBe("bad");
    expect(liveLevel({ live: 104, limit: 175 })).toBe("ok");      // 59.4 %
    expect(liveLevel({ live: 105, limit: 175 })).toBe("warn");    // 60 %
    expect(liveLevel({ live: 122, limit: 175 })).toBe("warn");    // 69.7 %
    expect(liveLevel({ live: 123, limit: 175 })).toBe("bad");     // 70.3 %
  });
  it("unknown → grey", () => {
    expect(liveLevel(null)).toBe("unknown");
  });
  it("number + limit = usage.concurrent / usage.concurrentLimit of the server answer", () => {
    const st = (u: unknown) => ({ count: 0, lastLabel: null, lastAt: null, cooldowns: [], usage: u as never });
    expect(liveCountFrom(st({ roomsToday: 9, concurrent: 38, dailyLimit: 1000, concurrentLimit: 100, warn: false }))).toEqual({ live: 38, limit: 100 });
    expect(liveCountFrom(st({ roomsToday: 9, concurrent: 38, dailyLimit: 1000, concurrentLimit: 250, warn: false }))).toEqual({ live: 38, limit: 250 });
    expect(liveCountFrom(st(null))).toBeNull();
    expect(liveCountFrom(st({ roomsToday: 9, concurrent: 3, dailyLimit: 1000, concurrentLimit: 0, warn: false }))).toBeNull();
    expect(liveCountFrom(undefined)).toBeNull();
  });
});

describe("when it reads", () => {
  let vis: DocumentVisibilityState = "visible";
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  const answer = (n: number) => ({ success: true, today: { count: 0 }, cooldowns: [], usage: { roomsToday: 1, concurrent: n, dailyLimit: 1000, concurrentLimit: 100 } });
  let live = 38;
  const reads = () => fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/admin/tiktok-cooldown/status")).length;
  const setVisible = (v: DocumentVisibilityState) => { vis = v; document.dispatchEvent(new Event("visibilitychange")); };
  const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

  beforeEach(() => {
    vi.useFakeTimers();
    vis = "visible"; live = 38;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(answer(live)), { status: 200 }));
  });
  afterEach(() => { fetchSpy.mockRestore(); vi.useRealTimers(); });

  it("once at once, then every 60 s while visible, with the new number", async () => {
    const { result } = renderHook(() => useLiveCount(true));
    await advance(0);
    expect(reads()).toBe(1);
    expect(result.current.count).toEqual({ live: 38, limit: 100 });
    live = 61;
    await advance(LIVE_TILE_REFRESH_MS - 1);
    expect(reads()).toBe(1);
    await advance(1);
    expect(reads()).toBe(2);
    expect(result.current.count).toEqual({ live: 61, limit: 100 });
    await advance(LIVE_TILE_REFRESH_MS);
    expect(reads()).toBe(3);
  });
  it("hidden page → no read at all; back in front after the 60 s → one read at once, then the 60 s rhythm", async () => {
    renderHook(() => useLiveCount(true));
    await advance(0);
    expect(reads()).toBe(1);
    setVisible("hidden");
    await advance(10 * LIVE_TILE_REFRESH_MS);
    expect(reads()).toBe(1);                                // paused
    setVisible("visible");
    await advance(0);
    expect(reads()).toBe(2);                                // due → at once
    await advance(LIVE_TILE_REFRESH_MS);
    expect(reads()).toBe(3);
  });
  it("back in front BEFORE the 60 s → waits for the rest of the 60 s (no extra read)", async () => {
    renderHook(() => useLiveCount(true));
    await advance(0);
    await advance(20_000);
    setVisible("hidden");
    await advance(10_000);
    setVisible("visible");
    await advance(0);
    expect(reads()).toBe(1);
    await advance(30_000 - 1);
    expect(reads()).toBe(1);
    await advance(1);
    expect(reads()).toBe(2);
  });
  it("hidden while a read is on its way → no next read is set up until the page is back", async () => {
    let release!: () => void;
    fetchSpy.mockImplementationOnce(() => new Promise((res) => { release = () => res(new Response(JSON.stringify(answer(5)), { status: 200 })); }));
    renderHook(() => useLiveCount(true));
    await advance(0);
    setVisible("hidden");
    release();
    await advance(5 * LIVE_TILE_REFRESH_MS);
    expect(reads()).toBe(1);
  });
  it("a page that opens hidden reads nothing until shown", async () => {
    vis = "hidden";
    renderHook(() => useLiveCount(true));
    await advance(3 * LIVE_TILE_REFRESH_MS);
    expect(reads()).toBe(0);
    setVisible("visible");
    await advance(0);
    expect(reads()).toBe(1);
  });
  it("the screen is left (unmount) → nothing more is read", async () => {
    const { unmount } = renderHook(() => useLiveCount(true));
    await advance(0);
    unmount();
    await advance(10 * LIVE_TILE_REFRESH_MS);
    setVisible("hidden"); setVisible("visible");
    await advance(0);
    expect(reads()).toBe(1);
  });
  it("not enabled → no read ever", async () => {
    const { result } = renderHook(() => useLiveCount(false));
    await advance(5 * LIVE_TILE_REFRESH_MS);
    setVisible("hidden"); setVisible("visible");
    await advance(0);
    expect(reads()).toBe(0);
    expect(result.current.count).toBeNull();
  });
});
