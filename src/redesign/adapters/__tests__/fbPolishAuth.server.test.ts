// @vitest-environment node
// Build 5 "Authorize clarity" — server half (server/fbLive.js). FAKE data only. Pins:
//   • a connect that leaves Pages out (plan cap or the combined account limit) answers
//     fb=connected&saved=&dropped=&kept=&names= (≤3 names each); nothing left out → plain fb=connected;
//   • the confirm page lists the Page names (read before anything is saved), shows the receiving
//     account as the masked email with the store name under "store name set by this account:",
//     and speaks the language signed into the state (English fallback);
//   • one code exchange is shared by the confirm page and Connect (Facebook allows one);
//   • the language rides inside the HMAC'd state (cannot be changed); /fb/oauth/start takes ?lang=
//     from a fixed list only; no_pages / token_exchange now stop at the confirm step.
import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  createFbRuntime, signState, verifyStateDetail, buildConfirmPage, partialSaveQuery, FB_CONFIRM_TEXT, CONFIRM_LANGS, PARTIAL_NAMES_MAX,
} from "../../../../server/fbLive.js";

const KEY = "sekret";
const CONFIG = { enabled: true, appId: "app123", appSecret: KEY, tokenKey: "tk" };
const APP = "https://app.test";
const NOW = 1_000_000;
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const PAGES = [
  { id: "P1", name: "Ukay Queen", access_token: "T1" },
  { id: "P2", name: "Ukay Queen 2", access_token: "T2" },
  { id: "P3", name: "Bags & Co", access_token: "T3" },
  { id: "P4", name: "Shoes", access_token: "T4" },
  { id: "P5", name: "Extra", access_token: "T5" },
];
function graph(pages = PAGES.slice(0, 3), opts: { failExchange?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes("/oauth/access_token") && url.includes("code=")) return opts.failExchange ? mkRes(400, { error: { code: 100 } }) : mkRes(200, { access_token: "SHORT" });
    if (url.includes("fb_exchange_token")) return mkRes(200, { access_token: "LONGUSER", expires_in: 5184000 });
    if (url.includes("/me/accounts")) return mkRes(200, { data: pages });
    return mkRes(200, { data: [] });
  });
}
function runtime(fetchImpl = graph(), o: { plan?: string; count?: number; limitFor?: string[] } = {}) {
  const upserts: { page_id: string }[] = [];
  const store = {
    getAccountLabel: vi.fn(async () => ({ email: "maria.santos@gmail.com", storeName: "Ukay <Queen>" })),
    async getPlan() { return o.plan || "pro"; }, async countPages() { return o.count || 0; }, async getPage() { return null; },
    async upsertPage(row: { page_id: string }) { if ((o.limitFor || []).includes(row.page_id)) throw new Error("account_limit"); upserts.push(row); },
    async listPages() { return []; }, async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {},
    async hasReceiptAccess() { return false; },
  };
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: APP, fetchImpl, now: () => NOW, log: () => {},
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  return { rt, upserts, fetchImpl, store };
}
const st = (lang = "") => signState({ userId: "user-1", key: KEY, nowMs: NOW, lang });
const params = (redirect: string) => Object.fromEntries(new URL(redirect).searchParams);

