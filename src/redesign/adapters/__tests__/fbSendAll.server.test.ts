// @vitest-environment node
// FB-2 — Invoicing → Facebook "Send all in Messenger" (server/fbSendAll.js) with the REAL fbReceipt send
// path (lock → claim → upload → one Graph call) and the REAL rule-2 access check (server/fbReceiptAccess.js).
// Pins: who may send (the add-on, ANY plan; plan ended → no send on Send all, the Orders Send and
// /fb/access; switch off → admins only); one job per session (a second tap = the same job); one message
// per comment (the buyer lock + the database's unique comment index, also with Send all and the Orders
// Send at once and with two servers); the skip rules (sent / by hand / cancelled / every line cancelled /
// can_reply_privately false); 10 a minute; the tag mapping; the preview = the job's picture; and that
// the phone never gets a PSID, comment id, token or Facebook's words.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbReceipt } from "../../../../server/fbReceipt.js";
import { createSendAllRunner, buyerTag, parseSendAllBody, tagSendable, jobView, SEND_ALL_LABELS, SEND_ALL_RATE_MAX, SEND_ALL_TAGS } from "../../../../server/fbSendAll.js";
import { receiptAccessAllowed, makeReceiptAccess } from "../../../../server/fbReceiptAccess.js";
import { createFbAccessHandler } from "../../../../server/fbAccess.js";
import { receiptInputFromRows } from "../../../../server/receiptDraw.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import { buildT } from "../../i18n";

const CONFIG = { enabled: true, appId: "a", appSecret: "s", tokenKey: "tk" };
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const page = { user_id: U, page_id: "111", active: true, can_message: true, access_token: encryptToken("PAGETOKEN", CONFIG.tokenKey) };
type Row = Record<string, unknown>;

