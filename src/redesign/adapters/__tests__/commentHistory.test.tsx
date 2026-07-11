// COMMENT PERSISTENCE — pure codec + hook behavior. Pins the final spec's
// hard requirements:
//   • ZERO TAIL LOSS (Jeff): every accepted comment hits the localStorage
//     mirror SYNCHRONOUSLY (no batching delay), unconfirmed comments RESEND on
//     the next open, and the exit flush uses the SYNC-cached token (audit F4).
//   • Batched server writes (≥FLUSH_AT or 60s), fail-streak degrade that never
//     touches the live feed, 64KiB-safe capped exit flush with hidden+pagehide
//     dedupe (audit F2).
//   • Round-trip identity: persisted tuples keep the EXACT commentKey (overlap
//     dedup) — comment text is never truncated.
//   • Structural caps: decode caps at RESTORE_CAP; restore is one-shot per
//     seller (F12); window rollover clears the restored block (F9); preview
//     saves are gated behind ?hist=1 (F10).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { Comment as ProdComment } from "../../../lib/orderTypes";

const M = vi.hoisted(() => ({
  rpc: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: [], error: null })),
  insert: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "uid1" }, access_token: "tok-cached" } } })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => M.getSession(...(a as [])),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ insert: (...a: unknown[]) => M.insert(...(a as [unknown])) }),
    rpc: (...a: unknown[]) => M.rpc(...(a as [string, unknown])),
  },
}));

import {
  toTuple, fromTuple, encodeBatch, chunk, decodeRestorePayload, mergeForDisplay,
  readMirror, writeMirror, clearMirror, isPersistEnabled, useCommentHistory,
  RESTORE_CAP, BATCH_MAX, FLUSH_AT, FLUSH_INTERVAL_MS, EXIT_FLUSH_MAX, MIRROR_KEY_PREFIX,
} from "../commentHistory";
import { commentKey, toRedesignComment } from "../useLiveFeed";

const mkComment = (n: number, over: Partial<ProdComment> = {}): ProdComment => ({
  platform: "TikTok", sourceUsername: "seller_tt", sessionId: "sess1",
  handle: `buyer${n}`, name: `Buyer ${n}`, comment: `mine ${n}`, isBuy: true,
  buyerNum: null, buyerData: null,
  time: "9:41:00 PM", timestamp: new Date(1760000000000 + n * 1000).toISOString(),
  ...over,
});

// vitest runs with DEV=true → isPreviewEnv() is true → saves are gated (F10).
// The save tests opt in exactly the way googletest preview verification does.
const optInPersist = () => window.history.replaceState({}, "", "/?hist=1");
const optOutPersist = () => window.history.replaceState({}, "", "/");

const WIN = "2026-07-11";
const hookProps = (feed: ProdComment[], win = WIN) => ({ feed, win });
const setup = (feed: ProdComment[] = []) =>
  renderHook(({ feed: f, win }: { feed: ProdComment[]; win: string }) =>
    useCommentHistory(true, "seller@x.com", win, f), { initialProps: hookProps(feed) });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  optInPersist();
  M.rpc.mockResolvedValue({ data: [], error: null });
  M.insert.mockResolvedValue({ error: null });
  M.getSession.mockResolvedValue({ data: { session: { user: { id: "uid1" }, access_token: "tok-cached" } } });
  vi.stubEnv("VITE_SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); optOutPersist();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
});

describe("tuple codec (pure)", () => {
  it("round-trip keeps every display field AND the exact commentKey (overlap dedup identity)", () => {
    const c = mkComment(1, { comment: "mine — 中文留言 with a very long text that must never be truncated because commentKey includes it" });
    const back = fromTuple(toTuple(c))!;
    expect(commentKey(back)).toBe(commentKey(c));
    expect(back.name).toBe(c.name);
    expect(back.time).toBe(c.time);
    expect(back.isBuy).toBe(true);
    expect(back.platform).toBe("TikTok");
    // restored comments are DISPLAY data: buyer fields are inert nulls
    expect(back.buyerNum).toBeNull();
    expect(back.buyerData).toBeNull();
  });
  it("fromTuple rejects malformed entries (never a throw, never a half-comment)", () => {
    expect(fromTuple(null)).toBeNull();
    expect(fromTuple(["TikTok"])).toBeNull();                                  // too short
    expect(fromTuple(["TikTok", "", "", "", "", "mine", "n", 1, ""])).toBeNull(); // no handle
    expect(fromTuple(["TikTok", "", "", "b1", "", "", "n", 1, ""])).toBeNull();   // no comment
    expect(fromTuple({ handle: "b1" })).toBeNull();                            // not an array
  });
  it("decodeRestorePayload: skips garbage, dedups by commentKey, caps at RESTORE_CAP", () => {
    const good = Array.from({ length: RESTORE_CAP + 50 }, (_, i) => toTuple(mkComment(i)));
    const dupe = toTuple(mkComment(0));
    const out = decodeRestorePayload([null, "junk", dupe, ...good, 42]);
    expect(out.length).toBe(RESTORE_CAP);
    const keys = new Set(out.map(commentKey));
    expect(keys.size).toBe(RESTORE_CAP); // no duplicates survived
  });
  it("decodeRestorePayload: non-array payload → empty (blank-feed-proof)", () => {
    expect(decodeRestorePayload(undefined)).toEqual([]);
    expect(decodeRestorePayload({ t: [] })).toEqual([]);
  });
  it("chunk splits at BATCH_MAX with no stragglers lost", () => {
    const list = Array.from({ length: 230 }, (_, i) => i);
    const parts = chunk(list, BATCH_MAX);
    expect(parts.map((p) => p.length)).toEqual([100, 100, 30]);
    expect(parts.flat()).toEqual(list);
  });
});

