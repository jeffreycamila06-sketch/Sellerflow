// Messenger receipt + Facebook error 10 / 2018300 ("another app is controlling this thread now").
//  A. LOG ONLY: after that failure the server asks who holds the buyer's conversation and logs
//     app ids + counts — the send's answer and the saved row are the same with the read on, off,
//     broken or slow; nothing private is logged; no other error starts the read.
//  C. 2026-11-25: production answered "owner=shape" 16 times. The parser reads Meta's Conversation Routing
//     answers (app id / held by an app Meta does not name / empty), records who=<app id> + who_is, and for
//     every answer without an app id the SHAPE — key names and value types, never a value.
//  B. FIX: a 10/2018300 failure does not use up the comment (rows of that kind saved earlier
//     count for nothing either); every other failure still counts toward RECEIPT_MAX_FAILS.
import { describe, it, expect, vi } from "vitest";
import {
  createFbReceipt, pickReceiptCandidates, RECEIPT_MAX_FAILS, RECEIPT_THREAD_OWNED, RECEIPT_NO_FAULT_ERRORS, RECEIPT_ERROR_DETAIL_MAX, RECEIPT_RETRYABLE_CODES,
} from "../../../../server/fbReceipt.js";
import {
  parseThreadOwner, parseConversation, safeKeyNames, ownerWhoIs, ownerNote, ownerRowDetail, ownerLogLine, makeOwnerReadGate, isBuyerId, readThreadOwner, answerShape,
  FB_PAGE_INBOX_APP_ID, OWNER_READ_MAX_PER_HOUR, OWNER_ROW_DETAIL_MAX, OWNER_SHAPE_MAX,
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
    expect(logs).toContain(`[FB] receipt owner user=${U.slice(0, 8)} page=P1 owner=app who=${FB_PAGE_INBOX_APP_ID} who_is=inbox owner_http=200 owner_err=- conv=1 conv_age_min=12 conv_http=200 conv_err=- keys=- ms=0`);
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10/2018300", error_detail: `${OWNED_TEXT} | owner=app who=${FB_PAGE_INBOX_APP_ID} who_is=inbox owner_err=- conv=1 conv_age_min=12 conv_err=-` });
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
    expect(await lineOf({ owner: "throw", conv: "throw" })).toContain("owner=err who=- who_is=- owner_http=0 owner_err=- conv=err conv_age_min=- conv_http=0 conv_err=-");
    expect(await lineOf({ owner: { status: 400, body: { error: { code: 200, error_subcode: 2018108, message: "needs a permission" } } } })).toContain("owner=err who=- who_is=- owner_http=400 owner_err=200/2018108 conv=1");
    expect(await lineOf({ conv: { status: 400, body: { error: { code: 100, message: "(#100) Tried accessing nonexisting field" } } } })).toContain("conv=err conv_age_min=- conv_http=400 conv_err=100/0");
    expect(await lineOf({ owner: { status: 200, body: { data: [] } }, conv: { status: 200, body: { data: [] } } })).toContain("owner=none who=- who_is=- owner_http=200 owner_err=- conv=0 conv_age_min=-");
    const odd = await lineOf({ owner: { status: 200, body: { data: [{ thread_owner: { expiration_timestamp: 1790000000, app99: "x" } }] } } });
    expect(odd).toContain("owner=shape who=- who_is=-");
    expect(odd.endsWith(" shape=data[0]{thread_owner{expiration_timestamp:num,?:str}}")).toBe(true);
    expect(await lineOf({ owner: { status: 200, body: { data: [{ thread_owner: { app_id: "987654321" } }] } } })).toContain("owner=app who=987654321 who_is=other");
    expect(await lineOf({ owner: { status: 200, body: { data: [{ thread_owner: { app_id: CONFIG.appId } }] } } })).toContain(`owner=app who=${CONFIG.appId} who_is=us`);
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
      expect(logs.find((l) => l.startsWith("[FB] receipt owner"))).toContain("owner=err who=- who_is=- owner_http=0");
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
    expect(parseThreadOwner({ data: [{ thread_owner: { app_id: 263902037430900 } }] })).toEqual({ owner: "app", who: "263902037430900", err: "", keys: "", shape: "" });
    expect(parseThreadOwner({ data: [{ thread_owner: { app_id: "x<script>" } }] })).toEqual({ owner: "shape", who: "", err: "", keys: "", shape: "data[0]{thread_owner{app_id:str}}" });
    expect(parseThreadOwner(null)).toEqual({ owner: "shape", who: "", err: "", keys: "", shape: "null" });
    expect(parseConversation({ data: [{ updated_time: "bad" }] }, NOW)).toEqual({ conv: "1", ageMin: "-", err: "", keys: "updated_time" });
    expect(parseConversation({ data: [{ updated_time: "2026-11-25T00:00:00Z" }] }, NOW).ageMin).toBe("0"); // a clock ahead of ours is never negative
    expect(safeKeyNames({ "name 123": 1, "a<b>": 2, ok_key: 3, "9": 4 })).toBe("name,ab,ok_key");
    for (const notAnId of ["-", "", "none", "hidden", "12", "1234x", null, undefined]) expect(ownerWhoIs(notAnId as never, "1234")).toBe("-");
    const r = { owner: "app", who: "1234", shape: "-", ownerHttp: 200, ownerErr: "-", conv: "0", convAgeMin: "-", convHttp: 200, convErr: "-", keys: "-", ms: 5 };
    expect(ownerNote(r, "1234")).toBe("owner=app who=1234 who_is=us owner_err=- conv=0 conv_age_min=- conv_err=-");
    expect(ownerLogLine(U, "P9", r, "2222")).toBe(`[FB] receipt owner user=${U.slice(0, 8)} page=P9 owner=app who=1234 who_is=other owner_http=200 owner_err=- conv=0 conv_age_min=- conv_http=200 conv_err=- keys=- ms=5`);
  });

  it("the note always fits the error text limit, whatever Facebook wrote", async () => {
    const store = makeStore();
    const { r } = rt(store, fakeFacebook({ send: { ...OWNED, message: "x".repeat(900) } }));
    await r.send(U, body());
    await r._ownerReadDone();
    const d = String(store.rows[0].error_detail);
    expect(d.length).toBeLessThanOrEqual(OWNER_ROW_DETAIL_MAX);
    expect(d.startsWith("x".repeat(RECEIPT_ERROR_DETAIL_MAX - 20))).toBe(true);        // Facebook's own words come first
    expect(d).toContain(` | owner=app who=${FB_PAGE_INBOX_APP_ID} who_is=inbox`);
  });

  it("readThreadOwner never throws, whatever fetch does", async () => {
    for (const fetchImpl of [async () => { throw new Error("x"); }, async () => ({ status: 200, json: async () => { throw new Error("bad json"); } }), async () => null]) {
      const out = await readThreadOwner({ fetchImpl: fetchImpl as never, pageId: "P1", buyerId: BUYER, pageToken: TOKEN, now: () => NOW });
      expect(out.owner === "err" || out.owner === "shape").toBe(true);
    }
  });
});

