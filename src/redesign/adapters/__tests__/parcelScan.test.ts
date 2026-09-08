// Client half of Parcel Scan (A1): the feature gate (canUseClassicText
// pattern), the downscale math, the row mapper, the confirm-form validation
// rules, and the scan POST (403 = server-enforced admin; unreachable = server
// not deployed yet). Mocking follows broadcastTranslate.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: "jwt-abc", user: { id: "u1" } } } })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getSession: () => getSession() } },
}));
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { canUseParcelScan, scaledDims, rowToScan, scanParcel, SCAN_MAX_EDGE, formErrors, amountWarns } from "../parcelScan";

beforeEach(() => vi.clearAllMocks());
afterEach(() => { (globalThis.fetch as unknown) = undefined; });

describe("canUseParcelScan (admin OR the sellerflowlive test account ONLY)", () => {
  it("admin role → allowed (both db and display casing)", () => {
    expect(canUseParcelScan("admin", "anyone@example.com")).toBe(true);
    expect(canUseParcelScan("Admin", null)).toBe(true);
  });
  it("test account → allowed, case/whitespace-insensitive", () => {
    expect(canUseParcelScan("seller", "googletest@sellerflowlive.com")).toBe(true);
    expect(canUseParcelScan("seller", "  GoogleTest@SellerFlowLive.com ")).toBe(true);
  });
  it("everyone else → hidden — including the gmail variant (the F4 lesson)", () => {
    expect(canUseParcelScan("seller", "seller@example.com")).toBe(false);
    expect(canUseParcelScan("seller", "googletest@gmail.com")).toBe(false);
    expect(canUseParcelScan(undefined, undefined)).toBe(false);
    expect(canUseParcelScan(null, "")).toBe(false);
  });
});

describe("scaledDims (~1500px long edge, aspect kept)", () => {
  it("large landscape scales down by the long edge", () => {
    expect(scaledDims(4000, 3000)).toEqual({ w: 1500, h: 1125 });
  });
  it("large portrait scales by height", () => {
    expect(scaledDims(3000, 4000)).toEqual({ w: 1125, h: 1500 });
  });
  it("already small → untouched (never upscales)", () => {
    expect(scaledDims(800, 600)).toEqual({ w: 800, h: 600 });
    expect(scaledDims(SCAN_MAX_EDGE, 900)).toEqual({ w: SCAN_MAX_EDGE, h: 900 });
  });
  it("degenerate inputs never produce 0/negative dims", () => {
    expect(scaledDims(0, 0).w).toBeGreaterThanOrEqual(1);
    expect(scaledDims(NaN as unknown as number, 10).h).toBeGreaterThanOrEqual(1);
  });
});

describe("rowToScan", () => {
  it("maps a DB row; null amount stays null", () => {
    const r = rowToScan({ id: "a", customer_name: "陳小美", phone: "0912345678", store_id: "123456", amount: "550", notes: null, status: "confirmed", created_at: "2026-09-08T01:00:00Z" });
    expect(r).toEqual({ id: "a", customerName: "陳小美", phone: "0912345678", storeId: "123456", amount: 550, notes: "", status: "confirmed", createdAt: "2026-09-08T01:00:00Z" });
    expect(rowToScan({ id: "b", amount: null }).amount).toBe(null);
  });
});

describe("confirm-form validation (existing 賣貨便 validators; empty allowed)", () => {
  const base = { name: "", phone: "", store: "", amount: "", notes: "" };
  it("all-empty form → empty flag (nothing to save)", () => {
    expect(formErrors(base).empty).toBe(true);
  });
  it("valid filled form → no errors", () => {
    const e = formErrors({ name: "陳小美", phone: "0912345678", store: "123456", amount: "550", notes: "" });
    expect(e).toEqual({ name: false, phone: false, store: false, empty: false });
  });
  it("non-empty invalid phone/store/name flag; EMPTY fields never flag", () => {
    expect(formErrors({ ...base, phone: "12345" }).phone).toBe(true);
    expect(formErrors({ ...base, store: "12" }).store).toBe(true);
    expect(formErrors({ ...base, name: "王小明123" }).name).toBe(true); // digits forbidden on the waybill
    const partial = formErrors({ ...base, name: "陳小美" }); // phone/store left empty = fine
    expect(partial.phone).toBe(false);
    expect(partial.store).toBe(false);
    expect(partial.empty).toBe(false);
  });
  it("amount 55–20000 is a WARNING, never a block", () => {
    expect(amountWarns("30")).toBe(true);
    expect(amountWarns("25000")).toBe(true);
    expect(amountWarns("550")).toBe(false);
    expect(amountWarns("")).toBe(false); // empty = unknown, no warning
  });
});

describe("scanParcel (client POST)", () => {
  const fields = { name: "陳小美", phone: "0912345678", store_id: "123456", amount: 550, notes: null };

  it("success → fields + confidence; sends Bearer token + image body", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, fields, confidence: { name: "high", phone: "high", store_id: "high", amount: "high", notes: "low" } }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await scanParcel("aGVsbG8=", "image/jpeg");
    expect(r.ok).toBe(true);
    expect(r.fields).toEqual(fields);
    expect(r.confidence?.notes).toBe("low");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://srv.test/admin/parcel-scan");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-abc");
    expect(JSON.parse(init.body as string)).toEqual({ imageBase64: "aGVsbG8=", mediaType: "image/jpeg" });
  });

  it("403 (non-admin — the server-enforced gate) → forbidden", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: "forbidden" }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await scanParcel("aGk=", "image/jpeg")).toEqual({ ok: false, error: "forbidden" });
  });

  it("server error → its error code, no partial fields", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ success: false, error: "truncated" }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await scanParcel("aGk=", "image/jpeg")).toEqual({ ok: false, error: "truncated" });
  });

  it("network throw (server not deployed yet) → unreachable signal", async () => {
    const f = vi.fn(async () => { throw new Error("boom"); });
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await scanParcel("aGk=", "image/jpeg");
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBe(true);
  });

  it("empty image → error, no request", async () => {
    const f = vi.fn(); globalThis.fetch = f as unknown as typeof fetch;
    expect((await scanParcel("", "image/jpeg")).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
