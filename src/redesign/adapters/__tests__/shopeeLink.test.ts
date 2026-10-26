// Shopee Live BETA — the paste-link connect adapter: POST /shopee/live/connect with the JWT +
// the BROWSER session id, the uid on success, one honest error code per failure.
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn(async () => ({ data: { session: { access_token: "jwt-1" } } }));
vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: () => getSession() } } }));

import { shopeeLinkConnect, shopeeLinkFailOf, SHOPEE_LINK_ERR_KEY } from "../shopeeLink";

const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response);
const sid = () => "sess-42";

beforeEach(() => { getSession.mockClear(); });

describe("shopeeLinkConnect", () => {
  it("POSTs the link + the browser session id with the bearer token; 200 → uid", async () => {
    const f = reply(200, { ok: true, region: "tw", session_id: "777", uid: "123456" });
    const r = await shopeeLinkConnect("  https://tw.shp.ee/abc  ", { fetchImpl: f as unknown as typeof fetch, sessionId: sid });
    expect(r).toEqual({ ok: true, uid: "123456", region: "tw" });
    const [url, init] = (f.mock.calls[0] as unknown as [string, RequestInit]);
    expect(url).toMatch(/\/shopee\/live\/connect$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(String(init.body))).toEqual({ shareLink: "https://tw.shp.ee/abc", sessionId: "sess-42" });
  });
  it("maps the server's codes: not_own / ended / bad_link / no_beta / unreachable", async () => {
    for (const [status, code, want] of [[400, "not_own", "not_own"], [410, "ended", "ended"], [400, "bad_link", "bad_link"], [403, "no_beta", "no_beta"], [502, "unreachable", "unreachable"], [503, "shopee_off", "unreachable"], [503, "blocked", "unreachable"]] as const) {
      const r = await shopeeLinkConnect("https://tw.shp.ee/x", { fetchImpl: reply(status, { ok: false, error: code }) as unknown as typeof fetch, sessionId: sid });
      expect(r).toEqual({ ok: false, error: want });
    }
  });
  it("network failure / unparsable body → unreachable (never a throw)", async () => {
    const boom = vi.fn(async () => { throw new Error("offline"); });
    expect(await shopeeLinkConnect("https://tw.shp.ee/x", { fetchImpl: boom as unknown as typeof fetch, sessionId: sid })).toEqual({ ok: false, error: "unreachable" });
    const bad = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error("html"); } }) as unknown as Response);
    expect(await shopeeLinkConnect("https://tw.shp.ee/x", { fetchImpl: bad as unknown as typeof fetch, sessionId: sid })).toEqual({ ok: false, error: "unreachable" });
  });
  it("status-only fallbacks + every code has a message key", () => {
    expect(shopeeLinkFailOf(403, undefined)).toBe("no_beta");
    expect(shopeeLinkFailOf(410, "")).toBe("ended");
    expect(shopeeLinkFailOf(400, "weird")).toBe("bad_link");
    expect(shopeeLinkFailOf(500, "")).toBe("unreachable");
    for (const k of ["bad_link", "not_own", "ended", "unreachable", "no_beta"] as const) expect(SHOPEE_LINK_ERR_KEY[k]).toMatch(/^rd_sh_/);
  });
});
