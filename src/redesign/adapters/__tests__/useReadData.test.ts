// Phase 5b — unit tests for the PURE read-data mappers (no Supabase / React).
import { describe, it, expect } from "vitest";
import {
  relativeTime,
  liveOrdersToRedesign,
  customerRowsToRedesign,
  accountUsersToRedesign,
  planDaysLeft,
} from "../useReadData";
import type { RebuiltSession } from "../../../lib/orderLogic";
import type { AccountUser } from "../../../accountDb";

describe("relativeTime", () => {
  const now = Date.parse("2026-06-25T12:00:00.000Z");
  it("formats minutes/hours/days", () => {
    expect(relativeTime("2026-06-25T11:58:30.000Z", now)).toBe("1m");
    expect(relativeTime("2026-06-25T10:00:00.000Z", now)).toBe("2h");
    expect(relativeTime("2026-06-22T12:00:00.000Z", now)).toBe("3d");
  });
  it("returns 'now' for <1m and '' for missing/invalid", () => {
    expect(relativeTime("2026-06-25T11:59:40.000Z", now)).toBe("now");
    expect(relativeTime("", now)).toBe("");
    expect(relativeTime(null, now)).toBe("");
    expect(relativeTime("nope", now)).toBe("");
  });
});

describe("liveOrdersToRedesign", () => {
  const rebuilt: RebuiltSession = {
    buyers: [],
    orders: [
      { orderNum: 1, item: "Lipstick", qty: 1, price: 150, total: 150, time: "9:40 PM", handle: "ann", name: "Ann", bNum: 1, platform: "TikTok", status: "New", date: "2026-06-25" },
      { orderNum: 2, item: "Tumbler", qty: 1, price: 200, total: 200, time: "9:42 PM", handle: "@bob", name: "Bob", bNum: 2, platform: "Facebook", status: "New", date: "2026-06-25" },
    ],
  };
  it("maps + reverses (newest first) + @-prefixes handles", () => {
    const out = liveOrdersToRedesign(rebuilt);
    expect(out).toHaveLength(2);
    expect(out[0].buyer).toBe("Bob");       // reversed
    expect(out[0].handle).toBe("@bob");     // already had @
    expect(out[1].handle).toBe("@ann");     // @ added
    expect(out[1].id).toBe("#1");
    expect(out[0].total).toBe(200);
    expect(out[0].status).toBe("New");
  });
  it("empty session → empty array", () => {
    expect(liveOrdersToRedesign({ buyers: [], orders: [] })).toEqual([]);
  });
});

describe("customerRowsToRedesign", () => {
  const now = Date.parse("2026-06-25T12:00:00.000Z");
  it("maps rows, coerces numbers, computes last-seen", () => {
    const out = customerRowsToRedesign([
      { name: "Ann Cruz", handle: "anncruz", platform: "TikTok", total_orders: "4", total_spent: "1200", updated_at: "2026-06-25T11:00:00.000Z" },
    ], now);
    expect(out[0]).toEqual({ name: "Ann Cruz", handle: "@anncruz", orders: 4, spent: 1200, last: "1h", platform: "TikTok" });
  });
  it("falls back name→handle and created_at when no updated_at", () => {
    const out = customerRowsToRedesign([
      { handle: "bob", platform: "Facebook", total_orders: 0, total_spent: 0, created_at: "2026-06-25T11:59:40.000Z" },
    ], now);
    expect(out[0].name).toBe("bob");
    expect(out[0].last).toBe("now");
  });
});

describe("accountUsersToRedesign", () => {
  const base: AccountUser = {
    authUserId: "a1", email: "seller@x.com",
    profile: { fullName: "Sel Ler", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    plan: "basic", planStatus: "active", planExpiry: "", connectedAccounts: ["tt1"], role: "seller",
  };
  it("maps role/plan/note/accounts", () => {
    const out = accountUsersToRedesign([base])[0];
    expect(out.email).toBe("seller@x.com");
    expect(out.role).toBe("Seller");
    expect(out.plan).toBe("Basic");
    expect(out.note).toBe("Sel Ler"); // falls back to fullName
    expect(out.accounts).toBe("1");
  });
  it("prefers adminContactNote and maps admin role", () => {
    const out = accountUsersToRedesign([{ ...base, role: "admin", plan: "master", profile: { ...base.profile, adminContactNote: "VIP note" } }])[0];
    expect(out.role).toBe("Admin");
    expect(out.plan).toBe("Master");
    expect(out.note).toBe("VIP note");
  });
  it("carries real days-left + planExpiry/planStatus (for admin Add days)", () => {
    const now = Date.parse("2026-06-26T00:00:00.000Z");
    const u: AccountUser = { ...base, planExpiry: "2026-07-06T00:00:00.000Z", planStatus: "active" }; // 10 days out
    const out = accountUsersToRedesign([u], now)[0];
    expect(out.days).toBe(10);
    expect(out.planExpiry).toBe("2026-07-06T00:00:00.000Z");
    expect(out.planStatus).toBe("active");
  });
});

describe("planDaysLeft", () => {
  const now = Date.parse("2026-06-26T00:00:00.000Z");
  it("ceils partial days; floors at 0; handles empty/invalid", () => {
    expect(planDaysLeft("2026-07-06T00:00:00.000Z", now)).toBe(10);
    expect(planDaysLeft("2026-06-26T06:00:00.000Z", now)).toBe(1); // partial day → ceil
    expect(planDaysLeft("2026-06-01T00:00:00.000Z", now)).toBe(0); // past → 0
    expect(planDaysLeft("", now)).toBe(0);
    expect(planDaysLeft(undefined, now)).toBe(0);
  });
});