interface Opts { canReply?: boolean | null; graphError?: { code: number; sub?: number }; access?: boolean; switchOn?: boolean; admin?: boolean; second?: number[]; skips?: number[]; cancels?: number[]; shipping?: number; graphDelay?: number }
function world(nBuyers: number, o: Opts = {}) {
  let t = Date.parse("2026-11-26T08:00:00Z");
  const nowIso = () => new Date(t).toISOString();
  const receipts: Row[] = [];
  const rows: Row[] = [];
  for (let b = 1; b <= nBuyers; b++) {
    rows.push({ id: b * 10, session_id: S, buyer_number: b, handle: `buyer${b}`, customer_name: `Name ${b}`, product: "Dress", price: 100, qty: 1, created_at: new Date(t - 3600_000 + b).toISOString(), comment_msg_id: `9${b}_1`, platform_meta: { page_id: "111", live_video_id: "LV", commenter_id: `C${b}` } });
    if (o.second?.includes(b)) rows.push({ id: b * 10 + 1, session_id: S, buyer_number: b, handle: `buyer${b}`, customer_name: `Name ${b}`, product: "Bag", price: 50, qty: 2, created_at: new Date(t - 1800_000 + b).toISOString(), comment_msg_id: `9${b}_2`, platform_meta: { page_id: "111", live_video_id: "LV", commenter_id: `C${b}` } });
  }
  const posts: string[] = [];
  const gets: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body!).recipient.comment_id);
      if (o.graphDelay) await new Promise((r) => setTimeout(r, o.graphDelay));
      if (o.graphError) return { status: 400, json: async () => ({ error: { code: o.graphError!.code, error_subcode: o.graphError!.sub || 0, message: "Facebook words here" } }) };
      return { status: 200, json: async () => ({ message_id: `m${posts.length}`, recipient_id: "PSID777" }) };
    }
    gets.push(url);
    return { status: 200, json: async () => (o.canReply === null ? {} : { can_reply_privately: o.canReply ?? true }) };
  });
  const jobs: Row[] = [];
  const draws: unknown[][] = [];
  const store = {
    hasReceiptAccess: vi.fn(async () => o.access ?? true),
    isAdmin: vi.fn(async () => o.admin ?? false),
    getPage: async () => ({ ...page }),
    // ── the receipt send's own reads (the same rows) ──
    listReceiptOrders: async (_u: string, _s: string, b: number) => rows.filter((r) => r.buyer_number === b).map((r) => ({ comment_msg_id: r.comment_msg_id, platform_meta: r.platform_meta, handle: r.handle, created_at: r.created_at })),
    listReceiptRows: async (ids: string[]) => receipts.filter((r) => ids.includes(String(r.comment_id))),
    // fb_receipts_one_live_per_comment: one pending/sent row per comment
    insertReceipt: async (row: Row) => {
      if (receipts.some((r) => r.comment_id === row.comment_id && r.status !== "failed")) return { conflict: true };
      const r = { kind: "receipt", ...row, id: receipts.length + 1, created_at: nowIso() }; receipts.push(r); return { id: r.id };
    },
    updateReceipt: async (id: number, patch: Row) => { Object.assign(receipts.find((r) => r.id === id)!, patch); return {}; },
    deleteReceipt: async (id: number) => { const i = receipts.findIndex((r) => r.id === id); if (i >= 0) receipts.splice(i, 1); return true; },
    uploadReceiptImage: async (p: string) => `https://cdn.test/${p}`,
    // ── Send all ──
    insertSendAllJob: vi.fn(async (row: Row) => {
      if (jobs.some((j) => j.user_id === row.user_id && j.session_id === row.session_id && ["queued", "running"].includes(String(j.status)))) return { conflict: true };
      const j = { id: jobs.length + 1, attempts: 0, total: 0, sent: 0, skipped: 0, failed: 0, created_at: nowIso(), ...row }; jobs.push(j); return { id: j.id };
    }),
    claimSendAllJobs: vi.fn(async () => {
      const q = jobs.filter((j) => j.status === "queued");
      for (const j of q) Object.assign(j, { status: "running", attempts: Number(j.attempts) + 1, claimed_at: nowIso(), heartbeat_at: nowIso() });
      return q.map((j) => ({ ...j }));
    }),
    touchSendAllJob: async (id: number, patch: Row) => { const j = jobs.find((x) => x.id === id); if (j && j.status === "running") Object.assign(j, patch); },
    finishSendAllJob: async (id: number, patch: Row) => { const j = jobs.find((x) => x.id === id); if (j && j.status === "running") Object.assign(j, patch); },
    latestSendAllJob: async (_u: string, s: string) => [...jobs].reverse().find((j) => j.session_id === s) || null,
    listSessionFbRows: async (_u: string, s: string) => rows.filter((r) => r.session_id === s),
    listSessionReceipts: async () => receipts.map((r) => ({ comment_id: r.comment_id, status: r.status, sent_at: r.sent_at, kind: r.kind, error_code: r.error_code, created_at: r.created_at })),
    listInvoiceSkips: async () => o.skips || [],
    listLineCancels: async () => o.cancels || [],
    getSendAllSettings: async () => ({ opening: "Hi!", note: "Pay by Friday", qrImage: null, shippingFee: o.shipping ?? 0 }),
  };
  const receipt = createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => t });
  const enabled = vi.fn(async () => o.switchOn ?? true);
  const draw = vi.fn(async (...a: unknown[]) => { draws.push(a); return PNG; });
  const logs: string[] = [];
  const slept: number[] = [];
  const runner = createSendAllRunner({
    store, receipt, enabled, config: CONFIG, fetchImpl, draw, now: () => t, log: (l: string) => logs.push(l),
    sleep: async (ms: number) => { slept.push(ms); t += ms; },
  });
  const start = (extra: Row = {}) => runner.start(U, { sessionId: S, lang: "en", currency: "NT$", ...extra });
  const status = () => runner.status(U, { sessionId: S });
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
  return { t: () => t, advance: (ms: number) => { t += ms; }, receipts, rows, posts, gets, jobs, draws, store, receipt, runner, enabled, draw, logs, slept, start, status, settle, fetchImpl };
}

