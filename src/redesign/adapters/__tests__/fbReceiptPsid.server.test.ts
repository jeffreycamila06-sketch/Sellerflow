// B0 — the buyer's Page-scoped ID (recipient_id of a private reply) is kept in
// fb_receipts.recipient_psid (sql/99) on BOTH sent paths (receipt picture + sold-out text).
// Pins: classify keeps it only when present; the store gets it; a refused update (column not
// there yet) falls back to the exact old update; it is never logged.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { classifyReceiptAnswer, updateSentReceipt, createFbReceipt } from "../../../../server/fbReceipt.js";
import { createFbSoldout } from "../../../../server/fbSoldout.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "a", appSecret: "s", tokenKey: "tk" };
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
const page = { user_id: U, page_id: "111", active: true, can_message: true, access_token: encryptToken("TOK", CONFIG.tokenKey) };

function store(o: { refuseColumn?: boolean } = {}) {
  const rows: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  return {
    rows, updates,
    hasReceiptAccess: async () => true,
    getPage: async () => ({ ...page }),
    getSoldoutSettings: async () => ({ enabled: true, text: "" }),
    listReceiptOrders: async () => [{ comment_msg_id: "222_333", platform_meta: { page_id: "111" }, handle: "Ann", created_at: new Date().toISOString() }],
    listReceiptRows: async () => rows,
    insertReceipt: vi.fn(async (row: Record<string, unknown>) => { const r = { ...row, id: rows.length + 1 }; rows.push(r); return { id: r.id }; }),
    updateReceipt: vi.fn(async (id: number, patch: Record<string, unknown>) => {
      updates.push(patch);
      if (o.refuseColumn && "recipient_psid" in patch) return { error: { message: "column recipient_psid does not exist" } };
      Object.assign(rows.find((r) => r.id === id)!, patch); return {};
    }),
    deleteReceipt: async () => true,
    uploadReceiptImage: async (p: string) => `https://cdn.test/${p}`,
  };
}
const fetchOk = (body: Record<string, unknown>) => vi.fn(async () => ({ status: 200, json: async () => body }));

describe("classifyReceiptAnswer", () => {
  it("keeps recipient_id only when present (number or string)", () => {
    expect(classifyReceiptAnswer(200, { message_id: "m", recipient_id: "R9" })).toEqual({ kind: "sent", messageId: "m", recipientId: "R9" });
    expect(classifyReceiptAnswer(200, { message_id: "m", recipient_id: 12345 })).toEqual({ kind: "sent", messageId: "m", recipientId: "12345" });
    expect(classifyReceiptAnswer(200, { message_id: "m" })).toEqual({ kind: "sent", messageId: "m" });
    expect(classifyReceiptAnswer(200, { message_id: "m", recipient_id: "  " })).toEqual({ kind: "sent", messageId: "m" });
    expect(classifyReceiptAnswer(200, { message_id: "m", recipient_id: { x: 1 } })).toEqual({ kind: "sent", messageId: "m" });
  });
});

describe("updateSentReceipt", () => {
  it("adds recipient_psid; refused → the exact patch without it; no id → the exact patch", async () => {
    const s = store({ refuseColumn: true });
    s.rows.push({ id: 1 });
    await updateSentReceipt(s, 1, { status: "sent" }, "R1");
    expect(s.updates).toEqual([{ status: "sent", recipient_psid: "R1" }, { status: "sent" }]);
    const t = store();
    t.rows.push({ id: 1 });
    await updateSentReceipt(t, 1, { status: "sent" }, undefined);
    expect(t.updates).toEqual([{ status: "sent" }]);
  });
});

describe("both sent paths store it, never log it", () => {
  it("receipt picture", async () => {
    const s = store();
    const logs: string[] = [];
    const r = createFbReceipt({ config: CONFIG, store: s, fetchImpl: fetchOk({ message_id: "m1", recipient_id: "PSID-777" }), log: (l: string) => logs.push(l) });
    const out = await r.send(U, { sessionId: S, buyerNumber: 3, imagePngBase64: PNG.toString("base64") });
    expect(out.status).toBe(200);
    expect(s.rows[0]).toMatchObject({ status: "sent", recipient_psid: "PSID-777" });
    expect(logs.join("\n")).not.toContain("PSID-777");
  });
  it("receipt picture, column missing → still sent", async () => {
    const s = store({ refuseColumn: true });
    const r = createFbReceipt({ config: CONFIG, store: s, fetchImpl: fetchOk({ message_id: "m1", recipient_id: "PSID-777" }) });
    expect((await r.send(U, { sessionId: S, buyerNumber: 3, imagePngBase64: PNG.toString("base64") })).status).toBe(200);
    expect(s.rows[0]).toMatchObject({ status: "sent", message_id: "m1" });
    expect(s.rows[0].recipient_psid).toBeUndefined();
  });
  it("sold-out text", async () => {
    const s = store();
    const logs: string[] = [];
    const r = createFbSoldout({ config: CONFIG, store: s, soldoutEnabled: async () => true, isOwnedComment: () => true, fetchImpl: fetchOk({ message_id: "M", recipient_id: "PSID-888" }), log: (l: string) => logs.push(l) });
    expect((await r.send(U, { pageId: "111", commentId: "222_333", code: "A1", lang: "en" })).status).toBe(200);
    expect(s.rows[0]).toMatchObject({ status: "sent", kind: "soldout", recipient_psid: "PSID-888" });
    expect(logs.join("\n")).not.toContain("PSID-888");
  });
});

describe("sql/99", () => {
  const sql = readFileSync("sql/99_fb_receipt_psid.sql", "utf8");
  it("nullable text column, server-only table, no drop-if-exists, no backslash-u", () => {
    expect(sql).toContain("add column if not exists recipient_psid text;");
    expect(sql).toContain("revoke all on public.fb_receipts from authenticated;");
    for (const f of ["sql/99_fb_receipt_psid.sql", "sql/99_fb_receipt_psid_rollback.sql"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/drop\s+\w+\s+if\s+exists/i);
      expect(s).not.toContain("\\u");
    }
  });
});
