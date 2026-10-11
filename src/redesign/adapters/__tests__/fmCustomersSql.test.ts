// Contract for sql/121 (FamilyMart customers + the global FamilyMart fee). Behaviour is proved on
// Postgres by scripts/sql121-behaviour.mjs; this pins the shape so an edit can't quietly drop a rule.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const up = readFileSync("sql/121_fm_parcel_customers.sql", "utf8");
const down = readFileSync("sql/121_fm_parcel_customers_rollback.sql", "utf8");
const code = up.replace(/--.*$/gm, "");

const s = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../appSettings", () => ({ getAppSetting: s.get, setAppSetting: s.set }));
import { loadFmGlobalFee, saveFmGlobalFee, validFmFee, FM_FEE_KEY } from "../fmScan";

describe("sql/121 — FamilyMart customers", () => {
  it("seeds fm_shipping_fee '39' without overwriting", () => {
    expect(up).toMatch(/insert into public\.app_settings \(key, value\) values \('fm_shipping_fee', '39'\) on conflict \(key\) do nothing;/);
  });
  it("table: the requested columns, 6-digit store, phone 09 + 8 digits", () => {
    for (const c of ["id", "user_id", "name", "phone", "store_id", "buyer_username", "notes", "created_at", "updated_at"]) expect(code).toMatch(new RegExp(`\\n  ${c}\\s`));
    expect(code).toContain("store_id ~ '^[0-9]{6}$'");
    expect(code).toContain("phone ~ '^09[0-9]{8}$'");
    expect(code).toContain("on delete cascade"); // kept while the account exists, like parcel_customers
  });
  it("same dedup key as parcel_customers: (user_id, phone, lower(trim(name)))", () => {
    expect(code).toContain("on public.fm_parcel_customers (user_id, phone, lower(trim(coalesce(name, ''))))");
    expect(code).toContain("on conflict (user_id, phone, lower(trim(coalesce(name, '')))) do update");
    expect(code).toContain("store_id       = coalesce(excluded.store_id, fm_parcel_customers.store_id)");
    expect(code).toContain("buyer_username = coalesce(excluded.buyer_username, fm_parcel_customers.buyer_username)");
  });
  it("saved / updated by a trigger on every FamilyMart parcel add or edit", () => {
    expect(code).toMatch(/create trigger trg_upsert_fm_parcel_customer\s+after insert or update of recipient_name, phone, store_id, buyer_username\s+on public\.fm_parcel_scans/);
  });
  it("RLS: own rows only; every write needs fm_scan_allowed()", () => {
    expect(code).toContain("alter table public.fm_parcel_customers enable row level security;");
    expect(code).toContain("for select to authenticated using (user_id = (select auth.uid()));");
    expect((code.match(/and \(select public\.fm_scan_allowed\(\)\)\);/g) ?? []).length).toBe(3);
    expect((code.match(/create policy/g) ?? []).length).toBe(4);
  });
  it("the 7-11 tables are never touched", () => {
    expect(code).not.toMatch(/\bparcel_scans\b/);
    expect(code).not.toMatch(/\bparcel_customers\b/);
    expect(code).not.toContain("shipping_default_fee");
  });
  it("rollback: plain drops, removes the fee key, keeps the parcels", () => {
    expect(down).not.toMatch(/if exists/i);
    expect(down).toContain("drop trigger trg_upsert_fm_parcel_customer on public.fm_parcel_scans;");
    expect(down).toContain("drop table public.fm_parcel_customers;");
    expect(down).toContain("delete from public.app_settings where key = 'fm_shipping_fee';");
    expect(down).not.toMatch(/drop table public\.fm_parcel_scans/);
  });
});

describe("FamilyMart global fee (adapter)", () => {
  beforeEach(() => { s.get.mockReset(); s.set.mockReset(); s.set.mockResolvedValue({ ok: true }); });
  it("reads app_settings fm_shipping_fee", async () => {
    s.get.mockResolvedValue({ value: "45", updatedAt: null });
    expect(await loadFmGlobalFee()).toBe(45);
    expect(s.get).toHaveBeenCalledWith(FM_FEE_KEY);
    expect(FM_FEE_KEY).toBe("fm_shipping_fee");
  });
  it("missing / invalid / out of range → 39; 0 is allowed", async () => {
    for (const v of [null, "", "abc", "-1", "201", "39.5"]) {
      s.get.mockResolvedValue(v === null ? null : { value: v, updatedAt: null });
      expect(await loadFmGlobalFee()).toBe(39);
    }
    s.get.mockResolvedValue({ value: "0", updatedAt: null });
    expect(await loadFmGlobalFee()).toBe(0);
  });
  it("write: only whole numbers 0–200", async () => {
    expect([0, 39, 200].every(validFmFee)).toBe(true);
    expect([-1, 201, 1.5, "", null].some(validFmFee)).toBe(false);
    expect((await saveFmGlobalFee(201)).ok).toBe(false);
    expect(s.set).not.toHaveBeenCalled();
    await saveFmGlobalFee(60);
    expect(s.set).toHaveBeenCalledWith("fm_shipping_fee", "60");
  });
});
