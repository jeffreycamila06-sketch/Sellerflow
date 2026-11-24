// Messenger receipt + Facebook error 10 / 2018300 ("another app is controlling this thread now").
//  A. LOG ONLY: after that failure the server asks who holds the buyer's conversation and logs
//     app ids + counts — the send's answer and the saved row are the same with the read on, off,
//     broken or slow; nothing private is logged; no other error starts the read.
//  B. FIX: a 10/2018300 failure does not use up the comment (rows of that kind saved earlier
//     count for nothing either); every other failure still counts toward RECEIPT_MAX_FAILS.
import { describe, it, expect, vi } from "vitest";
import {
  createFbReceipt, pickReceiptCandidates, RECEIPT_MAX_FAILS, RECEIPT_THREAD_OWNED, RECEIPT_NO_FAULT_ERRORS, RECEIPT_ERROR_DETAIL_MAX, RECEIPT_RETRYABLE_CODES,
} from "../../../../server/fbReceipt.js";
import {
  parseThreadOwner, parseConversation, safeKeyNames, ownerWho, ownerNote, ownerLogLine, makeOwnerReadGate, isBuyerId, readThreadOwner,
  FB_PAGE_INBOX_APP_ID, OWNER_READ_MAX_PER_HOUR,
} from "../../../../server/fbThreadOwner.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "555000111", appSecret: "sekret", tokenKey: "tk" };
const NOW = Date.parse("2026-11-24T13:30:00Z");
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const TOKEN = "PAGE-TOKEN-SECRET";
const BUYER = "24681357902468";                       // the commenter id saved with the order
const PNG_B64 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString("base64");
const OWNED = { message: "(#10) Message failed to send because another app is controlling this thread now.", type: "OAuthException", code: 10, error_subcode: 2018300, fbtrace_id: "TRACE123" };
const OWNED_TEXT = "(#10) Message failed to send because another app is controlling this thread now. | OAuthException";
const PRIVATE = [TOKEN, BUYER, "Secret Buyer", "secret.buyer", "TRACE123", "access_token", "graph.facebook.com", "hello from the buyer"];

type Row = { id: number; [k: string]: unknown };
type Order = { comment_msg_id: string; platform_meta: Record<string, unknown>; handle: string; created_at: string };
const order = (commentId: string, meta: Record<string, unknown> = { commenter_id: BUYER }, at = "2026-11-24T12:00:00Z"): Order =>
  ({ comment_msg_id: commentId, platform_meta: { page_id: "P1", live_video_id: "LV1", ...meta }, handle: "Secret Buyer", created_at: at });

function makeStore(orders: Order[] = [order("701_1")], sw: unknown = true) {
  const rows: Row[] = [];
  const store = {
    rows,
    ownerReadEnabled: vi.fn(async () => sw) as unknown as (() => Promise<unknown>) | undefined, // the switch (app_settings.fb_receipt_owner_read_enabled)
    hasReceiptAccess: async () => true,
    listReceiptOrders: async () => orders,
    listReceiptRows: async (ids: string[]) => rows.filter((r) => ids.includes(String(r.comment_id))),
    insertReceipt: async (row: Record<string, unknown>) => { const r = { ...row, id: 100 + rows.length }; rows.push(r); return { id: r.id }; },
    updateReceipt: vi.fn(async (id: number, patch: Record<string, unknown>) => { Object.assign(rows.find((r) => r.id === id)!, patch); return {}; }),
    deleteReceipt: async (id: number) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1); return true; },
    uploadReceiptImage: async (path: string) => `https://cdn.test/storage/v1/object/public/fb-receipts/${path}`,
    getPage: async () => ({ user_id: U, page_id: "P1", active: true, can_message: true, access_token: encryptToken(TOKEN, CONFIG.tokenKey) }),
    setActive: vi.fn(),
  };
  return store;
}

// The switch as the store answers it: a value, "throw" (the settings read fails) or "absent" (no reader).
function withSwitch(store: ReturnType<typeof makeStore>, sw: unknown) {
  if (sw === "absent") store.ownerReadEnabled = undefined;
  else if (sw === "throw") store.ownerReadEnabled = vi.fn(async () => { throw new Error("settings read failed"); });
  else store.ownerReadEnabled = vi.fn(async () => (sw === "undefined" ? undefined : sw));
  return store;
}

