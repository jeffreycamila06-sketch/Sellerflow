// Facebook authorization from the phone app (server/fbLive.js). FAKE data only; real express app.
// Pins: the app mode is signed INSIDE the HMAC'd state (cannot be flipped either way); web flows
// keep the exact 3-part state, CSP and redirects; app flows end on com.sellerflow.live://fb-auth
// (callback carries only a status word); the confirm page is still shown; one exchange per code.
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  createFbRuntime, signState, verifyState, verifyStateDetail, confirmPageCsp, APP_AUTH_CALLBACK, APP_AUTH_SCHEME, CONFIRM_SCRIPT_HASH,
} from "../../../../server/fbLive.js";

const KEY = "sekret";
const CONFIG = { enabled: true, appId: "app123", appSecret: KEY, tokenKey: "tk" };
const APP = "https://app.test";
const NOW = 1_000_000;
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });

describe("state: app mode inside the signature", () => {
  it("web state is byte-identical to the old 3-part format", () => {
    const s = signState({ userId: "user-1", key: KEY, nowMs: NOW });
    const body = `${Buffer.from("user-1").toString("base64url")}.${NOW + 10 * 60 * 1000}`;
    expect(s).toBe(`${body}.${createHmac("sha256", KEY).update(body).digest("hex")}`);
    expect(verifyStateDetail(s, KEY, NOW)).toEqual({ userId: "user-1", app: false });
  });
  it("app state = 4 parts ending in .a.<mac>; verifies as app; verifyState still returns the user id", () => {
    const s = signState({ userId: "user-1", key: KEY, nowMs: NOW, app: true });
    expect(s.split(".")).toHaveLength(4);
    expect(s.split(".")[2]).toBe("a");
    expect(verifyStateDetail(s, KEY, NOW)).toEqual({ userId: "user-1", app: true });
    expect(verifyState(s, KEY, NOW)).toBe("user-1");
  });
  it("the mode cannot be flipped: adding or removing .a breaks the signature; other 4th segments are refused", () => {
    const web = signState({ userId: "user-1", key: KEY, nowMs: NOW }).split(".");
    expect(verifyStateDetail([web[0], web[1], "a", web[2]].join("."), KEY, NOW)).toBeNull();
    const app = signState({ userId: "user-1", key: KEY, nowMs: NOW, app: true }).split(".");
    expect(verifyStateDetail([app[0], app[1], app[3]].join("."), KEY, NOW)).toBeNull();
    expect(verifyStateDetail([app[0], app[1], "b", app[3]].join("."), KEY, NOW)).toBeNull();
    expect(verifyStateDetail(signState({ userId: "user-1", key: KEY, nowMs: NOW, app: true }), KEY, NOW + 10 * 60 * 1000 + 1)).toBeNull(); // expiry unchanged
  });
});

describe("CSP", () => {
  it("web: exactly today's policy; app: plus the app scheme in form-action only", () => {
    expect(confirmPageCsp("https://www.sellerflowlive.com")).toBe(`default-src 'none'; script-src '${CONFIRM_SCRIPT_HASH}'; style-src 'unsafe-inline'; form-action 'self' https://www.sellerflowlive.com`);
    expect(confirmPageCsp("https://www.sellerflowlive.com", { app: true })).toBe(`default-src 'none'; script-src '${CONFIRM_SCRIPT_HASH}'; style-src 'unsafe-inline'; form-action 'self' https://www.sellerflowlive.com ${APP_AUTH_SCHEME}:`);
    expect(APP_AUTH_CALLBACK).toBe("com.sellerflow.live://fb-auth");
  });
});

// ── real express app ─────────────────────────────────────────────────────────
function graph(opts: { failExchange?: boolean; gate?: Promise<void> } = {}) {
  let first = true;
  return vi.fn(async (url: string) => {
    if (first && opts.gate) { first = false; await opts.gate; }
    if (url.includes("/oauth/access_token") && url.includes("code=")) return opts.failExchange ? mkRes(400, { error: { code: 100 } }) : mkRes(200, { access_token: "SHORT" });
    if (url.includes("fb_exchange_token")) return mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 });
    if (url.includes("/me/accounts")) return mkRes(200, { data: [{ id: "P1", name: "My Page", username: "mypage", access_token: "PAGETOK" }] });
    return mkRes(200, { data: [] });
  });
}
const exchanges = (f: ReturnType<typeof graph>) => f.mock.calls.filter((c) => String(c[0]).includes("/oauth/access_token") && String(c[0]).includes("code=")).length;
function runtime(fetchImpl: ReturnType<typeof graph>, label: unknown = { email: "maria.santos@gmail.com", storeName: "" }) {
  const logs: string[] = [];
  const upserts: unknown[] = [];
  const store = {
    async getAccountLabel() { return label; }, async hasReceiptAccess() { return false; },
    async getPlan() { return "pro"; }, async countPages() { return 0; }, async getPage() { return null; },
    async upsertPage(row: unknown) { upserts.push(row); }, async listPages() { return []; },
    async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {},
  };
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: APP, fetchImpl, now: () => NOW, log: (l: string) => logs.push(l),
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  return { rt, logs, upserts };
}
let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
afterEach(() => { if (server) { server.close(); server = null; } });
async function serve(rt: ReturnType<typeof runtime>["rt"]) {
  const app = express();
  rt.registerRoutes(app as never, ((req: { authUserId?: string }, _s: unknown, n: () => void) => { req.authUserId = "user-1"; n(); }) as never);
  server = app.listen(0);
  await new Promise((r) => server!.once("listening", r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const post = async (code: string, state: string) => {
    const r = await fetch(`${base}/fb/oauth/complete`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, state }).toString() });
    return { status: r.status, location: r.headers.get("location") || "" };
  };
  return { base, post };
}
const appState = () => signState({ userId: "user-1", key: KEY, nowMs: NOW, app: true });
const webState = () => signState({ userId: "user-1", key: KEY, nowMs: NOW });

