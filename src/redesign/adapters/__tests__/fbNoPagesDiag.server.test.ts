// Facebook "No Page was chosen" (no_pages) — 2026-10-11. (1) The dialog URL always asks again
// (auth_type=rerequest) so a remembered empty grant can't come back as a one-tap "Continue as …".
// (2) When Facebook returns no Page: one log line + one fb_probe_log row with permission NAMES and
// counts only (never a token, the app secret, a page/user id, a name or an email). The seller still
// gets the same no_pages answer; the pages > 0 path makes no extra call.
import { describe, it, expect, vi } from "vitest";
import { signState, createFbRuntime, OAUTH_SCOPE, pageTargetIds, PAGE_TARGETS_MAX } from "../../../../server/fbLive.js";

const CONFIG = { enabled: true, appId: "app123", appSecret: "SECRETVALUE", tokenKey: "tk" };
const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });

function makeStore() {
  const probes: Record<string, unknown>[] = [];
  return {
    probes,
    upserts: [] as unknown[],
    async getPlan() { return "pro"; },
    async countPages() { return 0; },
    async getPage() { return null; },
    async listPages() { return []; },
    async upsertPage(row: unknown) { this.upserts.push(row); },
    async listActivePages() { return []; },
    async setActive() {},
    async updateExpiry() {},
    async insertProbeRow(row: Record<string, unknown>) { probes.push(row); },
  };
}

type Route = (url: URL) => { status: number; body: unknown } | Error;
// Routes by Graph path; records every requested URL.
function graph(routes: Record<string, Route>) {
  const urls: string[] = [];
  const f = vi.fn(async (u: string) => {
    urls.push(u);
    const url = new URL(u);
    const path = url.pathname.replace(/^\/v[\d.]+/, "");
    const r = routes[path];
    if (!r) throw new Error(`unexpected ${path}`);
    const out = r(url);
    if (out instanceof Error) throw out;
    return mkRes(out.status, out.body);
  });
  return { f, urls };
}
const tokenRoutes: Record<string, Route> = {
  "/oauth/access_token": (u) => (u.searchParams.get("grant_type") === "fb_exchange_token"
    ? { status: 200, body: { access_token: "LONGUSERTOKEN", expires_in: 5184000 } }
    : { status: 200, body: { access_token: "SHORTTOKEN" } }),
};

function runtime(fetchImpl: unknown, store = makeStore()) {
  const lines: string[] = [];
  const rt = createFbRuntime({
    config: CONFIG, store, emitComment: vi.fn(), statusEmit: vi.fn(), liveKey: (s: string, p: string, g: string) => `${s}:${p}:${g}`,
    renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl, now: () => 1_000_000, log: (l: string) => lines.push(l),
    setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {},
  });
  return { rt, store, lines };
}
const stateFor = (app: boolean) => signState({ userId: "user-1", key: CONFIG.appSecret, nowMs: 1_000_000, app, kind: "fb" });
const FORBIDDEN = ["SHORTTOKEN", "LONGUSERTOKEN", "SECRETVALUE", "app123|", "user-1", "PAGE-ID-1", "My Shop", "fbuser-9", "@"];

describe("buildAuthUrl — always shows the Page picker", () => {
  for (const app of [false, true]) {
    for (const messaging of [false, true]) {
      it(`auth_type=rerequest (app=${app}, messaging=${messaging}); scope unchanged`, () => {
        const { rt } = runtime(vi.fn());
        const qs = new URLSearchParams(rt.buildAuthUrl("user-1", { app, messaging }).split("?")[1]);
        expect(qs.get("auth_type")).toBe("rerequest");
        expect(qs.get("scope")).toBe(messaging ? `${OAUTH_SCOPE},pages_messaging` : OAUTH_SCOPE);
        expect(OAUTH_SCOPE).toBe("pages_show_list,pages_read_engagement,pages_read_user_content");
      });
    }
  }
});