describe("partial save is told, not hidden", () => {
  it("basic plan (1 Page), 3 chosen → saved 1, dropped 2 with their names", async () => {
    const { rt, upserts } = runtime(graph(), { plan: "basic" });
    const { redirect } = await rt.handleCallback({ code: "C", state: st() });
    expect(upserts.map((r) => r.page_id)).toEqual(["P1"]);
    expect(params(redirect)).toEqual({ fb: "connected", saved: "1", dropped: "2", kept: "Ukay Queen", names: "Ukay Queen 2\nBags & Co" });
  });
  it("names are capped at 3 each; the combined account limit counts as left out too", async () => {
    const { rt } = runtime(graph(PAGES), { plan: "plus", limitFor: ["P2"] });
    const p = params((await rt.handleCallback({ code: "C", state: st() })).redirect);
    expect(p.saved).toBe("2");                       // P1 + P3 (P2 refused by the account limit)
    expect(p.dropped).toBe("3");                     // P2 (limit) + P4, P5 (plan cap)
    expect(p.names.split("\n")).toEqual(["Ukay Queen 2", "Shoes", "Extra"]);
    expect(PARTIAL_NAMES_MAX).toBe(3);
    expect(partialSaveQuery(["a", "b", "c", "d"], ["x".repeat(80)])).toBe(`saved=4&dropped=1&kept=a%0Ab%0Ac&names=${"x".repeat(60)}`);
  });
  it("everything fits → exactly today's fb=connected", async () => {
    const { rt } = runtime(graph(), { plan: "master" });
    expect((await rt.handleCallback({ code: "C", state: st() })).redirect).toBe(`${APP}/?fb=connected`);
  });
});

describe("confirm page: the Pages, the masked account, the language", () => {
  it("lists the Page names, masked email + labelled store name; nothing is saved", async () => {
    const { rt, upserts } = runtime();
    const out = await rt.confirmCallback({ code: "C", state: st() });
    const html = out.html as string;
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<p>These Pages will be connected:</p>");
    expect(html).toContain('<ul class="pages"><li>Ukay Queen</li><li>Ukay Queen 2</li><li>Bags &amp; Co</li></ul>');
    expect(html).toContain("<b>ma•••s@gmail.com</b><span>store name set by this account: <i>Ukay &lt;Queen&gt;</i></span>");
    expect(html).not.toContain("maria.santos");
    expect(html).not.toMatch(/<h1>[^<]*Ukay/); // the store name is never the headline
    expect(upserts).toEqual([]);
  });
  it("speaks the state's language; unknown / missing → English", async () => {
    const fil = (await runtime().rt.confirmCallback({ code: "C", state: st("fil") })).html as string;
    expect(fil).toContain('<html lang="fil">');
    expect(fil).toContain(`<h1>${FB_CONFIRM_TEXT.fil.title}</h1>`);
    expect(fil).toContain(`data-busy="${FB_CONFIRM_TEXT.fil.busy}">${FB_CONFIRM_TEXT.fil.connect}</button>`);
    expect(fil).toContain(FB_CONFIRM_TEXT.fil.storeLabel);
    const tw = (await runtime().rt.confirmCallback({ code: "C", state: st("zh-TW") })).html as string;
    expect(tw).toContain(FB_CONFIRM_TEXT["zh-TW"].title);
    const xx = (await runtime().rt.confirmCallback({ code: "C", state: st("xx") })).html as string;
    expect(xx).toContain('<html lang="en">');
    for (const l of CONFIRM_LANGS) expect(Object.keys(FB_CONFIRM_TEXT[l as keyof typeof FB_CONFIRM_TEXT]).sort()).toEqual(Object.keys(FB_CONFIRM_TEXT.en).sort());
  });
  it("more than 20 Pages → 20 names + '+N'", () => {
    const pages = Array.from({ length: 23 }, (_, i) => ({ id: `P${i}`, name: `Page ${i}` }));
    const html = buildConfirmPage({ code: "c", state: "s", email: "a@b.co", storeName: "", appUrl: APP, pages });
    expect(html.match(/<li>/g)).toHaveLength(21);
    expect(html).toContain("<li>+3</li>");
  });
  it("no Page chosen / the link expired → the error at once, no confirm page", async () => {
    expect((await runtime(graph([])).rt.confirmCallback({ code: "C", state: st() })).redirect).toBe(`${APP}/?fb=error&code=no_pages`);
    expect((await runtime(graph(undefined, { failExchange: true })).rt.confirmCallback({ code: "C", state: st() })).redirect).toBe(`${APP}/?fb=error&code=token_exchange`);
  });
});