describe("mergeForDisplay (pure — duplicate-order layer boundaries)", () => {
  it("overlap collapses by commentKey, LIVE copy wins; history appends BELOW live with restored:true", () => {
    const shared = mkComment(1);
    const liveOnly = mkComment(2);
    const histOnly = mkComment(0);
    const live = [toRedesignComment(liveOnly), toRedesignComment(shared)];
    const merged = mergeForDisplay(live, [shared, histOnly]);
    expect(merged.length).toBe(3); // shared rendered exactly once
    expect(merged[0].restored).toBeUndefined();          // live block first
    expect(merged[1].restored).toBeUndefined();
    expect(merged[2].restored).toBe(true);               // history below
    expect(merged[2].id).toBe(commentKey(histOnly));
  });
  it("no restored → returns the live array UNCHANGED (identity — zero re-render cost)", () => {
    const live = [toRedesignComment(mkComment(1))];
    expect(mergeForDisplay(live, [])).toBe(live);
  });
});

describe("local mirror (zero-tail-loss layer)", () => {
  it("write → read round-trips; garbage self-clears; clearMirror removes", () => {
    writeMirror("uid1", WIN, [mkComment(1), mkComment(2)]);
    const m = readMirror("uid1")!;
    expect(m.win).toBe(WIN);
    expect(m.comments.map(commentKey)).toEqual([mkComment(1), mkComment(2)].map(commentKey));
    localStorage.setItem(MIRROR_KEY_PREFIX + "uid1", "{corrupt");
    expect(readMirror("uid1")).toBeNull();
    expect(localStorage.getItem(MIRROR_KEY_PREFIX + "uid1")).toBeNull(); // self-cleared
    writeMirror("uid1", WIN, [mkComment(3)]);
    clearMirror("uid1");
    expect(readMirror("uid1")).toBeNull();
  });
  it("empty list removes the key (confirmed flush leaves no stale mirror)", () => {
    writeMirror("uid1", WIN, [mkComment(1)]);
    writeMirror("uid1", WIN, []);
    expect(localStorage.getItem(MIRROR_KEY_PREFIX + "uid1")).toBeNull();
  });
  it("quota error → retries with the NEWEST half (latest comments matter most — Jeff)", () => {
    const real = localStorage.setItem.bind(localStorage);
    let calls = 0;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      calls += 1;
      if (calls === 1) throw new Error("QuotaExceededError");
      real(k, v);
    });
    writeMirror("uid1", WIN, [mkComment(1), mkComment(2), mkComment(3), mkComment(4)]);
    spy.mockRestore();
    const m = readMirror("uid1")!;
    expect(m.comments.map((c) => c.handle)).toEqual(["buyer3", "buyer4"]); // newest half kept
  });
});

