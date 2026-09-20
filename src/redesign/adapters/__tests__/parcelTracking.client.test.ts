// Pickup Status (Part 5) — pure client helpers. Behavioral (not structural):
// gating matrix, chaseable derivation, returning-soon derivation, days-to-deadline,
// urgency, chase-target routing, and the status grouping/sort. The load() path is a
// thin own-scoped SELECT (parcelScan pattern) — not exercised here.
import { describe, it, expect } from "vitest";
import {
  parcelTrackingVisible, PARCEL_TRACKING_EMAILS,
  isChaseable, isReturningSoon, daysUntilDate, isUrgent, chaseTarget, chaseCopyValue, groupParcels,
  rowToTracking, type ParcelTrackingRow,
} from "../parcelTracking";

const TODAY = "2026-09-18";

function row(p: Partial<ParcelTrackingRow>): ParcelTrackingRow {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    trackingNo: p.trackingNo ?? "F1234567890",
    cmOrderNo: p.cmOrderNo ?? null,
    buyerUsername: p.buyerUsername ?? null,
    recipientName: p.recipientName ?? null,
    storeId: p.storeId ?? null,
    recStore: p.recStore ?? null,
    status: p.status ?? "created",
    statusMessage: p.statusMessage ?? null,
    pickupDeadline: p.pickupDeadline ?? null,
    arrivedAt: p.arrivedAt ?? null,
    shipType: p.shipType ?? "C2C",
    specialType: p.specialType ?? null,
    terminal: p.terminal ?? false,
  };
}

describe("parcelTrackingVisible — Phase 1 admin + googletest allowlist", () => {
  it("admin role → visible regardless of email", () => {
    expect(parcelTrackingVisible({ role: "admin", email: "someone@else.com" })).toBe(true);
  });
  it("googletest email → visible even as seller", () => {
    expect(parcelTrackingVisible({ role: "seller", email: "googletest@gmail.com" })).toBe(true);
  });
  it("email match is case/space-insensitive", () => {
    expect(parcelTrackingVisible({ role: "seller", email: "  GoogleTest@Gmail.com " })).toBe(true);
  });
  it("any other seller → hidden", () => {
    expect(parcelTrackingVisible({ role: "seller", email: "real@seller.com" })).toBe(false);
  });
  it("null / missing → hidden", () => {
    expect(parcelTrackingVisible(null)).toBe(false);
    expect(parcelTrackingVisible({})).toBe(false);
  });
  it("the allowlist is exactly the one test account (guards accidental widening)", () => {
    expect(PARCEL_TRACKING_EMAILS).toEqual(["googletest@gmail.com"]);
  });
});

describe("isChaseable — C2C store pickup, no special flow (mirrors server)", () => {
  it("C2C + no special → chaseable", () => {
    expect(isChaseable("C2C", null)).toBe(true);
    expect(isChaseable(" c2c ", "")).toBe(true);
  });
  it("C2C + a special flow → NOT chaseable (home delivery / return)", () => {
    expect(isChaseable("C2C", "4.店到宅服務單")).toBe(false);
    expect(isChaseable("C2C", "0.退貨便服務單")).toBe(false);
  });
  it("non-C2C ship types → NOT chaseable", () => {
    expect(isChaseable("B2C", null)).toBe(false);
    expect(isChaseable("C2B", "")).toBe(false);
    expect(isChaseable(null, null)).toBe(false);
  });
});

describe("isReturningSoon — derived from raw statusMessage (no stored column)", () => {
  it("將退回物流 warning → true", () => {
    expect(isReturningSoon("將退回物流中心")).toBe(true);
  });
  it("normal at-store / null → false", () => {
    expect(isReturningSoon("配達門市")).toBe(false);
    expect(isReturningSoon(null)).toBe(false);
  });
});

describe("daysUntilDate — Taipei-day whole-day diff", () => {
  it("future / today / past", () => {
    expect(daysUntilDate("2026-09-20", TODAY)).toBe(2);
    expect(daysUntilDate("2026-09-18", TODAY)).toBe(0);
    expect(daysUntilDate("2026-09-16", TODAY)).toBe(-2);
  });
  it("null / unparseable → null (never NaN)", () => {
    expect(daysUntilDate(null, TODAY)).toBeNull();
    expect(daysUntilDate("not-a-date", TODAY)).toBeNull();
  });
});

describe("isUrgent — returning-soon OR deadline ≤2 days", () => {
  it("returning-soon → urgent even with no deadline", () => {
    expect(isUrgent(row({ statusMessage: "將退回物流中心" }), TODAY)).toBe(true);
  });
  it("deadline ≤2 days (incl overdue) → urgent", () => {
    expect(isUrgent(row({ pickupDeadline: "2026-09-20" }), TODAY)).toBe(true); // 2 days
    expect(isUrgent(row({ pickupDeadline: "2026-09-15" }), TODAY)).toBe(true); // overdue
  });
  it("deadline 3+ days out, not returning → not urgent", () => {
    expect(isUrgent(row({ pickupDeadline: "2026-09-21" }), TODAY)).toBe(false);
  });
  it("no deadline, not returning → not urgent", () => {
    expect(isUrgent(row({}), TODAY)).toBe(false);
  });
});

