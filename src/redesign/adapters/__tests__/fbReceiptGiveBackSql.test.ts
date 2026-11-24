// sql/212 (give back the comments used up by Facebook error 10/2018300) + sql/213 (guide line) +
// sql/214 (the owner-read switch, created 'false') + how the server reads that switch: what the
// files may and may not do, read from the files themselves. Behaviour on a real Postgres:
// scripts/sql212-behaviour.mjs (not in CI).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { RECEIPT_THREAD_OWNED } from "../../../../server/fbReceipt.js";
import { parseGuide } from "../../../../server/helpBot.js";

const read = (f: string) => readFileSync(f, "utf8");
const code = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("sql/212 — give-back", () => {
  const up = code(read("sql/212_fb_receipt_give_back.sql")), down = code(read("sql/212_fb_receipt_give_back_rollback.sql"));
  it("ONE delete, on fb_receipts, only failed tries of exactly the server's error code — a rule, no ids", () => {
    const deletes = up.match(/delete\s+from\s+[\w.]+[^;]*?returning \*/gi) || [];
    expect(deletes).toHaveLength(1);
    expect(deletes[0].replace(/\s+/g, " ")).toBe(`delete from public.fb_receipts where status = 'failed' and error_code = '${RECEIPT_THREAD_OWNED}' returning *`);
    expect(up).not.toMatch(/\bupdate\b|\btruncate\b|drop\s+table|live_session_orders|\borders\b|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
  it("the rows are kept first, in a table browsers cannot read; one transaction", () => {
    expect(up).toMatch(/create table if not exists public\.fb_receipts_given_back_212 \(like public\.fb_receipts\)/);
    expect(up).toMatch(/alter table public\.fb_receipts_given_back_212 enable row level security/);
    expect(up).toMatch(/revoke all on public\.fb_receipts_given_back_212 from anon, authenticated/);
    expect(up).not.toMatch(/create policy|grant /i);
    expect(up.trim().startsWith("begin;") && up.trim().endsWith("commit;")).toBe(true);
    expect(down.trim().startsWith("begin;") && down.trim().endsWith("commit;")).toBe(true);
  });
  it("the rollback only puts rows back and drops the keeping table", () => {
    expect(down).toMatch(/insert into public\.fb_receipts overriding system value/);
    expect(down).toMatch(/not exists \(select 1 from public\.fb_receipts r where r\.id = g\.id\)/);
    expect(down).not.toMatch(/\bdelete\b|\bupdate\b|\btruncate\b/i);
    expect((down.match(/drop table/g) || []).length).toBe(1);
  });
});

describe("sql/213 — guide line", () => {
  const up = read("sql/213_guide_fb_receipt_thread_owned.sql");
  const body = parseGuide(read("docs/support/sfl-guide.md")).find((s: { id: string }) => s.id === "connect-facebook")!.body as string;
  const line = `If you see "Not sent. Facebook says another app is handling this buyer's chat with your Page right now…", nothing was sent to the buyer.`;
  it("the guide, sql/116b and sql/213 carry the same sentence; only the connect-facebook row is touched", () => {
    expect(body).toContain(line);
    expect(read("sql/116b_guide_seed.sql")).toContain(line.replace(/'/g, "''"));
    expect(up).toContain(line.replace(/'/g, "''"));
    expect([...code(up).matchAll(/where id = '([^']+)'/g)].map((m) => m[1])).toEqual(["connect-facebook"]);
  });
  it("user-level words only: no error number, no app id, nothing about how it is handled inside", () => {
    expect(line).not.toMatch(/2018300|\b10\b|app id|thread|owner|routing|handover|server|log/i);
  });
});

describe("sql/214 — the owner-read switch, and how the server reads it", () => {
  const up = code(read("sql/214_fb_receipt_owner_read_switch.sql")), down = code(read("sql/214_fb_receipt_owner_read_switch_rollback.sql"));
  it("creates ONE row, 'false', and never changes a row that is already there", () => {
    expect(up.replace(/\s+/g, " ").trim()).toBe("begin; insert into public.app_settings (key, value) values ('fb_receipt_owner_read_enabled', 'false') on conflict (key) do nothing; commit;");
    expect(down.replace(/\s+/g, " ").trim()).toBe("begin; delete from public.app_settings where key = 'fb_receipt_owner_read_enabled'; commit;");
  });
  it("server.js: the switch is read through the cached flag reader (exact 'true', error = off) and handed to the receipt sender as store.ownerReadEnabled", () => {
    const src = read("server.js");
    const at = src.indexOf("const ownerReadFlag = createFbFlagReader({");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, at + 420);
    expect(block).toContain('.from("app_settings").select("value").eq("key", "fb_receipt_owner_read_enabled").maybeSingle()');
    expect(block).toContain('if (error) throw new Error("fb_receipt_owner_read_enabled_read_failed");');
    expect(src).toContain("      ownerReadEnabled: () => ownerReadFlag(),");
    expect((src.match(/fb_receipt_owner_read_enabled"/g) || []).length).toBe(1);   // read in one place only
    expect(src).not.toContain("FB_RECEIPT_OWNER_READ");                              // no env switch
    // the line that builds the sender is the one main has
    expect(src).toContain("fbReceiptApi = createFbReceipt({ config: fbCfg, store, log: (line) => console.log(line) });");
  });
  it("fbReceipt.js: the switch is asked in exactly one place — inside the owner read, which only a 10/2018300 failure starts", () => {
    const src = read("server/fbReceipt.js").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"); // code lines only
    expect((src.match(/store\.ownerReadEnabled\(\)/g) || []).length).toBe(1);
    expect((src.match(/startOwnerRead\(/g) || []).length).toBe(2); // its definition + ONE call
    expect(src).toContain("if (`${answer.code}/${answer.subcode}` === RECEIPT_THREAD_OWNED) startOwnerRead(userId, claim, g.orders, answer.detail);");
    expect(src).toContain("if ((await store.ownerReadEnabled()) !== true) return;");
    expect(src).not.toContain("process.env");
  });
});