// ─────────────────────────────────────────────────────────────────────────────
describe("rule 2: the add-on + the plan not ended (server/fbReceiptAccess.js)", () => {
  const NOW = Date.parse("2026-11-26T00:00:00Z");
  it("any plan with the add-on; no end date or a future one = yes; ended / unreadable / no profile / no row = no", () => {
    const on = { enabled: true };
    expect(receiptAccessAllowed(on, { plan_expiry: null }, NOW)).toBe(true);           // a Free plan has no end date
    expect(receiptAccessAllowed(on, { plan_expiry: "" }, NOW)).toBe(true);
    expect(receiptAccessAllowed(on, { plan_expiry: "2026-12-01T00:00:00Z" }, NOW)).toBe(true);
    expect(receiptAccessAllowed(on, { plan_expiry: "2026-11-25T23:59:59Z" }, NOW)).toBe(false);
    expect(receiptAccessAllowed(on, { plan_expiry: "2026-11-26T00:00:00Z" }, NOW)).toBe(false); // the very moment = ended
    expect(receiptAccessAllowed(on, { plan_expiry: "not a date" }, NOW)).toBe(false);
    expect(receiptAccessAllowed(on, null, NOW)).toBe(false);
    expect(receiptAccessAllowed(null, { plan_expiry: null }, NOW)).toBe(false);
    expect(receiptAccessAllowed({ enabled: false }, { plan_expiry: null }, NOW)).toBe(false);
  });
  it("fails closed on any read error; the Facebook sign-in's row-only check ignores the plan", async () => {
    const a = makeReceiptAccess({ readAccess: async () => ({ enabled: true }), readProfile: async () => { throw new Error("db"); }, now: () => NOW });
    expect(await a.hasReceiptAccess(U)).toBe(false);
    expect(await a.receiptAddonRow(U)).toBe(true);
    const b = makeReceiptAccess({ readAccess: async () => { throw new Error("db"); }, readProfile: async () => ({ plan_expiry: null }), now: () => NOW });
    expect(await b.hasReceiptAccess(U)).toBe(false);
    expect(await b.receiptAddonRow(U)).toBe(false);
    const ended = makeReceiptAccess({ readAccess: async () => ({ enabled: true }), readProfile: async () => ({ plan_expiry: "2026-01-01T00:00:00Z" }), now: () => NOW });
    expect(await ended.hasReceiptAccess(U)).toBe(false);
    expect(await ended.receiptAddonRow(U)).toBe(true);
    expect(await ended.hasReceiptAccess("")).toBe(false);
  });
  it("plan ended → no send EVERYWHERE: Send all, the Orders receipt Send, and /fb/access says no receipt", async () => {
    const ended = makeReceiptAccess({ readAccess: async () => ({ enabled: true }), readProfile: async () => ({ plan_expiry: "2026-01-01T00:00:00Z" }) });
    const w = world(2);
    w.store.hasReceiptAccess.mockImplementation((uid: string) => ended.hasReceiptAccess(uid));
    expect((await w.start()).status).toBe(403);
    expect((await w.status()).json).toEqual({ ok: true, access: false });
    expect((await w.runner.preview(U, { sessionId: S, buyerNumber: 1 })).status).toBe(403);
    const orders = await w.receipt.send(U, { sessionId: S, buyerNumber: 1, imagePngBase64: PNG.toString("base64") });
    expect(orders).toEqual({ status: 403, json: { ok: false, error: "no_access" } });
    expect(w.posts).toEqual([]);
    const res = { json: vi.fn() };
    await createFbAccessHandler({ fbEnabled: async () => true, hasReceiptAccess: (uid: string) => ended.hasReceiptAccess(uid) })({ authUserId: U, userEmail: "x@y.z" } as never, res as never);
    expect(res.json).toHaveBeenCalledWith({ ok: true, facebook: true, receipt: false });
  });
});