// A fake Facebook: the send (POST …/messages) answers `send`; the two reads answer what the test gives.
type Reply = { status: number; body: unknown } | "throw" | "hang";
function fakeFacebook(o: { send?: Record<string, unknown>; owner?: Reply; conv?: Reply } = {}) {
  const calls: { method: string; url: string }[] = [];
  const reply = (r: Reply | undefined, fallback: Reply, init?: { signal?: AbortSignal }) => {
    const x = r ?? fallback;
    if (x === "throw") return Promise.reject(new Error("socket hang up"));
    if (x === "hang") return new Promise((_, rej) => { init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))); });
    return Promise.resolve({ status: x.status, json: async () => x.body });
  };
  const fetchImpl = vi.fn(async (url: string, init?: { method?: string; signal?: AbortSignal }) => {
    calls.push({ method: String(init?.method || "GET"), url: String(url) });
    if (url.includes("/messages?")) return { status: 400, json: async () => ({ error: o.send ?? OWNED }) };
    if (url.includes("/thread_owner?")) return reply(o.owner, { status: 200, body: { data: [{ thread_owner: { app_id: FB_PAGE_INBOX_APP_ID } }] } }, init);
    if (url.includes("/conversations?")) return reply(o.conv, { status: 200, body: { data: [{ id: "t_1", updated_time: "2026-11-24T13:18:00+0000", snippet: "hello from the buyer" }] } }, init);
    return { status: 404, json: async () => ({}) };
  });
  return { fetchImpl, calls, reads: () => calls.filter((c) => c.method === "GET") };
}
function rt(store: ReturnType<typeof makeStore>, fb: ReturnType<typeof fakeFacebook>, extra: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const r = createFbReceipt({ config: CONFIG, store, fetchImpl: fb.fetchImpl, now: () => NOW, log: (l: string) => logs.push(l), randomHex: () => "f".repeat(64), ...extra });
  return { r, logs };
}
const body = () => ({ sessionId: S, buyerNumber: 3, imagePngBase64: PNG_B64 });
const FAILED_ANSWER = { status: 502, json: { ok: false, error: "send_failed", code: 10, fb_code: "10/2018300" } };

