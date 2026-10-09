// Facebook confirm page — double-submit fix (server/fbLive.js). A Facebook code can be
// exchanged once; a second "Connect" tap used to run a second exchange that failed and ended
// on ?fb=error although the Page was saved. Now POST /fb/oauth/complete is idempotent per
// sha256(code|state): in flight → the repeat waits for the same result; a finished connected /
// cap answer is repeated for 10 minutes; other errors are not remembered. The page disables
// the button on the first submit (one hashed inline script). Real express app, FAKE data.
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";
import type { AddressInfo } from "node:net";
import { createFbRuntime, signState, CONFIRM_SCRIPT, COMPLETE_REMEMBER_MS, COMPLETE_REMEMBER_MAX } from "../../../../server/fbLive.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const APP = "https://app.test";
const USER = "user-1234567890";
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const pagesRes = () => mkRes(200, { data: [{ id: "P1", name: "My Page", username: "mypage", access_token: "PAGETOK" }] });

// Graph fake: every exchange answers a fresh chain; `gate` (when set) holds the FIRST call.
function graph(opts: { failExchange?: boolean; gate?: Promise<void> } = {}) {
  let first = true;
  return vi.fn(async (url: string) => {
    if (first && opts.gate) { first = false; await opts.gate; }
    if (url.includes("/oauth/access_token") && url.includes("code=")) return opts.failExchange ? mkRes(400, { error: { code: 100 } }) : mkRes(200, { access_token: "SHORT" });
    if (url.includes("fb_exchange_token")) return mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 });
    if (url.includes("/me/accounts")) return pagesRes();
    return mkRes(200, { data: [] });
  });
}
const exchanges = (f: ReturnType<typeof graph>) => f.mock.calls.filter((c) => String(c[0]).includes("/oauth/access_token") && String(c[0]).includes("code=")).length;

function runtime(fetchImpl: ReturnType<typeof graph>, opts: { plan?: string; count?: number } = {}) {
  let t = 1_000_000;
  const logs: string[] = [];
  const upserts: unknown[] = [];
  const store = {
    async getAccountLabel() { return { email: "maria@x.co", storeName: "" }; },
    async getPlan() { return opts.plan ?? "pro"; }, async countPages() { return opts.count ?? 0; }, async getPage() { return null; },
    async upsertPage(row: unknown) { upserts.push(row); }, async listPages() { return []; },
    async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {},
  };
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: APP, fetchImpl, now: () => t, log: (l: string) => logs.push(l),
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  return { rt, logs, upserts, advance: (ms: number) => { t += ms; }, state: () => signState({ userId: USER, key: CONFIG.appSecret, nowMs: t }) };
}

let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
afterEach(() => { if (server) { server.close(); server = null; } });
async function serve(rt: ReturnType<typeof runtime>["rt"]) {
  const app = express();
  rt.registerRoutes(app as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never);
  server = app.listen(0);
  await new Promise((r) => server!.once("listening", r));
  const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const post = async (code: string, state: string) => {
    const r = await fetch(`${base}/fb/oauth/complete`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, state }).toString() });
    return { status: r.status, location: r.headers.get("location") };
  };
  return { base, post };
}
const CONNECTED = { status: 303, location: `${APP}/?fb=connected` };