describe("who sees Send all: the switch, else admins only", () => {
  it("switch off + not admin → not allowed (status says so, start / preview refused, no job)", async () => {
    const w = world(2, { switchOn: false });
    expect((await w.status()).json).toEqual({ ok: true, access: true, allowed: false });
    expect(await w.start()).toEqual({ status: 403, json: { ok: false, error: "not_allowed" } });
    expect((await w.runner.preview(U, { sessionId: S, buyerNumber: 1 })).status).toBe(403);
    expect(w.jobs).toEqual([]);
  });
  it("switch off + admin (with the add-on) → allowed; switch on → everyone with the add-on, any plan", async () => {
    const a = world(1, { switchOn: false, admin: true });
    expect((await a.status()).json).toMatchObject({ ok: true, allowed: true });
    const b = world(1, { switchOn: true, admin: false });
    expect((await b.status()).json).toMatchObject({ ok: true, allowed: true });
    const c = world(1, { access: false, admin: true });   // admin without the add-on: nothing
    expect((await c.status()).json).toEqual({ ok: true, access: false });
  });
  it("a switch / admin read that fails = not allowed", async () => {
    const w = world(1, { switchOn: false });
    w.enabled.mockRejectedValue(new Error("db"));
    w.store.isAdmin.mockRejectedValue(new Error("db"));
    expect((await w.status()).json).toEqual({ ok: true, access: true, allowed: false });
  });
  it("the after-live switch and its job queue are never read or used here", () => {
    const src = readFileSync("server/fbSendAll.js", "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/fb_auto_receipt|insertAutoReceiptJob|claimJobs\b|autoSend\b/);
  });
});

describe("the job", () => {
  it("one tap → every buyer gets ONE receipt picture; the job ends done with counts", async () => {
    const w = world(3);
    expect(await w.start()).toEqual({ status: 200, json: { ok: true, already: false } });
    await w.settle();
    expect(w.posts).toEqual(["91_1", "92_1", "93_1"]);
    expect(w.jobs[0]).toMatchObject({ status: "done", total: 3, sent: 3, skipped: 0, failed: 0 });
    expect((await w.status()).json.buyers).toEqual([1, 2, 3].map((n) => ({ n, tag: "sent", at: expect.any(String) })));
  });
  it("a second tap while the job waits or runs = the same job (no second job, nothing sent twice)", async () => {
    const w = world(3, { graphDelay: 5 });
    const [a, b] = await Promise.all([w.start(), w.start()]);
    expect([a.json, b.json]).toEqual(expect.arrayContaining([{ ok: true, already: false }, { ok: true, already: true }]));
    expect(await w.start({ buyerNumber: 2 })).toEqual({ status: 200, json: { ok: true, already: true } }); // one row's Send too
    await new Promise((r) => setTimeout(r, 60));
    await w.settle();
    expect(w.jobs).toHaveLength(1);
    expect(w.posts.sort()).toEqual(["91_1", "92_1", "93_1"]);
  });
  it("skips: already sent, saved Sent by hand / Can't message / Cancelled, every line cancelled, can_reply_privately false", async () => {
    const w = world(5, { skips: [2], cancels: [30] });
    w.receipts.push({ id: 900, user_id: U, comment_id: "91_1", status: "sent", kind: "receipt", sent_at: new Date(w.t()).toISOString(), created_at: new Date(w.t()).toISOString() });
    w.fetchImpl.mockImplementation((async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") { w.posts.push(JSON.parse(init.body!).recipient.comment_id); return { status: 200, json: async () => ({ message_id: "m" }) }; }
      return { status: 200, json: async () => ({ can_reply_privately: !url.includes("94_1") }) };
    }) as never);
    await w.start();
    await w.settle();
    expect(w.posts).toEqual(["95_1"]);                    // 1 sent before · 2 by hand · 3 all lines cancelled · 4 cannot reply
    expect(w.jobs[0]).toMatchObject({ status: "done", total: 5, sent: 1, skipped: 4 });
    const tags = Object.fromEntries((await w.status()).json.buyers.map((x: { n: number; tag: string }) => [x.n, x.tag]));
    expect(tags).toMatchObject({ 1: "sent", 4: "cant_message", 5: "sent" });
  });
  it("10 a minute: the 11th buyer waits for a free place (heartbeat while waiting); skips give their place back", async () => {
    const w = world(SEND_ALL_RATE_MAX + 2);
    await w.start();
    await w.settle();
    expect(w.posts).toHaveLength(SEND_ALL_RATE_MAX + 2);
    expect(w.slept.length).toBeGreaterThan(0);
    expect(w.slept.every((ms) => ms >= 1000 && ms <= 60_000)).toBe(true);
    expect(w.jobs[0]).toMatchObject({ status: "done", sent: SEND_ALL_RATE_MAX + 2 });
  });
  it("a one-row Send = a job for that buyer only", async () => {
    const w = world(3);
    await w.start({ buyerNumber: 2 });
    await w.settle();
    expect(w.posts).toEqual(["92_1"]);
    expect(w.jobs[0]).toMatchObject({ buyer_number: 2, total: 1, sent: 1 });
  });
  it("the switch turned off (not admin) in the middle → the job stops before the next buyer", async () => {
    const w = world(4);
    let n = 0;
    w.enabled.mockImplementation(async () => { n++; return n <= 3; }); // start + job start + buyer 1
    await w.start();
    await w.settle();
    expect(w.posts).toEqual(["91_1"]);
    expect(w.jobs[0]).toMatchObject({ status: "stopped", note: "not_allowed" });
    expect(jobView(w.jobs[0])?.stop).toBe("not_allowed");
  });
  it("a Page that cannot message → the job stops 'needs_messaging' (the phone is told)", async () => {
    const w = world(2);
    w.store.getPage = async () => ({ ...page, can_message: false });
    await w.start();
    await w.settle();
    expect(w.posts).toEqual([]);
    expect(w.jobs[0]).toMatchObject({ status: "failed", note: "needs_messaging" });
    const st = (await w.status()).json;
    expect(st.job.stop).toBe("needs_messaging");
    expect(st.needsMessaging).toBe(true);
  });
  it("a job a restart left behind is picked up by the next pass (kick)", async () => {
    const w = world(2);
    w.jobs.push({ id: 1, user_id: U, session_id: S, buyer_number: null, status: "queued", lang: "en", currency: "NT$", attempts: 1, total: 0, sent: 0, skipped: 0, failed: 0, created_at: new Date(w.t()).toISOString() });
    w.runner.kick();
    await w.settle();
    expect(w.posts).toEqual(["91_1", "92_1"]);
  });
});

