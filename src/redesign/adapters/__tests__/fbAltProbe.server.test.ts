// Facebook alt probe (server/fbProbe.js) — read-only research after a code-10 live check.
// Pins: the /fb/connect 502 status + body are byte-identical; the probe runs only on code 10,
// after the response, never starts a poller, never affects the response (failure / timeout /
// row write error); at most once per page every 30 s; rows and logs hold metadata only (no token,
// URL, comment text or commenter id); skipped steps are recorded; the sql/78 mirror.
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createFbRuntime, GRAPH_TIMEOUT_MS } from "../../../../server/fbLive.js";
import { createFbAltProbe, PROBE_STEPS, PROBE_MIN_INTERVAL_MS, summarize, newestId } from "../../../../server/fbProbe.js";
import { encryptToken } from "../../../../server/fbTokens.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" };
const TOKEN = "EAAB-PAGE-TOKEN-SECRET";
const USER = "user-1234567890";
const NOW = Date.parse("2026-10-05T12:00:00Z");
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const CODE10 = mkRes(400, { error: { code: 10, type: "OAuthException", message: "(#10) To use 'live-video-api' on behalf of people who are not admins, developers and testers of your app…" } });
const ago = (s: number) => new Date(NOW - s * 1000).toISOString().replace(".000Z", "+0000");
const PIC = "https://scontent.xx.fbcdn.net/SECRET-PICTURE.jpg";
const CURSOR = "QVFIUSECRETCURSOR";
const COMMENTS = {
  data: [
    { id: "V9_c1", created_time: ago(30), from: { id: "COMMENTER-ID-777", name: "Secret Buyer", picture: { data: { url: PIC } } }, message: "SECRET COMMENT TEXT" },
    { id: "V9_c2", created_time: ago(90), message: "SECRET COMMENT TEXT 2" },
  ],
  paging: { cursors: { before: CURSOR, after: CURSOR }, next: `https://graph.facebook.com/v25.0/V9/comments?after=${CURSOR}&access_token=${TOKEN}` },
};
afterEach(() => { vi.useRealTimers(); });

// Graph fake by path. live_videos → code 10 (the connect check); the probe paths answer by step.
function graph(over: Record<string, unknown> = {}, seq?: string[]) {
  return vi.fn(async (url: string) => {
    const u = new URL(url); const path = u.pathname.replace(/^\/v[\d.]+/, ""); const fields = u.searchParams.get("fields") || "";
    seq?.push(`fetch ${path}`);
    if (path.endsWith("/live_videos")) return (over.live as never) || CODE10;
    if (path === "/P1/videos") return (over.videos as never) || mkRes(200, { data: [
      { id: "V8", created_time: ago(3600), ...(fields.includes("live_status") ? { live_status: "VOD" } : {}) },
      { id: "V9", created_time: ago(60), ...(fields.includes("live_status") ? { live_status: "LIVE" } : {}) },
    ] });
    if (path === "/P1") return (over.page as never) || mkRes(200, { id: "P1" });
    if (path === "/P1/posts") return (over.posts as never) || mkRes(200, { data: [
      { id: "P1_old", created_time: ago(7200), status_type: "added_video" },
      { id: "P1_new", created_time: ago(120), status_type: "added_video", ...(fields.includes("attachments") ? { attachments: { data: [
        { media_type: "video", type: "video_inline", target: { id: "V9", url: "https://www.facebook.com/SECRET-TARGET-URL" }, title: "SECRET ATTACHMENT TITLE", description: "SECRET ATTACHMENT DESCRIPTION", url: "https://www.facebook.com/SECRET-ATTACHMENT-URL" },
      ] } } : {}) },
    ] });
    if (path === "/V9") return mkRes(200, { id: "V9", created_time: ago(60), live_status: "LIVE" });
    if (path.endsWith("/comments")) return (over.comments as never) || mkRes(200, COMMENTS);
    return mkRes(404, {});
  });
}

