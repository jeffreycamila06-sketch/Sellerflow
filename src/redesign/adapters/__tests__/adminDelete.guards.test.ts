// Phase 2 — the SERVER hard-delete guards (pure, shared with the edge function).
// These are the "can't shoot your own foot" protections: never delete yourself,
// never delete a fellow admin or a master account, never a non-existent target.
import { describe, it, expect } from "vitest";
import { checkDeleteAllowed, checkSelfDeleteAllowed, isAlreadyDeletedError, type DeleteTarget } from "../../../../supabase/functions/admin-delete-user/guards";

const CALLER = "admin-uid-1";
const target = (over: Partial<DeleteTarget>): DeleteTarget =>
  ({ authUserId: "seller-uid-9", email: "seller@x.com", role: "seller", plan: "basic", ...over });

describe("checkDeleteAllowed — Phase 2 hard-delete guards", () => {
  it("allows deleting a normal seller (basic/pro/free, role seller)", () => {
    expect(checkDeleteAllowed(CALLER, target({})).allowed).toBe(true);
    expect(checkDeleteAllowed(CALLER, target({ plan: "pro" })).allowed).toBe(true);
    expect(checkDeleteAllowed(CALLER, target({ plan: "free" })).allowed).toBe(true);
  });

  it("BLOCKS deleting yourself (target uid === caller uid)", () => {
    const r = checkDeleteAllowed(CALLER, target({ authUserId: CALLER }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("self_delete");
  });

  it("BLOCKS deleting a fellow admin (any case)", () => {
    expect(checkDeleteAllowed(CALLER, target({ role: "admin" })).code).toBe("protected_admin");
    expect(checkDeleteAllowed(CALLER, target({ role: "Admin" })).code).toBe("protected_admin");
    expect(checkDeleteAllowed(CALLER, target({ role: "ADMIN" })).allowed).toBe(false);
  });

  it("BLOCKS deleting a master-plan account (any case)", () => {
    expect(checkDeleteAllowed(CALLER, target({ plan: "master" })).code).toBe("protected_master");
    expect(checkDeleteAllowed(CALLER, target({ plan: "Master" })).allowed).toBe(false);
  });

  it("BLOCKS a non-existent target (no profile resolved)", () => {
    const r = checkDeleteAllowed(CALLER, target({ authUserId: null }));
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("not_found");
  });

  it("guard order: self-check beats admin-check (deleting your own admin row = self, not protected_admin)", () => {
    const r = checkDeleteAllowed(CALLER, target({ authUserId: CALLER, role: "admin" }));
    expect(r.code).toBe("self_delete");
  });
});

describe("checkSelfDeleteAllowed — Phase 2 self-service guard (opposite of admin mode)", () => {
  it("ALLOWS a normal seller to self-delete (free/basic/pro)", () => {
    expect(checkSelfDeleteAllowed("seller", "free").allowed).toBe(true);
    expect(checkSelfDeleteAllowed("seller", "basic").allowed).toBe(true);
    expect(checkSelfDeleteAllowed("seller", "pro").allowed).toBe(true);
  });
  it("ALLOWS a profile-less ghost self-deleting (role/plan null)", () => {
    expect(checkSelfDeleteAllowed(null, null).allowed).toBe(true);
  });
  it("BLOCKS an admin from self-deleting (protected, any case)", () => {
    expect(checkSelfDeleteAllowed("admin", "pro").code).toBe("protected_admin");
    expect(checkSelfDeleteAllowed("Admin", "pro").allowed).toBe(false);
  });
  it("BLOCKS a master account from self-deleting (any case)", () => {
    expect(checkSelfDeleteAllowed("seller", "master").code).toBe("protected_master");
    expect(checkSelfDeleteAllowed("seller", "Master").allowed).toBe(false);
  });
});

describe("isAlreadyDeletedError — retry idempotency for the auth delete", () => {
  it("treats 'user already gone' as SUCCESS (idempotent retry after a partial run)", () => {
    expect(isAlreadyDeletedError({ status: 404 })).toBe(true);
    expect(isAlreadyDeletedError({ code: "user_not_found" })).toBe(true);
    expect(isAlreadyDeletedError({ code: "not_found" })).toBe(true);
    expect(isAlreadyDeletedError({ message: "User not found" })).toBe(true);
    expect(isAlreadyDeletedError({ message: "not-found" })).toBe(true);
  });
  it("does NOT swallow a real/transient failure (must still throw → retry, not fake success)", () => {
    expect(isAlreadyDeletedError(null)).toBe(false);
    expect(isAlreadyDeletedError(undefined)).toBe(false);
    expect(isAlreadyDeletedError({})).toBe(false);
    expect(isAlreadyDeletedError({ status: 500, message: "internal error" })).toBe(false);
    expect(isAlreadyDeletedError({ status: 429, message: "rate limited" })).toBe(false);
    expect(isAlreadyDeletedError({ message: "database timeout" })).toBe(false);
  });
});
