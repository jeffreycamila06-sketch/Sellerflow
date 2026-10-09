// Messenger receipt failures keep Facebook's own words (server/fbReceipt.js + sql/80). Pins: the
// detail string (fields, " | ", 300 cap, missing fields, no token / URL), it is saved as
// error_detail on BOTH failed-update paths and logged, fb_code "code/subcode" in the answer, the
// missing-column fallback (today's update), and nothing private in logs or the saved row.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbReceipt, classifyReceiptAnswer, receiptErrorDetail, RECEIPT_ERROR_DETAIL_MAX } from "../../../../server/fbReceipt.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-10-06T12:00:00Z");
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const TOKEN = "PAGE-TOKEN-SECRET";
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString("base64");
const FB_ERR = { message: "(#100) No matching user found", type: "OAuthException", code: 100, error_subcode: 1893060, error_user_title: "Cannot message", error_user_msg: "This person isn't available right now.", fbtrace_id: "TRACE123", error_data: { blame: "x" } };

type Row = { id: number; [k: string]: unknown };
function makeStore(o: { missingColumn?: "error" | "throw"; deleteOk?: boolean } = {}) {
  const rows: Row[] = [];
  const updates: Record<string, unknown>[] = [];
  const store = {
    rows, updates,
    hasReceiptAccess: async () => true,
    listReceiptOrders: async () => [{ user_id: U, session_id: S, buyer_number: 3, platform: "Facebook", comment_msg_id: "701_1", platform_meta: { page_id: "P1", live_video_id: "LV1", commenter_id: "COMMENTER-ID-9" }, handle: "Secret Buyer", created_at: new Date(NOW - 3600_000).toISOString() }],
    listReceiptRows: async (ids: string[]) => rows.filter((r) => ids.includes(String(r.comment_id))),
    insertReceipt: async (row: Record<string, unknown>) => { const r = { ...row, id: 100 + rows.length }; rows.push(r); return { id: r.id }; },
    updateReceipt: vi.fn(async (id: number, patch: Record<string, unknown>) => {
      updates.push({ ...patch });
      if (o.missingColumn && "error_detail" in patch) {
        if (o.missingColumn === "throw") throw new Error("column fb_receipts.error_detail does not exist");
        return { error: { code: "PGRST204", message: "Could not find the 'error_detail' column of 'fb_receipts'" } };
      }
      Object.assign(rows.find((r) => r.id === id)!, patch);
      return {};
    }),
    deleteReceipt: async (id: number) => { if (o.deleteOk === false) return false; const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true; },
    uploadReceiptImage: async (path: string) => `https://cdn.test/storage/v1/object/public/fb-receipts/${path}`,
    getPage: async () => ({ user_id: U, page_id: "P1", active: true, can_message: true, access_token: encryptToken(TOKEN, CONFIG.tokenKey) }),
    setActive: vi.fn(),
  };
  return store;
}
const graphErr = (err: Record<string, unknown>) => vi.fn(async () => ({ status: 400, json: async () => ({ error: err }) }));
function rt(store: ReturnType<typeof makeStore>, fetchImpl: unknown) {
  const logs: string[] = [];
  const r = createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => NOW, log: (l: string) => logs.push(l), randomHex: () => "f".repeat(64) });
  return { r, logs };
}
const body = () => ({ sessionId: S, buyerNumber: 3, imagePngBase64: PNG_B64 });
const PRIVATE = [TOKEN, "access_token", "graph.facebook.com", "cdn.test", "fb-receipts/", "Secret Buyer", "COMMENTER-ID-9", "TRACE123"];

