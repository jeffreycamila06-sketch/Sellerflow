// Dry / Frozen (常溫 / 冷凍) per parcel — sql/79 + adapters/parcelFrozen.
// Pins: who gets the control (public flag exactly 'true' OR an enabled own access row; any read
// error → off); mixed-batch export (dry rows = today's row byte for byte, frozen rows D=冷凍 +
// the frozen fee, fee_column_max split); per-row validation (frozen min total 150, dry as today);
// temp_layer only read/written when asked; the mode row; the sql/79 mirror.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

type Res = { data: unknown; error: unknown };
const db = vi.hoisted(() => ({
  me: "me-uuid" as string | null,
  res: {} as Record<string, Res>,          // per table: the answer to a read
  calls: [] as { table: string; op: string; args: unknown[] }[],
}));
vi.mock("../../../supabase", () => {
  const builder = (table: string) => {
    const rec = (op: string, args: unknown[]) => db.calls.push({ table, op, args });
    const answer = () => db.res[table] ?? { data: null, error: null };
    const q: Record<string, unknown> = {};
    for (const op of ["select", "eq", "neq", "in", "order", "range", "limit", "insert", "update", "upsert"]) {
      q[op] = (...args: unknown[]) => { rec(op, args); return q; };
    }
    q.maybeSingle = async () => { rec("maybeSingle", []); return answer(); };
    q.then = (ok: (v: Res) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(answer()).then(ok, bad);
    return q;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: db.me ? { user: { id: db.me } } : null } }) },
      from: (t: string) => builder(t),
    },
  };
});

import { parseFrozenSettings, frozenAllowed, loadFrozenState, saveParcelMode, xlsOptsForRow, feeForLayer, minTotalForLayer, FROZEN_OFF, TEMP_FROZEN, TEMP_DRY, type FrozenConfig } from "../parcelFrozen";
import { scanToXlsRow, splitScansForExport, validAmount, formErrors, minParcelAmount, loadParcelScans, saveParcelScan, updateParcelScan, type ParcelScanRow } from "../parcelScan";

const SETTINGS = { parcel_frozen_public: "false", parcel_frozen_fee: "129", parcel_frozen_min_total: "150", parcel_frozen_fee_column_max: "" };
const settingsRows = (m: Record<string, string>) => ({ data: Object.entries(m).map(([key, value]) => ({ key, value })), error: null });
const CFG: FrozenConfig = { fee: 129, minTotal: 150, feeColumnMax: null };
const row = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "王小明", phone: "0912345678", storeId: "266402", amount: 500, notes: "@buyer",
  status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-10-06T02:00:00Z", ...over,
});
const BASE = { storeName: "Shop", fee: 38 };

beforeEach(() => { db.me = "me-uuid"; db.res = {}; db.calls = []; });