describe("chaseTarget — Open profile vs Copy vs none", () => {
  it("handle-shaped → open the TikTok PROFILE (not a DM), @ stripped", () => {
    expect(chaseTarget("@maria_shop")).toEqual({ kind: "open", handle: "maria_shop", url: "https://www.tiktok.com/@maria_shop" });
    expect(chaseTarget("buyer.99")).toEqual({ kind: "open", handle: "buyer.99", url: "https://www.tiktok.com/@buyer.99" });
  });
  it("a real name (spaces / CJK) → copy, not a bad URL", () => {
    expect(chaseTarget("Maria Santos").kind).toBe("copy");
    expect(chaseTarget("陳小美").kind).toBe("copy");
  });
  it("null / empty → none", () => {
    expect(chaseTarget(null)).toEqual({ kind: "none" });
    expect(chaseTarget("   ")).toEqual({ kind: "none" });
  });
  it("real imported handles → open the correct profile URL", () => {
    expect(chaseTarget("Bless_love45")).toEqual({ kind: "open", handle: "Bless_love45", url: "https://www.tiktok.com/@Bless_love45" });
    expect(chaseTarget("Zona.nyaman1933")).toEqual({ kind: "open", handle: "Zona.nyaman1933", url: "https://www.tiktok.com/@Zona.nyaman1933" });
  });
  it("sanitizes FOR THE URL ONLY — leading @, full-width / NBSP / zero-width, trailing (IG) tag", () => {
    // leading @ + surrounding ASCII space
    expect(chaseTarget("  @Ashley102031 ")).toEqual({ kind: "open", handle: "Ashley102031", url: "https://www.tiktok.com/@Ashley102031" });
    // full-width space (U+3000) + NBSP (U+00A0) are trimmed
    expect(chaseTarget("　Ryry7067 ")).toEqual({ kind: "open", handle: "Ryry7067", url: "https://www.tiktok.com/@Ryry7067" });
    // zero-width chars (U+200B) that trim() does NOT remove
    expect(chaseTarget("Ryry7067​")).toEqual({ kind: "open", handle: "Ryry7067", url: "https://www.tiktok.com/@Ryry7067" });
    // trailing platform tag, half- and full-width parens
    expect(chaseTarget("Ashley102031(IG)")).toEqual({ kind: "open", handle: "Ashley102031", url: "https://www.tiktok.com/@Ashley102031" });
    expect(chaseTarget("Bless_love45（LINE）")).toEqual({ kind: "open", handle: "Bless_love45", url: "https://www.tiktok.com/@Bless_love45" });
    expect(chaseTarget("buyer.99 fb")).toEqual({ kind: "open", handle: "buyer.99", url: "https://www.tiktok.com/@buyer.99" });
  });
  it("does NOT mutate / rewrite the stored value — sanitization is local to the returned URL", () => {
    const stored = "  @Ashley102031（IG）​";
    const before = stored;
    chaseTarget(stored);
    expect(stored).toBe(before);                       // input string is never changed
    // a genuine multi-word name is still Copy (not force-opened on a partial token)
    expect(chaseTarget("Juan Dela Cruz").kind).toBe("copy");
  });
});

describe("chaseCopyValue — iOS copies @handle on the open-profile tap; desktop copies nothing", () => {
  it("iOS (ios=true) → the @handle string to paste into TikTok search", () => {
    expect(chaseCopyValue("Bless_love45", true)).toBe("@Bless_love45");
    expect(chaseCopyValue("Zona.nyaman1933", true)).toBe("@Zona.nyaman1933");
  });
  it("desktop (ios=false) → null (straight to the web profile, no copy)", () => {
    expect(chaseCopyValue("Bless_love45", false)).toBeNull();
  });
});

describe("groupParcels — status buckets, chaseable-gated, deadline-sorted", () => {
  const rows: ParcelTrackingRow[] = [
    row({ id: "atA", status: "at_store", pickupDeadline: "2026-09-25" }),         // not urgent
    row({ id: "atUrgent", status: "at_store", pickupDeadline: "2026-09-19" }),    // 1 day → urgent
    row({ id: "transit", status: "in_transit" }),
    row({ id: "picked", status: "picked_up", terminal: true }),
    row({ id: "returned", status: "returned", terminal: true }),
    row({ id: "home", status: "at_store", shipType: "C2C", specialType: "4.店到宅服務單" }), // non-chaseable
    row({ id: "created", status: "created" }),        // transient
    row({ id: "notfound", status: "not_found" }),     // transient
  ];
  const g = groupParcels(rows, TODAY);

  it("routes each status to its bucket; chaseable only in the 4 actionable groups", () => {
    expect(g.waitingPickup.map((r) => r.id)).toEqual(["atUrgent", "atA"]); // urgent first
    expect(g.inTransit.map((r) => r.id)).toEqual(["transit"]);
    expect(g.pickedUp.map((r) => r.id)).toEqual(["picked"]);
    expect(g.returned.map((r) => r.id)).toEqual(["returned"]);
  });
  it("non-chaseable + transient statuses fall to 'other'", () => {
    expect(g.other.map((r) => r.id).sort()).toEqual(["created", "home", "notfound"]);
  });
  it("does not mutate the input array", () => {
    expect(rows[0].id).toBe("atA"); // original order untouched
  });
  it("waitingPickup with equal urgency sorts by soonest deadline", () => {
    const two = groupParcels([
      row({ id: "later", status: "at_store", pickupDeadline: "2026-09-30" }),
      row({ id: "sooner", status: "at_store", pickupDeadline: "2026-09-28" }),
    ], TODAY);
    expect(two.waitingPickup.map((r) => r.id)).toEqual(["sooner", "later"]);
  });
});

describe("rowToTracking — snake→camel + null coalescing", () => {
  it("maps DB columns and coalesces empty strings to null", () => {
    const r = rowToTracking({ id: "x", tracking_no: "E79829464311", buyer_username: "", store_id: "台北門市", status: "at_store", terminal: true });
    expect(r.trackingNo).toBe("E79829464311");
    expect(r.buyerUsername).toBeNull();
    expect(r.storeId).toBe("台北門市");
    expect(r.terminal).toBe(true);
    expect(r.status).toBe("at_store");
  });
});
