// sql/233 fb_receipt_edits — the safety lines, pinned in CI (the full behaviour on a real Postgres is
// scripts/sql233-behaviour.mjs, PGlite, not in CI). A seller reads / writes ONLY own rows (four policies, each
// user_id = auth.uid()), a visitor (anon) has nothing, no admin rule, no SECURITY DEFINER function, every field has
// a size check, and the shared code's limits are the database's limits.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EDIT_MAX_LINES, EDIT_ITEM_MAX, EDIT_OPENING_MAX, EDIT_NOTE_MAX, EDIT_PRICE_MAX, cleanReceiptEdit } from "../../../lib/receiptEdit.js";

const root = resolve(__dirname, "../../../..");
const UP = readFileSync(resolve(root, "sql/233_fb_receipt_edits.sql"), "utf8");
const DOWN = readFileSync(resolve(root, "sql/233_fb_receipt_edits_rollback.sql"), "utf8");
const code = UP.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");

describe("sql/233", () => {
  it("RLS on; select / insert / update / delete for authenticated, each own rows only; nothing for anon; no admin rule", () => {
    expect(code).toContain("alter table public.fb_receipt_edits enable row level security;");
    for (const op of ["select", "insert", "update", "delete"]) {
      const line = code.split("\n").find((l) => l.includes(`policy fb_receipt_edits_${op} on public.fb_receipt_edits for ${op} to authenticated`));
      expect(line, op).toBeTruthy();
      expect(line).toContain("user_id = (select auth.uid())");
    }
    expect(code).toContain("revoke all on public.fb_receipt_edits from public, anon;");
    expect(code).not.toMatch(/is_admin|security definer|to anon|grant[^;]*anon/i);
    expect((code.match(/create policy/g) || []).length).toBe(4);
  });
  it("every field has a size / shape check; the shared code's limits are the database's", () => {
    expect(code).toContain("char_length(opening) <= 300");
    expect(code).toContain("char_length(note) <= 1000");
    expect(code).toContain("jsonb_array_length(p) <= 100");
    expect(code).toContain("char_length(e ->> 'item') > 200");
    expect(code).toContain("(e ->> 'price')::numeric > 100000000");
    expect(code).toContain("shipping_fee <= 100000000");
    expect([EDIT_OPENING_MAX, EDIT_NOTE_MAX, EDIT_MAX_LINES, EDIT_ITEM_MAX, EDIT_PRICE_MAX]).toEqual([300, 1000, 100, 200, 100000000]);
    const big = cleanReceiptEdit({ opening: "x".repeat(400), note: "y".repeat(1200), shippingFee: 1e12, lines: Array.from({ length: 120 }, () => ({ item: "z".repeat(250), price: -5 })) });
    expect(big.opening).toHaveLength(300); expect(big.note).toHaveLength(1000); expect(big.lines).toHaveLength(100);
    expect(big.lines[0]).toEqual({ item: "z".repeat(200), price: null }); expect(big.shippingFee).toBe(100000000);
  });
  it("one row per seller + session + buyer; the time is the database's; the rollback removes the table, both functions and the job", () => {
    expect(code).toContain("primary key (user_id, session_id, buyer_number)");
    expect(code).toContain("new.updated_at := now();");
    for (const x of ["drop table if exists public.fb_receipt_edits;", "drop function if exists public.fb_receipt_edits_stamp();", "drop function if exists public.fb_receipt_edit_lines_ok(jsonb);", "cron.unschedule('purge-old-fb-receipt-edits')"]) expect(DOWN).toContain(x);
  });
});
