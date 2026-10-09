// @vitest-environment node
// Build 8 "Privacy & hardening" — server. FAKE data only. Pins:
//   • POST /fb/deauthorize: a valid Meta signed_request deletes ONLY that Facebook user's Pages (all
//     sellers) and stops their pollers; bad signature / too old / no issued_at → 400 with no detail;
//     a replayed signature → 200 and nothing done again; per-IP rate limit;
//   • the Facebook user id is saved next to each Page at Connect (best effort);
//   • appsecret_proof = HMAC-SHA256(token, app secret) on EVERY Graph request that carries a token
//     (OAuth, live check, comments poll, receipt send, sold-out send); none on the token exchange;
//   • a state of the other app kind (or with no kind) → bad_state, both ways;
//   • per-IP gate on /fb/oauth/complete, per-seller gate on /fb/receipt/info;
//   • the receipt path skips comment ids that fail the sold-out format check;
//   • logs never carry a token or a URL; receipt drawing caps; an undrawable automatic receipt is
//     skipped with a logged reason.
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { createFbRuntime, signState, verifyStateDetail, COMPLETE_RATE_MAX, DEAUTH_RATE_MAX, DEAUTH_MAX_AGE_S } from "../../../../server/fbLive.js";
import { createIgRuntime } from "../../../../server/igLive.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import {
  appSecretProof, addAppSecretProof, withAppSecretProof, maskSecretText, makeRateGate, ipOf,
  parseSignedRequest, signRequestForTest, isFbCommentId,
} from "../../../../server/fbHardening.js";
import { createFbReceipt, pickReceiptCandidates, RECEIPT_INFO_RATE_MAX } from "../../../../server/fbReceipt.js";
import { parseSoldoutBody } from "../../../../server/fbSoldout.js";
import { createAutoReceiptRunner } from "../../../../server/fbAutoReceipt.js";
import { qrDataBytes, QR_MAX_BYTES, drawReceiptPng } from "../../../../server/receiptDraw.js";
import { layoutReceipt, RECEIPT_MAX_LINES, RECEIPT_MAX_HEIGHT, QR_MAX_HEIGHT } from "../../../../src/lib/receiptLayout.js";

const SECRET = "sekret";
const CONFIG = { enabled: true, appId: "app123", appSecret: SECRET, tokenKey: "tk" };
const NOW = 1_760_000_000_000;
const APP = "https://app.test";
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const proofOk = (url: string) => {
  const u = new URL(url);
  const tok = u.searchParams.get("access_token");
  return !tok || u.searchParams.get("appsecret_proof") === createHmac("sha256", SECRET).update(tok).digest("hex");
};

function graph() {
  return vi.fn(async (url: string) => {
    if (url.includes("/oauth/access_token") && url.includes("code=")) return mkRes(200, { access_token: "SHORT" });
    if (url.includes("fb_exchange_token")) return mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 });
    if (url.includes("/me/accounts")) return mkRes(200, { data: [{ id: "P1", name: "Page One", access_token: "PAGETOK1" }, { id: "P2", name: "Page Two", access_token: "PAGETOK2" }] });
    if (url.includes("/me?") || url.includes("/me/?")) return mkRes(200, { id: "1234567890" });
    if (url.includes("/live_videos")) return mkRes(200, { data: [{ id: "LV1", status: "LIVE" }] });
    if (url.includes("/comments")) return mkRes(400, { error: { code: 1, message: "bad token PAGETOK1 at https://graph.facebook.com/x?access_token=PAGETOK1" } });
    return mkRes(200, { data: [] });
  });
}
function runtime(fetchImpl = graph(), extra: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const pages = [{ user_id: "u1", page_id: "P1", active: true, access_token: encryptToken("PAGETOK1", "tk"), token_expires_at: new Date(NOW + 30 * 864e5).toISOString() }];
  const store = {
    getAccountLabel: vi.fn(async () => ({ email: "a@b.co", storeName: "" })),
    async getPlan() { return "master"; }, async countPages() { return 0; },
    getPage: vi.fn(async (_u: string, p: string) => pages.find((x) => x.page_id === p) || null),
    upsertPage: vi.fn(async () => {}), async listPages() { return []; }, async listActivePages() { return []; },
    setActive: vi.fn(async () => {}), async updateExpiry() {}, async hasReceiptAccess() { return false; },
    setPageFbUser: vi.fn(async () => {}),
    deletePagesByFbUser: vi.fn(async () => [{ user_id: "u1", page_id: "P1" }]),
    ...extra,
  };
  let t = NOW;
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: APP, fetchImpl, now: () => t, log: (l: string) => logs.push(l),
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  return { rt, store, fetchImpl, logs, tick: (ms: number) => { t += ms; } };
}