describe("A. who holds the conversation — log only", () => {
  it("after a 10/2018300 failure: two read-only questions about THAT buyer, one log line, the note next to the failed row", async () => {
    const store = makeStore();
    const fb = fakeFacebook();
    const { r, logs } = rt(store, fb);
    expect(await r.send(U, body())).toEqual(FAILED_ANSWER);
    await r._ownerReadDone();
    const reads = fb.reads();
    expect(reads).toHaveLength(2);
    const [a, b] = [reads.find((c) => c.url.includes("/thread_owner?"))!, reads.find((c) => c.url.includes("/conversations?"))!];
    expect(new URL(a.url).pathname).toMatch(/^\/v\d+\.\d+\/P1\/thread_owner$/);
    expect(new URL(a.url).searchParams.get("recipient")).toBe(BUYER);
    expect(new URL(b.url).pathname).toMatch(/^\/v\d+\.\d+\/P1\/conversations$/);
    expect(Object.fromEntries([...new URL(b.url).searchParams].filter(([k]) => !["access_token", "appsecret_proof"].includes(k)))).toEqual({ platform: "messenger", user_id: BUYER, fields: "id,updated_time" });
    for (const c of reads) expect(new URL(c.url).searchParams.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/); // signed like every other Facebook call
    expect(fb.calls.filter((c) => c.method === "POST")).toHaveLength(1);                                         // the send itself: once, never repeated
    expect(logs).toContain(`[FB] receipt owner user=${U.slice(0, 8)} page=P1 owner=${FB_PAGE_INBOX_APP_ID} who=inbox owner_http=200 owner_err=- conv=1 conv_age_min=12 conv_http=200 conv_err=- keys=- ms=0`);
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10/2018300", error_detail: `${OWNED_TEXT} | owner=${FB_PAGE_INBOX_APP_ID} who=inbox owner_err=- conv=1 conv_age_min=12 conv_err=-` });
  });

  it("nothing private in the log or in the saved note: no buyer id, name, message text, token, link", async () => {
    const store = makeStore();
    const { r, logs } = rt(store, fakeFacebook());
    await r.send(U, body());
    await r._ownerReadDone();
    const all = `${logs.join("\n")}\n${String(store.rows[0].error_detail)}`;
    for (const bad of PRIVATE) expect(all, bad).not.toContain(bad);
  });

  it("the send's answer and the row a seller's next tap sees are the same with the read on, off, broken, slow or of another shape", async () => {
    const cases: Record<string, { fb: Parameters<typeof fakeFacebook>[0]; sw?: unknown }> = {
      off: { fb: {}, sw: false },
      "switch row missing": { fb: {}, sw: null },
      "switch read fails": { fb: {}, sw: "throw" },
      "no switch reader at all": { fb: {}, sw: "absent" },
      on: { fb: {} },
      "both reads throw": { fb: { owner: "throw", conv: "throw" } },
      "Facebook refuses both": { fb: { owner: { status: 400, body: { error: { code: 200, error_subcode: 0, message: "(#200) Requires pages_manage_metadata" } } }, conv: { status: 403, body: { error: { code: 10, error_subcode: 0 } } } } },
      "another shape": { fb: { owner: { status: 200, body: { thread: { owner: 1 }, paging99: {} } }, conv: { status: 200, body: "not json" } } },
      "empty answers": { fb: { owner: { status: 200, body: { data: [] } }, conv: { status: 200, body: { data: [] } } } },
    };
    const seen: string[] = [];
    for (const [name, c] of Object.entries(cases)) {
      const store = withSwitch(makeStore(), "sw" in c ? c.sw : true);
      const { r } = rt(store, fakeFacebook(c.fb));
      const answer = await r.send(U, body());
      const atAnswer = JSON.stringify({ answer, row: { status: store.rows[0].status, error_code: store.rows[0].error_code, image_path: store.rows[0].image_path, error_detail: store.rows[0].error_detail }, rows: store.rows.length });
      await r._ownerReadDone();
      const info = await r.info(U, body());
      seen.push(JSON.stringify({ atAnswer, info, status: store.rows[0].status, error_code: store.rows[0].error_code }));
      expect(answer, name).toEqual(FAILED_ANSWER);
    }
    expect(new Set(seen).size).toBe(1);
  });

  it("a read that fails is logged with what happened (never silently dropped)", async () => {
    const lineOf = async (fb: Parameters<typeof fakeFacebook>[0]) => {
      const store = makeStore();
      const { r, logs } = rt(store, fakeFacebook(fb));
      await r.send(U, body());
      await r._ownerReadDone();
      return logs.find((l) => l.startsWith("[FB] receipt owner"))!;
    };
    expect(await lineOf({ owner: "throw", conv: "throw" })).toContain("owner=err who=- owner_http=0 owner_err=- conv=err conv_age_min=- conv_http=0 conv_err=-");
    expect(await lineOf({ owner: { status: 400, body: { error: { code: 200, error_subcode: 2018108, message: "needs a permission" } } } })).toContain("owner=err who=- owner_http=400 owner_err=200/2018108 conv=1");
    expect(await lineOf({ conv: { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field" } } } })).toContain("conv=err conv_age_min=- conv_http=400 conv_err=100/0");
    expect(await lineOf({ owner: { status: 200, body: { data: [] } }, conv: { status: 200, body: { data: [] } } })).toContain("owner=none who=- owner_http=200 owner_err=- conv=0 conv_age_min=-");
    expect(await lineOf({ owner: { status: 200, body: { data: [{ thread_owner: { expiration_timestamp: 1790000000, app99: "x" } }] } } })).toContain("owner=shape who=-");
    expect(await lineOf({ owner: { status: 200, body: { data: [{ thread_owner: { expiration_timestamp: 1790000000 } }] } } })).toContain("keys=expiration_timestamp");
    expect(await lineOf({ owner: { status: 200, body: { data: [{ thread_owner: { app_id: "987654321" } }] } } })).toContain("owner=987654321 who=other");
    expect(await lineOf({ owner: { status: 200, body: { data: [{ thread_owner: { app_id: CONFIG.appId } }] } } })).toContain(`owner=${CONFIG.appId} who=ours`);
  });

  it("a read that never answers is given up after its time limit and the send's answer did not wait for it", async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      const { r, logs } = rt(store, fakeFacebook({ owner: "hang", conv: "hang" }));
      expect(await r.send(U, body())).toEqual(FAILED_ANSWER);          // answered while both reads hang
      expect(logs.some((l) => l.startsWith("[FB] receipt owner"))).toBe(false);
      await vi.advanceTimersByTimeAsync(6100);
      await r._ownerReadDone();
      expect(logs.find((l) => l.startsWith("[FB] receipt owner"))).toContain("owner=err who=- owner_http=0");
    } finally { vi.useRealTimers(); }
  });

  it("the note write failing changes nothing (row stays as the send left it)", async () => {
    const store = makeStore();
    const base = store.updateReceipt.getMockImplementation()!;
    store.updateReceipt.mockImplementation(async (id: number, patch: Record<string, unknown>) => {
      if (Object.keys(patch).join() === "error_detail") throw new Error("db down");
      return base(id, patch);
    });
    const { r } = rt(store, fakeFacebook());
    expect(await r.send(U, body())).toEqual(FAILED_ANSWER);
    await expect(r._ownerReadDone()).resolves.toBeUndefined();
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10/2018300", error_detail: OWNED_TEXT });
  });

  it("no read at all: switch off · another error code · a sent receipt · an order without a usable buyer id", async () => {
    const noReads = async (fbOpts: Parameters<typeof fakeFacebook>[0], sw: unknown = true, orders?: Order[]) => {
      const store = withSwitch(makeStore(orders), sw);
      const fb = fakeFacebook(fbOpts);
      const { r, logs } = rt(store, fb);
      await r.send(U, body());
      await r._ownerReadDone();
      expect(fb.reads()).toHaveLength(0);
      return logs;
    };
    // the switch: only the exact answer `true` turns the read on
    for (const sw of [false, null, "undefined", "true", "false", 1, 0, "", {}, "throw", "absent"]) {
      const logs = await noReads({}, sw);
      expect(logs.filter((l) => l.includes("receipt owner")), String(sw)).toEqual([]);
    }
    await noReads({ send: { code: 10, error_subcode: 0, message: "x" } });
    await noReads({ send: { code: 100, error_subcode: 1893060, message: "x" } });
    await noReads({ send: { code: 10903, error_subcode: 2018300, message: "x" } });
    await noReads({ send: { code: 613, message: "x" } });
    for (const meta of [{}, { commenter_id: "" }, { commenter_id: "abc" }, { commenter_id: 24681357902468 }, { commenter_id: "12 34" }]) {
      const logs = await noReads({}, true, [order("701_1", { commenter_id: undefined, ...meta })]);
      expect(logs).toContain(`[FB] receipt owner user=${U.slice(0, 8)} page=P1 skipped=no_buyer_id`);
    }
    const store = makeStore();
    const fetchImpl = vi.fn(async () => ({ status: 200, json: async () => ({ message_id: "m1", recipient_id: BUYER }) }));
    const r = createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => NOW, log: () => {}, randomHex: () => "f".repeat(64) });
    expect((await r.send(U, body())).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("the switch is read only after a 10/2018300 failure — never for a sent receipt, another refusal, or info", async () => {
    const reads = async (send: Record<string, unknown> | "sent", step: "send" | "info" = "send") => {
      const store = makeStore();
      const fetchImpl = send === "sent" ? vi.fn(async () => ({ status: 200, json: async () => ({ message_id: "m1", recipient_id: BUYER }) })) : fakeFacebook({ send }).fetchImpl;
      const r = createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => NOW, log: () => {}, randomHex: () => "f".repeat(64) });
      await (step === "send" ? r.send(U, body()) : r.info(U, body()));
      await r._ownerReadDone();
      return (store.ownerReadEnabled as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    };
    expect(await reads(OWNED)).toBe(1);
    expect(await reads("sent")).toBe(0);
    expect(await reads(OWNED, "info")).toBe(0);
    for (const e of [{ code: 10, message: "x" }, { code: 10, error_subcode: 2018301 }, { code: 10903, error_subcode: 2018300 }, { code: 100, error_subcode: 1893060 }, { code: 613 }, { code: 190 }, { code: 551, error_subcode: 1545041 }]) {
      expect(await reads(e), JSON.stringify(e)).toBe(0);
    }
  });

  it(`at most ${OWNER_READ_MAX_PER_HOUR} reads per Page per hour`, () => {
    let t = 0;
    const allow = makeOwnerReadGate({ now: () => t });
    for (let i = 0; i < OWNER_READ_MAX_PER_HOUR; i++) expect(allow("P1")).toBe(true);
    expect(allow("P1")).toBe(false);
    expect(allow("P2")).toBe(true);
    t = 60 * 60 * 1000 + 1;
    expect(allow("P1")).toBe(true);
  });

  it("pure helpers", () => {
    expect(isBuyerId(BUYER)).toBe(true);
    for (const bad of ["", "12", "1234x678", " 123456", 123456789, null, undefined]) expect(isBuyerId(bad as never)).toBe(false);
    expect(parseThreadOwner({ data: [{ thread_owner: { app_id: 263902037430900 } }] }).owner).toBe("263902037430900");
    expect(parseThreadOwner({ data: [{ thread_owner: { app_id: "x<script>" } }] }).owner).toBe("shape");
    expect(parseThreadOwner(null)).toEqual({ owner: "shape", err: "", keys: "-" });
    expect(parseConversation({ data: [{ updated_time: "bad" }] }, NOW)).toEqual({ conv: "1", ageMin: "-", err: "", keys: "updated_time" });
    expect(parseConversation({ data: [{ updated_time: "2026-11-25T00:00:00Z" }] }, NOW).ageMin).toBe("0"); // a clock ahead of ours is never negative
    expect(safeKeyNames({ "name 123": 1, "a<b>": 2, ok_key: 3, "9": 4 })).toBe("name,ab,ok_key");
    expect(ownerWho("none", "1")).toBe("-");
    const r = { owner: "1", ownerHttp: 200, ownerErr: "-", conv: "0", convAgeMin: "-", convHttp: 200, convErr: "-", keys: "-", ms: 5 };
    expect(ownerNote(r, "1")).toBe("owner=1 who=ours owner_err=- conv=0 conv_age_min=- conv_err=-");
    expect(ownerLogLine(U, "P9", r, "2")).toBe(`[FB] receipt owner user=${U.slice(0, 8)} page=P9 owner=1 who=other owner_http=200 owner_err=- conv=0 conv_age_min=- conv_http=200 conv_err=- keys=- ms=5`);
  });

  it("the note always fits the error text limit, whatever Facebook wrote", async () => {
    const store = makeStore();
    const { r } = rt(store, fakeFacebook({ send: { ...OWNED, message: "x".repeat(900) } }));
    await r.send(U, body());
    await r._ownerReadDone();
    const d = String(store.rows[0].error_detail);
    expect(d.length).toBeLessThanOrEqual(RECEIPT_ERROR_DETAIL_MAX);
    expect(d).toContain(` | owner=${FB_PAGE_INBOX_APP_ID} who=inbox`);
  });

  it("readThreadOwner never throws, whatever fetch does", async () => {
    for (const fetchImpl of [async () => { throw new Error("x"); }, async () => ({ status: 200, json: async () => { throw new Error("bad json"); } }), async () => null]) {
      const out = await readThreadOwner({ fetchImpl: fetchImpl as never, pageId: "P1", buyerId: BUYER, pageToken: TOKEN, now: () => NOW });
      expect(out.owner === "err" || out.owner === "shape").toBe(true);
    }
  });
});

describe("B. a 10/2018300 failure does not use up the comment", () => {
  const failed = (commentId: string, code: string) => ({ user_id: U, comment_id: commentId, status: "failed", error_code: code });
  it("the rule is exactly this one error; it is not a give-back code (the row is kept)", () => {
    expect(RECEIPT_THREAD_OWNED).toBe("10/2018300");
    expect([...RECEIPT_NO_FAULT_ERRORS]).toEqual(["10/2018300"]);
    expect(RECEIPT_RETRYABLE_CODES.has(10)).toBe(false);
  });
  it("candidates: any number of such failed rows leaves the comment usable and never-failed; other failures count as before", () => {
    const orders = [order("701_1"), order("701_2", { commenter_id: BUYER }, "2026-11-24T12:05:00Z")];
    const many = Array.from({ length: 7 }, () => failed("701_1", "10/2018300"));
    expect(pickReceiptCandidates(orders, many).map((c) => [c.commentId, c.fails])).toEqual([["701_2", 0], ["701_1", 0]]);
    expect(RECEIPT_MAX_FAILS).toBe(2);
    for (const code of ["100/1893060", "10/0", "10/2018301", "10903/2018300", "upload/0", "", "2018300"]) {
      expect(pickReceiptCandidates([order("701_1")], [failed("701_1", code), failed("701_1", code)]), code).toEqual([]);
    }
    expect(pickReceiptCandidates([order("701_1")], [{ ...failed("701_1", "x"), error_code: null as never }, { ...failed("701_1", "x"), error_code: undefined as never }])).toEqual([]);
    // mixed: only the real failures are counted
    expect(pickReceiptCandidates([order("701_1")], [failed("701_1", "100/1"), ...many])[0].fails).toBe(1);
    expect(pickReceiptCandidates([order("701_1")], [failed("701_1", "100/1"), failed("701_1", "100/1"), ...many])).toEqual([]);
    // a sent / pending row still holds the comment
    expect(pickReceiptCandidates([order("701_1")], [...many, { user_id: U, comment_id: "701_1", status: "sent" }])).toEqual([]);
    expect(pickReceiptCandidates([order("701_1")], [...many, { user_id: U, comment_id: "701_1", status: "pending" }])).toEqual([]);
  });
  it("five tries in a row on one comment: each one really reaches Facebook, Send stays offered, every try is on record", async () => {
    const store = makeStore();
    const fb = fakeFacebook();
    const { r } = rt(store, fb);
    for (let i = 0; i < 5; i++) {
      expect(await r.send(U, body()), `try ${i + 1}`).toEqual(FAILED_ANSWER);
      await r._ownerReadDone();
      expect((await r.info(U, body())).json).toMatchObject({ ok: true, canSend: true, remaining: 1 });
    }
    expect(fb.calls.filter((c) => c.method === "POST")).toHaveLength(5);
    expect(store.rows.map((x) => [x.status, x.error_code])).toEqual(Array(5).fill(["failed", "10/2018300"]));
  });
  it("…and the same five tries with another refusal stop after two, as before", async () => {
    const store = makeStore();
    const fb = fakeFacebook({ send: { code: 100, error_subcode: 1893060, message: "x" } });
    const { r } = rt(store, fb);
    const out: string[] = [];
    for (let i = 0; i < 5; i++) out.push(String(((await r.send(U, body())).json as { error: string }).error));
    expect(out).toEqual(["send_failed", "send_failed", "none_left", "none_left", "none_left"]);
    expect((await r.info(U, body())).json).toMatchObject({ canSend: false, reason: "none_left" });
  });
  it("comments used up before this rule come back by themselves: two saved 10/2018300 rows → Send is offered again, and a later send goes out", async () => {
    const store = makeStore();
    store.rows.push({ id: 1, user_id: U, comment_id: "701_1", status: "failed", error_code: "10/2018300" }, { id: 2, user_id: U, comment_id: "701_1", status: "failed", error_code: "10/2018300" });
    const fetchImpl = vi.fn(async () => ({ status: 200, json: async () => ({ message_id: "m1", recipient_id: BUYER }) }));
    const r = createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => NOW, log: () => {}, randomHex: () => "f".repeat(64) });
    expect((await r.info(U, body())).json).toMatchObject({ ok: true, canSend: true, remaining: 1 });
    expect((await r.send(U, body())).json).toMatchObject({ ok: true, sentCount: 1 });
  });
});
