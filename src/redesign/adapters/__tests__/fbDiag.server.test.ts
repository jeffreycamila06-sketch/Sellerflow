// @vitest-environment node
// FB comment diagnostics (server/fbDiag.js + the server.js route), Nov 12 2026. Read-only, admin-only.
// Pins: the answer (debug_token, tasks, the poller's live pick, comment counts on the live_video and
// on its video object, the poller-filter variant, video mode on code 10); IDs/counts only — no token,
// app token, secret, token key, buyer name or comment text in the answer or the log line, even when
// Facebook echoes the token back; comments are asked for with id,created_time,from{id} only; GET only;
// every failing step is reported, never thrown; the route sits behind the REAL requireAdmin (403 for a
// non-admin, lifted verbatim from server.js) and the poller file is not touched.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { encryptToken } from "../../../../server/fbTokens.js";
import { runFbDiag, createFbDiagHandler, countCommentsFrom, pickPageRow, FB_DIAG_PATH } from "../../../../server/fbDiag.js";

const ROOT = resolve(__dirname, "../../../../");
const server = readFileSync(resolve(ROOT, "server.js"), "utf8");
const PAGE = "117959226341085";
const LV = "1651545750317441";
const VID = "1651545750999999";
const TOKEN = "EAAGpagetokenSECRET0123456789abcdef";
const config = { enabled: true, appId: "1234567890", appSecret: "appsecretVALUE987654321", tokenKey: "tokenkeyMATERIAL-0123456789-abcdef" };
const row = (extra: Record<string, unknown> = {}) => ({
  user_id: "seller-uuid-1", page_id: PAGE, active: true, can_message: false, created_at: "2026-11-12T09:56:00Z",
  updated_at: "2026-11-12T09:56:00Z", token_expires_at: null, access_token: encryptToken(TOKEN, config.tokenKey), page_name: "Jewels", ...extra,
});
const SECRETS = [TOKEN, config.appSecret, config.tokenKey, `${config.appId}|${config.appSecret}`];

type Reply = { status: number; body: unknown } | Error;
// A fake Graph: route by path; records every request (method + url).
function fakeGraph(routes: Record<string, Reply | ((u: URL) => Reply)>) {
  const calls: { method: string; url: string }[] = [];
  const fetchImpl = async (raw: string, init?: { method?: string }) => {
    calls.push({ method: String(init?.method || "GET"), url: String(raw) });
    const u = new URL(raw);
    const path = u.pathname.replace(/^\/v[\d.]+/, "");
    const key = Object.keys(routes).find((k) => {
      const [p, q] = k.split("?");
      return p === path && (!q || q.split("&").every((kv) => { const [a, b] = kv.split("="); return u.searchParams.get(a) === b; }));
    });
    let r = key ? routes[key] : { status: 404, body: { error: { code: 803, message: "not routed" } } };
    if (typeof r === "function") r = r(u);
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => r.body } as unknown as Response;
  };
  return { fetchImpl, calls };
}

