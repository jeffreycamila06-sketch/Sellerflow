// P3b SQL contracts — the sql/ files are the canonical text applied to prod via
// MCP; these tests pin the load-bearing invariants so a future edit can't
// silently break them:
//   1. the purge can NEVER affect quota (only exported rows, window strictly
//      wider than the quota's 30-day sliding count),
//   2. the export RPC carries the stamped=0 two-device race guard,
//   3. the mark-shipped path never touches status (quota counts status='exported').
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SHIP_QUOTA_WINDOW_DAYS, SHIP_PURGE_AFTER_DAYS } from "../shippingExport";

const sql = (f: string): string => readFileSync(resolve(__dirname, "../../../../sql", f), "utf8");

describe("purge vs quota (sql/13 + sql/10)", () => {
  it("constants: purge window strictly wider than the quota window", () => {
    expect(SHIP_PURGE_AFTER_DAYS).toBeGreaterThan(SHIP_QUOTA_WINDOW_DAYS);
  });
  it("sql/13 purges ONLY exported rows, at the 90-day mark (draft/encoded never purged)", () => {
    const s = sql("13_retention_crons.sql");
    const purge = /DELETE FROM public\.shipping_entries\s+WHERE ([^$]+)\$\$/m.exec(s)?.[1] ?? "";
    expect(purge).toContain("status = 'exported'");
    expect(purge).toContain(`interval '${SHIP_PURGE_AFTER_DAYS} days'`);
    expect(purge).not.toMatch(/draft|encoded/);
  });
  it("sql/10 quota count uses the 30-day sliding window the client mirrors", () => {
    expect(sql("10_shipping_export_rpc.sql")).toContain(`interval '${SHIP_QUOTA_WINDOW_DAYS} days'`);
  });
});

describe("export RPC race guard (sql/10)", () => {
  it("stamped = 0 → nothing_to_export (no ok-with-zero that would build a duplicate file)", () => {
    const s = sql("10_shipping_export_rpc.sql");
    expect(s).toMatch(/if stamped = 0 then\s+return json_build_object\('ok', false, 'error', 'nothing_to_export'\);/);
    // the guard must sit AFTER the row_count read and BEFORE the ok return
    expect(s.indexOf("get diagnostics stamped")).toBeLessThan(s.indexOf("if stamped = 0"));
    expect(s.indexOf("if stamped = 0")).toBeLessThan(s.indexOf("'ok', true"));
  });
});

describe("mark-as-shipped is quota-safe (sql/12)", () => {
  it("only stamps shipped_at/updated_at — status is never written (quota counts status='exported')", () => {
    const s = sql("12_shipping_shipped.sql");
    const update = /update public\.shipping_entries\s+set ([\s\S]+?)\s+where/m.exec(s)?.[1] ?? "";
    expect(update).toContain("shipped_at");
    expect(update).not.toMatch(/\bstatus\s*=/);
    // and it only ever touches the caller's exported rows of one batch
    expect(s).toContain("user_id = caller");
    expect(s).toContain("export_batch_id = batch");
    expect(s).toContain("status = 'exported'");
  });
});
