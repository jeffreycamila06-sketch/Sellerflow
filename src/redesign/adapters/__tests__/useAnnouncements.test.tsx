// Announcements hook — ONE read of the latest 10 on mount (zero poll), banner
// dismiss + bell last-seen in localStorage, admin publish (deactivate-then-
// insert keeps exactly one active) and unpublish. DB boundary mocked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { limitFn, updateEq, insert, deleteEq, getSession } = vi.hoisted(() => ({
  limitFn: vi.fn(async (): Promise<{ data: unknown[]; error: unknown }> => ({ data: [], error: null })),
  updateEq: vi.fn(async () => ({ error: null })),
  insert: vi.fn(async () => ({ error: null })),
  deleteEq: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "admin1" } } } })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: (...a: unknown[]) => getSession(...(a as [])) },
    from: () => ({
      select: () => ({ order: () => ({ limit: (...a: unknown[]) => limitFn(...(a as [])) }) }),
      update: () => ({ eq: (...a: unknown[]) => updateEq(...(a as [unknown, unknown])) }),
      insert: (...a: unknown[]) => insert(...(a as [])),
      delete: () => ({ eq: (...a: unknown[]) => deleteEq(...(a as [unknown, unknown])) }),
    }),
  },
}));

import { useAnnouncements, pickLatestActive, hasUnread, ANN_LS_DISMISSED, ANN_LS_LAST_SEEN, type Announcement } from "../useAnnouncements";

const row = (id: string, active: boolean, at: string) => ({ id, message: `msg ${id}`, active, created_at: at });
const ann = (id: string, active: boolean): Announcement => ({ id, message: `msg ${id}`, active, createdAt: "2026-07-02T00:00:00Z" });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  limitFn.mockResolvedValue({ data: [], error: null });
  deleteEq.mockResolvedValue({ error: null });
});

describe("pure helpers", () => {
  it("pickLatestActive returns the FIRST active (list is newest-first), null when none", () => {
    expect(pickLatestActive([ann("a", false), ann("b", true), ann("c", true)])?.id).toBe("b");
    expect(pickLatestActive([ann("a", false)])).toBeNull();
    expect(pickLatestActive([])).toBeNull();
  });
  it("hasUnread: newest id differs from last-seen; empty list = no dot", () => {
    expect(hasUnread([ann("a", true)], "")).toBe(true);
    expect(hasUnread([ann("a", true)], "a")).toBe(false);
    expect(hasUnread([], "")).toBe(false);
  });
});

describe("useAnnouncements", () => {
  it("loads the list once on mount; latest = newest active", async () => {
    limitFn.mockResolvedValue({ data: [row("n1", false, "2026-07-02T10:00:00Z"), row("n2", true, "2026-07-01T10:00:00Z")], error: null });
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.list).toHaveLength(2);
    expect(result.current.latest?.id).toBe("n2"); // n1 is newer but inactive
    expect(result.current.unread).toBe(true);     // n1 not seen yet
    expect(limitFn).toHaveBeenCalledTimes(1);     // read-on-load only
  });

  it("disabled (signed out) → no read, empty state", async () => {
    const { result } = renderHook(() => useAnnouncements(false));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(limitFn).not.toHaveBeenCalled();
    expect(result.current.latest).toBeNull();
  });

  it("dismiss persists the id (banner hidden for that id only)", async () => {
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.dismiss("n7"));
    expect(result.current.dismissedId).toBe("n7");
    expect(localStorage.getItem(ANN_LS_DISMISSED)).toBe("n7");
  });

  it("markSeen persists last-seen id → unread dot off", async () => {
    limitFn.mockResolvedValue({ data: [row("n1", true, "2026-07-02T10:00:00Z")], error: null });
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.unread).toBe(true);
    act(() => result.current.markSeen("n1"));
    expect(result.current.unread).toBe(false);
    expect(localStorage.getItem(ANN_LS_LAST_SEEN)).toBe("n1");
  });

  it("publish = deactivate current active, insert new (with created_by), reload", async () => {
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean } = { ok: false };
    await act(async () => { r = await result.current.publish("  Big sale tonight!  "); });
    expect(r.ok).toBe(true);
    expect(updateEq).toHaveBeenCalledWith("active", true); // single-active invariant
    expect(insert).toHaveBeenCalledWith({ message: "Big sale tonight!", created_by: "admin1" }); // trimmed
    expect(limitFn).toHaveBeenCalledTimes(2); // mount + reload after publish
  });

  it("publish rejects an empty/whitespace message without touching the DB", async () => {
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean } = { ok: true };
    await act(async () => { r = await result.current.publish("   "); });
    expect(r.ok).toBe(false);
    expect(updateEq).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("unpublish deactivates by id and reloads", async () => {
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.unpublish("n3"); });
    expect(updateEq).toHaveBeenCalledWith("id", "n3");
    expect(limitFn).toHaveBeenCalledTimes(2);
  });

  it("remove HARD-deletes by id (not update) and reloads → row gone everywhere", async () => {
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean } = { ok: false };
    await act(async () => { r = await result.current.remove("n5"); });
    expect(r.ok).toBe(true);
    expect(deleteEq).toHaveBeenCalledWith("id", "n5"); // DELETE, not active=false
    expect(updateEq).not.toHaveBeenCalled();           // not a soft unpublish
    expect(limitFn).toHaveBeenCalledTimes(2);           // reload → next open sees no row
  });

  it("remove surfaces an RLS/DB denial (non-admin) as {ok:false}, no crash, no reload", async () => {
    // Server-side RLS is the real gate; a non-admin delete returns an error here.
    deleteEq.mockResolvedValue({ error: { message: "permission denied for table announcements" } });
    const { result } = renderHook(() => useAnnouncements(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let r: { ok: boolean; error?: string } = { ok: true };
    await act(async () => { r = await result.current.remove("n5"); });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("permission denied");
    expect(limitFn).toHaveBeenCalledTimes(1); // no reload on failure
  });

  it("orphaned dismiss/last-seen keys (deleted id) don't crash pure helpers", () => {
    // After a delete, localStorage may still point at the removed id. The banner
    // + bell just never match it again — no crash, banner shows the next active.
    const afterDelete = [ann("keep-active", true)];
    expect(() => pickLatestActive(afterDelete)).not.toThrow();
    expect(pickLatestActive(afterDelete)?.id).toBe("keep-active"); // orphan dismissedId="gone" ≠ this id → banner shows
    expect(() => hasUnread(afterDelete, "gone")).not.toThrow();
    expect(hasUnread(afterDelete, "gone")).toBe(true); // newest ≠ stale last-seen
    expect(pickLatestActive([])).toBeNull();           // all deleted → no banner
    expect(hasUnread([], "gone")).toBe(false);
  });
});
