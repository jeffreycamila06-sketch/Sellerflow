// Facebook audit fixes, Part B (server/fbReceipt.js). FAKE data only. B1 one send at a time
// per buyer · B2 Graph errors that prove nothing was delivered give the comment back ·
// B3 recipient guard (mixed buyer number, unknown/empty handles).
import { describe, it, expect, vi } from "vitest";
import { createFbReceipt, isMixedBuyer, pickReceiptCandidates, RECEIPT_RETRYABLE_CODES } from "../../../../server/fbReceipt.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-10-05T12:00:00Z");
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString("base64");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

type Order = { user_id: string; session_id: string; buyer_number: number; platform: string; comment_msg_id: string | null; platform_meta: Record<string, string> | null; handle: string; created_at: string };
type Row = { id: number; user_id: string; comment_id: string; status: string; [k: string]: unknown };

function makeStore(orders: Order[], opts: { deleteOk?: boolean; uploadGate?: Promise<void> } = {}) {
  const rows: Row[] = [];
  let nextId = 1;
  return {
    rows,
    hasReceiptAccess: vi.fn(async () => true),
    listReceiptOrders: vi.fn(async (uid: string, sid: string, bn: number) => orders.filter((o) => o.user_id === uid && o.session_id === sid && o.buyer_number === bn)),
    listReceiptRows: vi.fn(async (ids: string[]) => rows.filter((r) => ids.includes(r.comment_id))),
    insertReceipt: vi.fn(async (row: Record<string, unknown>) => {
      if (rows.some((r) => r.comment_id === row.comment_id && r.status !== "failed")) return { conflict: true };
      const r = { ...row, id: nextId++ } as Row; rows.push(r); return { id: r.id };
    }),
    updateReceipt: vi.fn(async (id: number, patch: Record<string, unknown>) => { Object.assign(rows.find((r) => r.id === id)!, patch); }),
    deleteReceipt: vi.fn(async (id: number) => {
      if (opts.deleteOk === false) return false;
      const i = rows.findIndex((r) => r.id === id && r.status === "pending"); if (i >= 0) rows.splice(i, 1); return true;
    }),
    uploadReceiptImage: vi.fn(async (path: string) => { if (opts.uploadGate) await opts.uploadGate; return `https://cdn.test/${path}`; }),
    getPage: vi.fn(async () => ({ user_id: U, page_id: "P1", active: true, can_message: true, access_token: encryptToken("TOK", CONFIG.tokenKey) })),
    setActive: vi.fn(),
  };
}
const order = (over: Partial<Order> = {}): Order => ({
  user_id: U, session_id: S, buyer_number: 3, platform: "Facebook", comment_msg_id: "c1",
  platform_meta: { page_id: "P1", live_video_id: "LV1" }, handle: "Maria Santos", created_at: ago(3600_000), ...over,
});
const graphOk = () => vi.fn(async () => ({ status: 200, json: async () => ({ message_id: "m.1" }) }));
const graphErr = (code: number) => vi.fn(async () => ({ status: 400, json: async () => ({ error: { code, error_subcode: 0 } }) }));
const mk = (store: ReturnType<typeof makeStore>, fetchImpl: unknown = graphOk()) => createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => NOW, log: () => {} });
const body = (over: Record<string, unknown> = {}) => ({ sessionId: S, buyerNumber: 3, imagePngBase64: PNG_B64, ...over });