describe("POST /fb/oauth/complete is idempotent per code", () => {
  it("two POSTs at the same time with the same code → ONE exchange, both answered ?fb=connected", async () => {
    let release!: () => void;
    const f = graph({ gate: new Promise<void>((r) => { release = r; }) });
    const x = runtime(f);
    const { post } = await serve(x.rt);
    const st = x.state();
    const a = post("CODE1", st);
    const b = post("CODE1", st);
    await vi.waitFor(() => expect(x.rt._completeInFlight.size).toBe(1));
    await new Promise((r) => setTimeout(r, 20)); // let the second request arrive and join
    release();
    expect(await a).toEqual(CONNECTED);
    expect(await b).toEqual(CONNECTED);
    expect(exchanges(f)).toBe(1);
    expect(x.upserts).toHaveLength(1);
  });
  it("in-flight joining (not the remembered answer): two concurrent POSTs on a FAILING exchange → one exchange, same error for both", async () => {
    let release!: () => void;
    const f = graph({ failExchange: true, gate: new Promise<void>((r) => { release = r; }) });
    const x = runtime(f);
    const { post } = await serve(x.rt);
    const st = x.state();
    const a = post("CODE1F", st);
    const b = post("CODE1F", st);
    await vi.waitFor(() => expect(x.rt._completeInFlight.size).toBe(1));
    await new Promise((r) => setTimeout(r, 50)); // the second request joins the first
    release();
    const err = { status: 303, location: `${APP}/?fb=error&code=token_exchange` };
    expect(await a).toEqual(err);
    expect(await b).toEqual(err);
    expect(exchanges(f)).toBe(1);   // failures are not remembered → only joining explains one exchange
    expect(x.rt._completeInFlight.size).toBe(0);
  });
  it("a repeat POST after success → ?fb=connected, no new exchange", async () => {
    const f = graph();
    const x = runtime(f);
    const { post } = await serve(x.rt);
    const st = x.state();
    expect(await post("CODE2", st)).toEqual(CONNECTED);
    x.advance(COMPLETE_REMEMBER_MS - 1);
    expect(await post("CODE2", st)).toEqual(CONNECTED);
    expect(exchanges(f)).toBe(1);
  });
  it("after 10 minutes the answer is forgotten (the repeat runs again)", async () => {
    const f = graph();
    const x = runtime(f);
    const { post } = await serve(x.rt);
    const st = x.state();
    await post("CODE3", st);
    x.advance(COMPLETE_REMEMBER_MS);
    await post("CODE3", st);
    expect(exchanges(f)).toBe(2);
  });
  it("a failed exchange is NOT remembered — the next POST runs again", async () => {
    const f = graph({ failExchange: true });
    const x = runtime(f);
    const { post } = await serve(x.rt);
    const st = x.state();
    expect((await post("CODE4", st)).location).toBe(`${APP}/?fb=error&code=token_exchange`);
    expect((await post("CODE4", st)).location).toBe(`${APP}/?fb=error&code=token_exchange`);
    expect(exchanges(f)).toBe(2);
  });
  it("a cap answer IS remembered (no second exchange)", async () => {
    const f = graph();
    const x = runtime(f, { plan: "basic", count: 1 });
    const { post } = await serve(x.rt);
    const st = x.state();
    expect((await post("CODE5", st)).location).toBe(`${APP}/?fb=error&code=cap`);
    expect((await post("CODE5", st)).location).toBe(`${APP}/?fb=error&code=cap`);
    expect(exchanges(f)).toBe(1);
  });
  it("only hashed keys are kept, never the raw code or state; at most 500 entries, oldest dropped", async () => {
    const f = graph();
    const x = runtime(f);
    const { post } = await serve(x.rt);
    for (let i = 0; i < COMPLETE_REMEMBER_MAX; i++) x.rt._completeDone.set(`old${i}`, { redirect: `${APP}/?fb=connected`, at: 1_000_000 });
    const st = x.state();
    await post("SECRETCODE", st);
    expect(x.rt._completeDone.size).toBe(COMPLETE_REMEMBER_MAX);
    expect(x.rt._completeDone.has("old0")).toBe(false);
    const key = createHash("sha256").update(`SECRETCODE|${st}`, "utf8").digest("hex");
    expect(x.rt._completeDone.has(key)).toBe(true);
    const dump = JSON.stringify([...x.rt._completeDone]);
    expect(dump).not.toContain("SECRETCODE");
    expect(dump).not.toContain(st);
  });
  it("missing / invalid fields behave as today", async () => {
    const x = runtime(graph());
    const { post } = await serve(x.rt);
    expect((await post("C", "tampered")).location).toBe(`${APP}/?fb=error&code=bad_state`);
    expect((await post("", x.state())).location).toBe(`${APP}/?fb=error&code=missing_params`);
  });
});

describe("the failure log line", () => {
  it("names the user (first 8 chars) and the reason; never the code or the state", async () => {
    const x = runtime(graph({ failExchange: true }));
    const { post } = await serve(x.rt);
    const st = x.state();
    await post("LEAKYCODE", st);
    const lines = x.logs.filter((l) => l.startsWith("[FB] callback failed"));
    expect(lines).toEqual([`[FB] callback failed user=${USER.slice(0, 8)} reason=token_exchange`]);
    expect(x.logs.join("\n")).not.toContain("LEAKYCODE");
    expect(x.logs.join("\n")).not.toContain(st);
  });
  it("success logs no failure line", async () => {
    const x = runtime(graph());
    const { post } = await serve(x.rt);
    await post("OKCODE", x.state());
    expect(x.logs.some((l) => l.startsWith("[FB] callback failed"))).toBe(false);
  });
});

describe("the confirm page shows the tap worked", () => {
  it("the CSP hash matches the inline script exactly; the page has the script and the extra line", async () => {
    const x = runtime(graph());
    const { base } = await serve(x.rt);
    const r = await fetch(`${base}/fb/oauth/callback?code=C&state=${encodeURIComponent(x.state())}`);
    const html = await r.text();
    const inline = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    expect(inline).toBe(CONFIRM_SCRIPT);
    const hash = createHash("sha256").update(inline, "utf8").digest("base64");
    expect(r.headers.get("content-security-policy")).toContain(`script-src 'sha256-${hash}';`);
    expect(inline).toContain('b.getAttribute("data-busy")');
    expect(html).toContain('<button type="submit" data-busy="Connecting…">Connect</button>');
    expect(html).toContain('<p class="note">This can take a few seconds.</p>');
  });
  it("the script: first submit disables the button and shows Connecting…, further submits are ignored", async () => {
    const x = runtime(graph());
    const { base } = await serve(x.rt);
    const html = await (await fetch(`${base}/fb/oauth/callback?code=C&state=${encodeURIComponent(x.state())}`)).text();
    const dom = new JSDOM(html, { runScripts: "dangerously" });
    const { document, Event } = dom.window;
    const form = document.getElementById("c")!;
    const btn = form.querySelector("button")!;
    expect(form.dispatchEvent(new Event("submit", { cancelable: true }))).toBe(true);   // goes through
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Connecting…");
    expect(form.dispatchEvent(new Event("submit", { cancelable: true }))).toBe(false);  // ignored
    dom.window.close();
  });
});
