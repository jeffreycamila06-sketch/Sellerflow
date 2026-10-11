// sql/118 contract (behaviour is proven on Postgres by scripts/sql118-behaviour.mjs).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const up = readFileSync(resolve(__dirname, "../../../../sql/118_session_buyer_number_guard.sql"), "utf8");
const down = readFileSync(resolve(__dirname, "../../../../sql/118_session_buyer_number_guard_rollback.sql"), "utf8");

describe("sql/118 buyer-number guard", () => {
  it("only touches session rows, under one lock per seller + session", () => {
    expect(up).toMatch(/if new\.session_id is null then\s+return new;/);
    expect(up).toMatch(/pg_advisory_xact_lock\(hashtextextended\(new\.user_id::text \|\| ':' \|\| new\.session_id::text/);
  });
  it("a returning buyer keeps the first number; a taken number becomes the session's highest + 1", () => {
    expect(up).toMatch(/o\.handle = new\.handle and o\.platform = new\.platform\s+order by o\.created_at, o\.id/);
    expect(up).toMatch(/coalesce\(max\(o\.buyer_number\), 0\) \+ 1/);
  });
  it("is a BEFORE INSERT trigger; rollback is a plain drop", () => {
    expect(up).toMatch(/before insert on public\.live_session_orders/);
    expect(down).toMatch(/drop trigger trg_lso_session_buyer_number on public\.live_session_orders;/);
    expect(down).toMatch(/drop function public\.lso_session_buyer_number\(\);/);
    expect(down).not.toMatch(/if exists/i);
  });
});
