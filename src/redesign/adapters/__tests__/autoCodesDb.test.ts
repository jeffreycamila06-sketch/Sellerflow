// Auto Mode storage — pure mappers + unconfigured-env no-op behavior (no Supabase in
// vitest → reads return null, writes return false, so nothing is disturbed).
import { describe, it, expect } from "vitest";
import { rowToCode, codeToRow, loadCodes, saveCodes } from "../autoCodesDb";
import type { AutoCode } from "../autoMode";

const code: AutoCode = { code: "D", productLocalId: 1750000000014, price: 52, productName: "Brief" };

describe("rowToCode — DB row → AutoCode", () => {
  it("maps columns and coerces numerics", () => {
    expect(rowToCode({ code: "D", product_local_id: "1750000000014", product_name: "Brief", price: "52" }))
      .toEqual({ code: "D", productLocalId: 1750000000014, price: 52, productName: "Brief" });
  });
  it("tolerates nulls (empty name, zero price)", () => {
    expect(rowToCode({ code: "A", product_local_id: 11, product_name: null, price: null }))
      .toEqual({ code: "A", productLocalId: 11, price: 0, productName: "" });
  });
});

describe("codeToRow — AutoCode → insert payload", () => {
  it("includes scope + columns and derives updated_at", () => {
    expect(codeToRow(code, "user-123", 1750000000000)).toEqual({
      user_id: "user-123", code: "D", product_local_id: 1750000000014,
      product_name: "Brief", price: 52, updated_at: new Date(1750000000000).toISOString(),
    });
  });
});

describe("DB ops are safe no-ops when Supabase is unconfigured", () => {
  it("loadCodes returns null (caller keeps what it had)", async () => {
    expect(await loadCodes()).toBeNull();
  });
  it("saveCodes returns false without throwing", async () => {
    await expect(saveCodes([code])).resolves.toBe(false);
    await expect(saveCodes([])).resolves.toBe(false);
  });
});
