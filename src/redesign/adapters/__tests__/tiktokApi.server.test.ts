// TikTok API — Branch 1 server half (server/tiktokConfig.js, server/tiktokBiz.js, sql/138, server.js
// wiring). server.js has no vitest harness → its wiring is pinned by source checks.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tiktokConfig, TT_SCOPES_B1, TT_AUTHORIZE_URL, TT_BIZ_API } from "../../../../server/tiktokConfig.js";
import { signTtState, verifyTtState, parseTtSignature, verifyTtWebhook, connectVerdict, publicAccount, tokenColumns, needsRefresh, infoToColumns, createTiktokRuntime, webhookEventKey, APP_AUTH_CALLBACK } from "../../../../server/tiktokBiz.js";
import { decryptToken } from "../../../../server/fbTokens.js";
import { FEATURE_KEYS } from "../featureAccess";
import { FEATURE_SWITCH_KEYS } from "../featureSwitches";

const ENV = { TIKTOK_API_ENABLED: "true", TIKTOK_TOKEN_KEY: "k", TIKTOK_BIZ_APP_ID: "7000", TIKTOK_BIZ_APP_SECRET: "bizsecret", TIKTOK_BIZ_REDIRECT_URI: "https://sellerflow-live-server.onrender.com/tiktok/oauth/callback", TIKTOK_DEV_CLIENT_KEY: "aw1", TIKTOK_DEV_CLIENT_SECRET: "devsecret", TIKTOK_DEV_REDIRECT_URI: "https://sellerflow-live-server.onrender.com/tiktok/dev/callback" };

