// Rule 3 of the new sticker's auto-save (Jeff 2026-11-10): it runs only when BOTH reads really answered.
// A failed / missing read still counts as "loaded" (all off) for the gates, but never as OK for the auto-save.
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: mock.rpc, from: mock.from } }));
import { loadFeatureAccess, setFeatureAccess, featureAccessOk, featureAccessLoaded } from "../featureAccess";
import { useFeatureSwitches, switchesLoaded, switchesOk } from "../featureSwitches";

const table = (result: { data: unknown; error: unknown }) => ({ select: () => ({ in: async () => result }) });

describe("my_feature_access: featureAccessOk only after a read that answered", () => {
  it("answered → OK; error → loaded but NOT OK; a thrown read → NOT OK", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { one_sticker: true }, error: null });
    setFeatureAccess(await loadFeatureAccess(), true);
    expect(featureAccessOk()).toBe(true);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    setFeatureAccess(await loadFeatureAccess(), true);
    expect(featureAccessLoaded()).toBe(true);
    expect(featureAccessOk()).toBe(false);
    mock.rpc.mockRejectedValueOnce(new Error("network"));
    setFeatureAccess(await loadFeatureAccess(), true);
    expect(featureAccessOk()).toBe(false);
  });
  it("shared phone: a slow read of the previous user that answers late never makes the new user's failed read OK", async () => {
    let finishOld!: (v: unknown) => void;
    mock.rpc.mockReturnValueOnce(new Promise((r) => { finishOld = r; })); // previous user's read, still running
    const old = loadFeatureAccess();
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } }); // the new user's read fails
    const now = await loadFeatureAccess();
    finishOld({ data: { one_sticker: true }, error: null });
    await old;
    setFeatureAccess(now, true);
    expect(featureAccessOk()).toBe(false);
  });
  it("a cached answer (not read yet this sign-in) is never OK", () => {
    setFeatureAccess({ one_sticker: true }, false);
    expect(featureAccessOk()).toBe(false);
  });
});

describe("app_settings switches: switchesOk only after a read that answered", () => {
  it("answered → OK", async () => {
    mock.from.mockReturnValueOnce(table({ data: [{ key: "one_sticker_enabled", value: "true" }], error: null }));
    const { result } = renderHook(() => useFeatureSwitches("u1"));
    await waitFor(() => expect(switchesLoaded(result.current)).toBe(true));
    expect(switchesOk(result.current)).toBe(true);
    expect(result.current.oneSticker).toBe(true);
  });
  it("error → loaded (all off) but NOT OK", async () => {
    mock.from.mockReturnValueOnce(table({ data: null, error: { message: "offline" } }));
    const { result } = renderHook(() => useFeatureSwitches("u2"));
    await waitFor(() => expect(switchesLoaded(result.current)).toBe(true));
    expect(switchesOk(result.current)).toBe(false);
  });
  it("not read yet → neither", () => {
    mock.from.mockReturnValueOnce({ select: () => ({ in: () => new Promise(() => {}) }) });
    const { result } = renderHook(() => useFeatureSwitches("u3"));
    expect(switchesLoaded(result.current)).toBe(false);
    expect(switchesOk(result.current)).toBe(false);
  });
});
