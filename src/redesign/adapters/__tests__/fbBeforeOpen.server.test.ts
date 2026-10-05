// Facebook before opening, Parts A + B (server). FAKE data only.
// A — the OAuth callback no longer saves anything: it shows a confirm page naming the
//     receiving SellerFlowLive account (masked email + store name); only its POST to
//     /fb/oauth/complete runs the unchanged handleCallback. Real express app on a random
//     local port, so the urlencoded parser (8kb), headers and redirects are exercised.
// B — receipt pictures older than 24 hours are deleted from the bucket, hourly.
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createFbRuntime, signState, maskEmail, escapeHtml, confirmPageCsp, CONFIRM_SCRIPT, CONFIRM_SCRIPT_HASH } from "../../../../server/fbLive.js";
import {
  cleanupReceiptImages, startReceiptImageCleanup,
  RECEIPT_IMAGE_TTL_MS, RECEIPT_CLEANUP_EVERY_MS, RECEIPT_CLEANUP_FIRST_MS, RECEIPT_CLEANUP_MAX,
} from "../../../../server/fbReceipt.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const NOW = 1_000_000;
const APP = "https://app.test";
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });

function makeStore(label: unknown = { email: "maria.santos@gmail.com", storeName: "Maria <Shop>" }) {
  const upserts: unknown[] = [];
  return {
    upserts,
    getAccountLabel: vi.fn(async () => { if (label instanceof Error) throw label; return label; }),
    async getPlan() { return "pro"; }, async countPages() { return 0; }, async getPage() { return null; },
    async upsertPage(row: unknown) { upserts.push(row); }, async listPages() { return []; },
    async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {},
  };
}
const graphChain = () => vi.fn()
  .mockResolvedValueOnce(mkRes(200, { access_token: "SHORT" }))
  .mockResolvedValueOnce(mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 }))
  .mockResolvedValueOnce(mkRes(200, { data: [{ id: "P1", name: "My Page", username: "mypage", access_token: "PAGETOK" }] }))
  .mockResolvedValue(mkRes(200, { data: [] }));

function runtime(store = makeStore(), fetchImpl: ReturnType<typeof vi.fn> = graphChain()) {
  const logs: string[] = [];
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: APP, fetchImpl, now: () => NOW, log: (l: string) => logs.push(l),
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  return { rt, store, fetchImpl, logs };
}
const state = (userId = "user-1") => signState({ userId, key: CONFIG.appSecret, nowMs: NOW });

