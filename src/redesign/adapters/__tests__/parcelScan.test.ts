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

import { canUseParcelScan, canUseParcelManual, PARCEL_MANUAL_TIERS, scaledDims, rowToScan, scanParcel, SCAN_MAX_EDGE, formErrors, amountWarns, validAmount, amountTooHigh, MIN_PARCEL_AMOUNT, MAX_PARCEL_TOTAL, checkEmapStore } from "../parcelScan";

beforeEach(() => vi.clearAllMocks());
afterEach(() => { (globalThis.fetch as unknown) = undefined; });

describe("canUseParcelScan (ADMIN ROLE ONLY — audit S2: no email allowlist)", () => {
  it("admin role → allowed (both db and display casing)", () => {
    expect(canUseParcelScan("admin")).toBe(true);
    expect(canUseParcelScan("Admin")).toBe(true);
  });
  it("googletest is NOT allowed — the server requires admin, so the test/Apple-demo account must never see a button that always 403s", () => {
    // Deliberate divergence from canUseClassicText: the role is the only gate.
    expect(canUseParcelScan("seller")).toBe(false);
  });
  it("everyone else → hidden", () => {
    expect(canUseParcelScan("seller")).toBe(false);
    expect(canUseParcelScan(undefined)).toBe(false);
    expect(canUseParcelScan(null)).toBe(false);
    expect(canUseParcelScan("")).toBe(false);
  });
});

describe("canUseParcelManual (PLUS/PRO/MASTER + ACTIVE — phased manual-encode gate)", () => {
  const future = "2027-01-01T00:00:00Z"; // well beyond now
  const past = "2020-01-01T00:00:00Z";
  it("allowed tiers (plus/pro/master) + active + not expired → allowed", () => {
    expect(canUseParcelManual("plus", "active", future)).toBe(true);
    expect(canUseParcelManual("pro", "active", future)).toBe(true);
    expect(canUseParcelManual("master", "active", future)).toBe(true);
    expect(canUseParcelManual("Plus", "active", future)).toBe(true);  // case-insensitive
    expect(canUseParcelManual(" MASTER ", "active", future)).toBe(true); // trimmed
  });
  it("BASIC → NOT allowed (phased rollout excludes basic for now), even active", () => {
    expect(canUseParcelManual("basic", "active", future)).toBe(false);
    expect(canUseParcelManual("Basic", "active", future)).toBe(false);
  });
  it("FREE → never allowed, regardless of status/expiry", () => {
    expect(canUseParcelManual("free", "active", future)).toBe(false);
    expect(canUseParcelManual("Free", "active", null)).toBe(false);
    expect(canUseParcelManual("free", "active", undefined)).toBe(false);
  });
  it("allowed tier but expired → not allowed", () => {
    expect(canUseParcelManual("plus", "expired", future)).toBe(false); // status expired
    expect(canUseParcelManual("pro", "expired", future)).toBe(false);
    expect(canUseParcelManual("pro", "active", past)).toBe(false);     // past expiry date
  });
  it("missing/blank plan → not allowed", () => {
    expect(canUseParcelManual(undefined, "active", future)).toBe(false);
    expect(canUseParcelManual(null, "active", future)).toBe(false);
    expect(canUseParcelManual("", "active", future)).toBe(false);
  });
  it("PARCEL_MANUAL_TIERS is the single allowlist and excludes basic/free", () => {
    expect([...PARCEL_MANUAL_TIERS].sort()).toEqual(["master", "plus", "pro"]);
    expect(PARCEL_MANUAL_TIERS).not.toContain("basic");
    expect(PARCEL_MANUAL_TIERS).not.toContain("free");
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
    const r = rowToScan({ id: "a", customer_name: "陳小美", phone: "0912345678", store_id: "123456", amount: "550", notes: null, status: "confirmed", store_check_status: "not_found", created_at: "2026-09-08T01:00:00Z" });
    expect(r).toEqual({ id: "a", customerName: "陳小美", phone: "0912345678", storeId: "123456", amount: 550, notes: "", status: "confirmed", storeCheckStatus: "not_found", createdAt: "2026-09-08T01:00:00Z" });
    expect(rowToScan({ id: "b", amount: null }).amount).toBe(null);
    expect(rowToScan({ id: "c" }).storeCheckStatus).toBe(null); // absent → null (older rows)
  });
});

