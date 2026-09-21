// Country round-trips read↔write so a save NEVER wipes it, and is absent → NULL (= TW).
import { describe, it, expect } from "vitest";
import { rowToUser, userToRow, type AccountUser } from "../../../accountDb";

const baseRow = { auth_user_id: "u1", email: "s@x.com", full_name: "N", store_name: "S", phone: "0912345678", tiktok: "", facebook: "", plan: "free", plan_status: "active", plan_expiry: null, role: "seller", connected_accounts: [], admin_contact_note: "" };

describe("seller_profiles.country round-trip", () => {
  it("rowToUser reads country (ISO-2) and null when the column is absent/null", () => {
    expect(rowToUser({ ...baseRow, country: "PH" }).profile.country).toBe("PH");
    expect(rowToUser({ ...baseRow, country: null }).profile.country).toBeNull();
    expect(rowToUser(baseRow).profile.country).toBeNull(); // column missing → null (= TW)
  });

  it("userToRow writes the loaded country back (self-save never wipes it)", () => {
    const loaded = rowToUser({ ...baseRow, country: "PH" });
    expect(userToRow(loaded).country).toBe("PH"); // round-trip: load → save keeps it
  });

  it("userToRow with no country → null (never a stray value)", () => {
    const u = { ...rowToUser(baseRow), profile: { ...rowToUser(baseRow).profile, country: undefined } } as AccountUser;
    expect(userToRow(u).country).toBeNull();
  });
});