function setup(fetchImpl: ReturnType<typeof vi.fn>, opts: { insertRow?: (r: unknown) => unknown; now?: () => number } = {}) {
  const logs: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const page = { user_id: USER, page_id: "P1", page_username: "mypage", active: true, access_token: encryptToken(TOKEN, CONFIG.tokenKey) };
  const store = {
    async getPage() { return { ...page }; }, async getPlan() { return "pro"; }, async countPages() { return 1; }, async listPages() { return []; },
    async upsertPage() {}, async listActivePages() { return []; }, async setActive() {}, async updateExpiry() {},
    insertProbeRow: vi.fn(opts.insertRow || (async (r: Record<string, unknown>) => { rows.push(r); })),
  };
  const setLoop = vi.fn(() => 1);
  const rt = createFbRuntime({ config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (a: string, b: string, c: string) => `${a}:${b}:${c}`,
    renderUrl: "https://srv.test", appUrl: "https://app.test", fetchImpl, now: opts.now || (() => NOW), log: (l: string) => logs.push(l), setLoop, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} });
  const handlers: Record<string, ((q: unknown, s: unknown, n: () => void) => unknown)[]> = {};
  const rec = (m: string) => (p: string, ...h: never[]) => { handlers[`${m} ${p}`] = h; };
  rt.registerRoutes({ get: rec("GET"), post: rec("POST") } as never, ((_q: unknown, _s: unknown, n: () => void) => n()) as never);
  const run = async (seq?: string[]) => {
    let status = 200; let json: Record<string, unknown> = {};
    const res = { status(c: number) { status = c; return this; }, json(b: Record<string, unknown>) { json = b; seq?.push("response"); return this; } };
    const chain = handlers["POST /fb/connect"];
    await chain[chain.length - 1]({ authUserId: USER, sellerId: "s1", body: { page_id: "P1" } }, res, () => {});
    return { status, json };
  };
  const probeDone = async () => { await vi.waitFor(() => expect(logs.filter((l) => l.includes("alt probe")).length).toBe(PROBE_STEPS.length)); };
  return { rt, run, logs, rows, store, setLoop, probeDone };
}
const BODY_502 = { ok: false, error: "fb_check_failed", fb_code: 10, fb_http: 400, fb_timeout: false };

describe("/fb/connect response is unchanged", () => {
  it("code 10 → the same 502 status and byte-identical body; the response goes out BEFORE any probe call", async () => {
    const seq: string[] = [];
    const s = setup(graph({}, seq));
    const out = await s.run(seq);
    expect(out.status).toBe(502);
    expect(JSON.stringify(out.json)).toBe(JSON.stringify(BODY_502));
    await s.probeDone();
    const firstProbe = seq.findIndex((x) => x.startsWith("fetch /P1/videos"));
    expect(seq.indexOf("response")).toBeLessThan(firstProbe);
    expect(seq[0]).toBe("fetch /P1/live_videos");
  });
  it("never starts a poller", async () => {
    const s = setup(graph());
    await s.run();
    await s.probeDone();
    expect(s.rt._pollers.size).toBe(0);
    expect(s.setLoop).not.toHaveBeenCalled();
  });
});

describe("runs only on code 10", () => {
  it("other failures (code 100, 5xx, timeout), not_live and success → no probe", async () => {
    for (const live of [mkRes(400, { error: { code: 100 } }), mkRes(500, {}), mkRes(200, { data: [{ id: "LV", status: "VOD" }] }), mkRes(200, { data: [{ id: "LV", status: "LIVE" }] })]) {
      const f = graph({ live });
      const s = setup(f);
      await s.run();
      await new Promise((r) => setTimeout(r, 20));
      expect(s.logs.some((l) => l.includes("alt probe"))).toBe(false);
      expect(f.mock.calls.some((c) => String(c[0]).includes("/videos?") || String(c[0]).includes("/posts?"))).toBe(false);
      expect(s.store.insertProbeRow).not.toHaveBeenCalled();
    }
  });
});

