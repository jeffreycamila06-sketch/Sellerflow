// INSTAGRAM LIVE — phase 1 server pins (server/igLive.js, igComment.js, igAccess.js + the
// server.js wiring). All I/O is injected (server.js has no harness). Also pins that the
// shared Facebook confirm page is byte-identical to a verbatim copy of today's function.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createIgRuntime, igConfig, IG_OAUTH_SCOPE, IG_COMMENTS_LIMIT, classifyIgError, fetchIgAccounts, replayIgStatus,
} from "../../../../server/igLive.js";
import { igToPayload, IG_PLATFORM } from "../../../../server/igComment.js";
import { createIgLock, createIgAccessHandler } from "../../../../server/igAccess.js";
import {
  signState, buildConfirmPage, escapeHtml, maskEmail, APP_AUTH_CALLBACK, CONFIRM_SCRIPT,
  POLL_RATE_LIMIT_MS, MAX_AUTH_FAILURES, MAX_FETCH_ERRORS, IDLE_STOP_MS,
} from "../../../../server/fbLive.js";
import { encryptToken, decryptToken } from "../../../../server/fbTokens.js";
import { FB_PREVIEW_EMAILS } from "../../../../server/fbAccess.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const res = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (seller: string, platform: string, id: string) => `${seller}:${platform}:${id}`;

function makeStore(seed: Record<string, unknown>[] = [], plan = "pro") {
  const rows = new Map<string, Record<string, unknown>>();
  for (const r of seed) rows.set(`${r.user_id}:${r.ig_user_id}`, { ...r });
  const store = {
    rows, upserts: [] as Record<string, unknown>[], active: [] as unknown[], failUpsert: "" as string,
    async getPlan() { return plan; },
    async countAccounts(u: string) { return [...rows.values()].filter((r) => r.user_id === u).length; },
    async getAccount(u: string, id: string) { return rows.get(`${u}:${id}`) || null; },
    async listAccounts(u: string) { return [...rows.values()].filter((r) => r.user_id === u); },
    async upsertAccount(row: Record<string, unknown>) {
      if (store.failUpsert) throw new Error(store.failUpsert);
      store.upserts.push(row); rows.set(`${row.user_id}:${row.ig_user_id}`, { ...row });
    },
    async setActive(u: string, id: string, a: boolean) { store.active.push({ u, id, a }); const r = rows.get(`${u}:${id}`); if (r) r.active = a; },
    async getAccountLabel() { return { email: "seller@example.com", storeName: "Shop" }; },
  };
  return store;
}
function rt(o: { store?: ReturnType<typeof makeStore>; fetchImpl?: ReturnType<typeof vi.fn>; now?: () => number } = {}) {
  const store = o.store || makeStore();
  const emitComment = vi.fn(); const statusEmit = vi.fn(); const log = vi.fn();
  const fetchImpl = o.fetchImpl || vi.fn();
  const runtime = createIgRuntime({ config: CONFIG, store, emitComment, statusEmit, liveKey, renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl, now: o.now || (() => 1_000_000), log, setLoop: () => 1, clearLoop: () => {} });
  return { runtime, store, emitComment, statusEmit, fetchImpl, log };
}
const url = (call: unknown[]) => new URL(String(call[0]));