let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
afterEach(() => { if (server) { server.close(); server = null; } vi.useRealTimers(); });
async function serve(rt: ReturnType<typeof runtime>["rt"]) {
  const app = express();
  app.use(express.json());
  rt.registerRoutes(app as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never);
  server = app.listen(0);
  await new Promise((r) => server!.once("listening", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe("A — masked email", () => {
  it("first 2 + ••• + last character before @ + full domain; a 1–3 character local part → first + •••", () => {
    expect(maskEmail("maria.santos@gmail.com")).toBe("ma•••s@gmail.com");
    expect(maskEmail("abcd@x.co")).toBe("ab•••d@x.co");
    expect(maskEmail("abc@x.co")).toBe("a•••@x.co");
    expect(maskEmail("ab@x.co")).toBe("a•••@x.co");
    expect(maskEmail("a@x.co")).toBe("a•••@x.co");
  });
  it("escapeHtml covers the HTML special characters", () => {
    expect(escapeHtml(`<a href="x">'&\``)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#96;");
  });
});

describe("A — GET /fb/oauth/callback shows the confirm page, nothing is exchanged", () => {
  it("valid state + code → 200 confirm page with the receiving account; no Graph call, nothing saved", async () => {
    const { rt, store, fetchImpl } = runtime();
    const base = await serve(rt);
    const st = state();
    const r = await fetch(`${base}/fb/oauth/callback?code=CODE%22%3E&state=${encodeURIComponent(st)}`, { redirect: "manual" });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("<h1>Connect your Facebook Page</h1>");
    expect(html).toContain("Your Facebook Page will be connected to this SellerFlowLive account:");
    expect(html).toContain("ma•••s@gmail.com");
    expect(html).not.toContain("maria.santos");
    expect(html).toContain("Maria &lt;Shop&gt;");                       // escaped store name
    expect(html).toContain("Only continue if this is your own SellerFlowLive account.");
    expect(html).toContain('<form id="c" method="post" action="/fb/oauth/complete">');
    expect(html).toContain('<input type="hidden" name="code" value="CODE&quot;&gt;">'); // escaped
    expect(html).toContain(`<input type="hidden" name="state" value="${escapeHtml(st)}">`);
    expect(html).toContain(`href="${APP}/?fb=error&amp;code=cancelled"`);
    expect(html).toContain('<meta name="viewport"');
    // no external assets; the only script is the hashed inline CONFIRM_SCRIPT
    expect(html).not.toMatch(/src=|<link|https?:\/\/(?!app\.test)/i);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain(`<script>${CONFIRM_SCRIPT}</script>`);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toBe(`default-src 'none'; script-src '${CONFIRM_SCRIPT_HASH}'; style-src 'unsafe-inline'; form-action 'self' ${APP}`);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.upserts).toEqual([]);
    expect(store.getAccountLabel).toHaveBeenCalledWith("user-1");
  });
  it("no store name → only the masked email", async () => {
    const { rt } = runtime(makeStore({ email: "ab@x.co", storeName: "" }));
    const html = await (await fetch(`${await serve(rt)}/fb/oauth/callback?code=C&state=${encodeURIComponent(state())}`)).text();
    expect(html).toContain('<div class="acct"><b>a•••@x.co</b></div>');
  });
  it("bad state / missing code → the same error redirects as today", async () => {
    const { rt, fetchImpl } = runtime();
    const base = await serve(rt);
    const bad = await fetch(`${base}/fb/oauth/callback?code=C&state=tampered`, { redirect: "manual" });
    expect(bad.status).toBe(302);
    expect(bad.headers.get("location")).toBe(`${APP}/?fb=error&code=bad_state`);
    const noCode = await fetch(`${base}/fb/oauth/callback?state=${encodeURIComponent(state())}`, { redirect: "manual" });
    expect(noCode.headers.get("location")).toBe(`${APP}/?fb=error&code=missing_params`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("the account cannot be read (error / no row / no email) → exception redirect", async () => {
    for (const label of [new Error("db"), null, { email: "", storeName: "x" }]) {
      const { rt } = runtime(makeStore(label));
      const r = await fetch(`${await serve(rt)}/fb/oauth/callback?code=C&state=${encodeURIComponent(state())}`, { redirect: "manual" });
      expect(r.headers.get("location")).toBe(`${APP}/?fb=error&code=exception`);
      server!.close(); server = null;
    }
  });
  it("the CSP allows the form back to this server and the app origin only", () => {
    expect(confirmPageCsp("https://www.sellerflowlive.com")).toBe(`default-src 'none'; script-src '${CONFIRM_SCRIPT_HASH}'; style-src 'unsafe-inline'; form-action 'self' https://www.sellerflowlive.com`);
  });
});

describe("A — POST /fb/oauth/complete runs the unchanged exchange", () => {
  it("Connect → handleCallback → 303 to its redirect; the page is saved", async () => {
    const { rt, store, fetchImpl, logs } = runtime();
    const base = await serve(rt);
    const st = state();
    const r = await fetch(`${base}/fb/oauth/complete`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ code: "THECODE", state: st }) });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${APP}/?fb=connected`);
    expect(store.upserts).toHaveLength(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("code=THECODE");
    expect(logs.join("\n")).not.toContain("THECODE");
    expect(logs.join("\n")).not.toContain(st);
  });
  it("missing / invalid fields → the same error redirects (303), nothing exchanged", async () => {
    const { rt, fetchImpl } = runtime();
    const base = await serve(rt);
    const post = (body: string) => fetch(`${base}/fb/oauth/complete`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    expect((await post(form({ code: "C" }))).headers.get("location")).toBe(`${APP}/?fb=error&code=bad_state`);
    expect((await post(form({ code: "C", state: "tampered" }))).headers.get("location")).toBe(`${APP}/?fb=error&code=bad_state`);
    const noCode = await post(form({ state: state() }));
    expect(noCode.status).toBe(303);
    expect(noCode.headers.get("location")).toBe(`${APP}/?fb=error&code=missing_params`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("a body over 8kb is refused by the route's parser → bad_state redirect, nothing exchanged", async () => {
    const { rt, fetchImpl } = runtime();
    const r = await fetch(`${await serve(rt)}/fb/oauth/complete`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ code: "C", state: state(), pad: "x".repeat(9000) }) });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`${APP}/?fb=error&code=bad_state`);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ── B ────────────────────────────────────────────────────────────────────────
function imageStore(total: number, opts: { failList?: boolean; removeShort?: boolean } = {}) {
  let left = Array.from({ length: total }, (_, i) => `img${i}.png`);
  return {
    listOldReceiptImages: vi.fn(async (_before: string, limit: number) => { if (opts.failList) throw new Error("x"); return left.slice(0, limit); }),
    removeReceiptImages: vi.fn(async (paths: string[]) => { const n = opts.removeShort ? paths.length - 1 : paths.length; left = left.filter((p) => !paths.slice(0, n).includes(p)); return n; }),
  };
}

describe("B — receipt picture cleanup", () => {
  it("deletes everything older than 24 hours in pages of 100; one log line with the count, no paths", async () => {
    const store = imageStore(250);
    const log = vi.fn();
    expect(await cleanupReceiptImages({ store, now: () => NOW + RECEIPT_IMAGE_TTL_MS, log })).toBe(250);
    expect(store.listOldReceiptImages.mock.calls.map((c) => c[1])).toEqual([100, 100, 100]);
    expect(store.listOldReceiptImages.mock.calls[0][0]).toBe(new Date(NOW).toISOString()); // now − 24 h
    expect(store.removeReceiptImages.mock.calls.map((c) => c[0].length)).toEqual([100, 100, 50]);
    expect(log.mock.calls).toEqual([["[FB] receipt images cleanup deleted=250"]]);
  });
  it("at most 1000 per run", async () => {
    const store = imageStore(1500);
    expect(await cleanupReceiptImages({ store })).toBe(RECEIPT_CLEANUP_MAX);
    expect(store.removeReceiptImages).toHaveBeenCalledTimes(10);
  });
  it("never throws; a failing list deletes nothing; a partial remove stops the run", async () => {
    const log = vi.fn();
    await expect(cleanupReceiptImages({ store: imageStore(10, { failList: true }), log })).resolves.toBe(0);
    expect(log).toHaveBeenCalledWith("[FB] receipt images cleanup deleted=0");
    const short = imageStore(300, { removeShort: true });
    expect(await cleanupReceiptImages({ store: short })).toBe(99);
    expect(short.removeReceiptImages).toHaveBeenCalledTimes(1);
  });
  it("runs ~1 minute after start, then hourly; timers unref'd; stop() clears both", async () => {
    vi.useFakeTimers();
    const store = imageStore(0);
    const stop = startReceiptImageCleanup({ store, log: () => {} });
    await vi.advanceTimersByTimeAsync(RECEIPT_CLEANUP_FIRST_MS - 1);
    expect(store.listOldReceiptImages).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.listOldReceiptImages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RECEIPT_CLEANUP_EVERY_MS);
    expect(store.listOldReceiptImages).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(3 * RECEIPT_CLEANUP_EVERY_MS);
    expect(store.listOldReceiptImages).toHaveBeenCalledTimes(2);
    const unref = vi.fn();
    const h = { unref };
    startReceiptImageCleanup({ store, setTimer: () => h as never, setOnce: () => h as never, clearTimer: () => {}, clearOnce: () => {} });
    expect(unref).toHaveBeenCalledTimes(2);
  });
});