describe("no_pages diagnostics", () => {
  it("writes one log line + one probe row with permission names and counts only", async () => {
    const { f, urls } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [] } }),
      "/me/permissions": () => ({ status: 200, body: { data: [
        { permission: "pages_show_list", status: "granted" }, { permission: "public_profile", status: "granted" },
        { permission: "pages_read_engagement", status: "declined" }, { permission: "pages_messaging", status: "granted" },
      ] } }),
      "/debug_token": () => ({ status: 200, body: { data: { user_id: "fbuser-9", granular_scopes: [{ scope: "pages_show_list", target_ids: [] }, { scope: "pages_messaging", target_ids: ["PAGE-ID-1"] }] } } }),
    });
    const { rt, store, lines } = runtime(f);
    const out = await rt.handleCallback({ code: "C", state: stateFor(true) });
    expect(out.redirect).toContain("fb=error&code=no_pages");
    const diag = lines.filter((l) => l.startsWith("[FB] no_pages"));
    expect(diag).toEqual(["[FB] no_pages flow=app http=200 code=- granted=pages_show_list,public_profile,pages_messaging declined=pages_read_engagement pageTargets=0 messaging=1"]);
    expect(store.probes).toHaveLength(1);
    expect(store.probes[0]).toMatchObject({ user_id: "user-1", page_id: null, step: "oauth_no_pages", http: 200, fb_code: null, items: 0 });
    expect(store.probes[0].detail).toEqual({ flow: "app", http: "200", code: "-", granted: "pages_show_list,public_profile,pages_messaging", declined: "pages_read_engagement", pageTargets: "0", messaging: "1", fallback: "0/0" });
    const text = lines.join("\n") + JSON.stringify(store.probes[0].detail);
    for (const bad of FORBIDDEN) expect(text).not.toContain(bad);
    // debug_token goes out with the app token but WITHOUT appsecret_proof; the user-token reads keep it.
    expect(urls.filter((u) => u.includes("/debug_token"))).toHaveLength(1); // read once, shared by fallback + diagnostic
    const dbg = urls.find((u) => u.includes("/debug_token"))!;
    expect(new URL(dbg).searchParams.has("appsecret_proof")).toBe(false);
    expect(new URL(urls.find((u) => u.includes("/me/permissions"))!).searchParams.has("appsecret_proof")).toBe(true);
  });

  it("web flow + Facebook error on /me/accounts → http/code logged; no target list = all", async () => {
    const { f } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 400, body: { error: { code: 200, message: "secret PAGE-ID-1" } } }),
      "/me/permissions": () => ({ status: 200, body: { data: [] } }),
      "/debug_token": () => ({ status: 200, body: { data: { granular_scopes: [{ scope: "pages_show_list" }] } } }),
    });
    const { rt, lines, store } = runtime(f);
    const out = await rt.handleCallback({ code: "C", state: stateFor(false) });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=no_pages");
    expect(lines.filter((l) => l.startsWith("[FB] no_pages"))).toEqual(["[FB] no_pages flow=web http=400 code=200 granted=none declined=none pageTargets=all messaging=0"]);
    expect(store.probes[0]).toMatchObject({ http: 400, fb_code: 200 });
  });

  it("both diagnostic calls fail → '-' fields, still no_pages, still one row", async () => {
    const { f } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [] } }),
      "/me/permissions": () => new Error("network LONGUSERTOKEN"),
      "/debug_token": () => ({ status: 500, body: {} }),
    });
    const { rt, lines, store } = runtime(f);
    const out = await rt.handleCallback({ code: "C", state: stateFor(false) });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=no_pages");
    expect(lines.filter((l) => l.startsWith("[FB] no_pages"))).toEqual(["[FB] no_pages flow=web http=200 code=- granted=- declined=- pageTargets=- messaging=-"]);
    expect(store.probes).toHaveLength(1);
    expect(lines.join("\n")).not.toContain("LONGUSERTOKEN");
  });

  it("probe row insert fails → still no_pages, no throw", async () => {
    const { f } = graph({ ...tokenRoutes, "/me/accounts": () => ({ status: 200, body: { data: [] } }), "/me/permissions": () => ({ status: 200, body: { data: [] } }), "/debug_token": () => ({ status: 200, body: { data: {} } }) });
    const store = makeStore();
    store.insertProbeRow = async () => { throw new Error("fb_probe_log_insert_failed"); };
    const { rt } = runtime(f, store);
    expect((await rt.handleCallback({ code: "C", state: stateFor(false) })).redirect).toBe("https://app.test/?fb=error&code=no_pages");
  });

  it("pages > 0 → no diagnostic calls, no probe row, no no_pages line", async () => {
    const { f, urls } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [{ id: "PAGE-ID-1", name: "My Shop", access_token: "PAGETOKEN" }] } }),
      "/me/permissions": () => ({ status: 200, body: { data: [] } }),
      "/me": () => ({ status: 200, body: { id: "fbuser-9" } }),
    });
    const { rt, store, lines } = runtime(f);
    const out = await rt.handleCallback({ code: "C", state: stateFor(false) });
    expect(out.redirect).toBe("https://app.test/?fb=connected");
    expect(urls.some((u) => u.includes("/debug_token"))).toBe(false);
    expect(urls.filter((u) => u.includes("/me/permissions"))).toHaveLength(1); // the existing messaging check only
    expect(store.probes).toHaveLength(0);
    expect(lines.some((l) => l.startsWith("[FB] no_pages"))).toBe(false);
  });
});