const HAPPY = {
  "/debug_token": { status: 200, body: { data: { is_valid: true, type: "PAGE", app_id: "1234567890", profile_id: PAGE, scopes: ["pages_show_list", "pages_read_engagement"], granular_scopes: [{ scope: "pages_read_engagement", target_ids: [PAGE] }], expires_at: 0, data_access_expires_at: 1800000000 } } },
  [`/${PAGE}`]: { status: 200, body: { id: PAGE, name: "Jewels by ZN", tasks: ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT", "MANAGE"] } },
  [`/${PAGE}/live_videos`]: { status: 200, body: { data: [
    { id: "999", status: "VOD", broadcast_start_time: "2026-11-12T10:30:00+0000" },
    { id: LV, status: "LIVE", broadcast_start_time: "2026-11-12T10:00:00+0000" },
  ] } },
  [`/${LV}`]: { status: 200, body: { id: LV, status: "LIVE", broadcast_start_time: "2026-11-12T10:00:00+0000", video: { id: VID } } },
  [`/${LV}/comments`]: { status: 200, body: { data: [{ id: "c1", created_time: "t", from: { id: PAGE } }], summary: { total_count: 243 } } },
  [`/${VID}/comments`]: { status: 200, body: { data: [
    { id: "c2", created_time: "t", from: { id: "555" } }, { id: "c3", created_time: "t", from: { id: "556" } },
    { id: "c4", created_time: "t" }, { id: "c5", created_time: "t", from: { id: PAGE } },
  ], summary: { total_count: 240 }, paging: { next: "https://graph.facebook.com/x?after=1" } } },
};

describe("runFbDiag — the answer", () => {
  it("debug_token, tasks, the poller's live pick, comment counts on the live and on its video", async () => {
    const g = fakeGraph(HAPPY);
    const out = await runFbDiag({ config, pageId: PAGE, rows: [row()], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl });
    expect(out.ok).toBe(true);
    expect(out.fb_pages).toEqual({ rows: 1, picked: { user_id: "seller-uuid-1", active: true, can_message: false, created_at: "2026-11-12T09:56:00Z", updated_at: "2026-11-12T09:56:00Z", token_expires_at: null } });
    expect(out.debug_token).toMatchObject({ is_valid: true, type: "PAGE", app_id_matches: true, profile_id: PAGE, scopes: ["pages_show_list", "pages_read_engagement"], granular_scopes: [{ scope: "pages_read_engagement", target_ids: [PAGE] }], expires_at: 0, error: null });
    expect(out.page).toEqual({ id: PAGE, name_present: true, tasks: ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT", "MANAGE"] });
    expect(out.live).toMatchObject({ poller_pick: LV, video_mode: false, status: "LIVE", broadcast_start_time: "2026-11-12T10:00:00+0000", video_id: VID, failed: false });
    expect(out.comments_live).toMatchObject({ object_id: LV, ok: true, fb_total: 243, returned: 1, from_page: 1, from_missing: 0, from_others: 0, comment_ids: ["c1"] });
    expect(out.comments_video).toMatchObject({ object_id: VID, ok: true, fb_total: 240, returned: 4, from_page: 1, from_missing: 1, from_others: 2, has_next_page: true });
    expect(out.comments_live_poller_filters).toMatchObject({ object_id: LV, ok: true, returned: 1 });
    expect(out.page_only).toBe(true);
  });
  it("asks for comments with id,created_time,from{id} only — never message or names — and only GETs", async () => {
    const g = fakeGraph(HAPPY);
    await runFbDiag({ config, pageId: PAGE, rows: [row()], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl });
    const commentCalls = g.calls.filter((c) => c.url.includes("/comments"));
    expect(commentCalls.length).toBe(3);
    for (const c of commentCalls) {
      const u = new URL(c.url);
      expect(u.searchParams.get("fields")).toBe("id,created_time,from{id}");
      expect(u.searchParams.get("summary")).toBe("total_count");
      expect(u.searchParams.get("filter")).toBe("stream");
      expect(u.searchParams.get("limit")).toBe("10");
    }
    expect(g.calls.every((c) => c.method === "GET")).toBe(true);
  });
  it("video mode: live_videos refused (#10) → the Page's videos, like the poller; no separate video call", async () => {
    const g = fakeGraph({
      ...HAPPY,
      [`/${PAGE}/live_videos`]: { status: 400, body: { error: { code: 10, message: "Application does not have permission" } } },
      [`/${PAGE}/videos`]: { status: 200, body: { data: [{ id: VID, created_time: "2026-11-12T10:00:00+0000", live_status: "LIVE" }] } },
      [`/${VID}`]: { status: 200, body: { id: VID, live_status: "LIVE", created_time: "2026-11-12T10:00:00+0000" } },
    });
    const out = await runFbDiag({ config, pageId: PAGE, rows: [row()], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl });
    expect(out.live).toMatchObject({ poller_pick: VID, video_mode: true, live_videos_call: { failed: true, code: 10 }, status: "LIVE", video_id: VID });
    expect(out.comments_live).toMatchObject({ object_id: VID, returned: 4, from_others: 2 });
    expect(out.comments_video).toBeNull();
    expect(out.page_only).toBe(false);
  });
  it("every step that fails is reported with its code, nothing throws", async () => {
    const g = fakeGraph({
      "/debug_token": new Error("socket hang up"),
      [`/${PAGE}`]: { status: 400, body: { error: { code: 100, error_subcode: 33, message: "(#100) Tried accessing nonexisting field (tasks)" } } },
      [`/${PAGE}/live_videos`]: { status: 200, body: { data: [{ id: LV, status: "LIVE", broadcast_start_time: "x" }] } },
      [`/${LV}`]: { status: 500, body: {} },
      [`/${LV}/comments`]: { status: 403, body: { error: { code: 200, error_subcode: 2069030, message: "Permissions error" } } },
    });
    const out = await runFbDiag({ config, pageId: PAGE, rows: [row()], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl });
    expect(out.debug_token).toEqual({ error: { http: null, code: null, error_subcode: null, type: null, message: "request_failed" } });
    expect(out.page).toMatchObject({ error: { http: 400, code: 100, error_subcode: 33 } });
    expect(out.live.detail_error).toMatchObject({ http: 500 });
    expect(out.comments_live).toMatchObject({ ok: false, error: { http: 403, code: 200, error_subcode: 2069030, message: "Permissions error" } });
    expect(out.comments_video).toBeNull();
  });
  it("no row → page_not_found; unreadable token → token_unreadable; no Graph call", async () => {
    const g = fakeGraph(HAPPY);
    expect(await runFbDiag({ config, pageId: PAGE, rows: [], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl })).toMatchObject({ ok: false, error: "page_not_found" });
    expect(await runFbDiag({ config, pageId: PAGE, rows: [row({ access_token: "garbage" })], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl })).toMatchObject({ ok: false, error: "token_unreadable" });
    expect(g.calls).toEqual([]);
  });
  it("helpers: from counts, row pick (active first, newest)", () => {
    expect(countCommentsFrom([{ from: { id: "1" } }, {}, { from: {} }, { from: { id: "9" } }], "1")).toEqual({ returned: 4, from_page: 1, from_missing: 2, from_others: 1 });
    const a = { active: false, updated_at: "2026-11-12T10:00:00Z" }, b = { active: true, updated_at: "2026-11-01T00:00:00Z" }, c = { active: true, updated_at: "2026-11-12T00:00:00Z" };
    expect(pickPageRow([a, b, c])).toBe(c);
  });
});

describe("redaction — never a token, the app secret, a buyer name or comment text", () => {
  it("even when Facebook echoes the token / app token in error messages and returns names + text", async () => {
    const echo = (m: string): Reply => ({ status: 400, body: { error: { code: 190, message: `Invalid token ${m} at https://graph.facebook.com/x?access_token=${TOKEN}` } } });
    const g = fakeGraph({
      ...HAPPY,
      "/debug_token": { status: 200, body: { data: { is_valid: false, error: { code: 190, subcode: 460, message: `Session for ${TOKEN} has expired (${config.appId}|${config.appSecret})` }, scopes: [] } } },
      [`/${PAGE}`]: echo(TOKEN),
      [`/${LV}/comments`]: { status: 200, body: { data: [{ id: "c1", created_time: "t", from: { id: "77", name: "Buyer Maria Santos" }, message: "mine po! 0912345678" }], summary: { total_count: 9 } } },
    });
    const logs: string[] = [];
    const app = express();
    app.get(FB_DIAG_PATH, createFbDiagHandler({ config, readPageRows: async () => [row()], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl, log: (l: string) => { logs.push(l); } }));
    const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
    try {
      const r = await fetch(`http://127.0.0.1:${port}${FB_DIAG_PATH}?page_id=${PAGE}`);
      const text = await r.text();
      expect(r.status).toBe(200);
      for (const s of [...SECRETS, row().access_token as string, "Maria", "mine po", "0912345678", "access_token"]) {
        expect(text, s).not.toContain(s);
        expect(logs.join("\n"), s).not.toContain(s);
      }
      expect(text).toContain("[redacted]");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect(logs.length).toBe(1);
      expect(logs[0]).toMatch(/^\[FB-DIAG\] page=117959226341085 valid=false /);
    } finally { srv.close(); }
  });
});

describe("the route — admin only, read-only, poller untouched", () => {
  // The REAL requireAdmin, lifted verbatim from server.js and run with a fake database answer.
  const src = server.slice(server.indexOf("async function requireAdmin(req, res, next) {"), server.indexOf("// ====", server.indexOf("async function requireAdmin(req, res, next) {")));
  const realRequireAdmin = (isAdmin: unknown) => new Function("sb", "SUPABASE_URL", "SUPABASE_KEY", "createClient", `${src}; return requireAdmin;`)(
    {}, "https://x.supabase.co", "anon", () => ({ rpc: async () => (isAdmin instanceof Error ? { data: null, error: isAdmin } : { data: isAdmin, error: null }) }),
  ) as express.RequestHandler;
  const call = async (isAdmin: unknown, withToken = true) => {
    const g = fakeGraph(HAPPY);
    const app = express();
    app.get(FB_DIAG_PATH, (req, _res, next) => { (req as unknown as { authToken: string }).authToken = withToken ? "jwt" : ""; next(); }, realRequireAdmin(isAdmin),
      createFbDiagHandler({ config, readPageRows: async () => [row()], fetchImpl: g.fetchImpl, appFetch: g.fetchImpl }));
    const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
    try {
      const r = await fetch(`http://127.0.0.1:${port}${FB_DIAG_PATH}?page_id=${PAGE}`);
      return { status: r.status, body: await r.json(), graphCalls: g.calls.length };
    } finally { srv.close(); }
  };
  it("the lifted requireAdmin is the real one", () => {
    expect(src).toContain('const { data, error } = await userSb.rpc("is_admin");');
    expect(src).toContain("if (error || data !== true) return deny();");
  });
  it("non-admin → 403, nothing read from Facebook", async () => {
    expect(await call(false)).toEqual({ status: 403, body: { success: false, error: "forbidden" }, graphCalls: 0 });
  });
  it("admin check error / no login → 403 (fail closed)", async () => {
    expect((await call(new Error("rpc down"))).status).toBe(403);
    expect((await call(true, false)).status).toBe(403);
  });
  it("admin → 200 with the diagnosis", async () => {
    const r = await call(true);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, page_id: PAGE, live: { poller_pick: LV } });
  });
  it("bad page_id → 400; database error → 502", async () => {
    const app = express();
    app.get(FB_DIAG_PATH, createFbDiagHandler({ config, readPageRows: async () => { throw new Error("db"); }, fetchImpl: fetch, appFetch: fetch }));
    const srv = app.listen(0); const port = (srv.address() as { port: number }).port;
    try {
      expect((await fetch(`http://127.0.0.1:${port}${FB_DIAG_PATH}?page_id=abc`)).status).toBe(400);
      expect((await fetch(`http://127.0.0.1:${port}${FB_DIAG_PATH}?page_id=${PAGE}`)).status).toBe(502);
    } finally { srv.close(); }
  });
  it("server.js: the path, behind requireAuth + requireAdmin, rows read by page_id, the poller's appsecret_proof fetch", () => {
    expect(FB_DIAG_PATH).toBe("/api/admin/fb-diag");
    expect(server).toContain("app.get(FB_DIAG_PATH, requireAuth, requireAdmin, createFbDiagHandler({");
    expect(server.split("createFbDiagHandler(").length - 1).toBe(1);
    const route = server.slice(server.indexOf("app.get(FB_DIAG_PATH"), server.indexOf("}));", server.indexOf("app.get(FB_DIAG_PATH")));
    expect(route).toContain('.from("fb_pages").select("*").eq("page_id", String(pageId))');
    expect(route).toContain("fetchImpl: withAppSecretProof(globalThis.fetch, fbCfg.appSecret)");
    expect(route).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("the diag module only reads: no write, no poller start/stop, no emit", () => {
    const mod = readFileSync(resolve(ROOT, "server/fbDiag.js"), "utf8");
    expect(mod).not.toMatch(/\.(insert|update|upsert|delete)\(|method:\s*"(POST|DELETE)"|startPoller|stopPoller|emitComment|statusEmit/);
  });
});
