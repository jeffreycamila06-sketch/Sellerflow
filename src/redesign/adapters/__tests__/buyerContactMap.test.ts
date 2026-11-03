// Pickup Status contact map (v2 items 2 + 3): fold rows newest-first (first platform wins per
// key), handle+store key and handle key, carrier order (fm rows read the FM map first), and the
// loader's source contract (own rows, platform not null, 60-day window, paged 500, cap 2000).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { foldContactRows, contactFor, EMPTY_CONTACT_MAPS, BUYER_CONTACTS_CHUNK, BUYER_CONTACTS_MAX, BUYER_CONTACTS_DAYS, type ContactMaps } from "../buyerContactMap";
import type { BuyerContactPlatform } from "../buyerContact";

describe("foldContactRows", () => {
  it("newest first wins; keys by handle+store and by handle; unknown platforms and unwanted handles skipped", () => {
    const m = new Map<string, BuyerContactPlatform>();
    foldContactRows(m, new Set(["maria", "ana"]), [
      { handle: "@Maria", storeId: "266402", platform: "whatsapp" },   // newest
      { handle: "maria", storeId: "133712", platform: "line" },
      { handle: "maria", storeId: "266402", platform: "facebook" },     // older for the same key → ignored
      { handle: "ana", storeId: null, platform: "instagram" },
      { handle: "ana", storeId: "1", platform: "telegram" },            // not a platform
      { handle: "stranger", storeId: "1", platform: "line" },           // not wanted
    ]);
    expect(m.get("maria|266402")).toBe("whatsapp");
    expect(m.get("maria|133712")).toBe("line");
    expect(m.get("maria")).toBe("whatsapp");
    expect(m.get("ana")).toBe("instagram");
    expect(m.has("ana|1")).toBe(false);
    expect(m.has("stranger")).toBe(false);
  });
});

describe("contactFor — carrier order", () => {
  const maps: ContactMaps = { s711: new Map([["maria", "whatsapp"], ["both|1", "line"], ["both", "line"]]), fm: new Map([["pedro", "instagram"], ["both", "facebook"]]) };
  it("7-11 rows read the 7-11 map first, fm rows the FM map first; both fall back to the other", () => {
    expect(contactFor(maps, "@Maria", null)).toBe("whatsapp");
    expect(contactFor(maps, "pedro", null, "711")).toBe("instagram");       // fallback to FM
    expect(contactFor(maps, "pedro", null, "fm")).toBe("instagram");
    expect(contactFor(maps, "both", "1", "711")).toBe("line");              // precise key wins
    expect(contactFor(maps, "both", "9", "fm")).toBe("facebook");           // FM map first for fm rows
    expect(contactFor(maps, "nobody", "1")).toBeNull();
    expect(contactFor(EMPTY_CONTACT_MAPS, "maria", "1")).toBeNull();
    expect(contactFor(maps, "", "1")).toBeNull();
  });
});

describe("loader source contract", () => {
  const src = readFileSync(resolve(process.cwd(), "src/redesign/adapters/buyerContactMap.ts"), "utf8");
  it("own rows, platform not null, 60-day window on the scan tables, paged 500 up to 2000 with a one-time log, PT_SELECT untouched", () => {
    expect(BUYER_CONTACTS_CHUNK).toBe(500);
    expect(BUYER_CONTACTS_MAX).toBe(2000);
    expect(BUYER_CONTACTS_DAYS).toBe(60);
    expect(src).toContain('.eq("user_id", me).not("contact_platform", "is", null)');
    expect(src).toContain("if (src.since) q = q.gte(src.dateCol, sinceIso);");
    expect(src).toContain('{ table: "parcel_scans", handleCol: "notes", dateCol: "created_at", since: true }');
    expect(src).toContain('{ table: "fm_parcel_scans", handleCol: "buyer_username", dateCol: "created_at", since: true }');
    expect(src).toContain("if (!capLogged) { capLogged = true; log.warn(");
    const tracking = readFileSync(resolve(process.cwd(), "src/redesign/adapters/parcelTracking.ts"), "utf8");
    expect(tracking).toContain('export const PT_SELECT = "id, tracking_no, cm_order_no, buyer_username, recipient_name, store_id, rec_store, status, status_message, pickup_deadline, arrived_at, ship_type, special_type, order_amount, terminal, last_polled_at";');
  });
});
