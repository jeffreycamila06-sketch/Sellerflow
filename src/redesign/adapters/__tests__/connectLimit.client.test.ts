// Nov 3, 2026 — the client side of the connection-limit cooldown: the 429 answer's cooldownMs
// reaches the caller, the toast is the fixed "retrying for you" text (no minutes), the retry
// delay = cooldownMs (else the sentence's minutes) + a pad, and RedesignApp wires ONE retry
// (manual tap / Disconnect cancel it; the retried attempt never schedules another).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } } }));
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test", sellerIdOf: (e: string) => e, browserSessionId: () => "sess" }));

import { connectPlatform, connectFailText, cooldownRetryDelayMs, COOLDOWN_RETRY_PAD_MS, COOLDOWN_RETRY_MAX_MS } from "../connect";
import { buildT } from "../../i18n";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const serve = (status: number, body: Record<string, unknown>) => {
  globalThis.fetch = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, statusText: "", json: async () => body })) as unknown as typeof fetch;
};
const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("cooldownMs from the 429 answer", () => {
  it("is carried on the result (gate answer and tap-path answer alike); absent otherwise", async () => {
    serve(429, { success: false, error: "E41:2", cooldownMs: 120_000 });
    const r = await connectPlatform("TikTok", { username: "shop" }, "s@x.com");
    expect(r.ok).toBe(false);
    expect(r.cooldownMs).toBe(120_000);
    serve(500, { success: false, error: "boom" });
    expect((await connectPlatform("TikTok", { username: "shop" }, "s@x.com")).cooldownMs).toBeUndefined();
    serve(429, { success: false, error: "E41:2", cooldownMs: 0 });
    expect((await connectPlatform("TikTok", { username: "shop" }, "s@x.com")).cooldownMs).toBeUndefined();
  });
  it("A6. the daily limit marker is a boolean (daily: true — no raw word on the wire) and rides along", async () => {
    serve(429, { success: false, error: "E41:60", cooldownMs: 3_600_000, daily: true });
    const r = await connectPlatform("TikTok", { username: "shop" }, "s@x.com");
    expect(r.daily).toBe(true);
    serve(429, { success: false, error: "E41:2", cooldownMs: 120_000 });
    expect((await connectPlatform("TikTok", { username: "shop" }, "s@x.com")).daily).toBeUndefined();
    serve(429, { success: false, error: "E41:60", cooldownMs: 3_600_000, daily: "daily_rooms" });  // only the boolean counts
    expect((await connectPlatform("TikTok", { username: "shop" }, "s@x.com")).daily).toBeUndefined();
  });
});