describe("confirm-form validation (existing 賣貨便 validators; empty allowed)", () => {
  const base = { name: "", phone: "", store: "", amount: "", notes: "" };
  it("all-empty form → empty flag (nothing to save)", () => {
    expect(formErrors(base).empty).toBe(true);
  });
  it("valid filled form → no errors", () => {
    const e = formErrors({ name: "陳小美", phone: "0912345678", store: "123456", amount: "550", notes: "" });
    expect(e).toEqual({ name: false, phone: false, store: false, amount: false, empty: false });
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
  it("amount is REQUIRED with a MIN_PARCEL_AMOUNT floor — blank/0/below-min all flag (block Save)", () => {
    expect(MIN_PARCEL_AMOUNT).toBe(20); // the REAL 賣貨便 minimum product amount
    expect(formErrors({ ...base, name: "A", amount: "" }).amount).toBe(true);   // blank → block
    expect(formErrors({ ...base, name: "A", amount: "0" }).amount).toBe(true);  // zero → block
    expect(formErrors({ ...base, name: "A", amount: "19" }).amount).toBe(true); // below min → block
    expect(formErrors({ ...base, name: "A", amount: "abc" }).amount).toBe(true);// non-numeric → block
    expect(formErrors({ ...base, name: "A", amount: "20" }).amount).toBe(false);// exactly min → OK
    expect(formErrors({ ...base, name: "A", amount: "21" }).amount).toBe(false);// above min (was blocked at 22) → OK
    expect(formErrors({ ...base, name: "A", amount: "550" }).amount).toBe(false);// above min → OK
    // pure validAmount mirror
    expect(validAmount("20")).toBe(true);
    expect(validAmount("19.99")).toBe(false);
    expect(validAmount("")).toBe(false);
  });
  it("amount has a MAXIMUM = the 賠償上限 total ceiling minus fee (no export hole)", () => {
    expect(MAX_PARCEL_TOTAL).toBe(20000); // 賣貨便 compensation ceiling (aliases SHIP_MAX_TOTAL)
    const fee = 38; // the standard global fee
    const maxAmt = MAX_PARCEL_TOTAL - fee; // 19962 — the highest amount a seller can type
    // in range → passes
    expect(validAmount(String(maxAmt - 1), fee)).toBe(true);   // 19961 → OK
    expect(formErrors({ ...base, name: "A", amount: "550" }, fee).amount).toBe(false);
    // exactly at the ceiling → passes (amount + fee === 20000)
    expect(validAmount(String(maxAmt), fee)).toBe(true);       // 19962 + 38 = 20000 → OK
    expect(formErrors({ ...base, name: "A", amount: String(maxAmt) }, fee).amount).toBe(false);
    // over the ceiling → BLOCKED
    expect(validAmount(String(maxAmt + 1), fee)).toBe(false);  // 19963 + 38 = 20001 → block
    expect(formErrors({ ...base, name: "A", amount: String(maxAmt + 1) }, fee).amount).toBe(true);
    expect(formErrors({ ...base, name: "A", amount: "20000" }, fee).amount).toBe(true); // 20000 + 38 > ceiling → block
    // the min still works with the max in place
    expect(validAmount("20", fee)).toBe(true);
    expect(validAmount("19", fee)).toBe(false);
    // amountTooHigh flags ONLY the over-ceiling case (for the distinct message)
    expect(amountTooHigh(String(maxAmt), fee)).toBe(false);    // exactly at ceiling → not "too high"
    expect(amountTooHigh(String(maxAmt + 1), fee)).toBe(true); // over → too high
    expect(amountTooHigh("19", fee)).toBe(false);              // below min is NOT "too high"
    expect(amountTooHigh("", fee)).toBe(false);                // blank is NOT "too high"
    // a bigger fee lowers the max amount (ceiling is on the TOTAL)
    expect(validAmount("19970", 100)).toBe(false);             // 19970 + 100 = 20070 > 20000 → block
    expect(validAmount("19900", 100)).toBe(true);              // 19900 + 100 = 20000 → OK
    // default fee (SHIP_DEFAULT_FEE) when omitted — standalone callers still gate
    expect(validAmount("19970")).toBe(false);                  // 19970 + 38 = 20008 → block
    expect(validAmount("19962")).toBe(true);                   // 19962 + 38 = 20000 → OK
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

describe("checkEmapStore (client POST) — best-effort, never blocks", () => {
  it("valid store → verdict + name; sends Bearer + { storeId }", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, storeId: "982063", status: "valid", storeName: "德民門市" }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await checkEmapStore("982063");
    expect(r.status).toBe("valid");
    expect(r.storeName).toBe("德民門市");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://srv.test/admin/parcel-emap-check");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-abc");
    expect(JSON.parse(init.body as string)).toEqual({ storeId: "982063" });
  });

  it("not_found (wrong code) → not_found verdict", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, storeId: "930342", status: "not_found" }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await checkEmapStore("930342")).status).toBe("not_found");
  });

  it("an unexpected status string coerces to unknown (never a false verdict)", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, status: "no_service" }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await checkEmapStore("982063")).status).toBe("unknown");
  });

  it("403 / non-ok / network throw → unknown, never blocks", async () => {
    globalThis.fetch = (vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ success: false }) })) as unknown) as typeof fetch;
    expect((await checkEmapStore("982063")).status).toBe("unknown");
    globalThis.fetch = (vi.fn(async () => { throw new Error("boom"); }) as unknown) as typeof fetch;
    expect((await checkEmapStore("982063")).status).toBe("unknown");
  });

  it("malformed store id → unknown, no request", async () => {
    const f = vi.fn(); globalThis.fetch = f as unknown as typeof fetch;
    expect((await checkEmapStore("12ab")).status).toBe("unknown");
    expect(f).not.toHaveBeenCalled();
  });
});
