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
  it("the daily limit marker rides along", async () => {
    serve(429, { success: false, error: "E41:60", cooldownMs: 3_600_000, limit: "daily_rooms" });
    const r = await connectPlatform("TikTok", { username: "shop" }, "s@x.com");
    expect(r.limit).toBe("daily_rooms");
    serve(429, { success: false, error: "E41:2", cooldownMs: 120_000 });
    expect((await connectPlatform("TikTok", { username: "shop" }, "s@x.com")).limit).toBeUndefined();
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
    expect(cooldownRetryDelayMs({ cooldownMs: 120_000, limit: "daily_rooms" })).toBeNull();
    expect(cooldownRetryDelayMs({ cooldownMs: 10 * 60_000 })).toBe(10 * 60_000 + COOLDOWN_RETRY_PAD_MS);   // exactly 10 min still retries
    expect(cooldownRetryDelayMs({ cooldownMs: 10 * 60_000 + 1 })).toBeNull();
    expect(cooldownRetryDelayMs({ cooldownMs: 30 * 60_000 })).toBeNull();                                  // old server: 30 min
    expect(cooldownRetryDelayMs({ error: "TikTok connection is on cooldown after a rate limit. Try again in 12 minutes." })).toBeNull();
    expect(cooldownRetryDelayMs({ error: "TikTok rate limit reached. Try again in about 1 hour(s)." })).toBeNull();
  });
  it("the toast says 'retrying' ONLY when a retry is scheduled; daily → daily text; retried / too long → 'try again in a few minutes'", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const tt = buildT(lang);
      expect(connectFailText({ cooldownMs: 120_000, error: "E41:2" }, tt)).toBe(tt.rd_cm_tt_cooldown);
      expect(connectFailText({ cooldownMs: 120_000, error: "E41:2" }, tt, { retried: true })).toBe(tt.rd_cm_tt_cooldown_again);
      expect(connectFailText({ cooldownMs: 3_600_000, error: "E41:60", limit: "daily_rooms" }, tt)).toBe(tt.rd_cm_tt_daily_limit);
      expect(connectFailText({ cooldownMs: 30 * 60_000, error: "E41:30" }, tt)).toBe(tt.rd_cm_tt_cooldown_again);
      for (const k of ["rd_cm_tt_cooldown", "rd_cm_tt_cooldown_again", "rd_cm_tt_daily_limit"] as const) {
        expect(tt[k]).not.toContain("{n}");
        expect(tt[k].length).toBeGreaterThan(3);
      }
      expect(tt.rd_cm_tt_cooldown_again).not.toBe(tt.rd_cm_tt_cooldown);
    }
    expect(connectFailText({ cooldownMs: 120_000 }, t)).toBe("Connection limit reached — we're retrying for you");
    expect(connectFailText({ cooldownMs: 120_000 }, t, { retried: true })).toBe("Try again in a few minutes");
    expect(connectFailText({ cooldownMs: 3_600_000, limit: "daily_rooms" }, t)).toBe("Daily connection limit reached — try again later");
    expect(connectFailText({ error: "Server error" }, t)).toBe(t.rd_cm_conn_try_again);
    expect(connectFailText({ notLive: true }, t)).toBe(t.rd_cm_not_live);
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const app = src("src/redesign/RedesignApp.tsx");
  it("one retry per cooldown answer, TikTok only, never from a retried attempt; the timer re-checks the server session + platforms and passes register through", () => {
    expect(app).toContain('const retryMs = !r.ok && platform === "TikTok" && !opts?.retry ? cooldownRetryDelayMs(r) : null;');
    const timer = app.slice(app.indexOf("if (retryMs !== null) cooldownRetry.schedule("), app.indexOf("if (!r.ok) setToast({ msg: connectFailText(r, tApp, { retried"));
    expect(timer).toContain("const session = await sessionInstance.checkStatus();");
    expect(timer).toContain("if (!retryAllowed({ ttLive: ttEffRef.current, otherLive: otherLiveRef.current, session })) return;");
    expect(timer).toContain('void performConnect("TikTok", acct, { retry: true, register: opts?.register });');
    expect(app).toContain("const otherLive = fbEff || igEff || shopeeEff;");
  });
  it("the second 429 (on the retry) shows 'try again in a few minutes', never 'retrying'", () => {
    expect(app).toContain("if (!r.ok) setToast({ msg: connectFailText(r, tApp, { retried: !!opts?.retry }), kind: \"err\" });");
  });
  it("a manual tap, Disconnect, unmount, another platform's connect, a platform switch and session end all cancel a pending retry", () => {
    expect(app).toContain("if (!opts?.retry) cooldownRetry.cancel();");
    expect(app).toContain("if (eff) { cooldownRetry.cancel(); setOff(true); return; }");
    expect(app).toContain("useEffect(() => () => cooldownRetry.cancel(), [cooldownRetry]);");
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