describe("receiptErrorDetail", () => {
  it("message | type | error_user_title | error_user_msg — nothing else", () => {
    expect(receiptErrorDetail(FB_ERR)).toBe("(#100) No matching user found | OAuthException | Cannot message | This person isn't available right now.");
  });
  it("missing / empty / non-string fields are skipped; whitespace collapsed; nothing → ''", () => {
    expect(receiptErrorDetail({ message: "  a \n  b ", type: "", error_user_title: 5, error_user_msg: null })).toBe("a b");
    expect(receiptErrorDetail({ type: "OAuthException" })).toBe("OAuthException");
    expect(receiptErrorDetail({})).toBe("");
    expect(receiptErrorDetail(null)).toBe("");
  });
  it("capped at 300 characters", () => {
    expect(RECEIPT_ERROR_DETAIL_MAX).toBe(300);
    expect(receiptErrorDetail({ message: "x".repeat(500), type: "T" })).toHaveLength(300);
  });
  it("never the token or a URL", () => {
    const d = receiptErrorDetail({ message: `bad token ${TOKEN} see https://graph.facebook.com/v25.0/me/messages?access_token=${TOKEN}`, error_user_msg: "http://x.y/z" }, TOKEN);
    expect(d).toBe("bad token [redacted] see [url] | [url]");
    for (const bad of [TOKEN, "graph.facebook.com", "http"]) expect(d).not.toContain(bad);
  });
  it("classifyReceiptAnswer: failed carries code, subcode and detail; sent / unknown unchanged", () => {
    expect(classifyReceiptAnswer(400, { error: FB_ERR }, TOKEN)).toEqual({ kind: "failed", code: 100, subcode: 1893060, detail: receiptErrorDetail(FB_ERR) });
    expect(classifyReceiptAnswer(200, { message_id: "m1" })).toEqual({ kind: "sent", messageId: "m1" });
    expect(classifyReceiptAnswer(500, {})).toEqual({ kind: "unknown" });
  });
});

describe("send — failed paths", () => {
  it("non-retryable error: row failed with error_code + error_detail, logged, fb_code in the answer", async () => {
    const store = makeStore();
    const { r, logs } = rt(store, graphErr(FB_ERR));
    expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "send_failed", code: 100, fb_code: "100/1893060" } });
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "100/1893060", error_detail: receiptErrorDetail(FB_ERR) });
    expect(logs).toContain(`[FB] receipt user=${U.slice(0, 8)} page=P1 result=failed code=100/1893060 detail=${receiptErrorDetail(FB_ERR)}`);
    const all = logs.join("\n") + String(store.rows[0].error_detail); // (the row's own handle column is pre-existing)
    for (const bad of PRIVATE) expect(all, bad).not.toContain(bad);
  });
  it("retryable error whose claim can't be deleted: the same failed update carries error_detail; fb_code returned", async () => {
    const store = makeStore({ deleteOk: false });
    const { r, logs } = rt(store, graphErr({ code: 613, message: "Calls to this api have exceeded the rate limit." }));
    expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "try_later", code: 613, fb_code: "613/0" } });
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "613/0", error_detail: "Calls to this api have exceeded the rate limit." });
    expect(logs.some((l) => l.endsWith("detail=Calls to this api have exceeded the rate limit."))).toBe(true);
  });
  it("no Facebook text → no error_detail key and the log line is today's", async () => {
    const store = makeStore();
    const { r, logs } = rt(store, graphErr({ code: 10 }));
    await r.send(U, body());
    expect(store.updates[0]).not.toHaveProperty("error_detail");
    expect(logs).toContain(`[FB] receipt user=${U.slice(0, 8)} page=P1 result=failed code=10/0`);
  });
  for (const mode of ["error", "throw"] as const) {
    it(`error_detail column missing (${mode}) → retried without it: row failed exactly as today, same answer`, async () => {
      const store = makeStore({ missingColumn: mode });
      const { r } = rt(store, graphErr(FB_ERR));
      expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "send_failed", code: 100, fb_code: "100/1893060" } });
      expect(store.updates).toHaveLength(2);
      expect(store.updates[1]).toEqual({ status: "failed", error_code: "100/1893060", image_path: `${"f".repeat(64)}.png` });
      expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "100/1893060" });
      expect(store.rows[0]).not.toHaveProperty("error_detail");
    });
  }
});

describe("sql/80 mirror", () => {
  it("one additive, idempotent column", () => {
    const code = readFileSync("sql/80_fb_receipt_error_detail.sql", "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").trim();
    expect(code).toBe("alter table public.fb_receipts add column if not exists error_detail text;");
  });
});