describe("GET /fb/oauth/start", () => {
  it("?client=app → a URL whose state is app-mode; without it → web state (unchanged)", async () => {
    const { rt } = runtime(graph());
    const { base } = await serve(rt);
    const stateOf = async (q: string) => new URL((await (await fetch(`${base}/fb/oauth/start${q}`)).json()).url).searchParams.get("state")!;
    expect(verifyStateDetail(await stateOf("?client=app"), KEY, NOW)).toEqual({ userId: "user-1", app: true });
    expect(verifyStateDetail(await stateOf(""), KEY, NOW)).toEqual({ userId: "user-1", app: false });
    expect(verifyStateDetail(await stateOf("?client=web"), KEY, NOW)).toEqual({ userId: "user-1", app: false });
  });
});

describe("the confirm page is still shown for app flows", () => {
  it("app state → 200 confirm page (masked email, Connect form), Cancel → app scheme, CSP adds the scheme", async () => {
    const f = graph();
    const { rt, upserts } = runtime(f);
    const { base } = await serve(rt);
    const r = await fetch(`${base}/fb/oauth/callback?code=C&state=${encodeURIComponent(appState())}`, { redirect: "manual" });
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain("ma•••s@gmail.com");
    expect(html).toContain('<form id="c" method="post" action="/fb/oauth/complete">');
    expect(html).toContain('href="com.sellerflow.live://fb-auth?fb=error&amp;code=cancelled"');
    expect(r.headers.get("content-security-policy")).toContain(`form-action 'self' ${APP} com.sellerflow.live:`);
    expect(f).not.toHaveBeenCalled();
    expect(upserts).toEqual([]);
  });
  it("web state → today's page: web Cancel link and today's CSP", async () => {
    const { rt } = runtime(graph());
    const { base } = await serve(rt);
    const r = await fetch(`${base}/fb/oauth/callback?code=C&state=${encodeURIComponent(webState())}`, { redirect: "manual" });
    const html = await r.text();
    expect(html).toContain(`href="${APP}/?fb=error&amp;code=cancelled"`);
    expect(html).not.toContain("com.sellerflow.live");
    expect(r.headers.get("content-security-policy")).toBe(confirmPageCsp(APP));
  });
  it("app state + no code / unreadable account → error on the app scheme; unverifiable state → the web", async () => {
    const { rt } = runtime(graph(), null);
    const { base } = await serve(rt);
    const loc = async (q: string) => (await fetch(`${base}/fb/oauth/callback${q}`, { redirect: "manual" })).headers.get("location");
    expect(await loc(`?state=${encodeURIComponent(appState())}`)).toBe(`${APP_AUTH_CALLBACK}?fb=error&code=missing_params`);
    expect(await loc(`?code=C&state=${encodeURIComponent(appState())}`)).toBe(`${APP_AUTH_CALLBACK}?fb=error&code=exception`);
    expect(await loc(`?code=C&state=tampered`)).toBe(`${APP}/?fb=error&code=bad_state`);
  });
});

describe("POST /fb/oauth/complete for app flows", () => {
  it("success → 303 to com.sellerflow.live://fb-auth?fb=connected; the callback carries no code, state or token", async () => {
    const { rt, upserts } = runtime(graph());
    const { post } = await serve(rt);
    const st = appState();
    const r = await post("SECRETCODE", st);
    expect(r).toEqual({ status: 303, location: `${APP_AUTH_CALLBACK}?fb=connected` });
    expect(upserts).toHaveLength(1);
    expect(r.location).not.toContain("SECRETCODE");
    expect(r.location).not.toContain(st);
    expect(r.location).not.toContain("TOK");
  });
  it("failure → the app scheme with the reason; one failure log line, no code/state", async () => {
    const { rt, logs } = runtime(graph({ failExchange: true }));
    const { post } = await serve(rt);
    const st = appState();
    expect((await post("BADCODE", st)).location).toBe(`${APP_AUTH_CALLBACK}?fb=error&code=token_exchange`);
    expect(logs.filter((l) => l.startsWith("[FB] callback failed"))).toEqual(["[FB] callback failed user=user-1 reason=token_exchange"]);
    expect(logs.join("\n")).not.toContain("BADCODE");
    expect(logs.join("\n")).not.toContain(st);
  });
  it("web flows still end on the website (unchanged)", async () => {
    const { rt } = runtime(graph());
    const { post } = await serve(rt);
    expect(await post("C", webState())).toEqual({ status: 303, location: `${APP}/?fb=connected` });
  });
  it("one exchange per code still holds for app flows (double tap → one exchange, same answer)", async () => {
    let release!: () => void;
    const f = graph({ gate: new Promise<void>((r) => { release = r; }) });
    const { rt } = runtime(f);
    const { post } = await serve(rt);
    const st = appState();
    const a = post("CODE2", st);
    const b = post("CODE2", st);
    await vi.waitFor(() => expect(rt._completeInFlight.size).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    release();
    expect((await a).location).toBe(`${APP_AUTH_CALLBACK}?fb=connected`);
    expect((await b).location).toBe(`${APP_AUTH_CALLBACK}?fb=connected`);
    expect(exchanges(f)).toBe(1);
  });
});
