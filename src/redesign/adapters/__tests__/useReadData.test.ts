// Phase 5b — unit tests for the PURE read-data mappers (no Supabase / React).
import { describe, it, expect } from "vitest";
import {
  relativeTime,
  liveOrdersToRedesign,
  customerRowsToRedesign,
  minersRpcToStats,
  ZERO_MINERS_STATS,
  accountUsersToRedesign,
  planDaysLeft,
  deriveSubBuckets,
  deriveUserBase,
  deriveMrr,
  freeUsersSummary,
  signupTime,
  signupCompare,
  sortUsersBySignup,
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

// miners_stats RPC jsonb → screen shapes. Must mirror the OLD client-side
// derivation exactly (pct rounded off buyers; avg = spent/orders rounded).
describe("minersRpcToStats", () => {
  it("maps totals + pct + avg + top buyers (with @handle)", () => {
    const { stats, top } = minersRpcToStats({
      buyers: 3, orders: 10, spent: "500", tiktok: 2,
      top: [
        { name: "Ann", handle: "ann", platform: "TikTok", orders: "6", spent: "300" },
        { name: "", handle: "@bob", platform: "Facebook", orders: 4, spent: 200 },
      ],
    });
    expect(stats).toEqual({ buyers: 3, orders: 10, spent: 500, avg: 50, tiktokPct: 67, fbPct: 33 });
    expect(top).toEqual([
      { name: "Ann", handle: "@ann", orders: 6, spent: 300, platform: "TikTok" },
      { name: "@bob", handle: "@bob", orders: 4, spent: 200, platform: "Facebook" }, // name falls back to handle
    ]);
  });
  it("zero rows → clean zeros (no NaN/divide-by-zero)", () => {
    const { stats, top } = minersRpcToStats({ buyers: 0, orders: 0, spent: 0, tiktok: 0, top: [] });
    expect(stats).toEqual(ZERO_MINERS_STATS);
    expect(top).toEqual([]);
  });
  it("garbage/missing payload → zeros, never throws", () => {
    expect(minersRpcToStats(null).stats).toEqual(ZERO_MINERS_STATS);
    expect(minersRpcToStats("nope").stats).toEqual(ZERO_MINERS_STATS);
    expect(minersRpcToStats({ top: "not-an-array" }).top).toEqual([]);
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

describe("planDaysLeft (shared lib/planWindow)", () => {
  const now = Date.parse("2026-06-26T00:00:00.000Z");
  it("ceils partial days; floors at 0; missing/invalid = NO expiry (Infinity)", () => {
    expect(planDaysLeft("2026-07-06T00:00:00.000Z", now)).toBe(10);
    expect(planDaysLeft("2026-06-26T06:00:00.000Z", now)).toBe(1); // partial day → ceil
    expect(planDaysLeft("2026-06-01T00:00:00.000Z", now)).toBe(0); // past → 0
    expect(planDaysLeft("", now)).toBe(Infinity);        // NULL expiry ≠ expired today
    expect(planDaysLeft(undefined, now)).toBe(Infinity);
  });
});

describe("deriveSubBuckets — shared lib/planWindow buckets (paid-only, 7d window)", () => {
  const u = (over: Partial<User>): User => ({ email: "x@x.com", note: "", role: "Seller", plan: "Pro", days: 30, accounts: "1", planStatus: "active", ...over });
  it("active = paid, active status & days>0; excludes admins and free", () => {
    const users = [
      u({ email: "admin@x.com", role: "Admin", plan: "Master", days: 3000, planStatus: "active" }),
      u({ email: "a@x.com", planStatus: "active", days: 30 }),
      u({ email: "b@x.com", planStatus: "active", days: 0 }),   // lapsed → not active
      u({ email: "free@x.com", plan: "Free", planStatus: "active", days: Infinity }), // cap-limited → out
    ];
    const { active } = deriveSubBuckets(users);
    expect(active.map((x) => x.email)).toEqual(["a@x.com"]);
  });
  it("active sorts days-left ASC (soonest expiry first), ties alphabetical, no-expiry last", () => {
    const users = [
      u({ email: "far@x.com", planStatus: "active", days: 90 }),
      u({ email: "soon@x.com", planStatus: "active", days: 3 }),
      u({ email: "mid-b@x.com", planStatus: "active", days: 30 }),
      u({ email: "mid-a@x.com", planStatus: "active", days: 30 }),           // tie w/ mid-b → alphabetical
      u({ email: "noexp@x.com", planStatus: "active", days: Infinity }),     // no expiry → bottom
    ];
    expect(deriveSubBuckets(users).active.map((x) => x.email))
      .toEqual(["soon@x.com", "mid-a@x.com", "mid-b@x.com", "far@x.com", "noexp@x.com"]);
  });
  it("expired = paid, non-pending, (expired status OR days==0); free/no-expiry/pending out", () => {
    const users = [
      u({ email: "c@x.com", planStatus: "expired", days: 5 }),
      u({ email: "d@x.com", planStatus: "active", days: 0 }),
      u({ email: "e@x.com", planStatus: "active", days: 9 }),
      u({ email: "free@x.com", plan: "Free", planStatus: "expired", days: 0 }),  // cap-limited → out
      u({ email: "noexp@x.com", planStatus: "active", days: Infinity }),          // no expiry → out
      u({ email: "pend@x.com", planStatus: "pending", days: 0 }),                 // pending flow sets expiry=now → out
    ];
    expect(deriveSubBuckets(users).expired.map((x) => x.email).sort()).toEqual(["c@x.com", "d@x.com"]);
  });
  it("expiring = paid, non-pending, still-alive days 1..7 — DISJOINT from expired (days==0 / expired status excluded)", () => {
    const users = [
      u({ email: "p1@x.com", plan: "Pro", planStatus: "active", days: 1 }),    // 1..7 alive → in
      u({ email: "p0@x.com", plan: "Pro", planStatus: "active", days: 0 }),    // days==0 → EXPIRED, NOT expiring
      u({ email: "q@x.com", plan: "Pro", planStatus: "active", days: 5 }),     // 1..7 alive → in
      u({ email: "r@x.com", plan: "Pro", planStatus: "active", days: 8 }),     // >7 → out
      u({ email: "exp@x.com", plan: "Basic", planStatus: "expired", days: 9 }),// status expired → EXPIRED, NOT expiring
      u({ email: "f@x.com", plan: "Free", planStatus: "active", days: 1 }),    // free → out
      u({ email: "pend@x.com", plan: "Pro", planStatus: "pending", days: 0 }), // pending → out
    ];
    const { expiring, expired } = deriveSubBuckets(users);
    // expiring = still-alive only, sorted by days asc → p1(1), q(5). p0/exp moved to Expired.
    expect(expiring.map((x) => x.email)).toEqual(["p1@x.com", "q@x.com"]);
    // the two once-overlapping rows now live in Expired only
    expect(expired.map((x) => x.email).sort()).toEqual(["exp@x.com", "p0@x.com"]);
    // disjointness: no seller is in both admin lists at once (the bug this fixes)
    const inExpiring = new Set(expiring.map((x) => x.email));
    expect(expired.some((x) => inExpiring.has(x.email))).toBe(false);
  });
});

describe("deriveUserBase — tier headcount by PLAN (not status)", () => {
  const u = (over: Partial<User>): User => ({ email: "x@x.com", note: "", role: "Seller", plan: "Basic", days: 30, accounts: "1", planStatus: "active", ...over });
  // Mirrors the live DB: 17 basic, 5 pro, 1 master(=owner/admin), 2 free-active, 1 free-expired.
  const live: User[] = [
    ...Array.from({ length: 17 }, (_, i) => u({ email: `b${i}@x.com`, plan: "Basic", planStatus: "active", days: 30 })),
    ...Array.from({ length: 5 }, (_, i) => u({ email: `p${i}@x.com`, plan: "Pro", planStatus: "active", days: 30 })),
    u({ email: "owner@x.com", plan: "Master", role: "Admin", planStatus: "active", days: 3600 }),
    u({ email: "f1@x.com", plan: "Free", planStatus: "active", days: Infinity }),   // free: expiry null → no expiry
    u({ email: "f2@x.com", plan: "Free", planStatus: "active", days: Infinity }),
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
  it("paid status health EXCLUDES the admin/owner (shared deriveSubBuckets source)", () => {
    const b = deriveUserBase(live);
    // 22 non-admin paid sellers active; the owner's active Master is NOT counted.
    // (Was 23 — the old paidActive filtered paidUsers directly and left the admin in,
    // which is exactly the panel drift the headline 38 vs tile 39 exposed.)
    expect(b.paidActive).toBe(22);
    expect(b.paidExpired).toBe(0);
    expect(b.paidExpiring).toBe(0); // all at 30d — outside the 7d window
    expect(b.paidActive).toBe(deriveSubBuckets(live).active.length); // tile == Active-paid card
  });
  it("paidExpiring uses the shared 7-day window", () => {
    const b = deriveUserBase([...live, u({ email: "soon@x.com", plan: "Basic", planStatus: "active", days: 4 })]);
    expect(b.paidExpiring).toBe(1);
    expect(b.paidActive).toBe(23); // 22 sellers + soon@ (owner still excluded; was 24 when the admin was wrongly counted)
  });
  it("counts trial separately when present", () => {
    expect(deriveUserBase([u({ plan: "Trial", planStatus: "active", days: 7 })]).trial).toBe(1);
  });
});

// ── The "paying" headline UNIFICATION (2026-07-24 bug: User-base card read 41,
// counting expired plans AND the owner's own admin account, contradicting the
// Active-paid card + Monthly revenue which read 38). Fix: userBase.paying is the
// SAME source the Active-paid card + deriveMrr use — deriveSubBuckets(...).active
// (isActivePaid → excludes expired; non-admin filter → excludes the owner).
describe("deriveUserBase.paying — unified paying-customer count (excludes expired + admin)", () => {
  const u = (over: Partial<User>): User => ({ email: "x@x.com", note: "", role: "Seller", plan: "Basic", days: 30, accounts: "1", planStatus: "active", ...over });
  // Mirrors the live DB exactly: 26 basic active + 1 basic expired; 10 pro active +
  // 1 pro expiring (days 3, still active) + 1 pro status='active' but expiry PAST
  // (days 0 → counts as expired); 1 master seller; 1 master ADMIN (owner, active);
  // 13 free active + 3 free expired.
  const live: User[] = [
    ...Array.from({ length: 26 }, (_, i) => u({ email: `b${i}@x.com`, plan: "Basic", planStatus: "active", days: 30 })),
    u({ email: "bexp@x.com", plan: "Basic", planStatus: "expired", days: 0 }),                 // expired basic
    ...Array.from({ length: 10 }, (_, i) => u({ email: `p${i}@x.com`, plan: "Pro", planStatus: "active", days: 30 })),
    u({ email: "psoon@x.com", plan: "Pro", planStatus: "active", days: 3 }),                    // expiring (still active)
    u({ email: "plapsed@x.com", plan: "Pro", planStatus: "active", days: 0 }),                  // status active but expiry PAST → expired
    u({ email: "mseller@x.com", plan: "Master", planStatus: "active", days: 100 }),             // paying master seller
    u({ email: "owner@x.com", plan: "Master", role: "Admin", planStatus: "active", days: 3600 }), // the admin/owner — must NOT count
    ...Array.from({ length: 13 }, (_, i) => u({ email: `f${i}@x.com`, plan: "Free", planStatus: "active", days: Infinity })),
    ...Array.from({ length: 3 }, (_, i) => u({ email: `fe${i}@x.com`, plan: "Free", planStatus: "expired", days: 0 })),
  ];

  it("paying reads 38 — excludes the 2 expired paid AND the admin owner", () => {
    expect(deriveUserBase(live).paying).toBe(38); // 26 basic + (10+1) pro + 1 master seller
  });

  it("paying EQUALS the Active-paid card count (same deriveSubBuckets source)", () => {
    expect(deriveUserBase(live).paying).toBe(deriveSubBuckets(live).active.length);
  });

  it("excludes the admin owner even though their Master plan is active", () => {
    const b = deriveUserBase(live);
    // Addendum: paidActive now ALSO excludes the owner (was 39) — it reads from the
    // same deriveSubBuckets source as paying, so both are 38 and the panel no longer
    // shows two numbers for the same thing.
    expect(b.paidActive).toBe(38);
    expect(b.paying).toBe(38);
    // and no admin-role user is in the paying (active) set
    expect(deriveSubBuckets(live).active.some((x) => x.role === "Admin")).toBe(false);
  });

  it("EVERY paying-family panel number equals the Active-paid / Subscriptions counts", () => {
    const b = deriveUserBase(live);
    const { active, expiring, expired } = deriveSubBuckets(live);
    // headline + status-health "Active" tile == Active-paid card (all 38, one source)
    expect(b.paying).toBe(active.length);
    expect(b.paidActive).toBe(active.length);
    expect(b.paying).toBe(b.paidActive);
    // and the other two tiles match the Subscriptions Expiring / Expired cards
    expect(b.paidExpiring).toBe(expiring.length);
    expect(b.paidExpired).toBe(expired.length);
    // concrete: 38 / 1 / 2
    expect([b.paidActive, b.paidExpiring, b.paidExpired]).toEqual([38, 1, 2]);
  });

  it("excludes expired plans — the status='expired' basic AND the expiry-past pro", () => {
    const b = deriveUserBase(live);
    // plan-label tally (41) counts both expired; paying (38) drops them.
    expect(b.paid).toBe(41);
    expect(b.paying).toBe(38);
    const activeEmails = deriveSubBuckets(live).active.map((x) => x.email);
    expect(activeEmails).not.toContain("bexp@x.com");    // status expired
    expect(activeEmails).not.toContain("plapsed@x.com"); // status active but expiry past (days 0)
  });

  it("Monthly revenue agrees with paying on the SAME seller set (NT$27,900)", () => {
    expect(deriveMrr(live)).toBe(27900); // 26×500 + 11×1200 + 1×1700
    // deriveMrr sums over deriveSubBuckets(...).active — the exact set paying counts.
    expect(deriveSubBuckets(live).active.length).toBe(deriveUserBase(live).paying);
  });

  it("Subscriptions cards are UNCHANGED — still 38 active / 1 expiring / 2 expired", () => {
    const { active, expiring, expired } = deriveSubBuckets(live);
    expect(active.length).toBe(38);
    expect(expiring.length).toBe(1);  // the days-3 pro
    expect(expired.length).toBe(2);   // expired basic + expiry-past pro
  });
});

describe("freeUsersSummary — cap-progress aggregate from the RPC rows", () => {
  const f = (over: Partial<FreeUserRow>): FreeUserRow => ({ email: "f@x.com", store_name: "S", full_name: "F", count: 0, cap: 100, near_cap: false, capped: false, cycle_resets_in_days: 30, ...over });
  it("totals users, near-cap (not capped), capped, and summed orders", () => {
    const rows = [f({ count: 10 }), f({ count: 80, near_cap: true }), f({ count: 100, near_cap: true, capped: true })];
    expect(freeUsersSummary(rows)).toEqual({ total: 3, nearCap: 1, capped: 1, orders: 190, cap: 100 });
  });
  it("empty → zeros, default cap 100", () => {
    expect(freeUsersSummary([])).toEqual({ total: 0, nearCap: 0, capped: 0, orders: 0, cap: 100 });
  });
});

describe("free-tier signup sort — extracted from Admin.tsx FreeUserList (regression guard)", () => {
  const row = (email: string): FreeUserRow => ({ email, store_name: "S", full_name: "F", count: 0, cap: 100, near_cap: false, capped: false, cycle_resets_in_days: 30 });
  const raw = (createdAt?: string | null): AccountUser => ({ email: "x", profile: { fullName: "", storeName: "", phone: "", tiktok: "", facebook: "", adminContactNote: "" }, plan: "free", planStatus: "active", planExpiry: "", connectedAccounts: [], createdAt: createdAt ?? undefined });

  describe("signupTime", () => {
    it("parses a valid ISO string to its epoch ms", () => {
      expect(signupTime("2026-07-18T00:00:00Z")).toBe(Date.parse("2026-07-18T00:00:00Z"));
    });
    it("missing / not-loaded / invalid → -Infinity (so those rows sink)", () => {
      expect(signupTime(null)).toBe(-Infinity);
      expect(signupTime(undefined)).toBe(-Infinity);
      expect(signupTime("")).toBe(-Infinity);
      expect(signupTime("garbage")).toBe(-Infinity);
    });
  });

  describe("signupCompare — MUST stay subtraction-free (the -Infinity − -Infinity = NaN guard)", () => {
    it("descending: newer (larger ms) sorts first", () => {
      expect(signupCompare(200, 100)).toBe(-1); // a newer → a first
      expect(signupCompare(100, 200)).toBe(1);  // a older → a after
    });
    it("valid always beats missing", () => {
      expect(signupCompare(100, -Infinity)).toBe(-1);
      expect(signupCompare(-Infinity, 100)).toBe(1);
    });
    it("equal keys (incl. both-missing) → exactly 0 and NEVER NaN — a `bm - am` rewrite would fail here", () => {
      expect(signupCompare(100, 100)).toBe(0);
      expect(signupCompare(-Infinity, -Infinity)).toBe(0);
      expect(Number.isNaN(signupCompare(-Infinity, -Infinity))).toBe(false);
    });
  });

  describe("sortUsersBySignup — the exact production sort path", () => {
    it("sorts newest-first (newest at index 0, oldest last)", () => {
      const list = [row("old@x"), row("new@x"), row("mid@x")];
      const rawBy = { "old@x": raw("2026-07-10T00:00:00Z"), "new@x": raw("2026-07-18T00:00:00Z"), "mid@x": raw("2026-07-14T00:00:00Z") };
      expect(sortUsersBySignup(list, rawBy).map((u) => u.email)).toEqual(["new@x", "mid@x", "old@x"]);
    });
    it("pushes all missing-date variants (null / not-loaded / invalid) below every valid date", () => {
      const list = [row("nullc@x"), row("valid@x"), row("notloaded@x"), row("bad@x")];
      const rawBy: Record<string, AccountUser | undefined> = {
        "nullc@x": raw(null), "valid@x": raw("2026-07-15T00:00:00Z"), "bad@x": raw("garbage"),
        // "notloaded@x" intentionally absent → rawBy[email] === undefined
      };
      const order = sortUsersBySignup(list, rawBy).map((u) => u.email);
      expect(order[0]).toBe("valid@x");                    // the only valid date is on top
      expect(order.slice(1).sort()).toEqual(["bad@x", "notloaded@x", "nullc@x"]); // the other three sank
    });
    it("is STABLE: equal timestamps keep original relative order", () => {
      const list = [row("tieA@x"), row("tieB@x")];
      const rawBy = { "tieA@x": raw("2026-07-15T00:00:00Z"), "tieB@x": raw("2026-07-15T00:00:00Z") };
      expect(sortUsersBySignup(list, rawBy).map((u) => u.email)).toEqual(["tieA@x", "tieB@x"]);
    });
    it("is STABLE for two missing rows too (both -Infinity keep original order, no scramble)", () => {
      const list = [row("m1@x"), row("m2@x")];
      expect(sortUsersBySignup(list, {}).map((u) => u.email)).toEqual(["m1@x", "m2@x"]);
    });
    it("does NOT mutate the source list (sorts a copy)", () => {
      const list = [row("a@x"), row("b@x"), row("c@x")];
      const before = list.map((u) => u.email);
      const rawBy = { "a@x": raw("2026-07-01T00:00:00Z"), "b@x": raw("2026-07-20T00:00:00Z"), "c@x": raw("2026-07-10T00:00:00Z") };
      const out = sortUsersBySignup(list, rawBy);
      expect(list.map((u) => u.email)).toEqual(before);  // original order intact
      expect(out).not.toBe(list);                        // returned a new array
    });
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