let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
afterEach(() => { if (server) { server.close(); server = null; } });
async function serve(rt: { registerRoutes: (...a: never[]) => void }) {
  const app = express();
  app.use(express.json());
  rt.registerRoutes(app as never, ((req: { authUserId?: string; sellerId?: string }, _s: unknown, n: () => void) => { req.authUserId = "u1"; req.sellerId = "s1"; n(); }) as never);
  server = app.listen(0);
  await new Promise((r) => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

describe("signed_request", () => {
  it("valid → the user id; wrong secret / tampered payload / wrong algorithm / bad shape → null", () => {
    const sr = signRequestForTest({ algorithm: "HMAC-SHA256", user_id: "1234567890", issued_at: 100 }, SECRET);
    expect(parseSignedRequest(sr, SECRET)).toMatchObject({ userId: "1234567890", issuedAt: 100 });
    expect(parseSignedRequest(sr, "other")).toBeNull();
    const [sig, payload] = sr.split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "999", issued_at: 100 })).toString("base64url");
    expect(parseSignedRequest(`${sig}.${forged}`, SECRET)).toBeNull();
    expect(parseSignedRequest(signRequestForTest({ algorithm: "plain", user_id: "1", issued_at: 1 }, SECRET), SECRET)).toBeNull();
    expect(parseSignedRequest(signRequestForTest({ algorithm: "HMAC-SHA256", user_id: "x' or 1", issued_at: 1 }, SECRET), SECRET)).toBeNull();
    for (const bad of ["", "abc", `${sig}.${payload}.x`, `${sig}!.${payload}`, "a".repeat(5000)]) expect(parseSignedRequest(bad, SECRET)).toBeNull();
  });
});

describe("POST /fb/deauthorize", () => {
  const signed = (uid = "1234567890", issuedAt = Math.floor(NOW / 1000)) => signRequestForTest({ algorithm: "HMAC-SHA256", user_id: uid, issued_at: issuedAt }, SECRET);
  it("valid → deletes only that Facebook user's Pages, stops their poller (not others), 200", async () => {
    const x = runtime();
    x.rt.startPoller({ sellerId: "s1", userId: "u1", pageId: "P1", pageUsername: "p1", liveVideoId: "LV1" });
    x.rt.startPoller({ sellerId: "s2", userId: "u2", pageId: "P9", pageUsername: "p9", liveVideoId: "LV9" });
    const base = await serve(x.rt);
    const r = await fetch(`${base}/fb/deauthorize`, form({ signed_request: signed() }));
    expect(r.status).toBe(200);
    expect(x.store.deletePagesByFbUser).toHaveBeenCalledTimes(1);
    expect(x.store.deletePagesByFbUser).toHaveBeenCalledWith("1234567890");
    expect([...x.rt._pollers.keys()]).toEqual(["s2:Facebook:P9"]);
    expect(x.logs.join("\n")).toContain("[FB] deauthorize pages=1");
    expect(x.logs.join("\n")).not.toContain("1234567890");
  });
  it("bad signature / too old / no issued_at / no body → 400, nothing deleted, no detail", async () => {
    const x = runtime();
    const base = await serve(x.rt);
    const bad = [
      signRequestForTest({ algorithm: "HMAC-SHA256", user_id: "1", issued_at: Math.floor(NOW / 1000) }, "wrong"),
      signed("1", Math.floor(NOW / 1000) - DEAUTH_MAX_AGE_S - 1),
      signRequestForTest({ algorithm: "HMAC-SHA256", user_id: "1" }, SECRET),
    ];
    for (const s of bad) {
      const r = await fetch(`${base}/fb/deauthorize`, form({ signed_request: s }));
      expect(r.status).toBe(400);
      expect(await r.text()).toBe("");
    }
    expect((await fetch(`${base}/fb/deauthorize`, { method: "POST" })).status).toBe(400);
    expect(x.store.deletePagesByFbUser).not.toHaveBeenCalled();
  });
  it("a replayed request → 200 and nothing is done twice", async () => {
    const x = runtime();
    const base = await serve(x.rt);
    const s = signed();
    expect((await fetch(`${base}/fb/deauthorize`, form({ signed_request: s }))).status).toBe(200);
    expect((await fetch(`${base}/fb/deauthorize`, form({ signed_request: s }))).status).toBe(200);
    expect(x.store.deletePagesByFbUser).toHaveBeenCalledTimes(1);
  });
  it("a delete error still answers 200; per-IP limit → 429", async () => {
    const x = runtime(graph(), { deletePagesByFbUser: vi.fn(async () => { throw new Error("db"); }) });
    const base = await serve(x.rt);
    expect((await fetch(`${base}/fb/deauthorize`, form({ signed_request: signed() }))).status).toBe(200);
    let last = 0;
    for (let i = 0; i < DEAUTH_RATE_MAX + 1; i++) last = (await fetch(`${base}/fb/deauthorize`, { method: "POST", headers: { "x-forwarded-for": "1.2.3.4" } })).status;
    expect(last).toBe(429);
  });
});

