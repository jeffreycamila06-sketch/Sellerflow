// Every new switch OFF → every touched screen renders exactly what it rendered before (the same
// fixture is run on a fresh main checkout and compared byte for byte — see the report), and the
// RedesignApp hands each screen exactly the "off" props. Plus: no backslash-u escapes in the new
// SQL / code, and no 'drop … if exists' in the new SQL.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

vi.mock("../useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("../useReceiptPicture", () => ({ useReceiptPicture: () => ({ url: null, failed: true }) }));
import { renderScreens } from "./platformWorldScreens";

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });
beforeEach(() => { localStorage.clear(); });

describe("switch OFF props = no props", () => {
  it("SalesTab / Products / ReceiptFormat / Orders / Settings render identical with the off props", () => {
    const base = renderScreens();
    const off = renderScreens({
      sales: { platformOptions: [], platformSales: { data: null, state: "idle", load: () => {} } },
      products: { inventoryV2: false, productImages: false },
      receipt: {},                                   // soldout prop absent (gate off)
      orders: { waitlist: undefined },
      settings: { deductOneClick: false, onToggleDeductOneClick: undefined },
    });
    expect(off).toEqual(base);
    if (process.env.SFL_DUMP) writeFileSync(process.env.SFL_DUMP, JSON.stringify(base, null, 1));
  });
});

describe("RedesignApp hands the screens the OFF props when the switches are off", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("every new prop is derived from a switch (fail closed)", () => {
    expect(src).toContain("const salesPlatformOptions = featureSw.salesPlatform ? platformOptions(worldQuota?.platforms) : [];");
    expect(src).toContain(" inventoryV2={featureSw.inventoryV2} productImages={featureSw.productImages} />}");
    expect(src).toContain("onToggleDeductOneClick={featureSw.inventoryV2 ? toggleDeductOneClick : undefined}");
    expect(src).toContain("{...(soldoutBase ? { soldout: { onChanged: setSoldoutOn } } : {})}");
    expect(src).toContain("{...(waitlistBase ? { waitlist: ");
    expect(src).toContain('const featureSw = useFeatureSwitches(authed ? (authUserId || "") : "");');
  });
});

describe("hygiene", () => {
  const sqlFiles = readdirSync("sql").filter((f) => /^(88|89|90|91|92|93)_/.test(f));
  it("12 SQL files (6 + 6 rollbacks)", () => { expect(sqlFiles).toHaveLength(12); });
  it("no backslash-u escapes; no 'drop … if exists'", () => {
    const code = ["server/fbSoldout.js", "src/redesign/adapters/fbSoldout.ts", "src/redesign/adapters/fbWaitlist.ts", "src/redesign/adapters/salesByPlatform.ts", "src/redesign/adapters/featureSwitches.ts"];
    for (const f of [...sqlFiles.map((x) => `sql/${x}`), ...code]) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/\\u[0-9a-fA-F]{4}/);
      if (f.startsWith("sql/")) expect(s, f).not.toMatch(/drop\s+\w+\s+if\s+exists/i);
    }
  });
});