describe("the 9 steps, metadata only", () => {
  it("one row + one log line per step, in order; picks the LIVE video and the newest post", async () => {
    const f = graph();
    const s = setup(f);
    await s.run();
    await s.probeDone();
    await vi.waitFor(() => expect(s.rows).toHaveLength(PROBE_STEPS.length));
    expect(s.rows.map((r) => r.step)).toEqual(PROBE_STEPS);
    expect(PROBE_STEPS[0]).toBe("page_node");
    const paths = f.mock.calls.map((c) => new URL(String(c[0])).pathname.replace(/^\/v[\d.]+/, ""));
    expect(paths).toEqual(["/P1/live_videos", "/P1", "/P1/videos", "/P1/videos", "/P1/posts", "/P1/posts", "/V9", "/V9/comments", "/V9/comments", "/V9/comments", "/V9/comments", "/V9/comments", "/V9/comments", "/P1_new/comments"]);
    const byStep = Object.fromEntries(s.rows.map((r) => [r.step, r]));
    expect(byStep.videos_live).toMatchObject({ user_id: USER, page_id: "P1", http: 200, items: 2, detail: { ids: ["V8", "V9"], live_status: ["VOD", "LIVE"] } });
    expect(byStep.vcomments_from).toMatchObject({ http: 200, items: 2, detail: { newest_comment_age_seconds: 30, comments_with_from: 1, paging_has_next: true } });
    expect(byStep.page_node).toMatchObject({ http: 200, items: 1, detail: { ids: ["P1"] } });
    expect(byStep.posts_min.detail).toMatchObject({ ids: ["P1_old", "P1_new"], status_type: ["added_video", "added_video"] });
    expect(byStep.posts_attach.detail).toMatchObject({ attachments: [[], [{ media_type: "video", type: "video_inline", target_id: "V9" }]] });
    expect(byStep.vcomments_full.detail).toEqual({ newest_comment_age_seconds: 30, comments_with_from: 1, comments_with_from_name: 1, comments_with_from_picture: 1, comments_with_message: 2, paging_has_next: true });
    // The new comment requests: the full field list, live_filter, and since = now − 120 s (unix).
    const q = (i: number) => new URL(String(f.mock.calls[i][0])).searchParams;
    expect(q(10).get("fields")).toBe("id,created_time,from{id,name,picture},message");
    expect(q(10).get("filter")).toBe("stream");
    expect(q(11).get("live_filter")).toBe("no_filter");
    expect(q(12).get("since")).toBe(String(Math.floor((NOW - 120_000) / 1000)));
    expect(q(12).get("order")).toBe("reverse_chronological");
    expect(s.logs).toContain(`[FB] alt probe user=${USER.slice(0, 8)} page=P1 step=videos_min http=200 code=- items=2`);
  });
  it("rows and logs never hold the token, a request URL, comment text, commenter names or ids", async () => {
    const f = graph({ posts: mkRes(400, { error: { code: 10, type: "OAuthException", message: `token ${TOKEN} denied` } }) });
    const s = setup(f);
    await s.run();
    await s.probeDone();
    await vi.waitFor(() => expect(s.rows).toHaveLength(PROBE_STEPS.length));
    const all = JSON.stringify(s.rows) + "\n" + s.logs.join("\n");
    for (const bad of [TOKEN, "access_token", "graph.facebook.com", "https://", "fbcdn", "SECRET-PICTURE", CURSOR, "after=", "SECRET COMMENT TEXT", "Secret Buyer", "COMMENTER-ID-777", "V9_c1", "SECRET ATTACHMENT", "SECRET-TARGET-URL"]) expect(all, bad).not.toContain(bad);
    const posts = s.rows.find((r) => r.step === "posts_min")!;
    expect(posts).toMatchObject({ http: 400, fb_code: 10, fb_type: "OAuthException", items: null });
    expect((posts.detail as { error_message: string }).error_message).toBe("token [redacted] denied");
  });
  it("Facebook's error message is cut to 160 characters", () => {
    const r = summarize({ status: 400, body: { error: { code: 10, message: "y".repeat(400) } }, kind: "objects", nowMs: NOW, token: TOKEN });
    expect((r.detail as { error_message: string }).error_message).toHaveLength(160);
  });
  it("skipped steps are recorded when the input id is missing", async () => {
    const empty = mkRes(200, { data: [] });
    const s = setup(graph({ videos: empty, posts: empty }));
    await s.run();
    await s.probeDone();
    await vi.waitFor(() => expect(s.rows).toHaveLength(PROBE_STEPS.length));
    for (const step of ["video_node", "vcomments_min", "vcomments_from", "vcomments_stream", "vcomments_full", "vcomments_live_filter", "vcomments_since"]) expect(s.rows.find((r) => r.step === step)).toMatchObject({ http: null, items: null, detail: { skipped: true, reason: "no_video_id" } });
    expect(s.rows.find((r) => r.step === "pcomments_stream")).toMatchObject({ detail: { skipped: true, reason: "no_post_id" } });
    expect(s.logs).toContain(`[FB] alt probe user=${USER.slice(0, 8)} page=P1 step=pcomments_stream http=- code=- items=- skipped`);
  });
  it("paging_has_next is a boolean only: next or cursors.after → true; none → false; never the cursor", () => {
    const c = (paging: unknown) => summarize({ status: 200, body: { data: [], paging }, kind: "comments", nowMs: NOW, token: TOKEN }).detail as Record<string, unknown>;
    expect(c({ next: "https://x" }).paging_has_next).toBe(true);
    expect(c({ cursors: { after: CURSOR } }).paging_has_next).toBe(true);
    expect(c({ cursors: { before: CURSOR } }).paging_has_next).toBe(false);
    expect(c(undefined).paging_has_next).toBe(false);
    expect(JSON.stringify(c({ next: `https://x?after=${CURSOR}`, cursors: { after: CURSOR } }))).not.toContain(CURSOR);
  });
  it("without a LIVE video the newest one is used", () => {
    expect(newestId([{ id: "A", created_time: ago(500) }, { id: "B", created_time: ago(5) }])).toBe("B");
  });
});