describe("who gets the control", () => {
  it("public flag must be exactly 'true'", () => {
    expect(parseFrozenSettings({ ...SETTINGS, parcel_frozen_public: "true" }).isPublic).toBe(true);
    for (const v of ["false", "TRUE", " true", "yes", "1", "", null, undefined]) {
      expect(parseFrozenSettings({ ...SETTINGS, parcel_frozen_public: v as string }).isPublic).toBe(false);
    }
  });
  it("config: 129 / 150 / '' → no cap; '100' → cap 100; invalid values → no config (off)", () => {
    expect(parseFrozenSettings(SETTINGS).cfg).toEqual(CFG);
    expect(parseFrozenSettings({ ...SETTINGS, parcel_frozen_fee_column_max: "100" }).cfg).toEqual({ ...CFG, feeColumnMax: 100 });
    expect(parseFrozenSettings({ ...SETTINGS, parcel_frozen_fee: "abc" }).cfg).toBeNull();
    expect(parseFrozenSettings({ ...SETTINGS, parcel_frozen_fee: "501" }).cfg).toBeNull();
    expect(parseFrozenSettings({ ...SETTINGS, parcel_frozen_min_total: "" }).cfg).toBeNull();
    expect(parseFrozenSettings({ ...SETTINGS, parcel_frozen_fee_column_max: "x" }).cfg).toBeNull();
    expect(parseFrozenSettings({}).cfg).toBeNull();
  });
  it("allowed = config AND (public OR enabled access row)", () => {
    expect(frozenAllowed(true, null, CFG)).toBe(true);
    expect(frozenAllowed(false, { enabled: true }, CFG)).toBe(true);
    expect(frozenAllowed(false, { enabled: false }, CFG)).toBe(false);
    expect(frozenAllowed(false, null, CFG)).toBe(false);
    expect(frozenAllowed(true, { enabled: true }, null)).toBe(false);
  });

  it("public 'true' → allowed for a seller with NO access row; mode from the own prefs row", async () => {
    db.res.app_settings = settingsRows({ ...SETTINGS, parcel_frozen_public: "true" });
    db.res.parcel_scan_prefs = { data: { temp_layer: "冷凍" }, error: null };
    expect(await loadFrozenState()).toEqual({ allowed: true, sqlReady: true, mode: TEMP_FROZEN, cfg: CFG });
    expect(db.calls).toContainEqual({ table: "parcel_scan_prefs", op: "eq", args: ["user_id", "me-uuid"] });
  });
  it("early access row (enabled) → allowed; default mode Dry when no prefs row", async () => {
    db.res.app_settings = settingsRows(SETTINGS);
    db.res.parcel_frozen_access = { data: { user_id: "me-uuid", enabled: true }, error: null };
    expect(await loadFrozenState()).toEqual({ allowed: true, sqlReady: true, mode: TEMP_DRY, cfg: CFG });
    expect(db.calls).toContainEqual({ table: "parcel_frozen_access", op: "eq", args: ["user_id", "me-uuid"] });
  });
  it("public 'false' and no access row → off (no prefs read)", async () => {
    db.res.app_settings = settingsRows(SETTINGS);
    const st = await loadFrozenState();
    expect(st.allowed).toBe(false);
    expect(st.mode).toBe(TEMP_DRY);
    expect(db.calls.some((c) => c.table === "parcel_scan_prefs")).toBe(false);
  });
  it("another seller's access row can never turn it on (only the own row counts)", async () => {
    db.res.app_settings = settingsRows(SETTINGS);
    db.res.parcel_frozen_access = { data: { user_id: "someone-else", enabled: true }, error: null };
    expect((await loadFrozenState()).allowed).toBe(false);
  });
  it("any read error → off: settings error, access error (sql not applied), not signed in, throw", async () => {
    db.res.app_settings = { data: null, error: { message: "boom" } };
    db.res.parcel_frozen_access = { data: { user_id: "me-uuid", enabled: true }, error: null };
    expect((await loadFrozenState()).allowed).toBe(false);
    db.res.app_settings = settingsRows({ ...SETTINGS, parcel_frozen_public: "true" });
    db.res.parcel_frozen_access = { data: null, error: { message: 'relation "parcel_frozen_access" does not exist' } };
    expect(await loadFrozenState()).toMatchObject({ allowed: false, sqlReady: false });
    db.me = null;
    expect(await loadFrozenState()).toEqual(FROZEN_OFF);
  });
  it("saveParcelMode upserts the own row only", async () => {
    expect(await saveParcelMode(TEMP_FROZEN)).toEqual({ ok: true });
    const up = db.calls.find((c) => c.table === "parcel_scan_prefs" && c.op === "upsert");
    expect(up?.args[0]).toMatchObject({ user_id: "me-uuid", temp_layer: "冷凍" });
    expect(up?.args[1]).toEqual({ onConflict: "user_id" });
  });
});

describe("export per row", () => {
  it("dry row (and any row without the control) → exactly today's export row", () => {
    const today = scanToXlsRow(row(), BASE);
    expect(scanToXlsRow(row(), xlsOptsForRow(row(), BASE, CFG))).toEqual(today);
    expect(scanToXlsRow(row({ tempLayer: TEMP_DRY }), xlsOptsForRow(row({ tempLayer: TEMP_DRY }), BASE, CFG))).toEqual(today);
    expect(xlsOptsForRow(row(), BASE, CFG)).toBe(BASE);
    expect(today).toEqual(["王小明", "0912345678", "266402", "常溫", "Shop", "500", "38", "2026/10/6", "", "@buyer"]);
  });
  it("mixed batch → each row carries its own layer and fee", () => {
    const rows = [row({ id: "d" }), row({ id: "f", tempLayer: TEMP_FROZEN, amount: 300 })];
    const out = rows.map((r) => scanToXlsRow(r, xlsOptsForRow(r, BASE, CFG)));
    expect(out.map((x) => [x[3], x[5], x[6]])).toEqual([["常溫", "500", "38"], ["冷凍", "300", "129"]]);
  });
  it("fee_column_max = 100 → G = 100, F = amount + 29 (buyer still pays amount + 129)", () => {
    const r = row({ tempLayer: TEMP_FROZEN, amount: 500 });
    const x = scanToXlsRow(r, xlsOptsForRow(r, BASE, { ...CFG, feeColumnMax: 100 }));
    expect([x[3], x[5], x[6]]).toEqual(["冷凍", "529", "100"]);
  });
});

