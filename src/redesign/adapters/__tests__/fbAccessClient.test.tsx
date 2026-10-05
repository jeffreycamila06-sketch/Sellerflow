// GET /fb/access — client half. Pins: the answer is read strictly (fail closed on any failure),
// the hook asks once per account and again on focus, false while loading / after a failure /
// for another account, and the UI gates: non-testers see no Facebook UI, the 3 hard-coded
// accounts are unchanged, testers get Facebook, receipt access opens the receipt UI.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "JWT" } } }) } } }));
import { loadFbAccess, useFbAccess, fbUiGates, FB_ACCESS_NONE, FB_ACCESS_REFRESH_MIN_MS } from "../fbAccess";
import { fbPreviewEnabled } from "../fbPreview";

const res = (status: number, body: unknown) => ({ status, json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await Promise.resolve(); }); };

describe("loadFbAccess", () => {
  it("200 + ok:true → the booleans (anything but true is false); sends the bearer", async () => {
    fetchMock.mockResolvedValue(res(200, { ok: true, facebook: true, receipt: "yes" }));
    expect(await loadFbAccess()).toEqual({ facebook: true, receipt: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/fb\/access$/);
    expect(init.headers.Authorization).toBe("Bearer JWT");
  });
  it("failure path: non-200, 404 (route not deployed), ok:false, bad JSON, network → null", async () => {
    for (const r of [res(500, {}), res(404, {}), res(401, { ok: false }), res(200, { ok: false, facebook: true }), { status: 200, json: async () => { throw new Error("x"); } }]) {
      fetchMock.mockResolvedValueOnce(r);
      expect(await loadFbAccess()).toBeNull();
    }
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect(await loadFbAccess()).toBeNull();
  });
});

describe("useFbAccess", () => {
  it("false while loading, then the answer", async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => useFbAccess(true, "tester@x.co"));
    expect(result.current).toEqual(FB_ACCESS_NONE);
    await act(async () => { resolve(res(200, { ok: true, facebook: true, receipt: true })); });
    await flush();
    expect(result.current).toEqual({ facebook: true, receipt: true });
  });
  it("a failed call → both false (fail closed)", async () => {
    fetchMock.mockResolvedValue(res(500, {}));
    const { result } = renderHook(() => useFbAccess(true, "tester@x.co"));
    await flush();
    expect(result.current).toEqual(FB_ACCESS_NONE);
  });
  it("asks again when the app regains focus (throttled); a later failure → false", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, facebook: true, receipt: false })).mockResolvedValueOnce(res(500, {}));
    const { result } = renderHook(() => useFbAccess(true, "tester@x.co"));
    await flush();
    expect(result.current.facebook).toBe(true);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // too soon after the first ask
    vi.setSystemTime(Date.now() + FB_ACCESS_REFRESH_MIN_MS);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(FB_ACCESS_NONE);
  });
  it("signed out → no call, false; another account never inherits an answer", async () => {
    const off = renderHook(() => useFbAccess(false, "tester@x.co"));
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(off.result.current).toEqual(FB_ACCESS_NONE);
    let resolveB!: (v: unknown) => void;
    fetchMock.mockResolvedValueOnce(res(200, { ok: true, facebook: true, receipt: true })).mockReturnValueOnce(new Promise((r) => { resolveB = r; }));
    const { result, rerender } = renderHook(({ k }) => useFbAccess(true, k), { initialProps: { k: "tester@x.co" } });
    await flush();
    expect(result.current.facebook).toBe(true);
    rerender({ k: "other@x.co" });
    expect(result.current).toEqual(FB_ACCESS_NONE); // B is still loading → nothing from A
    await act(async () => { resolveB(res(200, { ok: true, facebook: false, receipt: false })); });
    await flush();
    expect(result.current).toEqual(FB_ACCESS_NONE);
  });
});

describe("UI gates", () => {
  const none = FB_ACCESS_NONE;
  it("non-tester (flag off, not preview, no access) → no Facebook UI and no receipt UI", () => {
    expect(fbUiGates({ fbFlag: false, fbPreview: fbPreviewEnabled("seller@x.co"), access: none })).toEqual({ fbEnabled: false, receiptUi: false });
  });
  it("the 3 hard-coded accounts → both, even with no /fb/access answer (unchanged)", () => {
    for (const e of ["camilajeffrey1@gmail.com", "googletest@gmail.com", "test@gmail.com"]) {
      expect(fbUiGates({ fbFlag: false, fbPreview: fbPreviewEnabled(e), access: none })).toEqual({ fbEnabled: true, receiptUi: true });
    }
  });
  it("tester → Facebook; receipt UI only with receipt access", () => {
    expect(fbUiGates({ fbFlag: false, fbPreview: false, access: { facebook: true, receipt: false } })).toEqual({ fbEnabled: true, receiptUi: false });
    expect(fbUiGates({ fbFlag: false, fbPreview: false, access: { facebook: true, receipt: true } })).toEqual({ fbEnabled: true, receiptUi: true });
  });
  it("fb_enabled flag alone opens Facebook but not the receipt UI (unchanged meaning)", () => {
    expect(fbUiGates({ fbFlag: true, fbPreview: false, access: none })).toEqual({ fbEnabled: true, receiptUi: false });
  });
});
