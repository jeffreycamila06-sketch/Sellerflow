// Jeff 2026-11-10 (item 2): in Admin, a seller's country saved while the admin_user_country list is still loading
// must not be replaced by the list when it arrives — the country just saved stays.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const DB = vi.hoisted(() => ({ release: null as null | (() => void), rows: [] as { user_id: string; country: string }[], upserts: [] as unknown[], deletes: [] as string[] }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      // the list arrives only when the test releases it (a slow read)
      select: () => new Promise((res) => { DB.release = () => res({ data: DB.rows, error: null }); }),
      upsert: async (row: unknown) => { DB.upserts.push(row); return { error: null }; },
      delete: () => ({ eq: async (_c: string, v: string) => { DB.deletes.push(v); return { error: null }; } }),
    }),
  },
}));

import { useAdminCountries, withSavedHere } from "../adminCountry";

describe("Admin country: a save while the list is loading", () => {
  it("save CA before the list (still saying TW) arrives → after it arrives, CA is shown", async () => {
    DB.rows = [{ user_id: "u1", country: "TW" }, { user_id: "u2", country: "PH" }];
    const { result } = renderHook(() => useAdminCountries(true));
    await waitFor(() => expect(DB.release).not.toBeNull());
    await act(async () => { await result.current.save("u1", "CA"); });
    expect(result.current.picks.u1).toBe("CA");
    await act(async () => { DB.release!(); await Promise.resolve(); });
    expect(result.current.picks).toEqual({ u1: "CA", u2: "PH" }); // the save stays; the rest of the list arrives
  });
  it("cleared back to automatic before the list arrives → it stays cleared", async () => {
    DB.rows = [{ user_id: "u1", country: "TW" }];
    DB.release = null;
    const { result } = renderHook(() => useAdminCountries(true));
    await waitFor(() => expect(DB.release).not.toBeNull());
    await act(async () => { await result.current.save("u1", null); });
    await act(async () => { DB.release!(); await Promise.resolve(); });
    expect(result.current.picks.u1).toBeUndefined();
  });
  it("withSavedHere: this session's saves on top of the loaded list (null = cleared)", () => {
    expect(withSavedHere({ a: "TW", b: "PH" }, { a: "CA", b: null, c: "US" })).toEqual({ a: "CA", c: "US" });
    expect(withSavedHere({ a: "TW" }, {})).toEqual({ a: "TW" });
  });
});