describe("a probe failure never affects the response", () => {
  it("every probe call throwing / timing out → same 502, steps recorded as failed, no unhandled rejection", async () => {
    vi.useFakeTimers();
    const f = vi.fn((url: string, init?: { signal?: AbortSignal }) => {
      if (String(url).includes("/live_videos")) return Promise.resolve(CODE10);
      return new Promise((_r, rej) => { init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))); });
    });
    const s = setup(f);
    const out = await s.run();
    expect(out).toEqual({ status: 502, json: BODY_502 });
    for (let i = 0; i < PROBE_STEPS.length; i++) await vi.advanceTimersByTimeAsync(GRAPH_TIMEOUT_MS);
    await vi.waitFor(() => expect(s.rows).toHaveLength(PROBE_STEPS.length));
    expect(s.rows[0]).toMatchObject({ step: "page_node", http: null, detail: { timed_out: true } });
  });
  it("a failing row insert never breaks the probe or the response", async () => {
    const s = setup(graph(), { insertRow: async () => { throw new Error("db"); } });
    expect(await s.run()).toEqual({ status: 502, json: BODY_502 });
    await s.probeDone();
  });
});

describe("at most one probe per page every 30 s", () => {
  it("a second code-10 connect within 30 s gets the 502 but no probe; after 30 s it probes again", async () => {
    let t = NOW;
    const s = setup(graph(), { now: () => t });
    await s.run();
    await s.probeDone();
    t = NOW + PROBE_MIN_INTERVAL_MS - 1;
    expect(await s.run()).toEqual({ status: 502, json: BODY_502 });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.logs.filter((l) => l.includes("step=videos_min"))).toHaveLength(1);
    t = NOW + PROBE_MIN_INTERVAL_MS;
    await s.run();
    await vi.waitFor(() => expect(s.logs.filter((l) => l.includes("step=videos_min"))).toHaveLength(2));
  });
  it("the probe helper alone: skipped start returns null, never throws", () => {
    const p = createFbAltProbe({ get: async () => { throw new Error("x"); }, now: () => NOW });
    expect(p.start({ userId: "u", pageId: "", token: TOKEN })).toBeNull();
    expect(p.start({ userId: "u", pageId: "P", token: "" })).toBeNull();
  });
});

describe("sql/78 mirror", () => {
  const code = readFileSync("sql/78_fb_probe_log.sql", "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").toLowerCase();
  it("table with the asked columns, RLS on, revoked from anon/authenticated; idempotent; no drop / grant", () => {
    expect(code).toContain("create table if not exists public.fb_probe_log");
    for (const col of ["id bigint generated always as identity primary key", "created_at timestamptz default now()", "user_id uuid", "page_id text", "step text", "http int", "fb_code int", "fb_subcode int", "fb_type text", "items int", "detail jsonb"]) expect(code).toContain(col);
    expect(code).toContain("alter table public.fb_probe_log enable row level security");
    expect(code).toContain("revoke all on table public.fb_probe_log from anon");
    expect(code).toContain("revoke all on table public.fb_probe_log from authenticated");
    expect(code).not.toMatch(/\bdrop\b|\bgrant\b/);
  });
});
