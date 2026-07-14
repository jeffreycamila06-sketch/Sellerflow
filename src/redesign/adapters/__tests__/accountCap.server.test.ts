// #6 SERVER-SIDE ACCOUNT-CAP (Option B — registered-account verification).
// server.js has no vitest harness; the pure core lives in server/accountCap.js.
// Pins: per-plan cap parity with the client; the requested account must be a
// REGISTERED account within the cap; FAIL-OPEN on unknown plan / admin / broken
// registered list (Addition 1); casing/@/whitespace normalization (Addition 2).
import { describe, it, expect } from "vitest";
import {
  maxAccountsForPlan, normalizeAccount, parseRegisteredList, accountCapVerdict,
} from "../../../../server/accountCap.js";

describe("maxAccountsForPlan — parity with client connect.ts maxAcc", () => {
  it("free/trial/basic=1, pro=3, master=5, unknown=1", () => {
    expect(maxAccountsForPlan("free")).toBe(1);
    expect(maxAccountsForPlan("trial")).toBe(1);
    expect(maxAccountsForPlan("basic")).toBe(1);
    expect(maxAccountsForPlan("pro")).toBe(3);
    expect(maxAccountsForPlan("master")).toBe(5);
    expect(maxAccountsForPlan("MASTER")).toBe(5); // case-insensitive
    expect(maxAccountsForPlan("weird")).toBe(1);
    expect(maxAccountsForPlan(null)).toBe(1);
  });
});

describe("normalizeAccount — cleanLiveAccount mirror (Addition 2)", () => {
  it("trims, strips leading @, lowercases", () => {
    expect(normalizeAccount("@JuanDelaCruz")).toBe("juandelacruz");
    expect(normalizeAccount("  Ann_Store  ")).toBe("ann_store");
    expect(normalizeAccount("@@double")).toBe("double");
    expect(normalizeAccount(null)).toBe("");
  });
});

describe("parseRegisteredList — comma/newline, normalized, deduped; malformed -> []", () => {
  it("parses + normalizes + dedups", () => {
    expect(parseRegisteredList("@A, b\nB , c")).toEqual(["a", "b", "c"]);
  });
  it("non-string / null -> [] (fail-open upstream — Addition 1)", () => {
    expect(parseRegisteredList(null)).toEqual([]);
    expect(parseRegisteredList(undefined)).toEqual([]);
    expect(parseRegisteredList(12345 as unknown as string)).toEqual([]);
    expect(parseRegisteredList({} as unknown as string)).toEqual([]);
    expect(parseRegisteredList("")).toEqual([]);
  });
});

describe("accountCapVerdict — registered-account verification", () => {
  const base = { plan: "basic", role: "seller", tiktok: "myshop", facebook: "", platform: "TikTok" as const };

  it("registered account within cap → allowed (case/@/space variance still matches — Addition 2)", () => {
    expect(accountCapVerdict({ ...base, username: "myshop" }).allowed).toBe(true);
    expect(accountCapVerdict({ ...base, username: "@MyShop" }).allowed).toBe(true);
    expect(accountCapVerdict({ ...base, username: "  MYSHOP " }).allowed).toBe(true);
  });

  it("UNregistered account on a capped plan → BLOCKED (the actual finding)", () => {
    const v = accountCapVerdict({ ...base, username: "someone_elses_account" });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe("account_limit");
    expect(v.max).toBe(1);
    expect(v.plan).toBe("basic");
  });

  it("basic (cap 1) with 3 registered → only the FIRST is connectable", () => {
    const b = { ...base, plan: "basic", tiktok: "a,b,c" };
    expect(accountCapVerdict({ ...b, username: "a" }).allowed).toBe(true);  // within cap 1
    expect(accountCapVerdict({ ...b, username: "b" }).allowed).toBe(false); // beyond cap 1
  });

  it("pro (cap 3) allows any of the first 3 registered", () => {
    const p = { ...base, plan: "pro", tiktok: "a,b,c,d" };
    for (const u of ["a", "b", "c"]) expect(accountCapVerdict({ ...p, username: u }).allowed).toBe(true);
    expect(accountCapVerdict({ ...p, username: "d" }).allowed).toBe(false); // 4th exceeds cap 3
  });

  it("Facebook uses the facebook registered list", () => {
    const f = { plan: "basic", role: "seller", tiktok: "", facebook: "mypage", platform: "Facebook" as const };
    expect(accountCapVerdict({ ...f, username: "mypage" }).allowed).toBe(true);
    expect(accountCapVerdict({ ...f, username: "otherpage" }).allowed).toBe(false);
  });

  it("FAIL-OPEN: unknown plan / admin / broken registered list / empty requested", () => {
    expect(accountCapVerdict({ ...base, plan: undefined, username: "anything" }).allowed).toBe(true); // infra fail-open
    expect(accountCapVerdict({ ...base, role: "admin", username: "anything" }).allowed).toBe(true);   // admin exempt
    expect(accountCapVerdict({ ...base, role: "Admin", username: "anything" }).allowed).toBe(true);   // case-insensitive
    expect(accountCapVerdict({ ...base, tiktok: null as unknown as string, username: "x" }).allowed).toBe(true); // Addition 1
    expect(accountCapVerdict({ ...base, tiktok: "", username: "x" }).allowed).toBe(true);             // empty list -> fail-open
    expect(accountCapVerdict({ ...base, username: "" }).allowed).toBe(true);                          // empty requested
    expect(accountCapVerdict({ ...base, username: "  @  " }).allowed).toBe(true);                     // normalizes to empty
  });
});
