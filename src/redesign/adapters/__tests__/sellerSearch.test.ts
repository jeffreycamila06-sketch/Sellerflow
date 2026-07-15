// Manage Sellers search — phone-column fix. The old filter searched only
// email + @handles + contact note, so a phone lookup ("0958…") returned nothing
// even though seller_profiles.phone is populated (36/38) and already loaded on the
// admin client (rawByEmail). Pins: phone matches (exact/partial/+886/dash/space),
// text fields still match (byte-unchanged), no-phone sellers don't crash + still
// match on text, and the phone match is SCOPED to the phone field (no false-match
// from a short/no-digit query).
import { describe, it, expect } from "vitest";
import { normPhone, sellerMatchesQuery } from "../useReadData";
import type { AccountUser } from "../../../accountDb";
import type { User } from "../../data";

const user = (email: string, contactNote = ""): User =>
  ({ email, note: "", contactNote, role: "Seller", plan: "Basic", days: 30, accounts: "1", status: "active", planExpiry: "", planStatus: "active" } as User);

const raw = (over: Partial<AccountUser["profile"]> & { handles?: string[] } = {}): AccountUser =>
  ({
    email: "x@y.com",
    profile: { fullName: "", storeName: "", phone: "", tiktok: "", facebook: "", adminContactNote: "", ...over },
    plan: "basic", planStatus: "active", planExpiry: "",
    connectedAccounts: over.handles || [],
  } as AccountUser);

describe("normPhone", () => {
  it("digits only; strips spaces / dashes / parens", () => {
    expect(normPhone("0958 704-782")).toBe("0958704782");
    expect(normPhone("(0958) 704 782")).toBe("0958704782");
  });
  it("+886 / 886 → local 0", () => {
    expect(normPhone("+886958704782")).toBe("0958704782");
    expect(normPhone("886 958 704 782")).toBe("0958704782");
  });
  it("null / undefined / empty → ''", () => {
    expect(normPhone(null)).toBe("");
    expect(normPhone(undefined)).toBe("");
    expect(normPhone("")).toBe("");
  });
});

describe("sellerMatchesQuery — phone", () => {
  const u = user("leinapan@gmail.com");
  const r = raw({ phone: "0958161233" });

  it("exact phone matches", () => {
    expect(sellerMatchesQuery(u, r, "0958161233")).toBe(true);
  });
  it("partial phone (prefix / middle) matches", () => {
    expect(sellerMatchesQuery(u, r, "0958")).toBe(true);
    expect(sellerMatchesQuery(u, r, "161233")).toBe(true);
    expect(sellerMatchesQuery(u, r, "958161233")).toBe(true); // typed without the leading 0
  });
  it("typed with spaces / dashes / +886 still matches the clean stored value", () => {
    expect(sellerMatchesQuery(u, r, "0958 161 233")).toBe(true);
    expect(sellerMatchesQuery(u, r, "0958-161-233")).toBe(true);
    expect(sellerMatchesQuery(u, r, "+886958161233")).toBe(true);
  });
  it("a DIFFERENT number does NOT match (0958704782 is not this seller)", () => {
    expect(sellerMatchesQuery(u, r, "0958704782")).toBe(false);
  });
});

describe("sellerMatchesQuery — existing text fields unchanged", () => {
  it("email, @handle, and contact note still match", () => {
    const u = user("maria@shop.com", "tg:mariastore");
    const r = raw({ phone: "0912345678", handles: ["mariatiktok"] });
    expect(sellerMatchesQuery(u, r, "maria@shop")).toBe(true);   // email
    expect(sellerMatchesQuery(u, r, "mariatiktok")).toBe(true);  // handle
    expect(sellerMatchesQuery(u, r, "mariastore")).toBe(true);   // contact note
  });
  it("empty query returns everyone (no filter)", () => {
    expect(sellerMatchesQuery(user("a@b.com"), raw(), "   ")).toBe(true);
  });
});

describe("sellerMatchesQuery — null-safety + no false positives", () => {
  it("a seller with NO phone doesn't crash and still matches on text", () => {
    const u = user("nophone@x.com");
    const r = raw({ phone: "" });
    expect(sellerMatchesQuery(u, r, "nophone@x")).toBe(true); // text still works
    expect(sellerMatchesQuery(u, r, "0958")).toBe(false);     // no phone → no phone match, no crash
  });
  it("raw missing entirely (no rawByEmail row) → text-only, no crash", () => {
    expect(sellerMatchesQuery(user("solo@x.com"), undefined, "solo@x")).toBe(true);
    expect(sellerMatchesQuery(user("solo@x.com"), undefined, "0958")).toBe(false);
  });
  it("a short / no-digit query never phone-matches everyone (>=3-digit guard)", () => {
    const r = raw({ phone: "0958161233" });
    // "0" and "12" are <3 digits → must fall through to the text path only.
    expect(sellerMatchesQuery(user("nomatch@z.com"), r, "0")).toBe(false);
    expect(sellerMatchesQuery(user("nomatch@z.com"), r, "12")).toBe(false);
  });
  it("phone match is scoped to the phone field only (not email/handle digits)", () => {
    // The query '161233' must match ONLY because the PHONE contains it — a seller
    // whose phone lacks those digits does not match even if unrelated.
    const other = raw({ phone: "0900000000" });
    expect(sellerMatchesQuery(user("z@z.com"), other, "161233")).toBe(false);
  });
});