describe("C. what /thread_owner answered: the app id, or the answer's shape — never a value", () => {
  const run = async (owner: unknown, conv?: Reply) => {
    const store = makeStore();
    const { r, logs } = rt(store, fakeFacebook({ owner: { status: 200, body: owner }, ...(conv ? { conv } : {}) }));
    expect(await r.send(U, body())).toEqual(FAILED_ANSWER);
    await r._ownerReadDone();
    return { line: logs.find((l) => l.startsWith("[FB] receipt owner"))!, detail: String(store.rows[0].error_detail), store, logs };
  };

  it("the documented answer → who=<app id> and who_is: us · inbox · other (log line AND saved row)", async () => {
    for (const [appId, whoIs] of [[CONFIG.appId, "us"], [FB_PAGE_INBOX_APP_ID, "inbox"], ["1217981644879628", "other"]] as const) {
      for (const answer of [
        { data: [{ thread_owner: { app_id: appId } }] },                                   // Handover Protocol reference
        { data: [{ thread_owner: { app_id: appId, expiration: 1795000000 } }] },           // Conversation Routing: owner / default app
        { data: [{ thread_owner: { app_id: Number(appId) } }] },                           // the id as a number
        { thread_owner: { app_id: appId } },                                               // a bare object (not documented; read the same way)
      ]) {
        const { line, detail } = await run(answer);
        expect(line, JSON.stringify(answer)).toContain(` owner=app who=${appId} who_is=${whoIs} owner_http=200 owner_err=- `);
        expect(detail).toBe(`${OWNED_TEXT} | owner=app who=${appId} who_is=${whoIs} owner_err=- conv=1 conv_age_min=12 conv_err=-`);
        expect(`${line}${detail}`).not.toContain("shape=");                                 // an app id was read: nothing else is kept
        expect(`${line}${detail}`).not.toContain("1795000000");
      }
    }
  });

  it("Conversation Routing, held by another app: an expiration and no app id → owner=hidden + the shape, never the expiration itself", async () => {
    const { line, detail } = await run({ data: [{ thread_owner: { expiration: 1795000123 } }] });
    expect(line).toContain(" owner=hidden who=- who_is=- owner_http=200 owner_err=- ");
    expect(line.endsWith(" shape=data[0]{thread_owner{expiration:num}}")).toBe(true);
    expect(detail).toBe(`${OWNED_TEXT} | owner=hidden who=- who_is=- owner_err=- conv=1 conv_age_min=12 conv_err=- shape=data[0]{thread_owner{expiration:num}}`);
    expect(`${line}${detail}`).not.toContain("1795000123");
  });

  it("an empty answer, in the forms it may take → owner=none + the shape", async () => {
    for (const [answer, shape] of [[{ data: [] }, "data[]"], [{ data: [{}] }, "data[0]{}"], [{ data: [{ thread_owner: {} }] }, "data[0]{thread_owner{}}"]] as const) {
      const { line, detail } = await run(answer);
      expect(line, shape).toContain(" owner=none who=- who_is=- ");
      expect(detail.endsWith(` shape=${shape}`), shape).toBe(true);
    }
  });

  it("an answer nobody expected → owner=shape + its key names and value types to 3 levels (Jeff's example format)", () => {
    expect(answerShape({ data: [{ thread_owner: { app_id: "1" } }] })).toBe("data[0]{thread_owner{app_id:str}}");
    expect(answerShape({ data: [{ thread_owner: { app: { id: "1", name: "x" } } }] })).toBe("data[0]{thread_owner{app:obj}}");                 // the 4th level is only "obj"
    expect(answerShape({ data: [{ a: { b: { c: 1 } }, tags: ["x"], n: null, ok: true, list: [[1]] }], paging: { cursors: { before: "A", after: "B" } } }))
      .toBe("data[0]{a{b:obj},tags[0]:str,n:null,ok:bool,list[0]:arr},paging{cursors{before:str,after:str}}");
    expect(answerShape({})).toBe("{}");
    expect(answerShape([])).toBe("[]");
    expect(answerShape([{ id: 1 }])).toBe("[0]{id:num}");
    for (const [v, word] of [[null, "null"], [undefined, "other"], ["text", "str"], [7, "num"], [false, "bool"]] as const) expect(answerShape(v)).toBe(word);
    // only a key shaped like a Graph field name is a name; anything else is data and is written "?"
    expect(answerShape({ ok_name: 1, Name: 1, "two words": 1, "1234567890": 1, "t_123": 1, "a.b": 1, "user@x.com": 1, [`a${"b".repeat(24)}`]: 1, "": 1 }))
      .toBe("?:num,ok_name:num,?:num,?:num,?:num,?:num,?:num,?:num,?:num");
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${String.fromCharCode(97 + i)}`, i]));
    expect(answerShape(many).endsWith(",+8")).toBe(true);                                                                                       // 12 names, then how many more
    const huge = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${"key_name_".repeat(2)}${String.fromCharCode(97 + i)}`, { inner_key: { deeper: "v" } }]));
    expect(answerShape(huge).length).toBe(OWNER_SHAPE_MAX);                                                                                     // never longer than 200
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(() => answerShape(circular)).not.toThrow();                                                                                          // depth-limited: a loop cannot hang it
  });

  it("NO VALUE LEAKS: an answer stuffed with private values — as values AND as key names — leaves only key letters and type words", async () => {
    const PSID = "24681357902468", NAME = "Secret Buyer", TEXT = "hello from the buyer", CONV = "t_10203040506070809", LINK = "https://graph.facebook.com/v19.0/abc", APP_SECRET = "s3cr3t-Value";
    const stuffed = {
      data: [{
        thread_owner: { psid: PSID, name: NAME, last_message: TEXT, conversation: CONV, link: LINK, expires: 1795000456, nested: { token: TOKEN, deep: { deeper: APP_SECRET } } },
        [PSID]: { [CONV]: TEXT },                 // an id used as a key name
        [`user ${NAME}`]: NAME,                   // a name inside a key name: only its letters can stay
        participants: [{ id: PSID, name: NAME, email: "buyer@example.com" }],
        numbers: [1795000456, 42],
      }],
      [TOKEN]: true,
      paging: { next: LINK, cursors: { before: "QVFIUk1", after: "QVFIUk2" } },
    };
    const { line, detail, logs } = await run(stuffed, { status: 200, body: { data: [{ id: CONV, updated_time: "2026-11-24T13:18:00+0000", snippet: TEXT, participants: { data: [{ name: NAME, id: PSID }] } }] } });
    expect(line).toContain(" owner=shape who=- who_is=- ");
    const shape = /shape=(\S+)$/.exec(line)![1];
    expect(detail.endsWith(` shape=${shape}`)).toBe(true);
    expect(shape.length).toBeLessThanOrEqual(OWNER_SHAPE_MAX);
    // only key letters, the type words and the punctuation of the format; digits only as "[0]" and "+N"
    expect(shape).toMatch(/^[A-Za-z_[\]{}:,+?0-9]+$/);
    expect(shape.replace(/\[0\]/g, "").replace(/\+\d+/g, "")).not.toMatch(/\d/);
    const everything = `${logs.join("\n")}\n${detail}`;
    for (const secret of [PSID, NAME, "Secret", TEXT, "hello", CONV, "10203040506070809", LINK, "graph.facebook.com", APP_SECRET, TOKEN, "1795000456", "buyer@example.com", "QVFIUk1", "TRACE123", "access_token", "PAGE-", "Buyer", "userSecret"]) {
      expect(everything, secret).not.toContain(secret);
    }
    // the whole answer's shape (not cut): the three keys that were data — an id, a name, the token — are each a "?",
    // and every ":" is followed by a type word only
    const whole = answerShape(stuffed, 5000);
    expect(whole).toBe("data[0]{thread_owner{psid:str,name:str,last_message:str,conversation:str,link:str,expires:num,nested:obj},?{?:str},?:str,participants[0]{id:str,name:str,email:str},numbers[0]:num},?:bool,paging{next:str,cursors{before:str,after:str}}");
    expect(whole.match(/\?/g)).toHaveLength(4);
    for (const m of whole.matchAll(/:([A-Za-z_]+)/g)) expect(["str", "num", "bool", "null", "obj", "arr", "other"]).toContain(m[1]);
    expect(whole.startsWith(shape)).toBe(true);                         // what is recorded = its first 200 characters
  });

  it("random answers: whatever the values are, the recorded shape is the same as for other values of the same types", () => {
    let seed = 20261125;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const KEYS = ["data", "thread_owner", "app_id", "expiration", "id", "name", "owner", "metadata", "paging", "next"];
    const build = (depth: number, fill: (kind: "s" | "n") => unknown): unknown => {
      const x = rnd();
      if (depth <= 0 || x < 0.25) return x < 0.1 ? fill("n") : x < 0.2 ? fill("s") : x < 0.23 ? null : true;
      if (x < 0.45) return Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => build(depth - 1, fill));
      return Object.fromEntries(Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => [KEYS[Math.floor(rnd() * KEYS.length)], build(depth - 1, fill)]));
    };
    for (let i = 0; i < 300; i++) {
      const start = seed;
      const a = build(5, (k) => (k === "s" ? `VALUE_${i}_SECRET` : 900000000 + i));
      seed = start;
      const b = build(5, (k) => (k === "s" ? "zzz" : 1));
      const shape = answerShape(a);
      expect(shape).toBe(answerShape(b));                                 // the values changed, the shape did not
      expect(shape).not.toContain("VALUE_");
      expect(shape).not.toContain("SECRET");
      expect(shape.replace(/\[0\]/g, "").replace(/\+\d+/g, "")).not.toMatch(/\d/);
      expect(shape.length).toBeLessThanOrEqual(OWNER_SHAPE_MAX);
    }
  });

  it("a Graph error is owner=err with its code, as before — and no shape", async () => {
    const store = makeStore();
    const { r, logs } = rt(store, fakeFacebook({ owner: { status: 400, body: { error: { code: 200, error_subcode: 2018108, message: "(#200) needs pages_messaging", type: "OAuthException", fbtrace_id: "TRACE999" } } } }));
    await r.send(U, body());
    await r._ownerReadDone();
    const line = logs.find((l) => l.startsWith("[FB] receipt owner"))!;
    expect(line).toContain(" owner=err who=- who_is=- owner_http=400 owner_err=200/2018108 ");
    expect(line).not.toContain("shape=");
    expect(String(store.rows[0].error_detail)).toBe(`${OWNED_TEXT} | owner=err who=- who_is=- owner_err=200/2018108 conv=1 conv_age_min=12 conv_err=-`);
    expect(`${line}${store.rows[0].error_detail}`).not.toMatch(/TRACE999|pages_messaging/);
  });

  it("the saved row: Facebook's own words stay whole, the note follows, and it is never longer than its limit", () => {
    const r = { owner: "shape", who: "-", shape: "s".repeat(OWNER_SHAPE_MAX), ownerHttp: 200, ownerErr: "-", conv: "1", convAgeMin: "301", convHttp: 200, convErr: "-", keys: "-", ms: 1 };
    const text = ownerRowDetail(OWNED_TEXT, r, CONFIG.appId);
    expect(text.startsWith(`${OWNED_TEXT} | owner=shape who=- who_is=- `)).toBe(true);
    expect(text.endsWith(` shape=${"s".repeat(OWNER_SHAPE_MAX)}`)).toBe(true);
    const long = ownerRowDetail("w".repeat(RECEIPT_ERROR_DETAIL_MAX), r, CONFIG.appId);
    expect(long.length).toBeLessThanOrEqual(OWNER_ROW_DETAIL_MAX);
    expect(long.endsWith(` shape=${"s".repeat(OWNER_SHAPE_MAX)}`)).toBe(true);           // the words give way, never the note
    expect(ownerRowDetail(null as never, r, CONFIG.appId).startsWith(" | owner=shape")).toBe(true);
  });

  it("switch off → no read at all, nothing added to the row (every answer shape)", async () => {
    for (const owner of [{ data: [{ thread_owner: { expiration: 1 } }] }, { odd: 1 }, { data: [{ thread_owner: { app_id: "1234567" } }] }]) {
      const store = withSwitch(makeStore(), false);
      const fb = fakeFacebook({ owner: { status: 200, body: owner } });
      const { r, logs } = rt(store, fb);
      expect(await r.send(U, body())).toEqual(FAILED_ANSWER);
      await r._ownerReadDone();
      expect(fb.reads()).toHaveLength(0);
      expect(logs.filter((l) => l.includes("receipt owner"))).toEqual([]);
      expect(store.rows[0].error_detail).toBe(OWNED_TEXT);
    }
  });

  it("the read still never delays or changes the send: the answer is given while the read hangs, whatever shape comes later", async () => {
    vi.useFakeTimers();
    try {
      const store = makeStore();
      const { r } = rt(store, fakeFacebook({ owner: "hang" }));
      expect(await r.send(U, body())).toEqual(FAILED_ANSWER);
      expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10/2018300", error_detail: OWNED_TEXT });
      await vi.advanceTimersByTimeAsync(6100);
      await r._ownerReadDone();
      expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10/2018300" });
    } finally { vi.useRealTimers(); }
  });
});