describe("Facebook user id saved at Connect", () => {
  it("each saved Page gets the id (best effort: a failure never fails the save)", async () => {
    const x = runtime(graph(), { setPageFbUser: vi.fn(async () => { throw new Error("column missing"); }) });
    const { redirect } = await x.rt.handleCallback({ code: "C", state: signState({ userId: "u1", key: SECRET, nowMs: NOW }) });
    expect(redirect).toBe(`${APP}/?fb=connected`);
    expect(x.store.upsertPage).toHaveBeenCalledTimes(2);
    expect(x.store.setPageFbUser).toHaveBeenCalledWith("u1", "P1", "1234567890");
    expect(x.store.setPageFbUser).toHaveBeenCalledWith("u1", "P2", "1234567890");
    const src = readFileSync("server.js", "utf8");
    expect(src).toMatch(/async setPageFbUser\(userId, pageId, fbUserId\)[\s\S]{0,200}update\(\{ fb_user_id: String\(fbUserId\) \}\)/);
    expect(src).toMatch(/async deletePagesByFbUser\(fbUserId\)[\s\S]{0,200}\.delete\(\)\.eq\("fb_user_id", String\(fbUserId\)\)/);
  });
});

describe("appsecret_proof", () => {
  it("helper: HMAC-SHA256(token, secret) hex, appended; no token / other host / no secret → unchanged", () => {
    expect(appSecretProof("T", SECRET)).toBe(createHmac("sha256", SECRET).update("T").digest("hex"));
    const u = "https://graph.facebook.com/v25.0/me?fields=id,name&access_token=T";
    expect(addAppSecretProof(u, SECRET)).toBe(`${u}&appsecret_proof=${appSecretProof("T", SECRET)}`);
    expect(addAppSecretProof("https://graph.facebook.com/v25.0/oauth/access_token?code=C&client_secret=S", SECRET)).toBe("https://graph.facebook.com/v25.0/oauth/access_token?code=C&client_secret=S");
    expect(addAppSecretProof("https://example.com/?access_token=T", SECRET)).toBe("https://example.com/?access_token=T");
    expect(addAppSecretProof(u, "")).toBe(u);
    const f = vi.fn(async () => mkRes(200, {}));
    const w = withAppSecretProof(f, SECRET);
    expect(withAppSecretProof(w, SECRET)).toBe(w);
  });
  it("every Graph call of the Facebook runtime that carries a token has the proof (OAuth, live check, poll)", async () => {
    const x = runtime();
    await x.rt.handleCallback({ code: "C", state: signState({ userId: "u1", key: SECRET, nowMs: NOW }) });
    const base = await serve(x.rt);
    await fetch(`${base}/fb/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page_id: "P1" }) });
    const entry = x.rt._pollers.get("s1:Facebook:P1");
    if (entry) await x.rt.pollOnce(entry);
    const urls = x.fetchImpl.mock.calls.map((c) => String(c[0]));
    const withToken = urls.filter((u) => new URL(u).searchParams.has("access_token"));
    expect(withToken.length).toBeGreaterThanOrEqual(5);
    for (const u of urls) expect(proofOk(u), u).toBe(true);
    expect(withToken.every((u) => new URL(u).searchParams.has("appsecret_proof"))).toBe(true);
  });
  it("receipt send, sold-out send and the automatic-receipt preflight are wrapped too", () => {
    for (const f of ["server/fbReceipt.js", "server/fbSoldout.js"]) expect(readFileSync(f, "utf8")).toContain("const fetchImpl = withAppSecretProof(rawFetch, config && config.appSecret);");
    expect(readFileSync("server.js", "utf8")).toContain("fetchImpl: withAppSecretProof(globalThis.fetch, fbCfg.appSecret)");
  });
  it("the receipt module really sends the proof", async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: unknown) => mkRes(200, { message_id: "m.1" }));
    const r = createFbReceipt({ config: CONFIG, store: {} as never, fetchImpl, log: () => {} });
    expect(typeof r.send).toBe("function");
    const wrapped = withAppSecretProof(fetchImpl, SECRET);
    await wrapped("https://graph.facebook.com/v25.0/P1/messages?access_token=PT", { method: "POST" });
    expect(proofOk(String(fetchImpl.mock.calls[0][0]))).toBe(true);
  });
});

describe("state kind", () => {
  it("a Facebook state is refused by Instagram, an Instagram state by Facebook, an untagged one by both", async () => {
    const fbSt = signState({ userId: "u1", key: SECRET, nowMs: NOW });
    const igSt = signState({ userId: "u1", key: SECRET, nowMs: NOW, kind: "ig" });
    expect(verifyStateDetail(fbSt, SECRET, NOW, "fb")).not.toBeNull();
    expect(verifyStateDetail(fbSt, SECRET, NOW, "ig")).toBeNull();
    expect(verifyStateDetail(igSt, SECRET, NOW, "fb")).toBeNull();
    const body = `${Buffer.from("u1").toString("base64url")}.${NOW + 600000}`;
    const untagged = `${body}.${createHmac("sha256", SECRET).update(body).digest("hex")}`;
    expect(verifyStateDetail(untagged, SECRET, NOW)).not.toBeNull();           // still a valid signature
    expect(verifyStateDetail(untagged, SECRET, NOW, "fb")).toBeNull();          // but no kind → refused
    const x = runtime();
    expect((await x.rt.handleCallback({ code: "C", state: igSt })).redirect).toBe(`${APP}/?fb=error&code=bad_state`);
    expect((await x.rt.confirmCallback({ code: "C", state: untagged })).redirect).toBe(`${APP}/?fb=error&code=bad_state`);
    const ig = createIgRuntime({ config: CONFIG, store: { getAccountLabel: async () => ({ email: "a@b.co" }) } as never, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: () => "k", renderUrl: "https://srv.test", appUrl: APP, fetchImpl: graph(), now: () => NOW, log: () => {} });
    expect((await ig.handleCallback({ code: "C", state: fbSt })).redirect).toBe(`${APP}/?ig=error&code=bad_state`);
    expect((await ig.confirmCallback({ code: "C", state: fbSt })).redirect).toBe(`${APP}/?ig=error&code=bad_state`);
  });
});

describe("rate limits", () => {
  it("/fb/oauth/complete: per IP, the right-most X-Forwarded-For entry", async () => {
    const x = runtime();
    const base = await serve(x.rt);
    const post = (ip: string) => fetch(`${base}/fb/oauth/complete`, { method: "POST", redirect: "manual", headers: { "x-forwarded-for": `9.9.9.9, ${ip}` } });
    for (let i = 0; i < COMPLETE_RATE_MAX; i++) expect((await post("5.5.5.5")).status).toBe(303);
    expect((await post("5.5.5.5")).status).toBe(429);
    expect((await post("6.6.6.6")).status).toBe(303); // another person is not blocked
    expect(ipOf({ headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" } })).toBe("2.2.2.2");
  });
  it("/fb/receipt/info: per seller, RECEIPT_INFO_RATE_MAX a minute", async () => {
    const routes: Record<string, ((...a: never[]) => unknown)[]> = {};
    const app = { post: (p: string, ...h: ((...a: never[]) => unknown)[]) => { routes[p] = h; } };
    createFbReceipt({ config: CONFIG, store: {} as never, now: () => NOW, log: () => {} }).registerRoutes(app as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never);
    const gate = routes["/fb/receipt/info"][1] as unknown as (q: unknown, s: unknown, n: () => void) => void;
    let passed = 0, status = 0;
    const res = { status(c: number) { status = c; return this; }, json() { return this; } };
    for (let i = 0; i < RECEIPT_INFO_RATE_MAX + 1; i++) gate({ authUserId: "u1" }, res, () => { passed++; });
    expect(passed).toBe(RECEIPT_INFO_RATE_MAX);
    expect(status).toBe(429);
    gate({ authUserId: "u2" }, res, () => { passed++; });
    expect(passed).toBe(RECEIPT_INFO_RATE_MAX + 1);
  });
  it("makeRateGate: window slides; no key → let through", () => {
    let t = 0, passed = 0, limited = 0;
    const g = makeRateGate({ max: 2, windowMs: 1000, keyOf: (q: { k?: string }) => q.k, onLimit: () => { limited++; }, now: () => t });
    for (const k of ["a", "a", "a"]) g({ k }, {}, () => { passed++; });
    t = 1001; g({ k: "a" }, {}, () => { passed++; });
    g({}, {}, () => { passed++; });
    expect([passed, limited]).toEqual([4, 1]);
  });
});

describe("comment ids", () => {
  it("one format check (digits and _) for the sold-out reply and the receipt", () => {
    for (const ok of ["123_456", "1"]) expect(isFbCommentId(ok)).toBe(true);
    for (const bad of ["abc", "1/../2", "1&x=2", "", "1".repeat(81)]) expect(isFbCommentId(bad)).toBe(false);
    expect(parseSoldoutBody({ pageId: "1", commentId: "1&x", code: "A" })).toBeNull();
    const order = (id: string) => ({ comment_msg_id: id, handle: "Ann", created_at: "2026-10-09T00:00:00Z", platform_meta: { page_id: "P1" } });
    expect(pickReceiptCandidates([order("12_34"), order("evil?x=1"), order("abc")], []).map((c: { commentId: string }) => c.commentId)).toEqual(["12_34"]);
  });
});

describe("logs: no token, no URL", () => {
  it("the comments-poll error line masks the page token and the URL", async () => {
    const x = runtime();
    const base = await serve(x.rt);
    await fetch(`${base}/fb/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ page_id: "P1" }) });
    const entry = x.rt._pollers.get("s1:Facebook:P1")!;
    await x.rt.pollOnce(entry);
    await x.rt.pollOnce(entry);
    const all = x.logs.join("\n");
    expect(all).toContain("[FB] comments error");
    expect(all).toContain("[redacted]");
    expect(all).not.toContain("PAGETOK1");
    expect(all).not.toContain("https://graph.facebook.com/x");
    expect(maskSecretText("tok T at https://x.y/?a=T", "T")).toBe("tok [redacted] at [url]");
  });
});

