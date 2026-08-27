// FREE-CARD "Renews on / Days left" gate. The renewal block was rendered
// UNCONDITIONALLY, so a FREE seller with a stale (previously-paid) plan_expiry saw a
// bogus "Renews on {future date} · Days left {n}". The fix gates the block on the PLAN
// (isTimeLimitedPlan = plan !== "free"), NOT on plan_expiry — so free is always
// excluded regardless of a stale expiry, while paid plans are unchanged.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Subscription from "../Subscription";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { FreeStatus } from "../../adapters/useFreeCap";

// A FAR-FUTURE expiry so, if the block ever rendered for free, "Renews on" would show.
const STALE_EXPIRY = "2029-04-11T00:00:00.000Z";

const acct = (over: Partial<AccountUser>): AccountUser => ({
  authUserId: "u1", email: "t@x.com",
  profile: { fullName: "T", storeName: "S", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "free", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
  ...over,
});

const freeStatus: FreeStatus = { is_free: true, count: 5, cap: 20, near_cap: false, capped: false };

const renderSub = (account: AccountUser, isFreeUser: boolean) =>
  render(
    <TProvider lang="en">
      <Subscription cur="NT$" account={account} isFreeUser={isFreeUser} freeStatus={isFreeUser ? freeStatus : null} />
    </TProvider>,
  );

describe("Subscription — free Current Plan card hides the renewal block (plan-gated)", () => {
  it("FREE with a STALE non-null plan_expiry → NO 'Renews on / Days left' block (the key bug case)", () => {
    renderSub(acct({ plan: "free", planExpiry: STALE_EXPIRY }), true);
    // The renewal block is gone…
    expect(screen.queryByText("Renews on")).toBeNull();
    expect(screen.queryByText("Days left")).toBeNull();
    // …but the plan name, ACTIVE badge, and the orders-used bar still render.
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("ACTIVE")).toBeTruthy();
    expect(screen.getByText("Free orders used")).toBeTruthy();
  });

  it("FREE with a null plan_expiry → also NO renewal block", () => {
    renderSub(acct({ plan: "free", planExpiry: "" }), true);
    expect(screen.queryByText("Renews on")).toBeNull();
    expect(screen.queryByText("Days left")).toBeNull();
    expect(screen.getByText("ACTIVE")).toBeTruthy();
  });

  it("PAID (pro) → renewal block STILL renders (unchanged)", () => {
    renderSub(acct({ plan: "pro", planExpiry: STALE_EXPIRY }), false);
    expect(screen.getByText("Renews on")).toBeTruthy();
    expect(screen.getByText("Days left")).toBeTruthy();
  });
});