describe("one exchange per code, shared by the confirm page and Connect", () => {
  it("confirm page (GET) then Connect (POST) → the code is exchanged once; the Pages are saved on Connect", async () => {
    const { rt, upserts, fetchImpl } = runtime();
    await rt.confirmCallback({ code: "C", state: st() });
    await rt.confirmCallback({ code: "C", state: st() });  // a reload of the confirm page
    const codeCalls = () => fetchImpl.mock.calls.filter((c) => String(c[0]).includes("code=C")).length;
    expect(codeCalls()).toBe(1);
    expect(upserts).toEqual([]);
    const { redirect } = await rt.handleCallback({ code: "C", state: st() });
    expect(redirect).toBe(`${APP}/?fb=connected`);
    expect(codeCalls()).toBe(1);
    expect(upserts).toHaveLength(3);
  });
  it("after Connect the answer is dropped (a later Connect exchanges again → today's behaviour)", async () => {
    const { rt, fetchImpl } = runtime();
    await rt.handleCallback({ code: "C", state: st() });
    await rt.handleCallback({ code: "C", state: st() });
    expect(fetchImpl.mock.calls.filter((c) => String(c[0]).includes("code=C"))).toHaveLength(2);
  });
  it("a failed exchange is not kept (a reload tries again)", async () => {
    const f = graph(undefined, { failExchange: true });
    const { rt } = runtime(f);
    await rt.confirmCallback({ code: "C", state: st() });
    await new Promise((r) => setTimeout(r, 0));
    await rt.confirmCallback({ code: "C", state: st() });
    expect(f.mock.calls.filter((c) => String(c[0]).includes("code=C"))).toHaveLength(2);
  });
});

describe("the language in the state", () => {
  it("signed inside the HMAC: changing or adding it breaks the state; unknown values are not signed", () => {
    const s = st("fil");
    expect(verifyStateDetail(s, KEY, NOW)).toEqual({ userId: "user-1", app: false, lang: "fil" });
    const p = s.split(".");
    expect(verifyStateDetail([p[0], p[1], "lvi", p[3]].join("."), KEY, NOW)).toBeNull();
    const web = st().split(".");
    expect(verifyStateDetail([web[0], web[1], "lfil", web[2]].join("."), KEY, NOW)).toBeNull();
    expect(st("xx").split(".")).toHaveLength(3);
    const app = signState({ userId: "user-1", key: KEY, nowMs: NOW, app: true, lang: "zh-TW" });
    expect(verifyStateDetail(app, KEY, NOW)).toEqual({ userId: "user-1", app: true, lang: "zh-TW" });
  });
  let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
  afterEach(() => { if (server) { server.close(); server = null; } });
  it("/fb/oauth/start?lang= → signed only when it is one of the 8 languages", async () => {
    const { rt } = runtime();
    const app = express();
    rt.registerRoutes(app as never, ((req: { authUserId?: string }, _s: unknown, n: () => void) => { req.authUserId = "user-1"; n(); }) as never);
    server = app.listen(0);
    await new Promise((r) => server!.once("listening", r));
    const base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
    const stateOf = async (q: string) => new URL((await (await fetch(`${base}/fb/oauth/start${q}`)).json()).url).searchParams.get("state")!;
    expect(verifyStateDetail(await stateOf("?lang=fil"), KEY, NOW)).toEqual({ userId: "user-1", app: false, lang: "fil" });
    expect(verifyStateDetail(await stateOf("?client=app&lang=th"), KEY, NOW)).toEqual({ userId: "user-1", app: true, lang: "th" });
    expect(verifyStateDetail(await stateOf("?lang=../x"), KEY, NOW)).toEqual({ userId: "user-1", app: false });
    expect(verifyStateDetail(await stateOf(""), KEY, NOW)).toEqual({ userId: "user-1", app: false });
  });
});