describe("receipt drawing caps", () => {
  const measure = (s: string) => s.length * 14;
  const base = { opening: "", note: "", qrImage: null, currency: "NT$", buyerNum: 1, buyerName: "A", labels: { total: "Total", toBeConfirmed: "tbc", more: "…and {n} more" } };
  it("at most 400 lines; the rest is one '…and N more' row; the total still counts every line", () => {
    const lines = Array.from({ length: 450 }, (_, i) => ({ item: `I${i}`, total: 1 }));
    const L = layoutReceipt({ ...base, lines }, measure, null);
    expect(RECEIPT_MAX_LINES).toBe(400);
    expect(L.ops.filter((o: { kind: string; text?: string }) => o.kind === "text" && /^\d+\.$/.test(o.text || "")).length).toBeLessThanOrEqual(400);
    expect(L.ops.some((o) => o.kind === "text" && /^…and \d+ more$/.test(o.text))).toBe(true);
    expect(L.totalText).toBe("NT$450");
    expect(L.height).toBeLessThanOrEqual(RECEIPT_MAX_HEIGHT);
  });
  it("the picture never passes 12,000 px; a tall QR is shrunk to 1,000 px; small receipts are unchanged", () => {
    const lines = Array.from({ length: 300 }, (_, i) => ({ item: `Item number ${i} `.repeat(12), total: 0 }));
    const L = layoutReceipt({ ...base, note: "Pay ".repeat(200), lines }, measure, { w: 400, h: 4000 });
    expect(L.height).toBeLessThanOrEqual(RECEIPT_MAX_HEIGHT);
    const img = L.ops.find((o: { kind: string }) => o.kind === "image") as { h: number; w: number };
    expect(img.h).toBe(QR_MAX_HEIGHT);
    expect(img.w).toBe(100);
    expect(L.hiddenLines).toBeGreaterThan(0);
    const small = layoutReceipt({ ...base, lines: [{ item: "A1", total: 100 }] }, measure, null);
    expect(small.hiddenLines).toBe(0);
    expect(small.ops.some((o) => o.kind === "text" && /more/.test(o.text))).toBe(false);
  });
  it("the server refuses a QR over 2 MB before decoding it", async () => {
    const big = `data:image/png;base64,${"A".repeat(Math.ceil((QR_MAX_BYTES + 10) * 4 / 3))}`;
    expect(qrDataBytes(big)).toBeGreaterThan(QR_MAX_BYTES);
    await expect(drawReceiptPng([{ product: "A1", price: 1, buyer_number: 1, created_at: "2026-10-09T00:00:00Z" }], { qrImage: big })).rejects.toThrow("qr_too_big");
  });
  it("an automatic receipt that cannot be drawn is skipped with a logged reason (no throw, no retry)", async () => {
    const logs: string[] = [];
    const store = {
      claimJobs: vi.fn().mockResolvedValueOnce([{ id: 1, user_id: "u1", page_id: "P1", live_video_id: "LV1", attempts: 1 }]).mockResolvedValue([]),
      finishJob: vi.fn(async () => {}),
      listLiveRows: vi.fn(async () => [{ session_id: "s", buyer_number: 1, comment_msg_id: "1_1", handle: "Ann", product: "A1", price: 1, created_at: "2026-10-09T00:00:00Z" }]),
      getAutoReceiptSettings: vi.fn(async () => ({ enabled: true })),
      readProfile: vi.fn(async () => ({ plan: "pro", plan_status: "active", plan_expiry: "2099-01-01T00:00:00Z" })),
    };
    const receipt = { autoSend: vi.fn(async (_u: string, _t: unknown, makePng: () => Promise<unknown>) => { await makePng(); return { status: 200, json: { ok: true } }; }) };
    const runner = createAutoReceiptRunner({ store, flag: async () => true, hasAccess: async () => true, receipt, draw: async () => { throw new Error("qr_too_big"); }, log: (l: string) => logs.push(l) } as never);
    await runner.tick();
    expect(logs.join("\n")).toMatch(/\[AUTO-RECEIPT\] skip user=u1 buyer=#1 reason=qr_too_big/);
  });
});

describe("source contracts", () => {
  it("every Facebook log that prints Facebook's text goes through the masker", () => {
    const src = readFileSync("server/fbLive.js", "utf8");
    expect(src).not.toMatch(/msg=\$\{res\.error \|\| "-"\}/);
    expect(src).not.toMatch(/log\(`\[FB\][^`]*\$\{e && e\.message\}/);
    expect(src).toContain('const fetchImpl = withAppSecretProof(rawFetch, config.appSecret);');
  });
});