describe("retry delay + toast text", () => {
  const t = buildT("en");
  it("cooldownMs wins, then the sentence's minutes, else null (no retry)", () => {
    expect(cooldownRetryDelayMs({ cooldownMs: 120_000, error: "whatever" })).toBe(120_000 + COOLDOWN_RETRY_PAD_MS);
    expect(cooldownRetryDelayMs({ error: "TikTok connection is on cooldown after a rate limit. Try again in 2 minutes." })).toBe(120_000 + COOLDOWN_RETRY_PAD_MS);
    expect(cooldownRetryDelayMs({ error: "TikTok rate limit reached. Try again in about 5 minute(s)." })).toBe(300_000 + COOLDOWN_RETRY_PAD_MS);
    expect(cooldownRetryDelayMs({ error: "Server error" })).toBeNull();
    expect(cooldownRetryDelayMs({})).toBeNull();
  });
  it("no retry for the daily limit or a bench over 10 min (an old 30-min server answer) — audit items 4 + 5", () => {
    expect(COOLDOWN_RETRY_MAX_MS).toBe(10 * 60 * 1000);
    expect(cooldownRetryDelayMs({ cooldownMs: 120_000, daily: true })).toBeNull();
    expect(cooldownRetryDelayMs({ cooldownMs: 10 * 60_000 })).toBe(10 * 60_000 + COOLDOWN_RETRY_PAD_MS);   // exactly 10 min still retries
    expect(cooldownRetryDelayMs({ cooldownMs: 10 * 60_000 + 1 })).toBeNull();
    expect(cooldownRetryDelayMs({ cooldownMs: 30 * 60_000 })).toBeNull();                                  // old server: 30 min
    expect(cooldownRetryDelayMs({ error: "TikTok connection is on cooldown after a rate limit. Try again in 12 minutes." })).toBeNull();
    expect(cooldownRetryDelayMs({ error: "TikTok rate limit reached. Try again in about 1 hour(s)." })).toBeNull();
  });
  it("A2. the toast says 'retrying' ONLY when the caller says a retry IS scheduled; daily → daily text; otherwise 'try again in a few minutes'", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const tt = buildT(lang);
      expect(connectFailText({ cooldownMs: 120_000, error: "E41:2" }, tt, { retryScheduled: true })).toBe(tt.rd_cm_tt_cooldown);
      expect(connectFailText({ cooldownMs: 120_000, error: "E41:2" }, tt, { retryScheduled: false })).toBe(tt.rd_cm_tt_cooldown_again);
      expect(connectFailText({ cooldownMs: 120_000, error: "E41:2" }, tt)).toBe(tt.rd_cm_tt_cooldown_again);    // the Connect modal (no retry) → never "retrying"
      expect(connectFailText({ cooldownMs: 3_600_000, error: "E41:60", daily: true }, tt, { retryScheduled: true })).toBe(tt.rd_cm_tt_daily_limit);
      expect(connectFailText({ cooldownMs: 30 * 60_000, error: "E41:30" }, tt)).toBe(tt.rd_cm_tt_cooldown_again);
      for (const k of ["rd_cm_tt_cooldown", "rd_cm_tt_cooldown_again", "rd_cm_tt_daily_limit"] as const) {
        expect(tt[k]).not.toContain("{n}");
        expect(tt[k].length).toBeGreaterThan(3);
      }
      expect(tt.rd_cm_tt_cooldown_again).not.toBe(tt.rd_cm_tt_cooldown);
    }
    expect(connectFailText({ cooldownMs: 120_000 }, t, { retryScheduled: true })).toBe("Connection limit reached — we're retrying for you");
    expect(connectFailText({ cooldownMs: 120_000 }, t)).toBe("Try again in a few minutes");
    expect(connectFailText({ cooldownMs: 3_600_000, daily: true }, t)).toBe("Daily connection limit reached — try again later");
    expect(connectFailText({ error: "Server error" }, t)).toBe(t.rd_cm_conn_try_again);
    expect(connectFailText({ notLive: true }, t)).toBe(t.rd_cm_not_live);
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const app = src("src/redesign/RedesignApp.tsx");
  it("one retry per cooldown answer, TikTok only, never from a retried attempt; the timer re-checks the server session + platforms and passes register through", () => {
    expect(app).toContain('const retryMs = !r.ok && platform === "TikTok" && !opts?.retry ? cooldownRetryDelayMs(r) : null;');
    const timer = app.slice(app.indexOf("if (retryMs !== null) cooldownRetry.schedule("), app.indexOf("if (!r.ok) setToast({ msg: connectFailText(r, tApp, { retryScheduled"));
    expect(timer).toContain("const session = await sessionInstance.checkStatus();");
    // A3: the generation is re-checked AFTER the session check and BEFORE the connect
    const g = timer.indexOf("if (!cooldownRetry.isCurrent(gen)) return;");
    expect(g).toBeGreaterThan(timer.indexOf("await sessionInstance.checkStatus()"));
    expect(g).toBeLessThan(timer.indexOf("void performConnect("));
    expect(timer).toContain("if (!retryAllowed({ ttLive: ttEffRef.current, otherLive: otherLiveRef.current, session })) return;");
    expect(timer).toContain('void performConnect("TikTok", acct, { retry: true, register: opts?.register });');
    expect(app).toContain("const otherLive = fbEff || igEff || shopeeEff;");
  });
  it("A2. 'retrying' only when this tap really scheduled the retry (a retried attempt schedules none → 'try again'); the Connect modal passes no options", () => {
    expect(app).toContain("if (!r.ok) setToast({ msg: connectFailText(r, tApp, { retryScheduled: retryMs !== null }), kind: \"err\" });");
    expect(src("src/redesign/screens/ConnectModal.tsx")).toContain("if (!r.ok) { setErr(connectFailText(r, t)); return; }");
  });
  it("9. a different signed-in user cancels a pending retry", () => {
    expect(app).toContain("useEffect(() => () => cooldownRetry.cancel(), [cooldownRetry, auth.email]);");
  });
  it("A4. picking another TikTok account cancels a pending retry (it must not connect the previously typed account)", () => {
    const fn = app.slice(app.indexOf("const switchAccount = (platform: Platform, i: number) => {"), app.indexOf("const [ttConnecting, setTtConnecting]"));
    expect(fn).toContain('if (platform === "TikTok") { cooldownRetry.cancel(); setTtIdx(i); }');
  });
  it("a manual tap, Disconnect, unmount, another platform's connect, a platform switch and session end all cancel a pending retry", () => {
    expect(app).toContain("if (!opts?.retry) cooldownRetry.cancel();");
    expect(app).toContain("if (eff) { cooldownRetry.cancel(); setOff(true); return; }");
    expect(app).toContain("useEffect(() => () => cooldownRetry.cancel(), [cooldownRetry, auth.email]);"); // unmount + user change, one effect
    for (const sig of ["const doShopeeConnect = async (shopId: number, sessionId: string) => {", 'const doFbConnect = async (pageId: string, scopeKey = "") => {', "const doIgConnect = async (igUserId: string) => {", "const confirmSwitch = async () => {", "const doEndSession = async () => {"]) {
      const i = app.indexOf(sig);
      expect(i, sig).toBeGreaterThan(0);
      expect(app.slice(i, i + sig.length + 120), sig).toContain("cooldownRetry.cancel();");
    }
  });
  it("the retry goes through performConnect (the same tap path: toast gate, analytics, honest toast) — no bare liveFeed.connect", () => {
    const fn = app.slice(app.indexOf("const performConnect = async"), app.indexOf("const doConnect = async"));
    expect(fn.match(/liveFeed\.connect\(/g)?.length).toBe(1);
  });
});

describe("B. TikTok username not found / lookup failed (client)", () => {
  const t = buildT("en");
  it("404 notFound → notFound, no cooldown, no retry; 502 lookupFailed → lookupFailed, no cooldown, no retry", async () => {
    serve(404, { success: false, notFound: true, error: "E43" });
    const a = await connectPlatform("TikTok", { username: "oldname" }, "s@x.com");
    expect(a).toMatchObject({ ok: false, notFound: true, error: "tiktok_user_not_found" });
    expect(a.cooldownMs).toBeUndefined();
    expect(cooldownRetryDelayMs(a)).toBeNull();
    serve(502, { success: false, lookupFailed: true, error: "E44" });
    const b = await connectPlatform("TikTok", { username: "shop" }, "s@x.com");
    expect(b).toMatchObject({ ok: false, lookupFailed: true, error: "tiktok_lookup_failed" });
    expect(cooldownRetryDelayMs(b)).toBeNull();
    expect(cooldownRetryDelayMs({ notFound: true, cooldownMs: 120_000 })).toBeNull();   // never retried, whatever else rides along
    serve(404, { success: false, error: "E10" });                                         // a 404 without notFound is not this case
    expect((await connectPlatform("TikTok", { username: "shop" }, "s@x.com")).notFound).toBeUndefined();
  });
  it("the not-found text wins over everything (checked FIRST); lookup failed has its own text — never 'make sure you're LIVE'", () => {
    expect(connectFailText({ notFound: true, notLive: true, cooldownMs: 1 }, t, { retryScheduled: true })).toBe(t.rd_cm_tt_not_found);
    expect(connectFailText({ lookupFailed: true }, t)).toBe(t.rd_cm_tt_lookup_failed);
    expect(connectFailText({ lookupFailed: true }, t)).not.toBe(t.rd_cm_not_live);
    expect(t.rd_cm_tt_not_found).toBe("TikTok username not found. It may have changed — edit the account's username and try again.");
    expect(t.rd_cm_tt_lookup_failed).toBe("Couldn't find this TikTok account right now. Make sure you're LIVE and the username is correct, then try again.");
  });
  it("both texts exist in all 8 languages, distinct from English (except en) and from each other; zh-TW and fil are the given words", () => {
    const en = buildT("en");
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const tt = buildT(lang);
      for (const k of ["rd_cm_tt_not_found", "rd_cm_tt_lookup_failed", "rd_adm_ttl_daily_still"] as const) {
        expect(tt[k], `${lang} ${k}`).toBeTruthy();
        if (lang !== "en") expect(tt[k], `${lang} ${k}`).not.toBe(en[k]);
      }
      expect(tt.rd_cm_tt_not_found).not.toBe(tt.rd_cm_tt_lookup_failed);
    }
    expect(buildT("zh-TW").rd_cm_tt_not_found).toBe("找不到此 TikTok 使用者名稱，可能已更改，請編輯帳號的使用者名稱後再試一次。");
    expect(buildT("fil").rd_cm_tt_not_found).toBe("Hindi mahanap ang TikTok username. Baka napalitan — i-edit ang username ng account at subukan ulit.");
    // 6: lookup failed covers a seller who tapped Connect before going LIVE too
    expect(buildT("zh-TW").rd_cm_tt_lookup_failed).toBe("目前找不到此 TikTok 帳號。請確認你已開始直播且使用者名稱正確，然後再試一次。");
    expect(buildT("fil").rd_cm_tt_lookup_failed).toBe("Hindi mahanap ang TikTok account ngayon. Siguraduhing naka-LIVE ka at tama ang username, tapos subukan ulit.");
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) expect(buildT(lang).rd_cm_tt_lookup_failed, lang).toMatch(/LIVE|直播/);
  });
  it("the two new codes are NEW numbers (E43 / E44), never reused, and decode back to the words", async () => {
    const { ERR_CODES, decodeErr } = await import("../../../lib/errCodes.js");
    expect(ERR_CODES.tiktok_user_not_found).toBe("E43");
    expect(ERR_CODES.tiktok_lookup_failed).toBe("E44");
    const codes = Object.values(ERR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    const { SERVER_ONLY_CODES } = await import("../../../../server/errorCodes.js");
    for (const c of ["E43", "E44"]) expect(Object.values(SERVER_ONLY_CODES)).not.toContain(c);
    expect(decodeErr("E43")).toBe("tiktok_user_not_found");
    expect(decodeErr("E44")).toBe("tiktok_lookup_failed");
  });
});

