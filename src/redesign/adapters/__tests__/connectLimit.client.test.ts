// Nov 3, 2026 — the client side of the connection-limit cooldown: the 429 answer's cooldownMs
// reaches the caller, the toast is the fixed "retrying for you" text (no minutes), the retry
// delay = cooldownMs (else the sentence's minutes) + a pad, and RedesignApp wires ONE retry
// (manual tap / Disconnect cancel it; the retried attempt never schedules another).
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } } }));
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test", sellerIdOf: (e: string) => e, browserSessionId: () => "sess" }));

import { connectPlatform, connectFailText, cooldownRetryDelayMs, COOLDOWN_RETRY_PAD_MS } from "../connect";
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
  it("the toast is the fixed text in every language; other failures unchanged", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const tt = buildT(lang);
      expect(connectFailText({ cooldownMs: 120_000, error: "E41:2" }, tt)).toBe(tt.rd_cm_tt_cooldown);
      expect(tt.rd_cm_tt_cooldown).not.toContain("{n}");
      expect(tt.rd_cm_tt_cooldown.length).toBeGreaterThan(8);
    }
    expect(connectFailText({ cooldownMs: 120_000 }, t)).toBe("Connection limit reached — we're retrying for you");
    expect(connectFailText({ error: "Server error" }, t)).toBe(t.rd_cm_conn_try_again);
    expect(connectFailText({ notLive: true }, t)).toBe(t.rd_cm_not_live);
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const app = src("src/redesign/RedesignApp.tsx");
  it("one retry per cooldown answer, TikTok only, never from a retried attempt", () => {
    expect(app).toContain('const retryMs = !r.ok && platform === "TikTok" && !opts?.retry ? cooldownRetryDelayMs(r) : null;');
    expect(app).toContain('if (retryMs !== null) cooldownRetry.schedule(acct, retryMs, () => { if (!ttEffRef.current) void performConnect("TikTok", acct, { retry: true }); });');
  });
  it("a manual tap and Disconnect cancel a pending retry; unmount too", () => {
    expect(app).toContain("if (!opts?.retry) cooldownRetry.cancel();");
    expect(app).toContain("if (eff) { cooldownRetry.cancel(); setOff(true); return; }");
    expect(app).toContain("useEffect(() => () => cooldownRetry.cancel(), [cooldownRetry]);");
  });
  it("the retry goes through performConnect (the same tap path: toast gate, analytics, honest toast) — no bare liveFeed.connect", () => {
    const fn = app.slice(app.indexOf("const performConnect = async"), app.indexOf("const doConnect = async"));
    expect(fn.match(/liveFeed\.connect\(/g)?.length).toBe(1);
  });
});