// Business-portfolio Pages (2026-10-11 root cause from the oauth_no_pages rows: everything granted,
// pageTargets=1, /me/accounts empty) → read the ticked Page directly.
describe("pages via debug_token targets", () => {
  const debugWith = (scopes: unknown[]): Route => () => ({ status: 200, body: { data: { granular_scopes: scopes } } });
  const page: Route = (u) => (u.pathname.endsWith("/PAGE-ID-1")
    ? { status: 200, body: { id: "PAGE-ID-1", name: "My Shop", username: "myshop", access_token: "PAGETOKEN" } }
    : { status: 404, body: { error: { code: 100 } } });

  it("/me/accounts empty + 1 ticked Page with a token → that Page is saved, normal redirect", async () => {
    const { f, urls } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [] } }),
      "/debug_token": debugWith([{ scope: "pages_show_list", target_ids: ["PAGE-ID-1"] }]),
      "/PAGE-ID-1": page,
      "/me/permissions": () => ({ status: 200, body: { data: [{ permission: "pages_messaging", status: "granted" }] } }),
      "/me": () => ({ status: 200, body: { id: "fbuser-9" } }),
    });
    const { rt, store, lines } = runtime(f);
    const out = await rt.handleCallback({ code: "C", state: stateFor(false) });
    expect(out.redirect).toBe("https://app.test/?fb=connected");
    expect(store.upserts).toHaveLength(1);
    expect(store.upserts[0]).toMatchObject({ user_id: "user-1", page_id: "PAGE-ID-1", page_name: "My Shop", can_message: true });
    expect(store.probes).toHaveLength(0);
    expect(lines).toContain("[FB] pages via targets tried=1 found=1");
    expect(lines.some((l) => l.startsWith("[FB] no_pages"))).toBe(false);
    // The Page read uses the user token WITH appsecret_proof.
    const pageUrl = new URL(urls.find((u) => u.includes("/PAGE-ID-1"))!);
    expect(pageUrl.searchParams.get("access_token")).toBe("LONGUSERTOKEN");
    expect(pageUrl.searchParams.has("appsecret_proof")).toBe(true);
    expect(pageUrl.searchParams.get("fields")).toBe("id,name,username,access_token");
    // The new line carries numbers only (the existing "[FB] callback ok user=…" line is unchanged).
    const added = lines.filter((l) => l.includes("pages via targets")).join("\n");
    for (const bad of FORBIDDEN) expect(added).not.toContain(bad);
  });

  it("the Page read fails → no_pages + one probe row with fallback=1/0; debug_token read once", async () => {
    const { f, urls } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [] } }),
      "/debug_token": debugWith([{ scope: "pages_show_list", target_ids: ["PAGE-ID-1"] }]),
      "/PAGE-ID-1": () => ({ status: 400, body: { error: { code: 10 } } }),
      "/me/permissions": () => ({ status: 200, body: { data: [{ permission: "pages_show_list", status: "granted" }] } }),
    });
    const { rt, store, lines } = runtime(f);
    const out = await rt.handleCallback({ code: "C", state: stateFor(true) });
    expect(out.redirect).toContain("fb=error&code=no_pages");
    expect(store.upserts).toHaveLength(0);
    expect(store.probes).toHaveLength(1);
    expect(store.probes[0].detail).toMatchObject({ fallback: "1/0", pageTargets: "1" });
    expect(lines).toContain("[FB] pages via targets tried=1 found=0");
    expect(urls.filter((u) => u.includes("/debug_token"))).toHaveLength(1);
    const text = lines.join("\n") + JSON.stringify(store.probes[0].detail);
    for (const bad of FORBIDDEN) expect(text).not.toContain(bad);
  });

  it("a Page answer without an access_token is not kept", async () => {
    const { f } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [] } }),
      "/debug_token": debugWith([{ scope: "pages_show_list", target_ids: ["PAGE-ID-1"] }]),
      "/PAGE-ID-1": () => ({ status: 200, body: { id: "PAGE-ID-1", name: "My Shop" } }),
      "/me/permissions": () => ({ status: 200, body: { data: [] } }),
    });
    const { rt, store } = runtime(f);
    expect((await rt.handleCallback({ code: "C", state: stateFor(false) })).redirect).toBe("https://app.test/?fb=error&code=no_pages");
    expect(store.probes[0].detail).toMatchObject({ fallback: "1/0" });
  });

  it("debug_token fails → no Page reads, no_pages with fallback=0/0", async () => {
    const { f, urls } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [] } }),
      "/debug_token": () => new Error("network"),
      "/me/permissions": () => ({ status: 200, body: { data: [] } }),
    });
    const { rt, store, lines } = runtime(f);
    expect((await rt.handleCallback({ code: "C", state: stateFor(false) })).redirect).toBe("https://app.test/?fb=error&code=no_pages");
    expect(store.probes[0].detail).toMatchObject({ fallback: "0/0", pageTargets: "-" });
    expect(lines.some((l) => l.startsWith("[FB] pages via targets"))).toBe(false);
    expect(urls.some((u) => /\/v[\d.]+\/PAGE/.test(u))).toBe(false);
  });

  it("/me/accounts non-empty → no debug_token and no Page reads at all", async () => {
    const { f, urls } = graph({
      ...tokenRoutes,
      "/me/accounts": () => ({ status: 200, body: { data: [{ id: "PAGE-ID-1", name: "My Shop", access_token: "PAGETOKEN" }] } }),
      "/me/permissions": () => ({ status: 200, body: { data: [] } }),
      "/me": () => ({ status: 200, body: { id: "fbuser-9" } }),
    });
    const { rt, lines } = runtime(f);
    expect((await rt.handleCallback({ code: "C", state: stateFor(false) })).redirect).toBe("https://app.test/?fb=connected");
    expect(urls.some((u) => u.includes("/debug_token"))).toBe(false);
    expect(urls.some((u) => /\/v[\d.]+\/PAGE-ID-1/.test(u))).toBe(false);
    expect(lines.some((l) => l.startsWith("[FB] pages via targets"))).toBe(false);
  });
});

describe("pageTargetIds (pure)", () => {
  it("pages_show_list targets first; pages_read_engagement when it has none; max 10, no blanks/repeats", () => {
    expect(pageTargetIds([{ scope: "pages_show_list", target_ids: ["1", "2"] }, { scope: "pages_read_engagement", target_ids: ["9"] }])).toEqual(["1", "2"]);
    expect(pageTargetIds([{ scope: "pages_show_list", target_ids: [] }, { scope: "pages_read_engagement", target_ids: ["9", "9", ""] }])).toEqual(["9"]);
    expect(pageTargetIds([{ scope: "pages_show_list" }])).toEqual([]);
    expect(pageTargetIds(null)).toEqual([]);
    expect(pageTargetIds([{ scope: "pages_show_list", target_ids: Array.from({ length: 15 }, (_, i) => String(i + 1)) }])).toHaveLength(PAGE_TARGETS_MAX);
    expect(PAGE_TARGETS_MAX).toBe(10);
  });
});