describe("useCommentHistory — save path (zero tail loss)", () => {
  it("a fresh comment is mirrored SYNCHRONOUSLY on the same effect tick (no batching delay)", async () => {
    const { rerender } = setup();
    await waitFor(() => expect(M.getSession).toHaveBeenCalled());
    await act(async () => {});                       // let auth ids land
    rerender(hookProps([mkComment(1)]));
    const m = readMirror("uid1");                    // read IMMEDIATELY — no timers advanced
    expect(m).not.toBeNull();
    expect(m!.comments.map(commentKey)).toEqual([commentKey(mkComment(1))]);
    expect(M.insert).not.toHaveBeenCalled();         // server write stays batched
  });

  it("timer flush after FLUSH_INTERVAL_MS → ONE insert (return-minimal rows) → mirror emptied", async () => {
    const { rerender } = setup();
    await act(async () => {});
    vi.useFakeTimers();
    rerender(hookProps([mkComment(1), mkComment(2)]));
    expect(M.insert).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(FLUSH_INTERVAL_MS + 10); });
    await act(async () => {});                       // let the insert promise settle
    vi.useRealTimers();
    expect(M.insert).toHaveBeenCalledTimes(1);
    const rows = M.insert.mock.calls[0][0] as Array<{ user_id: string; session_key: string; comments: { v: number; t: unknown[] }; comment_count: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe("uid1");
    expect(rows[0].session_key).toBe(WIN);
    expect(rows[0].comment_count).toBe(2);
    expect(readMirror("uid1")).toBeNull();           // confirmed → mirror cleared
  });

  it(`size flush at FLUSH_AT (${FLUSH_AT}) → immediate insert, chunked ≤${BATCH_MAX}/row`, async () => {
    const { rerender } = setup();
    await act(async () => {});
    const feed = Array.from({ length: FLUSH_AT }, (_, i) => mkComment(i)).reverse(); // newest-first like the real feed
    await act(async () => { rerender(hookProps(feed)); });
    expect(M.insert).toHaveBeenCalledTimes(1);
    const rows = M.insert.mock.calls[0][0] as Array<{ comment_count: number; comments: { t: unknown[] } }>;
    expect(rows.every((r) => r.comments.t.length <= BATCH_MAX)).toBe(true);
    expect(rows.reduce((s, r) => s + r.comment_count, 0)).toBe(FLUSH_AT);
  });

  it("failed inserts NEVER lose data: pending stays mirrored; after 3 misses the network goes quiet (mirror + resend take over)", async () => {
    M.insert.mockResolvedValue({ error: { message: "down" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = setup();
    await act(async () => {});
    const feed = Array.from({ length: FLUSH_AT }, (_, i) => mkComment(i)).reverse();
    await act(async () => { rerender(hookProps(feed)); });                            // miss 1
    await act(async () => { rerender(hookProps([mkComment(500), ...feed])); });       // miss 2
    await act(async () => { rerender(hookProps([mkComment(501), mkComment(500), ...feed])); }); // miss 3
    const callsAfterStreak = M.insert.mock.calls.length;
    expect(callsAfterStreak).toBe(3);
    await act(async () => { rerender(hookProps([mkComment(502), mkComment(501), mkComment(500), ...feed])); });
    expect(M.insert.mock.calls.length).toBe(callsAfterStreak); // backed off — no more burns
    const m = readMirror("uid1")!;
    expect(m.comments.length).toBe(FLUSH_AT + 3);              // NOTHING lost — all mirrored
    warn.mockRestore();
  });

  it("F10 preview gate: without ?hist=1 (preview default) nothing is mirrored or inserted", async () => {
    optOutPersist();
    expect(isPersistEnabled()).toBe(false);
    const { rerender } = setup();
    await act(async () => {});
    await act(async () => { rerender(hookProps([mkComment(1)])); });
    expect(readMirror("uid1")).toBeNull();
    expect(M.insert).not.toHaveBeenCalled();
  });
});

describe("useCommentHistory — exit flush (audit F2/F4)", () => {
  const fireVisibility = (state: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("visibilitychange→hidden → immediate keepalive fetch with the SYNC-cached token; pagehide right after is DEDUPED", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = setup();
    await act(async () => {});
    rerender(hookProps([mkComment(1)]));
    act(() => { fireVisibility("hidden"); });
    expect(fetchMock).toHaveBeenCalledTimes(1);                    // fired synchronously, no getSession await
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://test.supabase.co/rest/v1/session_comment_batches");
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-cached");
    expect((init.headers as Record<string, string>).Prefer).toBe("return=minimal");
    act(() => { window.dispatchEvent(new Event("pagehide")); });   // double-fire path
    expect(fetchMock).toHaveBeenCalledTimes(1);                    // deduped
    await act(async () => {});                                     // 2xx → confirm
    expect(readMirror("uid1")).toBeNull();                         // confirmed on real success only
  });

  it(`exit body is capped at the NEWEST ${EXIT_FLUSH_MAX} (64KiB keepalive quota); older stay mirrored for resend`, async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));          // NOT confirmed (e.g. died mid-flight)
    vi.stubGlobal("fetch", fetchMock);
    M.insert.mockResolvedValue({ error: { message: "offline" } }); // keep pending large
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { rerender } = setup();
    await act(async () => {});
    const feed = Array.from({ length: EXIT_FLUSH_MAX + 150 }, (_, i) => mkComment(i)).reverse();
    await act(async () => { rerender(hookProps(feed)); });
    act(() => { fireVisibility("hidden"); });
    const rows = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Array<{ comment_count: number; comments: { t: unknown[][] } }>;
    const sent = rows.reduce((s, r) => s + r.comment_count, 0);
    expect(sent).toBe(EXIT_FLUSH_MAX);
    // newest-priority: the very last accepted comment IS in the exit payload
    const sentHandles = rows.flatMap((r) => r.comments.t.map((t) => t[3]));
    expect(sentHandles).toContain(`buyer${EXIT_FLUSH_MAX + 149}`);
    await act(async () => {});
    expect(readMirror("uid1")!.comments.length).toBe(EXIT_FLUSH_MAX + 150); // nothing confirmed → nothing lost
    warn.mockRestore();
  });
});