describe("tiktokConfig — fail closed", () => {
  it("ON only with the literal 'true' and every secret; any missing → { enabled:false }", () => {
    expect(tiktokConfig(ENV).enabled).toBe(true);
    expect(tiktokConfig({ ...ENV, TIKTOK_API_ENABLED: "TRUE" }).enabled).toBe(false);
    expect(tiktokConfig({ ...ENV, TIKTOK_API_ENABLED: "" }).enabled).toBe(false);
    for (const k of Object.keys(ENV)) if (k !== "TIKTOK_API_ENABLED") expect(tiktokConfig({ ...ENV, [k]: " " }).enabled, k).toBe(false);
    expect(tiktokConfig({}).enabled).toBe(false);
    expect(tiktokConfig(undefined as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
  });
});

describe("OAuth state nonce (own kind 'tt')", () => {
  it("round-trips the user + app flag; tamper / wrong key / expiry / FB-kind → null", () => {
    const st = signTtState({ userId: "u-1", key: "bizsecret", nowMs: 1000, app: true });
    expect(verifyTtState(st, "bizsecret", 2000)).toEqual({ userId: "u-1", app: true });
    expect(verifyTtState(signTtState({ userId: "u-1", key: "bizsecret", nowMs: 1000 }), "bizsecret", 2000)).toEqual({ userId: "u-1", app: false });
    expect(verifyTtState(st, "other", 2000)).toBeNull();
    expect(verifyTtState(st, "bizsecret", 1000 + 11 * 60 * 1000)).toBeNull();
    expect(verifyTtState(st.replace("ktt", "kfb"), "bizsecret", 2000)).toBeNull();
    expect(verifyTtState(`${st}x`, "bizsecret", 2000)).toBeNull();
    expect(verifyTtState("", "bizsecret", 2000)).toBeNull();
  });
});

describe("webhook signature (TikTok-Signature t=…,s=…, HMAC-SHA256 with the DEV client secret over `${t}.${rawBody}`)", () => {
  const body = Buffer.from(JSON.stringify({ client_key: "aw1", event: "authorization.removed", create_time: 1700000000, user_openid: "o1", content: "{}" }));
  const sig = (t: number, secret = "devsecret") => `t=${t},s=${createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex")}`;
  it("accepts a fresh, correctly signed raw body; rejects bad/old/unsigned", () => {
    expect(parseTtSignature(sig(1700000000))).toEqual({ t: "1700000000", s: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(verifyTtWebhook({ header: sig(1700000000), rawBody: body, secret: "devsecret", nowS: 1700000100 })).toEqual({ ok: true });
    expect(verifyTtWebhook({ header: sig(1700000000, "other"), rawBody: body, secret: "devsecret", nowS: 1700000100 }).reason).toBe("bad_signature");
    expect(verifyTtWebhook({ header: sig(1700000000), rawBody: Buffer.from("{}"), secret: "devsecret", nowS: 1700000100 }).reason).toBe("bad_signature");
    expect(verifyTtWebhook({ header: sig(1700000000), rawBody: body, secret: "devsecret", nowS: 1700000000 + 6 * 60 }).reason).toBe("stale");
    expect(verifyTtWebhook({ header: "nonsense", rawBody: body, secret: "devsecret", nowS: 1700000100 }).reason).toBe("bad_header");
    expect(verifyTtWebhook({ header: sig(1700000000), rawBody: body, secret: "", nowS: 1700000100 }).reason).toBe("no_secret");
    expect(webhookEventKey(JSON.parse(body.toString()))).toBe("authorization.removed|o1|1700000000");
  });
});

describe("pure verdicts + row shaping", () => {
  it("connectVerdict: Business account AND one of the registered TikTok usernames (same seat)", () => {
    const info = { username: "Amy.Ukay2026", is_business_account: true };
    expect(connectVerdict({ info, registeredRaw: "@amy.ukay2026, other" })).toEqual({ ok: true });
    expect(connectVerdict({ info, registeredRaw: "other\nsomeone" }).code).toBe("not_registered");
    expect(connectVerdict({ info, registeredRaw: "" }).code).toBe("not_registered");
    expect(connectVerdict({ info: { ...info, is_business_account: false }, registeredRaw: "amy.ukay2026" }).code).toBe("not_business");
    expect(connectVerdict({ info: { username: "" }, registeredRaw: "amy.ukay2026" }).code).toBe("read_failed");
  });
  it("publicAccount never carries the token columns; tokenColumns encrypts + stamps both expiries", () => {
    const cols = tokenColumns({ access_token: "A", refresh_token: "R", expires_in: 86400, refresh_token_expires_in: 31536000, scope: "user.info.basic,user.account.type" }, "k", 0);
    expect(decryptToken(cols.access_token_enc, "k")).toBe("A");
    expect(decryptToken(cols.refresh_token_enc, "k")).toBe("R");
    expect(cols.expires_at).toBe(new Date(86400 * 1000).toISOString());
    expect(cols.refresh_expires_at).toBe(new Date(31536000 * 1000).toISOString());
    expect(cols.scopes).toEqual(["user.info.basic", "user.account.type"]);
    const pub = publicAccount({ id: "x", tt_account_id: "o1", username: "amy", followers: "12", status: "active", ...cols }) as Record<string, unknown>;
    expect(JSON.stringify(pub)).not.toMatch(/token/);
    expect(pub.followers).toBe(12);
    expect(infoToColumns({ username: "amy", display_name: "Amy", profile_image: "https://p/x.jpg", followers_count: 3 })).toEqual({ username: "amy", display_name: "Amy", avatar_url: "https://p/x.jpg", followers: 3 });
    expect(needsRefresh({ expires_at: new Date(10 * 3600 * 1000).toISOString() }, 0)).toBe(false);
    expect(needsRefresh({ expires_at: new Date(5 * 3600 * 1000).toISOString() }, 0)).toBe(true);
    expect(needsRefresh({ expires_at: null }, 0)).toBe(true);
  });
});

function makeRuntime(fetchPlan: (url: string, init: RequestInit) => unknown, rows: Record<string, unknown>[] = []) {
  const store = {
    rows,
    getAccount: vi.fn(async (userId: string) => rows.find((r) => r.user_id === userId) || null),
    listAccountsOf: vi.fn(async (userId: string) => rows.filter((r) => r.user_id === userId)),
    listAccounts: vi.fn(async () => rows),
    upsertAccount: vi.fn(async (cols: Record<string, unknown>) => { rows.push({ id: `id${rows.length + 1}`, ...cols }); }),
    updateAccount: vi.fn(async (id: string, patch: Record<string, unknown>) => { const r = rows.find((x) => x.id === id); if (r) Object.assign(r, patch); }),
    deleteAccount: vi.fn(async (id: string) => { const i = rows.findIndex((x) => x.id === id); if (i >= 0) rows.splice(i, 1); }),
    getRegistered: vi.fn(async () => "@amy.ukay2026"),
    markWebhook: vi.fn(async () => {}),
  };
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => { calls.push(`${init.method || "GET"} ${url}`); const body = fetchPlan(url, init); return { ok: true, json: async () => body }; });
  const log = vi.fn();
  const rt = createTiktokRuntime({ config: tiktokConfig(ENV), store, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1_700_000_000_000, log });
  return { rt, store, calls, log };
}
const TOKEN = { code: 0, data: { access_token: "AT", refresh_token: "RT", expires_in: 86400, refresh_token_expires_in: 31536000, open_id: "o1", scope: "user.info.basic" } };
const INFO = (over = {}) => ({ code: 0, data: { username: "amy.ukay2026", display_name: "Amy", profile_image: "https://p/a.jpg", followers_count: 12400, is_business_account: true, ...over } });

describe("runtime", () => {
  it("buildAuthUrl: TikTok authorize URL with client_key, Branch-1 scopes, the registered redirect and a signed state", () => {
    const { rt } = makeRuntime(() => ({}));
    const u = new URL(rt.buildAuthUrl("u-1", { app: true }));
    expect(`${u.origin}${u.pathname}`).toBe(TT_AUTHORIZE_URL);
    expect(u.searchParams.get("client_key")).toBe("7000");
    expect(u.searchParams.get("scope")).toBe(TT_SCOPES_B1.join(","));
    expect(u.searchParams.get("redirect_uri")).toBe(ENV.TIKTOK_BIZ_REDIRECT_URI);
    expect(verifyTtState(u.searchParams.get("state"), "bizsecret", 1_700_000_000_000)).toEqual({ userId: "u-1", app: true });
  });
  it("callback: exchange → /business/get/ → verdict → encrypted row; app flows bounce to the app scheme", async () => {
    const { rt, store, calls } = makeRuntime((url) => (url.includes("/tt_user/oauth2/token/") ? TOKEN : INFO()));
    const state = signTtState({ userId: "u-1", key: "bizsecret", nowMs: 1_700_000_000_000, app: true });
    const out = await rt.handleCallback({ code: "c", state });
    expect(out.redirect).toBe(`${APP_AUTH_CALLBACK}?tt=connected`);
    expect(calls[0]).toBe(`POST ${TT_BIZ_API}/tt_user/oauth2/token/`);
    expect(calls[1]).toMatch(new RegExp(`^GET ${TT_BIZ_API}/business/get/\\?business_id=o1`));
    const row = store.rows[0];
    expect(row.user_id).toBe("u-1"); expect(row.tt_account_id).toBe("o1"); expect(row.username).toBe("amy.ukay2026"); expect(row.status).toBe("active");
    expect(decryptToken(String(row.access_token_enc), "k")).toBe("AT");
    expect(String(row.access_token_enc)).not.toBe("AT");
  });
  it("callback refusals revoke the token and store nothing: personal account, unregistered username, bad state", async () => {
    const personal = makeRuntime((url) => (url.includes("/tt_user/oauth2/token/") ? TOKEN : INFO({ is_business_account: false })));
    const state = signTtState({ userId: "u-1", key: "bizsecret", nowMs: 1_700_000_000_000 });
    expect((await personal.rt.handleCallback({ code: "c", state })).redirect).toBe("https://www.sellerflowlive.com/?tt=error&code=not_business");
    expect(personal.calls.some((c) => c.includes("/tt_user/oauth2/revoke/"))).toBe(true);
    expect(personal.store.rows).toHaveLength(0);
    const other = makeRuntime((url) => (url.includes("/tt_user/oauth2/token/") ? TOKEN : INFO({ username: "someone.else" })));
    expect((await other.rt.handleCallback({ code: "c", state })).redirect).toBe("https://www.sellerflowlive.com/?tt=error&code=not_registered");
    expect(other.store.rows).toHaveLength(0);
    expect((await other.rt.handleCallback({ code: "c", state: "bad" })).redirect).toBe("https://www.sellerflowlive.com/?tt=error&code=bad_state");
    expect((await other.rt.handleCallback({ code: "", state })).redirect).toBe("https://www.sellerflowlive.com/?tt=error&code=missing_params");
  });
  it("refresh-on-use: expiring row → one refresh (per-account lock), the ROTATED refresh token stored; a refused refresh → status 'revoked'", async () => {
    const cols = tokenColumns({ access_token: "OLD", refresh_token: "RT1", expires_in: 3600, refresh_token_expires_in: 31536000 }, "k", 1_700_000_000_000);
    const rows = [{ id: "id1", user_id: "u-1", tt_account_id: "o1", status: "active", ...cols }];
    const { rt, store, calls } = makeRuntime(() => ({ code: 0, data: { access_token: "NEW", refresh_token: "RT2", expires_in: 86400, refresh_token_expires_in: 31536000, scope: "user.info.basic" } }), rows);
    const [a, b] = await Promise.all([rt.freshToken(rows[0]), rt.freshToken(rows[0])]);
    expect(a.ok && a.token).toBe("NEW"); expect(b.ok && b.token).toBe("NEW");
    expect(calls.filter((c) => c.includes("/tt_user/oauth2/refresh_token/"))).toHaveLength(1);
    expect(decryptToken(String(store.rows[0].refresh_token_enc), "k")).toBe("RT2");
    const bad = makeRuntime(() => ({ code: 40001, message: "invalid refresh token" }), [{ id: "id1", user_id: "u-1", tt_account_id: "o1", status: "active", ...cols }]);
    expect((await bad.rt.freshToken(bad.store.rows[0])).ok).toBe(false);
    expect(bad.store.rows[0].status).toBe("revoked");
    expect(JSON.stringify(bad.log.mock.calls)).not.toContain("RT1"); // tokens never reach a log
  });
  it("disconnect revokes at TikTok, deletes the row and calls the Branch-2 hook; revoke-all covers every row of the user", async () => {
    const cols = tokenColumns({ access_token: "AT", refresh_token: "RT", expires_in: 86400, refresh_token_expires_in: 31536000 }, "k", 1_700_000_000_000);
    const rows = [{ id: "id1", user_id: "u-1", tt_account_id: "o1", status: "active", ...cols }, { id: "id2", user_id: "u-1", tt_account_id: "o2", status: "revoked", ...cols }];
    const onDisconnect = vi.fn(async () => {});
    const { calls, store } = makeRuntime(() => ({ code: 0, data: {} }), rows);
    const rt = createTiktokRuntime({ config: tiktokConfig(ENV), store, onDisconnect, fetchImpl: (async (url: string, init: RequestInit) => { calls.push(`${init.method} ${url}`); return { ok: true, json: async () => ({ code: 0, data: {} }) }; }) as unknown as typeof fetch, now: () => 1_700_000_000_000, log: () => {} });
    expect(await rt.revokeAllForUser("u-1")).toBe(2);
    expect(calls.filter((c) => c.includes("/tt_user/oauth2/revoke/"))).toHaveLength(2);
    expect(store.rows).toHaveLength(0);
    expect(onDisconnect).toHaveBeenCalledTimes(2);
  });
  it("webhook handler: parses the raw body, drops duplicates, stamps last_webhook_at, never throws on junk", () => {
    const { rt, store, log } = makeRuntime(() => ({}));
    const ev = Buffer.from(JSON.stringify({ event: "authorization.removed", user_openid: "o1", create_time: 1 }));
    expect(rt.handleWebhook(ev)).toEqual({ ok: true, event: "authorization.removed" });
    expect(rt.handleWebhook(ev)).toEqual({ ok: true, duplicate: true });
    expect(store.markWebhook).toHaveBeenCalledWith("o1");
    expect(rt.handleWebhook(Buffer.from("not json")).ok).toBe(false);
    expect(JSON.stringify(log.mock.calls)).toContain("[TT-HOOK]");
  });
});

describe("server.js wiring + sql/138 (source contracts)", () => {
  const server = readFileSync("server.js", "utf8");
  it("webhook on the raw-body skip list; own try/catch; every /tiktok/* route answers 404 off until the env + table probe pass", () => {
    expect(server).toContain('req.path === "/tiktok/webhook" || req.path === "/admin/parcel-scan"'); // first in the chain: the FB line stays byte-identical (fbReceipt pin)
    expect(server).toContain('app.use(/^\\/tiktok(\\/|$)/, (req, res, next) => (tiktokReady ? next() : res.status(404).json(TT_OFF_BODY)));');
    expect(server).toContain('console.error("[TT-AUTH] init failed — TikTok API disabled, Facebook/live unaffected:"');
    expect(server).toContain('from("tiktok_business_accounts").select("id").limit(1).then(');
    expect(server.indexOf("let tiktokRuntime = null;")).toBeGreaterThan(server.indexOf('console.error("[FB] init failed')); // separate from + after the FB block
    expect(server).toContain('express.raw({ type: () => true, limit: TT_WEBHOOK_MAX_BODY })');
    expect(server).toContain('.eq("key", "tiktok_api_enabled")');
    expect(server).toContain('.eq("feature", "tiktok_api")');
  });
  it("sql/138: columns, RLS select-own, revoke all, column grant WITHOUT the token columns, FK cascade, switch + key + the two preview rows; rollback restores the sql/137 list", () => {
    const sql = readFileSync("sql/138_tiktok_business.sql", "utf8");
    const rb = readFileSync("sql/138_tiktok_business_rollback.sql", "utf8");
    for (const f of [sql, rb]) { expect(f).toMatch(/NOT APPLIED|Rollback of sql\/138/); expect(f).toContain("begin;"); expect(f).toContain("set local lock_timeout = '5s';"); expect(f.trim().endsWith("commit;")).toBe(true); }
    for (const col of ["tt_account_id", "username", "display_name", "avatar_url", "followers", "access_token_enc", "refresh_token_enc", "scopes", "expires_at", "refresh_expires_at", "status", "last_poll_at", "last_webhook_at", "created_at", "updated_at"]) expect(sql).toContain(col);
    expect(sql).toContain("references auth.users(id) on delete cascade");
    expect(sql).toContain("unique (user_id, tt_account_id)");
    expect(sql).toContain("check (status in ('active', 'revoked', 'error'))");
    expect(sql).toContain("for select using (user_id = (select auth.uid()))");
    expect(sql).toContain("revoke all on table public.tiktok_business_accounts from authenticated;");
    const grant = sql.slice(sql.indexOf("grant select ("), sql.indexOf("to authenticated;"));
    expect(grant).not.toMatch(/token/);
    expect(sql).not.toMatch(/grant (insert|update|delete)/);
    expect(sql).toContain("('tiktok_api_enabled', 'false')");
    expect(sql).toContain("('tiktok_api', 'camilajeffrey1@gmail.com', false)");
    expect(sql).toContain("('tiktok_api', 'test@gmail.com', false)");
    const keysOf = (f: string) => [...f.slice(f.indexOf("keys(k) as (")).split("\n  )")[0].matchAll(/\('([a-z0-9_]+)'\)/g)].map((m) => m[1]);
    const k137 = keysOf(readFileSync("sql/137_fb_post_sales.sql", "utf8"));
    expect(keysOf(sql)).toEqual([...k137, "tiktok_api"]);
    expect(keysOf(rb)).toEqual(k137);
    expect([...keysOf(sql)].sort()).toEqual([...FEATURE_KEYS].sort());
    expect(FEATURE_SWITCH_KEYS.tiktokApi).toBe("tiktok_api_enabled");
    expect(rb).toContain("drop table if exists public.tiktok_business_accounts;");
    expect(rb).toContain("delete from public.feature_access_emails where feature = 'tiktok_api';");
  });
});