describe("10 + 12. the rollback app's readable text; the admin comment placement", () => {
  it("10. legacy App.tsx shows readable English for the two new TikTok answers (never the raw word)", () => {
    const legacy = src("src/App.tsx");
    expect(legacy).toContain(`const ttReadable=j.error==="tiktok_user_not_found"?"TikTok username not found. It may have changed — edit the account's username and try again."`);
    expect(legacy).toContain(`:j.error==="tiktok_lookup_failed"?"Couldn't find this TikTok account right now. Make sure you're LIVE and the username is correct, then try again.":null;`);
    expect(legacy).toContain("setToast(ttReadable||`${t.conn_failed}: ");
    const t = buildT("en");                                       // same words as the new app
    expect(legacy).toContain(t.rd_cm_tt_not_found);
    expect(legacy).toContain(t.rd_cm_tt_lookup_failed);
  });
  it("12. the Business Pulse comment sits right above PulsePanel again (not above the TikTok limit card)", () => {
    const admin = src("src/redesign/screens/Admin.tsx");
    const c = admin.indexOf("// Business Pulse — WEB-ONLY admin activity view.");
    expect(admin.indexOf("// Business Pulse — WEB-ONLY")).toBe(admin.lastIndexOf("// Business Pulse — WEB-ONLY"));
    expect(admin.slice(c, admin.indexOf("function PulsePanel(")).split("\n").length).toBe(4);   // 3 comment lines, then the function
    expect(admin.slice(admin.indexOf("export function TikTokLimitCard()") - 400, admin.indexOf("export function TikTokLimitCard()"))).not.toContain("Business Pulse");
  });
});