describe("B1 one send at a time per buyer", () => {
  it("a second send while one is running → 409 busy; nothing claimed for it; one Graph call", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const store = makeStore([order({ comment_msg_id: "c1" }), order({ comment_msg_id: "c2" })], { uploadGate: gate });
    const f = graphOk();
    const r = mk(store, f);
    const first = r.send(U, body());
    await vi.waitFor(() => expect(store.uploadReceiptImage).toHaveBeenCalled());
    expect(await r.send(U, body())).toEqual({ status: 409, json: { ok: false, error: "busy" } });
    expect(store.insertReceipt).toHaveBeenCalledTimes(1);
    release();
    expect((await first).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("another buyer of the same session is not blocked", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const store = makeStore([order(), order({ buyer_number: 4, comment_msg_id: "c9" })], { uploadGate: gate });
    const r = mk(store);
    const first = r.send(U, body());
    await vi.waitFor(() => expect(store.uploadReceiptImage).toHaveBeenCalled());
    const second = r.send(U, body({ buyerNumber: 4 }));
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });
  it("the lock is released after success and after a throw", async () => {
    const store = makeStore([order({ comment_msg_id: "c1" }), order({ comment_msg_id: "c2" })]);
    const r = mk(store);
    expect((await r.send(U, body())).status).toBe(200);
    expect((await r.send(U, body())).status).toBe(200); // not busy
    store.listReceiptOrders.mockRejectedValueOnce(new Error("db"));
    await expect(r.send(U, body())).rejects.toThrow("db");
    expect(r._sending.size).toBe(0);
    expect((await r.send(U, body())).json).toEqual({ ok: false, error: "none_left" }); // not busy
  });
});

describe("B2 Graph errors that prove nothing was delivered give the comment back", () => {
  it("each retryable code → claim deleted (comment still a candidate); 190 → needs_reauth, others → try_later", async () => {
    expect([...RECEIPT_RETRYABLE_CODES].sort((a, b) => a - b)).toEqual([1, 2, 4, 17, 32, 190, 613, 80001, 80006]);
    for (const code of RECEIPT_RETRYABLE_CODES) {
      const store = makeStore([order()]);
      const r = mk(store, graphErr(code));
      expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: code === 190 ? "needs_reauth" : "try_later", code, fb_code: `${code}/0` } });
      expect(store.rows).toEqual([]);
      expect(store.setActive).not.toHaveBeenCalled();
      // the comment is still usable: the next send takes it
      const r2 = mk(store, graphOk());
      expect((await r2.send(U, body())).status).toBe(200);
    }
  });
  it("retryable errors never use up the comment, however many times they happen", async () => {
    const store = makeStore([order()]);
    const r = mk(store, graphErr(613));
    for (let i = 0; i < 5; i++) expect((await r.send(U, body())).json.error).toBe("try_later");
    expect((await r.info(U, body())).json).toMatchObject({ canSend: true, remaining: 1 });
  });
  it("delete fails → the claim is marked failed as today (code/subcode)", async () => {
    const store = makeStore([order()], { deleteOk: false });
    const r = mk(store, graphErr(17));
    expect((await r.send(U, body())).json.error).toBe("try_later");
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "17/0" });
  });
  it("any other Graph error keeps today's behaviour: row failed, counts toward the cap", async () => {
    const store = makeStore([order()]);
    const r = mk(store, graphErr(10));
    expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "send_failed", code: 10, fb_code: "10/0" } });
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10/0" });
    await r.send(U, body());
    expect((await r.send(U, body())).json).toEqual({ ok: false, error: "none_left" }); // 2 failures → used up
  });
});

describe("B3 recipient guard", () => {
  const withId = (id: string, over: Partial<Order> = {}) => order({ ...over, platform_meta: { page_id: "P1", live_video_id: "LV1", commenter_id: id } });
  it("isMixedBuyer: >1 distinct non-empty commenter_id; rows without one do not count", () => {
    expect(isMixedBuyer([withId("A"), withId("A")])).toBe(false);
    expect(isMixedBuyer([withId("A"), order()])).toBe(false);
    expect(isMixedBuyer([withId("A"), withId(" ")])).toBe(false);
    expect(isMixedBuyer([withId("A"), withId("B")])).toBe(true);
  });
  it("mixed buyer number → info canSend:false mixed_buyer; send 409 mixed_buyer, nothing claimed or sent", async () => {
    const store = makeStore([withId("A", { comment_msg_id: "c1" }), withId("B", { comment_msg_id: "c2" })]);
    const f = graphOk();
    const r = mk(store, f);
    expect((await r.info(U, body())).json).toMatchObject({ ok: true, canSend: false, reason: "mixed_buyer" });
    expect(await r.send(U, body())).toEqual({ status: 409, json: { ok: false, error: "mixed_buyer" } });
    expect(store.insertReceipt).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
  it("one commenter + older rows without commenter_id → sendable as today", async () => {
    const store = makeStore([withId("A", { comment_msg_id: "c1" }), order({ comment_msg_id: "c0" })]);
    const r = mk(store);
    expect((await r.info(U, body())).json).toMatchObject({ canSend: true, remaining: 2 });
    expect((await r.send(U, body())).status).toBe(200);
  });
  it("handle 'unknown' (any case) or empty → never a candidate", async () => {
    const rows = [order({ comment_msg_id: "u1", handle: "Unknown" }), order({ comment_msg_id: "u2", handle: "  " }), order({ comment_msg_id: "u3", handle: "UNKNOWN" })];
    expect(pickReceiptCandidates(rows, [])).toEqual([]);
    const store = makeStore(rows);
    const f = graphOk();
    const r = mk(store, f);
    expect((await r.info(U, body())).json).toMatchObject({ canSend: false, reason: "none_left" });
    expect(await r.send(U, body())).toEqual({ status: 409, json: { ok: false, error: "none_left" } });
    expect(f).not.toHaveBeenCalled();
  });
});
