// Phase 5b — unit tests for the PURE read-data mappers (no Supabase / React).
import { describe, it, expect } from "vitest";
import {
  relativeTime,
  liveOrdersToRedesign,
  customerRowsToRedesign,
  accountUsersToRedesign,
  planDaysLeft,
  deriveSubBuckets,
  deriveUserBase,
  freeUsersSummary,
  auditActionColor,
  filterAuditLogs,
  type FreeUserRow,
} from "../useReadData";
import type { User } from "../../data";
import type { AccountAuditLog } from "../../../accountDb";
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

describe("deriveSubBuckets — parity with App.tsx Plan Monitoring (3346-3350)", () => {
  const u = (over: Partial<User>): User => ({ email: "x@x.com", note: "", role: "Seller", plan: "Pro", days: 30, accounts: "1", planStatus: "active", ...over });
  it("active = active status & days>0; excludes admins", () => {
    const users = [
      u({ email: "admin@x.com", role: "Admin", plan: "Master", days: 3000, planStatus: "active" }),
      u({ email: "a@x.com", planStatus: "active", days: 30 }),
      u({ email: "b@x.com", planStatus: "active", days: 0 }),   // lapsed → not active
    ];
    const { active } = deriveSubBuckets(users);
    expect(active.map((x) => x.email)).toEqual(["a@x.com"]);
  });
  it("expired = expired status OR days==0", () => {
    const users = [u({ email: "c@x.com", planStatus: "expired", days: 5 }), u({ email: "d@x.com", planStatus: "active", days: 0 }), u({ email: "e@x.com", planStatus: "active", days: 9 })];
    expect(deriveSubBuckets(users).expired.map((x) => x.email).sort()).toEqual(["c@x.com", "d@x.com"]);
  });
  it("expiring = paid, non-pending, (expired or days<=1), sorted asc (App.tsx expiringSoonSellers)", () => {
    const users = [
      u({ email: "p1@x.com", plan: "Pro", planStatus: "active", days: 1 }),    // ≤1 → in
      u({ email: "p0@x.com", plan: "Pro", planStatus: "active", days: 0 }),    // 0 → in
      u({ email: "q@x.com", plan: "Pro", planStatus: "active", days: 5 }),     // >1 → out
      u({ email: "exp@x.com", plan: "Basic", planStatus: "expired", days: 9 }),// expired → in
      u({ email: "f@x.com", plan: "Free", planStatus: "active", days: 1 }),    // free → out
      u({ email: "pend@x.com", plan: "Pro", planStatus: "pending", days: 0 }), // pending → out
    ];
    // sorted by days asc → p0(0), p1(1), exp(9)
    expect(deriveSubBuckets(users).expiring.map((x) => x.email)).toEqual(["p0@x.com", "p1@x.com", "exp@x.com"]);
  });
});

describe("deriveUserBase — tier headcount by PLAN (not status)", () => {
  const u = (over: Partial<User>): User => ({ email: "x@x.com", note: "", role: "Seller", plan: "Basic", days: 30, accounts: "1", planStatus: "active", ...over });
  // Mirrors the live DB: 17 basic, 5 pro, 1 master(=owner/admin), 2 free-active, 1 free-expired.
  const live: User[] = [
    ...Array.from({ length: 17 }, (_, i) => u({ email: `b${i}@x.com`, plan: "Basic", planStatus: "active", days: 30 })),
    ...Array.from({ length: 5 }, (_, i) => u({ email: `p${i}@x.com`, plan: "Pro", planStatus: "active", days: 30 })),
    u({ email: "owner@x.com", plan: "Master", role: "Admin", planStatus: "active", days: 3600 }),
    u({ email: "f1@x.com", plan: "Free", planStatus: "active", days: 0 }),   // free: expiry null → days 0
    u({ email: "f2@x.com", plan: "Free", planStatus: "active", days: 0 }),
    u({ email: "f3@x.com", plan: "Free", planStatus: "expired", days: 0 }),
  ];
  it("matches the real distribution: 23 paid / 3 free; free counted by plan, not status", () => {
    const b = deriveUserBase(live);
    expect(b).toMatchObject({ total: 26, admins: 1, basic: 17, pro: 5, master: 1, free: 3, trial: 0 });
    expect(b.paid).toBe(23);          // 17+5+1 incl. owner's Master
    expect(b.paidSellers).toBe(22);   // excludes the admin/owner
  });
  it("free-active users are NOT dropped into expired (counted as Free by plan)", () => {
    const b = deriveUserBase(live);
    expect(b.free).toBe(3); // 2 active + 1 expired free — all by plan==='Free'
  });
  it("paid status health is expiry-based over paid plans (active incl. owner's Master)", () => {
    const b = deriveUserBase(live);
    expect(b.paidActive).toBe(23);  // all paid currently active w/ days>0
    expect(b.paidExpired).toBe(0);
    expect(b.paidExpiring).toBe(0);
  });
  it("counts trial separately when present", () => {
    expect(deriveUserBase([u({ plan: "Trial", planStatus: "active", days: 7 })]).trial).toBe(1);
  });
});

describe("freeUsersSummary — cap-progress aggregate from the RPC rows", () => {
  const f = (over: Partial<FreeUserRow>): FreeUserRow => ({ email: "f@x.com", store_name: "S", full_name: "F", count: 0, cap: 200, near_cap: false, capped: false, cycle_resets_in_days: 30, ...over });
  it("totals users, near-cap (not capped), capped, and summed orders", () => {
    const rows = [f({ count: 10 }), f({ count: 160, near_cap: true }), f({ count: 200, near_cap: true, capped: true })];
    expect(freeUsersSummary(rows)).toEqual({ total: 3, nearCap: 1, capped: 1, orders: 370, cap: 200 });
  });
  it("empty → zeros, default cap 200", () => {
    expect(freeUsersSummary([])).toEqual({ total: 0, nearCap: 0, capped: 0, orders: 0, cap: 200 });
  });
});

describe("auditActionColor — parity with App.tsx:3595 badge color", () => {
  it("red for delete/reject, green for approve/created, purple otherwise", () => {
    expect(auditActionColor("deleted seller")).toBe("danger");
    expect(auditActionColor("rejected signup")).toBe("danger");
    expect(auditActionColor("approved plan")).toBe("ok");
    expect(auditActionColor("created account")).toBe("ok");
    expect(auditActionColor("made admin")).toBe("accent");
    expect(auditActionColor("changed plan")).toBe("accent");
    expect(auditActionColor("set password")).toBe("accent");
  });
});

describe("filterAuditLogs — parity with App.tsx:3341-3343", () => {
  const log = (over: Partial<AccountAuditLog>): AccountAuditLog => ({ id: "1", actorEmail: "admin@x.com", action: "changed plan", targetEmail: "seller@x.com", details: "→ pro", timestamp: "2026-06-26T05:30:00.000Z", ...over });
  const logs = [log({ id: "1", action: "made admin", targetEmail: "a@x.com" }), log({ id: "2", action: "deleted seller", targetEmail: "b@x.com", details: "removed" })];
  it("matches across action / target / details / actor; empty query returns all", () => {
    expect(filterAuditLogs(logs, "")).toHaveLength(2);
    expect(filterAuditLogs(logs, "made").map((l) => l.id)).toEqual(["1"]);      // action "made admin"
    expect(filterAuditLogs(logs, "b@x.com").map((l) => l.id)).toEqual(["2"]);   // target
    expect(filterAuditLogs(logs, "removed").map((l) => l.id)).toEqual(["2"]);   // details
    expect(filterAuditLogs(logs, "zzz")).toHaveLength(0);
  });
});
