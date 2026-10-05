// Facebook alt probe (server/fbProbe.js) — read-only research. Since the video path (Oct 2026)
// /fb/connect no longer starts it (pinned in fbVideoPath.server.test.ts); the module and its
// table stay in place, unused, and are tested directly here: never throws / rejects (failure,
// timeout, row write error); at most once per page every 30 s; rows and logs hold metadata only
// (no token, URL, comment text or commenter id); skipped steps are recorded; the sql/78 mirror.
// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { graphGet, GRAPH_HOST, GRAPH_TIMEOUT_MS } from "../../../../server/fbLive.js";
import { GRAPH_VERSION } from "../../../../server/fbConfig.js";
import { createFbAltProbe, PROBE_STEPS, PROBE_MIN_INTERVAL_MS, summarize, newestId } from "../../../../server/fbProbe.js";

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

// The probe exactly as the runtime used to build it (graphGet + the Graph URL with the token as a
// query param), started directly — /fb/connect no longer starts it.
function setup(fetchImpl: ReturnType<typeof vi.fn>, opts: { insertRow?: (r: unknown) => unknown; now?: () => number } = {}) {
  const logs: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const insertRow = vi.fn(opts.insertRow || (async (r: Record<string, unknown>) => { rows.push(r); }));
  const get = (path: string, params: Record<string, unknown>, token: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, access_token: token })) if (v != null && v !== "") q.set(k, String(v));
    return graphGet({ fetchImpl, url: `${GRAPH_HOST}/${GRAPH_VERSION}${path}?${q.toString()}` });
  };
  const probe = createFbAltProbe({ get, insertRow, log: ((l: string) => { logs.push(l); }) as never, now: opts.now || (() => NOW) });
  const run = () => probe.start({ userId: USER, pageId: "P1", token: TOKEN });
  const probeDone = async () => { await vi.waitFor(() => expect(logs.filter((l) => l.includes("alt probe")).length).toBe(PROBE_STEPS.length)); };
  return { run, logs, rows, store: { insertProbeRow: insertRow }, probeDone };
}

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
    expect(paths).toEqual(["/P1", "/P1/videos", "/P1/videos", "/P1/posts", "/P1/posts", "/V9", "/V9/comments", "/V9/comments", "/V9/comments", "/V9/comments", "/V9/comments", "/V9/comments", "/P1_new/comments"]);
    const byStep = Object.fromEntries(s.rows.map((r) => [r.step, r]));
    expect(byStep.videos_live).toMatchObject({ user_id: USER, page_id: "P1", http: 200, items: 2, detail: { ids: ["V8", "V9"], live_status: ["VOD", "LIVE"] } });
    expect(byStep.vcomments_from).toMatchObject({ http: 200, items: 2, detail: { newest_comment_age_seconds: 30, comments_with_from: 1, paging_has_next: true } });
    expect(byStep.page_node).toMatchObject({ http: 200, items: 1, detail: { ids: ["P1"] } });
    expect(byStep.posts_min.detail).toMatchObject({ ids: ["P1_old", "P1_new"], status_type: ["added_video", "added_video"] });
    expect(byStep.posts_attach.detail).toMatchObject({ attachments: [[], [{ media_type: "video", type: "video_inline", target_id: "V9" }]] });
    expect(byStep.vcomments_full.detail).toEqual({ newest_comment_age_seconds: 30, comments_with_from: 1, comments_with_from_name: 1, comments_with_from_picture: 1, comments_with_message: 2, paging_has_next: true });
    // The new comment requests: the full field list, live_filter, and since = now − 120 s (unix).
    const q = (i: number) => new URL(String(f.mock.calls[i - 1][0])).searchParams; // −1: indexes kept from when live_videos was call 0
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

describe("a probe failure never throws", () => {
  it("every probe call timing out → steps recorded as failed, the run resolves (no unhandled rejection)", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_url: string, init?: { signal?: AbortSignal }) => new Promise((_r, rej) => { init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))); }));
    const s = setup(f);
    const p = s.run();
    for (let i = 0; i < PROBE_STEPS.length; i++) await vi.advanceTimersByTimeAsync(GRAPH_TIMEOUT_MS);
    await expect(p).resolves.toBeUndefined();
    await vi.waitFor(() => expect(s.rows).toHaveLength(PROBE_STEPS.length));
    expect(s.rows[0]).toMatchObject({ step: "page_node", http: null, detail: { timed_out: true } });
  });
  it("a failing row insert never breaks the probe", async () => {
    const s = setup(graph(), { insertRow: async () => { throw new Error("db"); } });
    await expect(s.run()).resolves.toBeUndefined();
    await s.probeDone();
  });
});

describe("at most one probe per page every 30 s", () => {
  it("a second start within 30 s is skipped (null); after 30 s it probes again", async () => {
    let t = NOW;
    const s = setup(graph(), { now: () => t });
    await s.run();
    await s.probeDone();
    t = NOW + PROBE_MIN_INTERVAL_MS - 1;
    expect(s.run()).toBeNull();
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