describe("one message per comment, whatever runs at the same time", () => {
  it("Send all and the Orders receipt Send for the same buyer at once → ONE message", async () => {
    const w = world(1, { graphDelay: 10 });
    const orders = w.receipt.send(U, { sessionId: S, buyerNumber: 1, imagePngBase64: PNG.toString("base64") });
    await w.start();
    const r = await orders;
    await new Promise((x) => setTimeout(x, 40));
    await w.settle();
    expect(w.posts).toEqual(["91_1"]);
    expect(r.json.ok).toBe(true);
    expect(w.receipts.filter((x) => x.status === "sent")).toHaveLength(1);
  });
  it("two servers (two locks) on the same buyer → the database index lets only ONE claim the comment", async () => {
    const w = world(1, { graphDelay: 10 });
    const other = createFbReceipt({ config: CONFIG, store: w.store, fetchImpl: w.fetchImpl, now: w.t });
    const mk = async () => PNG;
    const pre = async () => true;
    const [a, b] = await Promise.all([w.receipt.sendOne(U, { sessionId: S, buyerNumber: 1 }, mk, pre), other.sendOne(U, { sessionId: S, buyerNumber: 1 }, mk, pre)]);
    expect(w.posts).toEqual(["91_1"]);
    expect([a.json.ok, b.json.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe("tags (the mapping the phone shows)", () => {
  const NOW = Date.parse("2026-11-26T08:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const orders = (n = 1, age = 3600_000) => Array.from({ length: n }, (_, i) => ({ comment_msg_id: `7_${i}`, platform_meta: { page_id: "1", commenter_id: "C1" }, handle: "b", created_at: iso(NOW - age) }));
  const fail = (code: string, at = NOW - 60_000, id = "7_0") => ({ comment_id: id, status: "failed", error_code: code, kind: "receipt", created_at: iso(at) });
  it.each([
    ["no try yet", orders(), [], null, "not_sent"],
    ["sent (time kept)", orders(), [{ comment_id: "7_0", status: "sent", sent_at: iso(NOW - 5000), kind: "receipt", created_at: iso(NOW - 6000) }], null, "sent"],
    ["a sold-out text is not a receipt", orders(), [{ comment_id: "7_0", status: "sent", kind: "soldout", created_at: iso(NOW) }], null, "not_sent"],
    ["pending, young", orders(), [{ comment_id: "7_0", status: "pending", kind: "receipt", created_at: iso(NOW - 30_000) }], null, "sending"],
    ["pending, old (delivery unknown)", orders(), [{ comment_id: "7_0", status: "pending", kind: "receipt", created_at: iso(NOW - 600_000) }], null, "unknown"],
    ["another chat app (10/2018300)", orders(), [fail("10/2018300")], null, "other_app"],
    ["another chat app, twice — still sendable", orders(), [fail("10/2018300", NOW - 90_000), fail("10/2018300")], null, "other_app"],
    ["cannot reply privately (preflight)", orders(), [fail("no_private_reply/0")], null, "cant_message"],
    ["10903 twice on the only comment", orders(), [fail("10903/1893049", NOW - 90_000), fail("10903/1893049")], null, "cant_message"],
    ["10900 twice on the only comment", orders(), [fail("10900/0", NOW - 90_000), fail("10900/0")], null, "cant_message"],
    ["100/1893060 (comment gone) twice, another comment left", orders(2), [fail("100/1893060", NOW - 90_000), fail("100/1893060")], null, "not_sent"],
    ["comments older than 7 days", orders(1, 8 * 86400_000), [], null, "cant_message"],
  ])("%s → %s", (_n, ords, rows, job, want) => {
    expect(buyerTag({ orders: ords, rows, job, inScope: true, nowMs: NOW }).tag).toBe(want);
  });
  it("two Facebook accounts on one buyer number → Can't message; a running job → Sending… until tried", () => {
    const mixed = [...orders(), { ...orders()[0], comment_msg_id: "7_9", platform_meta: { page_id: "1", commenter_id: "C2" } }];
    expect(buyerTag({ orders: mixed, rows: [], nowMs: NOW }).tag).toBe("cant_message");
    const job = { status: "running", claimed_at: iso(NOW - 10_000) };
    expect(buyerTag({ orders: orders(), rows: [], job, inScope: true, nowMs: NOW }).tag).toBe("sending");
    expect(buyerTag({ orders: orders(), rows: [], job, inScope: false, nowMs: NOW }).tag).toBe("not_sent");
    expect(buyerTag({ orders: orders(), rows: [fail("100/1893060", NOW - 5000)], job, inScope: true, nowMs: NOW }).tag).toBe("not_sent"); // tried in this job
    expect(buyerTag({ orders: orders(), rows: [], job: { ...job, status: "done" }, inScope: true, nowMs: NOW }).tag).toBe("not_sent");
  });
  it("sendable = Not sent and Other chat app only; every tag is in the list", () => {
    expect(SEND_ALL_TAGS.filter(tagSendable)).toEqual(["not_sent", "other_app"]);
  });
});

describe("what the phone gets", () => {
  it("status: per buyer number a tag (+ sent time), the job's counts — no PSID, comment id, token or Facebook text", async () => {
    const w = world(3, { graphError: { code: 10, sub: 2018300 } });
    await w.start();
    await w.settle();
    const st = (await w.status()).json;
    expect(Object.keys(st).sort()).toEqual(["access", "allowed", "buyers", "job", "needsMessaging", "ok"]);
    for (const b of st.buyers) expect(Object.keys(b).every((k) => ["n", "tag", "at"].includes(k))).toBe(true);
    expect(st.buyers.map((b: { tag: string }) => b.tag)).toEqual(["other_app", "other_app", "other_app"]);
    expect(Object.keys(st.job).sort()).toEqual(["failed", "finishedAt", "oneBuyer", "sent", "skipped", "startedAt", "state", "stop", "total"]);
    const text = JSON.stringify(st);
    for (const secret of ["PSID777", "PAGETOKEN", "91_1", "92_1", "C1", "Facebook words", "buyer1", "Name 1", "111", "LV"]) expect(text).not.toContain(secret);
    for (const call of [await w.start(), await w.runner.preview(U, { sessionId: S, buyerNumber: 1 })]) {
      const s = JSON.stringify(call.json).replace(/"png":"[^"]*"/, "");
      for (const secret of ["PSID777", "PAGETOKEN", "91_1", "C1"]) expect(s).not.toContain(secret);
    }
  });
  it("bad input is refused (session must be an id, buyer a positive whole number)", async () => {
    expect(parseSendAllBody({ sessionId: "day:2026-11-26" })).toBeNull();
    expect(parseSendAllBody({ sessionId: S, buyerNumber: 0 })).toBeNull();
    expect(parseSendAllBody({ sessionId: S, buyerNumber: 1.5 })).toBeNull();
    expect(parseSendAllBody({ sessionId: S }, { needBuyer: true })).toBeNull();
    expect(parseSendAllBody({ sessionId: S, lang: "xx", currency: "<b>" })).toEqual({ sessionId: S, buyerNumber: null, lang: "en", currency: "NT$" });
    const w = world(1);
    expect((await w.runner.start(U, { sessionId: "nope" })).status).toBe(400);
  });
});

describe("the picture: the preview = what the job sends", () => {
  it("the same draw input (lines cancelled for the invoice left out, the shipping fee, the app's words)", async () => {
    const w = world(1, { second: [1], cancels: [11], shipping: 60 });
    const p = await w.runner.preview(U, { sessionId: S, buyerNumber: 1, lang: "zh-TW", currency: "NT$" });
    expect(p.status).toBe(200);
    expect(p.json.png).toBe(PNG.toString("base64"));
    await w.start({ lang: "zh-TW", currency: "NT$" });
    await w.settle();
    expect(w.draws).toHaveLength(2);
    expect(w.draws[1]).toEqual(w.draws[0]);
    const [rows, settings] = w.draws[0] as [Row[], Row];
    expect(rows.map((r) => r.id)).toEqual([10]);                  // order 11 cancelled
    expect(settings).toMatchObject({ opening: "Hi!", note: "Pay by Friday", shippingFee: 60, lang: "zh-TW", currency: "NT$", labels: SEND_ALL_LABELS["zh-TW"] });
    const input = receiptInputFromRows(rows, settings);
    expect(input.shippingFee).toBe(60);
    expect(input.labels).toMatchObject({ total: "合計", shipping: "運費", howToPay: "付款方式", scanToPay: "掃碼付款" });
  });
  it("the after-live receipt's picture input is unchanged (no words list, no shipping fee passed)", () => {
    const rows = [{ id: 1, buyer_number: 4, handle: "h", customer_name: "N", product: "Dress", price: 100, qty: 1, created_at: "2026-11-26T00:00:00Z" }];
    const input = receiptInputFromRows(rows, { opening: "", note: "", lang: "en", currency: "NT$" });
    expect(input).toEqual({ opening: "", note: "", qrImage: null, currency: "NT$", buyerNum: 4, buyerName: "N", lines: [{ item: "Dress", total: 100 }], labels: { total: "Total", toBeConfirmed: "to be confirmed", more: "…and {n} more" } });
  });
  it("the server's extra picture words = the app's texts in all 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const t = buildT(lang);
      expect(SEND_ALL_LABELS[lang]).toEqual({ shipping: t.rd_rc_pic_shipping, howToPay: t.rd_rc_pic_howto, scanToPay: t.rd_rc_pic_scan });
    }
  });
  it("a buyer with every line cancelled has no picture", async () => {
    const w = world(1, { cancels: [10] });
    expect((await w.runner.preview(U, { sessionId: S, buyerNumber: 1 })).status).toBe(404);
  });
});

describe("server.js wiring", () => {
  const src = readFileSync("server.js", "utf8");
  it("the receipt check = rule 2; the Facebook sign-in keeps the row only; the routes + the pick-up timer are there", () => {
    expect(src).toContain("hasReceiptAccess: (userId) => receiptAccess.hasReceiptAccess(userId),");
    expect(src).toContain("store: { ...store, hasReceiptAccess: (uid) => receiptAccess.receiptAddonRow(uid) },");
    expect(src).toMatch(/createSendAllRunner\(\{\s*store, receipt: fbReceiptApi, enabled: sendAllFlag/);
    expect(src).toContain('.eq("key", "fb_send_all_enabled")');
    expect(src).toContain("sendAllRunner.registerRoutes(app, requireAuth);");
    expect(src).toMatch(/setInterval\(\(\) => \{ if \(sendAllRunner\) sendAllRunner\.kick\(\); \}, SEND_ALL_TICK_MS\)/);
    // the after-live switch: the same 4 mentions as on main (its one read + 3 comments) — not used by Send all
    expect(src.match(/fb_auto_receipt_enabled/g)?.length).toBe(4);
    expect(src.slice(src.indexOf("createSendAllRunner({"), src.indexOf("sendAllRunner.registerRoutes"))).not.toMatch(/autoReceiptFlag|fb_auto_receipt/);
  });
});