describe("useCommentHistory — restore + resend-on-open", () => {
  it("resends the unconfirmed mirror BEFORE the restore read (zero tail loss across a kill), then clears it", async () => {
    writeMirror("uid1", WIN, [mkComment(90), mkComment(91)]);      // a previous open died with these unconfirmed
    const restoredTuples = [toTuple(mkComment(90)), toTuple(mkComment(91)), toTuple(mkComment(1))];
    M.rpc.mockResolvedValue({ data: restoredTuples, error: null });
    const { result } = setup();
    await waitFor(() => expect(result.current.restored.length).toBe(3));
    expect(M.insert).toHaveBeenCalledTimes(1);                     // the resend
    // resend FIRST → the just-delivered tail is part of the restore read
    expect(M.insert.mock.invocationCallOrder[0]).toBeLessThan(M.rpc.mock.invocationCallOrder[0]);
    const rows = M.insert.mock.calls[0][0] as Array<{ comment_count: number }>;
    expect(rows[0].comment_count).toBe(2);
    expect(readMirror("uid1")).toBeNull();                         // confirmed → cleared
  });

  it("mirror from a CLOSED window is dropped, not resent (retention = window only)", async () => {
    writeMirror("uid1", "2026-07-01", [mkComment(90)]);
    const { result } = setup();
    await waitFor(() => expect(M.rpc).toHaveBeenCalled());
    expect(M.insert).not.toHaveBeenCalled();
    expect(readMirror("uid1")).toBeNull();
    expect(result.current.restored).toEqual([]);
  });

  it("failed resend keeps the mirror AND queues the tail into the live flush cycle", async () => {
    writeMirror("uid1", WIN, [mkComment(90)]);
    M.insert.mockResolvedValueOnce({ error: { message: "down" } });
    const { result, rerender } = setup();
    await waitFor(() => expect(M.rpc).toHaveBeenCalled());
    expect(readMirror("uid1")).not.toBeNull();                     // mirror kept — will retry next open too
    // …and the very next successful live flush carries it:
    M.insert.mockResolvedValue({ error: null });
    vi.useFakeTimers();
    rerender(hookProps([mkComment(1)]));
    await act(async () => { vi.advanceTimersByTime(FLUSH_INTERVAL_MS + 10); });
    await act(async () => {});
    vi.useRealTimers();
    const lastRows = M.insert.mock.calls.at(-1)![0] as Array<{ comments: { t: unknown[][] } }>;
    const handles = lastRows.flatMap((r) => r.comments.t.map((t) => t[3]));
    expect(handles).toContain("buyer90");                          // the killed tail rode along
    expect(handles).toContain("buyer1");
    expect(result.current.restored).toEqual([]);                   // rpc returned [] here — fine
  });

  it("restore is ONE-SHOT per seller (F12): a window-key change clears the block (F9) and does NOT refetch", async () => {
    M.rpc.mockResolvedValue({ data: [toTuple(mkComment(1))], error: null });
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.restored.length).toBe(1));
    expect(M.rpc).toHaveBeenCalledTimes(1);
    rerender({ feed: [], win: "2026-07-12" });                     // midnight rollover
    await waitFor(() => expect(result.current.restored).toEqual([]));  // old history gone (F9)
    expect(M.rpc).toHaveBeenCalledTimes(1);                        // still one read — ZERO POLL
  });

  it("restore RPC error → empty history, live feed untouched (silent degrade)", async () => {
    M.rpc.mockResolvedValue({ data: null, error: { message: "rpc missing" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = setup();
    await waitFor(() => expect(M.rpc).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.restored).toEqual([]);
    warn.mockRestore();
  });
});