describe("D. error 10900/0 \"Activity already replied to\" is recorded like every other refusal, and handled as before", () => {
  const REPLIED = { message: "(#10900) Activity already replied to", type: "OAuthException", code: 10900, fbtrace_id: "TRACE10900" };
  it("the row keeps the code/subcode, Facebook's message and its error type — no trace id; no owner read; the comment counts as failed", async () => {
    const store = makeStore();
    const fb = fakeFacebook({ send: REPLIED });
    const { r, logs } = rt(store, fb);
    expect(await r.send(U, body())).toEqual({ status: 502, json: { ok: false, error: "send_failed", code: 10900, fb_code: "10900/0" } });
    await r._ownerReadDone();
    expect(store.rows[0]).toMatchObject({ status: "failed", error_code: "10900/0", error_detail: "(#10900) Activity already replied to | OAuthException" });
    expect(logs).toContain(`[FB] receipt user=${U.slice(0, 8)} page=P1 result=failed code=10900/0 detail=(#10900) Activity already replied to | OAuthException`);
    expect(`${logs.join("\n")}${store.rows[0].error_detail}`).not.toContain("TRACE10900");
    expect(fb.reads()).toHaveLength(0);                                                    // not a thread-owner case: nothing is asked
    expect((store.ownerReadEnabled as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
    expect(RECEIPT_NO_FAULT_ERRORS.has("10900/0")).toBe(false);                            // handled as before: it counts
    expect(RECEIPT_RETRYABLE_CODES.has(10900)).toBe(false);
  });
  it("a subcode, when Facebook sends one, is kept in the code", async () => {
    const store = makeStore();
    const { r } = rt(store, fakeFacebook({ send: { ...REPLIED, error_subcode: 2018999, error_user_title: "Already replied", error_user_msg: "You already replied to this comment." } }));
    await r.send(U, body());
    expect(store.rows[0]).toMatchObject({ error_code: "10900/2018999", error_detail: "(#10900) Activity already replied to | OAuthException | Already replied | You already replied to this comment." });
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