describe("igConfig — off unless IG_ENABLED=true and the Facebook secrets exist", () => {
  const secrets = { FB_APP_ID: "a", FB_APP_SECRET: "s", FB_TOKEN_KEY: "k" };
  it("on only with the literal true + all secrets (FB_ENABLED not needed)", () => {
    expect(igConfig({ ...secrets, IG_ENABLED: "true" }).enabled).toBe(true);
    expect(igConfig({ ...secrets }).enabled).toBe(false);
    expect(igConfig({ ...secrets, IG_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(igConfig({ IG_ENABLED: "true", FB_APP_ID: "a" }).enabled).toBe(false);
  });
});

describe("OAuth", () => {
  it("asks EXACTLY the four approved permissions, redirect = /ig/oauth/callback", () => {
    expect(IG_OAUTH_SCOPE).toBe("instagram_basic,instagram_manage_comments,pages_show_list,pages_read_engagement");
    const u = new URL(rt().runtime.buildAuthUrl("u1"));
    expect(u.searchParams.get("scope")).toBe(IG_OAUTH_SCOPE);
    expect(u.searchParams.get("redirect_uri")).toBe("https://srv.test/ig/oauth/callback");
  });
  const exchange = (accounts: unknown) => vi.fn(async (u: string) => {
    if (u.includes("/oauth/access_token") && u.includes("code=")) return res(200, { access_token: "short" });
    if (u.includes("fb_exchange_token")) return res(200, { access_token: "long", expires_in: 100 });
    if (u.includes("/me/accounts")) return res(200, { data: accounts });
    return res(500, {});
  });
  const page = (id: string, ig?: { id: string; username: string }) => ({ id, name: `P${id}`, access_token: `pt-${id}`, ...(ig ? { instagram_business_account: ig } : {}) });

  it("saves only Pages with a linked IG account; the PAGE token is stored encrypted, no expiry", async () => {
    const { runtime, store } = rt({ fetchImpl: exchange([page("1", { id: "17841", username: "shop.ig" }), page("2")]) });
    const out = await runtime.handleCallback({ code: "c", state: signState({ userId: "u1", key: "sekret", nowMs: 1_000_000, kind: "ig" }) });
    expect(out.redirect).toBe("https://app.test/?ig=connected");
    expect(store.upserts).toHaveLength(1);
    const row = store.upserts[0];
    expect(row).toMatchObject({ user_id: "u1", ig_user_id: "17841", ig_username: "shop.ig", page_id: "1", token_expires_at: null, active: true });
    expect(row.access_token).not.toBe("pt-1");
    expect(decryptToken(row.access_token as string, "tk")).toBe("pt-1");
    expect(JSON.stringify(row)).not.toContain("pt-1"); // the plain token is nowhere in the saved row
  });
  it("no linked IG professional account → ?ig=error&code=no_ig_account", async () => {
    const { runtime } = rt({ fetchImpl: exchange([page("2")]) });
    const out = await runtime.handleCallback({ code: "c", state: signState({ userId: "u1", key: "sekret", nowMs: 1_000_000, kind: "ig" }) });
    expect(out.redirect).toBe("https://app.test/?ig=error&code=no_ig_account");
  });
  it("plan cap: a NEW account over the cap → cap; re-authorizing an existing one passes", async () => {
    const seed = [{ user_id: "u1", ig_user_id: "17841", active: true }];
    const a = rt({ store: makeStore(seed, "basic"), fetchImpl: exchange([page("1", { id: "999", username: "new" })]) });
    expect((await a.runtime.handleCallback({ code: "c", state: signState({ userId: "u1", key: "sekret", nowMs: 1_000_000, kind: "ig" }) })).redirect).toBe("https://app.test/?ig=error&code=cap");
    const b = rt({ store: makeStore(seed, "basic"), fetchImpl: exchange([page("1", { id: "17841", username: "same" })]) });
    expect((await b.runtime.handleCallback({ code: "c", state: signState({ userId: "u1", key: "sekret", nowMs: 1_000_000, kind: "ig" }) })).redirect).toBe("https://app.test/?ig=connected");
  });
  it("the database account limit (sql/87 trigger) → account_limit", async () => {
    const s = makeStore(); s.failUpsert = "account_limit";
    const { runtime } = rt({ store: s, fetchImpl: exchange([page("1", { id: "1", username: "x" })]) });
    expect((await runtime.handleCallback({ code: "c", state: signState({ userId: "u1", key: "sekret", nowMs: 1_000_000, kind: "ig" }) })).redirect).toBe("https://app.test/?ig=error&code=account_limit");
  });
  it("bad state → web error; app flow ends on the native callback with fb= (the sheet's contract)", async () => {
    const { runtime } = rt({ fetchImpl: exchange([page("1", { id: "1", username: "x" })]) });
    expect((await runtime.handleCallback({ code: "c", state: "forged" })).redirect).toBe("https://app.test/?ig=error&code=bad_state");
    const out = await runtime.handleCallback({ code: "c", state: signState({ userId: "u1", key: "sekret", nowMs: 1_000_000, app: true, kind: "ig" }) });
    expect(out.redirect).toBe(`${APP_AUTH_CALLBACK}?fb=connected`);
  });
  it("confirm page names Instagram, posts to /ig/oauth/complete, cancels to ?ig=", async () => {
    const out = await rt().runtime.confirmCallback({ code: "c", state: signState({ userId: "u1", key: "sekret", nowMs: 1_000_000, kind: "ig" }) });
    expect(out.html).toContain("<h1>Connect your Instagram account</h1>");
    expect(out.html).toContain('action="/ig/oauth/complete"');
    expect(out.html).toContain("https://app.test/?ig=error&amp;code=cancelled");
  });
  it("fetchIgAccounts asks the nested instagram_business_account field", async () => {
    const f = vi.fn(async () => res(200, { data: [] }));
    await fetchIgAccounts({ fetchImpl: f, userToken: "t" });
    expect(url(f.mock.calls[0] as unknown[]).searchParams.get("fields")).toBe("id,name,access_token,instagram_business_account{id,username}");
  });
});

// Verbatim copy of buildConfirmPage as it was before Instagram (origin/main 957d960).
function buildConfirmPageBefore({ code, state, email, storeName, appUrl, app = false }: { code: string; state: string; email: string; storeName: string; appUrl: string; app?: boolean }) {
  const cancel = app ? `${APP_AUTH_CALLBACK}?fb=error&code=cancelled` : `${appUrl}/?fb=error&code=cancelled`;
  const store = String(storeName || "").trim();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect your Facebook Page</title>
<style>
body{margin:0;background:#f4f3fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1d1b2e}
main{max-width:420px;margin:0 auto;padding:32px 20px}
.card{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 6px 24px rgba(30,20,80,.08)}
h1{font-size:20px;margin:0 0 12px}
p{font-size:15px;line-height:1.5;margin:0 0 12px}
.acct{background:#f0eefc;border-radius:10px;padding:12px 14px;margin:0 0 12px;font-size:15px;word-break:break-all}
.acct b{display:block}
.warn{color:#8a5a00;font-weight:600}
form{margin:20px 0 0}
button,a.btn{display:block;width:100%;box-sizing:border-box;text-align:center;font-size:16px;font-weight:700;padding:14px 0;border-radius:12px;text-decoration:none}
button{border:none;background:#4f46e5;color:#fff;cursor:pointer}
a.btn{margin-top:10px;background:#fff;color:#4f46e5;border:1px solid #c9c4f2}
button:disabled{opacity:.7;cursor:default}
.note{margin:12px 0 0;font-size:13px;color:#6b6880;text-align:center}
</style></head>
<body><main><div class="card">
<h1>Connect your Facebook Page</h1>
<p>Your Facebook Page will be connected to this SellerFlowLive account:</p>
<div class="acct"><b>${escapeHtml(maskEmail(email))}</b>${store ? `${escapeHtml(store)}` : ""}</div>
<p class="warn">Only continue if this is your own SellerFlowLive account.</p>
<form id="c" method="post" action="/fb/oauth/complete">
<input type="hidden" name="code" value="${escapeHtml(code)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<button type="submit">Connect</button>
</form>
<a class="btn" href="${escapeHtml(cancel)}">Cancel</a>
<p class="note">This can take a few seconds.</p>
</div></main><script>${CONFIRM_SCRIPT}</script></body></html>`;
}
// Build 5: the same page except (1) the store name sits under "store name set by this account:"
// (never a bare headline), (2) the button carries its busy text, (3) three CSS lines for those.
const withBuild5 = (html: string, storeName: string) => html
  .replace(".acct b{display:block}\n", ".acct b{display:block}\n.acct span{display:block;margin-top:6px;font-size:13px;color:#6b6880}\n.acct i{font-style:normal;color:#1d1b2e}\n.pages{margin:0 0 12px;padding:0 0 0 20px;font-size:15px;line-height:1.5;font-weight:600}\n")
  .replace(`</b>${escapeHtml(String(storeName).trim())}</div>`, String(storeName).trim() ? `</b><span>store name set by this account: <i>${escapeHtml(String(storeName).trim())}</i></span></div>` : "</b></div>")
  .replace('<button type="submit">Connect</button>', '<button type="submit" data-busy="Connecting…">Connect</button>');
describe("Facebook confirm page = the old page + only the Build 5 changes", () => {
  it("web / app, with and without a store name, odd characters", () => {
    for (const app of [false, true]) for (const storeName of ["", "Shop <&> \"x\""]) {
      const a = { code: "c<1>", state: "s&2", email: "seller@example.com", storeName, appUrl: "https://app.test", app };
      expect(buildConfirmPage(a)).toBe(withBuild5(buildConfirmPageBefore(a), storeName));
    }
  });
});

describe("igToPayload — the comment contract", () => {
  it("platform 'Instagram' (exact casing), handle = name = username, msgId = comment id, no avatar", () => {
    const p = igToPayload({ id: "c9", text: "mine A", timestamp: "2026-10-08T09:00:00+0000", username: "buyer1", from: { id: "77", username: "buyer1" } },
      { sellerId: "s", sessionId: "sess", igUserId: "178", igUsername: "shop.ig", liveMediaId: "m1", nowMs: 0 });
    expect(p).toMatchObject({ platform: "Instagram", handle: "buyer1", name: "buyer1", comment: "mine A", msgId: "c9", avatar: "", sourceUsername: "shop.ig", roomId: "m1", sessionId: "sess", commenterId: "77", isBuy: false, buyerNum: null });
    expect(p.timestamp).toBe("2026-10-08T09:00:00.000Z");
    expect(IG_PLATFORM).toBe("Instagram");
  });
  it("missing username → handle = commenter id, name 'Unknown'", () => {
    const p = igToPayload({ id: "c1", text: "x", from: { id: "77" } }, { nowMs: 5 });
    expect(p.handle).toBe("77"); expect(p.name).toBe("Unknown");
  });
});

describe("poller", () => {
  const tok = encryptToken("pagetok", "tk");
  const seed = [{ user_id: "u1", ig_user_id: "178", ig_username: "shop.ig", access_token: tok, active: true }];
  const c = (id: string, text = "mine") => ({ id, text, timestamp: "2026-10-08T09:00:00+0000", username: `b${id}`, from: { id: `f${id}`, username: `b${id}` } });
  const start = (fetchImpl: ReturnType<typeof vi.fn>, now = () => 1_000_000) => {
    const h = rt({ store: makeStore(seed), fetchImpl, now });
    const entry = h.runtime.startPoller({ sellerId: "s1", userId: "u1", igUserId: "178", igUsername: "shop.ig", liveMediaId: "m1", sessionId: "sess" });
    return { ...h, entry };
  };
  it("first poll = initial lane, oldest first; then only new comments; asks ≤50 newest", async () => {
    let page = [c("2"), c("1")];
    const f = vi.fn(async () => res(200, { data: page }));
    const { runtime, entry, emitComment, statusEmit } = start(f);
    expect(statusEmit).toHaveBeenCalledWith("s1", { connected: true, scopeKey: "shop.ig", sessionId: "sess" });
    await runtime.pollOnce(entry);
    expect(url(f.mock.calls[0] as unknown[]).searchParams.get("limit")).toBe(String(IG_COMMENTS_LIMIT));
    expect(emitComment.mock.calls.map((x) => [x[1], x[2].msgId, x[2].initial])).toEqual([["shop.ig", "1", true], ["shop.ig", "2", true]]);
    page = [c("3"), c("2"), c("1")];
    await runtime.pollOnce(entry);
    expect(emitComment.mock.calls.slice(2).map((x) => [x[2].msgId, x[2].initial])).toEqual([["3", undefined]]);
  });
  it("Instagram throttle 80002 → wait 30 s (never an auth failure)", async () => {
    expect(classifyIgError(400, { error: { code: 80002 } })).toMatchObject({ rateLimited: true, authFail: false });
    const { runtime, entry } = start(vi.fn(async () => res(400, { error: { code: 80002 } })));
    expect(await runtime.pollOnce(entry)).toEqual({ stop: false, delayMs: POLL_RATE_LIMIT_MS });
  });
  it("invalid token (190) ×3 → account set inactive, stop(auth)", async () => {
    const { runtime, entry, store } = start(vi.fn(async () => res(400, { error: { code: 190 } })));
    for (let i = 1; i < MAX_AUTH_FAILURES; i++) expect((await runtime.pollOnce(entry)).stop).toBe(false);
    expect(await runtime.pollOnce(entry)).toEqual({ stop: true, reason: "auth" });
    expect(store.active).toEqual([{ u: "u1", id: "178", a: false }]);
  });
  it("hard errors ×3 → asks live_media: gone → session_end", async () => {
    const f = vi.fn(async (u: string) => (u.includes("/live_media") ? res(200, { data: [] }) : res(400, { error: { code: 100 } })));
    const { runtime, entry } = start(f);
    for (let i = 1; i < MAX_FETCH_ERRORS; i++) expect((await runtime.pollOnce(entry)).stop).toBe(false);
    expect(await runtime.pollOnce(entry)).toEqual({ stop: true, reason: "session_end" });
  });
  it("quiet past the idle limit → still in live_media = keep polling; gone = session_end", async () => {
    let t = 1_000_000; let live = true;
    const f = vi.fn(async (u: string) => (u.includes("/live_media") ? res(200, { data: live ? [{ id: "m1" }] : [] }) : res(200, { data: [] })));
    const { runtime, entry } = start(f, () => t);
    t += IDLE_STOP_MS;
    expect((await runtime.pollOnce(entry)).stop).toBe(false);
    t += IDLE_STOP_MS; live = false;
    expect(await runtime.pollOnce(entry)).toEqual({ stop: true, reason: "session_end" });
  });
  it("replayIgStatus re-sends one Instagram status per running poller", () => {
    const { runtime } = start(vi.fn());
    const emit = vi.fn();
    replayIgStatus(runtime, "s1", "e1", emit);
    expect(emit).toHaveBeenCalledWith({ platform: "Instagram", connected: true, sellerId: "e1", username: "shop.ig", sessionId: "sess" });
    replayIgStatus(null, "s1", "e1", emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("routes", () => {
  function register(extra: Record<string, unknown> = {}, h = rt()) {
    const routes: Record<string, ((...a: unknown[]) => unknown)[]> = {};
    const app = { get: (p: string, ...f: never[]) => { routes[`GET ${p}`] = f; }, post: (p: string, ...f: never[]) => { routes[`POST ${p}`] = f; } };
    const requireAuth = (req: Record<string, unknown>, _r: unknown, next: () => unknown) => { req.authUserId = "u1"; req.sellerId = "s1"; return next(); };
    h.runtime.registerRoutes(app, requireAuth, extra);
    const call = async (key: string, req: Record<string, unknown> = {}) => {
      const out: { status: number; body?: unknown } = { status: 200 };
      const r = { status(s: number) { out.status = s; return r; }, json(b: unknown) { out.body = b; return r; }, redirect() { return r; }, set() { return r; }, send() { return r; } };
      const chain = routes[key];
      const q = { body: {}, query: {}, ...req };
      const run = async (i: number): Promise<void> => { if (i < chain.length) await chain[i](q, r, () => run(i + 1)); };
      await run(0);
      return out;
    };
    return { routes, call, h };
  }
  it("registers the six Instagram routes, never a Facebook one", () => {
    expect(Object.keys(register().routes).sort()).toEqual(["GET /ig/accounts", "GET /ig/oauth/callback", "GET /ig/oauth/start", "POST /ig/connect", "POST /ig/disconnect", "POST /ig/oauth/complete"]);
  });
  it("/ig/connect chain: auth → lock → rate → plan → IG plan (lock first)", async () => {
    const order: string[] = [];
    const mw = (n: string) => (_q: unknown, _r: unknown, next: () => unknown) => { order.push(n); return next(); };
    const { call } = register({ requireIgAvailable: mw("lock"), requireConnectRate: mw("rate"), requirePlanActive: mw("plan"), requireIgPlan: mw("igplan") });
    await call("POST /ig/connect", { body: {} });
    expect(order).toEqual(["lock", "rate", "plan", "igplan"]);
  });
  it("not live → { ok:false, reason:'not_live' }; live → poller started; account check skipped when running", async () => {
    const tok = encryptToken("pt", "tk");
    let live = false;
    const f = vi.fn(async () => res(200, { data: live ? [{ id: "m1" }] : [] }));
    const h = rt({ store: makeStore([{ user_id: "u1", ig_user_id: "178", ig_username: "shop.ig", access_token: tok, active: true }]), fetchImpl: f });
    const check = vi.fn(async () => ({ allow: true }));
    const { call } = register({ accountLiveCheck: check }, h);
    expect((await call("POST /ig/connect", { body: { ig_user_id: "178" } })).body).toEqual({ ok: false, reason: "not_live" });
    expect(check).toHaveBeenCalledWith(expect.anything(), "instagram", "178");
    live = true;
    expect((await call("POST /ig/connect", { body: { ig_user_id: "178", sessionId: "x" } })).body).toEqual({ ok: true, live_media_id: "m1" });
    check.mockClear();
    await call("POST /ig/connect", { body: { ig_user_id: "178" } });
    expect(check).not.toHaveBeenCalled();
  });
  it("invalid token on the live check → 409 needs_reauth; account refused → 403", async () => {
    const tok = encryptToken("pt", "tk");
    const h = rt({ store: makeStore([{ user_id: "u1", ig_user_id: "178", access_token: tok, active: true }]), fetchImpl: vi.fn(async () => res(400, { error: { code: 190 } })) });
    expect((await register({}, h).call("POST /ig/connect", { body: { ig_user_id: "178" } })).status).toBe(409);
    expect((await register({ accountLiveCheck: async () => ({ allow: false }) }, h).call("POST /ig/connect", { body: { ig_user_id: "178" } })).body).toEqual({ ok: false, error: "account_not_covered" });
  });
  it("/ig/accounts never returns a token", async () => {
    const h = rt({ store: makeStore([{ user_id: "u1", ig_user_id: "178", ig_username: "x", page_name: "P", access_token: "SECRET", active: true }]) });
    const out = await register({}, h).call("GET /ig/accounts");
    expect(JSON.stringify(out.body)).not.toContain("SECRET");
    expect(out.body).toEqual({ ok: true, accounts: [{ ig_user_id: "178", username: "x", page_name: "P", active: true }] });
  });
});

describe("IG lock — same preview list as Facebook", () => {
  const run = async (email: string, flag: boolean, tester = false) => {
    const lock = createIgLock({ igEnabled: async () => flag, isIgTester: async () => tester });
    const out: { status?: number; next?: boolean; body?: unknown } = {};
    await lock({ userEmail: email }, { status: (s: number) => ({ json: (b: unknown) => { out.status = s; out.body = b; } }) }, () => { out.next = true; });
    return out;
  };
  it("preview account (incl. test@gmail.com) passes with the switch off", async () => {
    for (const e of FB_PREVIEW_EMAILS) expect((await run(e, false)).next).toBe(true);
    expect(FB_PREVIEW_EMAILS).toContain("test@gmail.com");
  });
  it("anyone else: 403 ig_not_available while off; on via ig_enabled or a tester row", async () => {
    expect(await run("seller@x.com", false)).toEqual({ status: 403, body: { ok: false, error: "ig_not_available" } });
    expect((await run("seller@x.com", true)).next).toBe(true);
    expect((await run("seller@x.com", false, true)).next).toBe(true);
  });
  it("/ig/access answers the same decision", async () => {
    const h = createIgAccessHandler({ igEnabled: async () => false });
    const r = { json: vi.fn() };
    await h({ userEmail: "seller@x.com" }, r); expect(r.json).toHaveBeenCalledWith({ ok: true, instagram: false });
    await h({ userEmail: "test@gmail.com" }, r); expect(r.json).toHaveBeenLastCalledWith({ ok: true, instagram: true });
  });
});

describe("server.js wiring (source contract)", () => {
  const src = readFileSync("server.js", "utf8");
  it("select_account accepts 'Instagram' as its own key (never folded into TikTok)", () => {
    expect(src).toContain('const p = ps === "Facebook" ? "Facebook" : ps === "Shopee" ? "Shopee" : ps === "Instagram" ? "Instagram" : "TikTok";');
  });
  it("runtime only when igConfig is on; comments go through emitCommentScoped as 'Instagram'", () => {
    expect(src).toContain("if (igCfg.enabled && serviceSb && RENDER_URL) {");
    expect(src).toContain('void emitCommentScoped(sellerId, "Instagram", scopeKey,');
    expect(src).toContain('emit("platform_status", { platform: "Instagram", connected,');
    expect(src).toContain("replayIgStatus(igRuntime, cleanId,");
  });
  it("the IG switch / tester tables are its own (ig_enabled, ig_tester_access)", () => {
    expect(src).toContain('.eq("key", "ig_enabled")');
    expect(src).toContain('.from("ig_tester_access")');
  });
});
