// Explicit session model (sub-step 2) — session lifecycle adapter.
// Pins: statusFallback never uses the device clock (resume-if-known, else pick);
// checkStatus maps the server RPC; startSession returns the new id; an RPC error
// degrades safely (resume, no reset).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { statusFallback } from "../useSessionInstance";

const { rpcMock, maybeSingleMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  maybeSingleMock: vi.fn(async () => ({ data: { current_session_id: null }, error: null })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
    rpc: rpcMock,
  },
}));

import { useSessionInstance } from "../useSessionInstance";

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingleMock.mockResolvedValue({ data: { current_session_id: null }, error: null });
});

describe("statusFallback (no device clock)", () => {
  it("resumes a known session id (running=true) — never resets", () => {
    expect(statusFallback("sid-1")).toEqual({ running: true, sessionId: "sid-1" });
  });
  it("no known id → not running (must pick a new session)", () => {
    expect(statusFallback(null)).toEqual({ running: false, sessionId: null });
  });
});

describe("useSessionInstance", () => {
  it("mount reads current_session_id from config", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { current_session_id: "sid-existing" }, error: null });
    const { result } = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.currentSessionId).toBe("sid-existing");
  });

  it("checkStatus running=true → returns id + syncs currentSessionId", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ running: true, session_id: "sid-live" }], error: null });
    const { result } = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let status;
    await act(async () => { status = await result.current.checkStatus(); });
    expect(status).toEqual({ running: true, sessionId: "sid-live" });
    expect(result.current.currentSessionId).toBe("sid-live");
  });

  it("checkStatus running=false → not running, no id", async () => {
    rpcMock.mockResolvedValueOnce({ data: [{ running: false, session_id: "sid-ended" }], error: null });
    const { result } = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let status;
    await act(async () => { status = await result.current.checkStatus(); });
    expect(status).toEqual({ running: false, sessionId: null });
  });

  it("checkStatus RPC error → statusFallback (resume known id; NOT the device clock)", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: { current_session_id: "sid-known" }, error: null });
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    const { result } = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(result.current.currentSessionId).toBe("sid-known"));
    let status;
    await act(async () => { status = await result.current.checkStatus(); });
    expect(status).toEqual({ running: true, sessionId: "sid-known" }); // resumed, no reset
  });

  it("startSession returns the new id and sets currentSessionId", async () => {
    rpcMock.mockResolvedValueOnce({ data: "sid-new", error: null });
    const { result } = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let id;
    await act(async () => { id = await result.current.startSession(4); });
    expect(id).toBe("sid-new");
    expect(result.current.currentSessionId).toBe("sid-new");
    expect(rpcMock).toHaveBeenCalledWith("start_session", { p_days: 4 });
  });

  it("startSession RPC failure → null (caller must NOT start a session-less feed)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let id: string | null = "x";
    await act(async () => { id = await result.current.startSession(2); });
    expect(id).toBeNull();
  });
});

describe("ensureLoaded — Connect gate (audit LOW #2: no wrongful reset while mount read pending)", () => {
  it("WAITS for the pending mount read, so a failing session_status RESUMES the known session (not a new one)", async () => {
    // Mount read is SLOW (still pending) and session_status FAILS — the exact
    // double-condition that used to fall back to a null id → picker → new session.
    let resolveRead!: (v: unknown) => void;
    maybeSingleMock.mockReturnValueOnce(new Promise((r) => { resolveRead = r; }));
    rpcMock.mockResolvedValue({ data: null, error: { message: "network" } });

    const { result } = renderHook(() => useSessionInstance(true));
    expect(result.current.loaded).toBe(false);              // mount read still pending

    // Connect's sequence: await ensureLoaded() THEN checkStatus().
    let status: { running: boolean; sessionId: string | null } | undefined;
    const connect = (async () => {
      await result.current.ensureLoaded();
      status = await result.current.checkStatus();
    })();

    // The mount read now resolves with a KNOWN session id.
    await act(async () => {
      resolveRead({ data: { current_session_id: "sid-known" }, error: null });
      await connect;
    });

    // ensureLoaded guaranteed idRef was populated before checkStatus fell back →
    // RESUME the known session, NOT running=false (which would open the picker = reset).
    expect(status).toEqual({ running: true, sessionId: "sid-known" });
    expect(result.current.currentSessionId).toBe("sid-known");
  });

  it("resolves immediately once already loaded (no deadlock — the read always completes)", async () => {
    const { result } = renderHook(() => useSessionInstance(true));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await expect(result.current.ensureLoaded()).resolves.toBeUndefined();
  });
});