describe("validation per row", () => {
  it("frozen: min total 150 with fee 129 blocks amount 20 and allows 21 (save + export)", () => {
    const fee = feeForLayer(TEMP_FROZEN, 38, CFG); const min = minTotalForLayer(TEMP_FROZEN, CFG);
    expect([fee, min, minParcelAmount(fee, min)]).toEqual([129, 150, 21]);
    expect(validAmount("20", fee, min)).toBe(false);
    expect(validAmount("21", fee, min)).toBe(true);
    const f = (amount: string) => formErrors({ name: "王小明", phone: "0912345678", store: "266402", amount, notes: "@b" }, fee, true, true, false, min).amount;
    expect([f("20"), f("21")]).toEqual([true, false]);
    const split = splitScansForExport([row({ id: "a", tempLayer: TEMP_FROZEN, amount: 20 }), row({ id: "b", tempLayer: TEMP_FROZEN, amount: 21 })], 38, CFG);
    expect(split.attention.map((a) => [a.row.id, a.reason])).toEqual([["a", "bad_amount"]]);
    expect(split.ready.map((r) => r.id)).toEqual(["b"]);
  });
  it("frozen: the 20,000 maximum still applies", () => {
    const ok = splitScansForExport([row({ tempLayer: TEMP_FROZEN, amount: 20000 - 129 })], 38, CFG);
    const over = splitScansForExport([row({ tempLayer: TEMP_FROZEN, amount: 20000 - 128 })], 38, CFG);
    expect([ok.ready.length, over.attention.length]).toEqual([1, 1]);
  });
  it("dry stays as today: amount 20 with fee 38 saves and exports; a frozen row with no settings is blocked", () => {
    expect(validAmount("20", feeForLayer(TEMP_DRY, 38, CFG), minTotalForLayer(TEMP_DRY, CFG))).toBe(true);
    expect(validAmount("19", 38)).toBe(false);
    expect(splitScansForExport([row({ amount: 20 })], 38, CFG).ready).toHaveLength(1);
    expect(splitScansForExport([row({ amount: 20 })], 38).ready).toHaveLength(1);
    expect(splitScansForExport([row({ tempLayer: TEMP_FROZEN })], 38, null).attention[0].reason).toBe("bad_amount");
  });
});

describe("parcel_scans reads / writes", () => {
  const selectArgs = () => db.calls.filter((c) => c.table === "parcel_scans" && c.op === "select").map((c) => String(c.args[0]));
  it("temp_layer is selected only when asked", async () => {
    db.res.parcel_scans = { data: [{ id: "x", temp_layer: "冷凍", created_at: "2026-10-06T00:00:00Z" }], error: null };
    await loadParcelScans();
    expect(selectArgs().every((s) => !s.includes("temp_layer"))).toBe(true);
    db.calls = [];
    const r = await loadParcelScans({ withTempLayer: true });
    expect(selectArgs().every((s) => s.endsWith(", temp_layer"))).toBe(true);
    expect(r.rows[0].tempLayer).toBe("冷凍");
  });
  it("save / update send temp_layer only when given", async () => {
    const fields = { name: "A", phone: "0912345678", store_id: "266402", amount: 100, notes: "@a" };
    await saveParcelScan(fields, null);
    await saveParcelScan(fields, null, TEMP_FROZEN);
    const ins = db.calls.filter((c) => c.op === "insert").map((c) => c.args[0] as Record<string, unknown>);
    expect("temp_layer" in ins[0]).toBe(false);
    expect(ins[1].temp_layer).toBe("冷凍");
    await updateParcelScan("id1", fields);
    await updateParcelScan("id1", fields, undefined, TEMP_DRY);
    const ups = db.calls.filter((c) => c.op === "update").map((c) => c.args[0] as Record<string, unknown>);
    expect("temp_layer" in ups[0]).toBe(false);
    expect(ups[1].temp_layer).toBe("常溫");
  });
});

describe("sql/79 mirror", () => {
  const sql = readFileSync("sql/79_parcel_frozen.sql", "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("column, prefs (own select/insert/update), access (own select only), settings rows; idempotent", () => {
    expect(code).toContain("add column if not exists temp_layer text not null default '常溫'");
    expect(code).toContain("check (temp_layer in ('常溫', '冷凍'))");
    expect(code).toContain("create table if not exists public.parcel_scan_prefs");
    expect(code).toContain("grant select, insert, update on table public.parcel_scan_prefs to authenticated");
    expect(code).not.toMatch(/grant[^;]*delete[^;]*parcel_scan_prefs/);
    expect(code).toContain("create table if not exists public.parcel_frozen_access");
    expect(code).toContain("revoke all on table public.parcel_frozen_access from authenticated");
    expect(code).toContain("grant select on table public.parcel_frozen_access to authenticated");
    expect(code).not.toMatch(/grant (insert|update|delete)[^;]*parcel_frozen_access/);
    expect(code).not.toMatch(/on public\.parcel_frozen_access\s+for (insert|update|delete|all)/);
    expect((code.match(/using \(user_id = \(select auth\.uid\(\)\)\)/g) ?? []).length).toBe(3);
    expect(code).toContain("enable row level security");
    for (const [k, v] of [["parcel_frozen_public", "false"], ["parcel_frozen_fee", "129"], ["parcel_frozen_min_total", "150"], ["parcel_frozen_fee_column_max", ""]]) {
      expect(code).toContain(`('${k}', '${v}')`);
    }
    expect(code).toContain("on conflict (key) do nothing");
    expect(code.match(/drop policy if exists/g)?.length).toBe(4);
    // the column comes before the access table (the app reads "access answered" as "sql applied")
    expect(code.indexOf("add column if not exists temp_layer")).toBeLessThan(code.indexOf("create table if not exists public.parcel_frozen_access"));
  });
});
