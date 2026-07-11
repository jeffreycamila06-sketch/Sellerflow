// Client side of broadcast translation — POSTs the source text to the admin-
// guarded server endpoint with the caller's JWT. Proves 403 (non-admin, server-
// enforced) → {ok:false,forbidden}, success → i18n map, and unreachable → the
// English-only fallback signal.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: { access_token: "jwt-abc" } } })),
}));
vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: () => getSession() } } }));
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { translateBroadcast } from "../broadcastTranslate";

const full = { en: "Sale", fil: "Sale", zh: "促销", "zh-TW": "促銷", vi: "Sale", th: "ลด", id: "Diskon" };

beforeEach(() => vi.clearAllMocks());
afterEach(() => { (globalThis.fetch as unknown) = undefined; });

describe("translateBroadcast (client)", () => {
  it("empty text → error, no request", async () => {
    const f = vi.fn(); globalThis.fetch = f as unknown as typeof fetch;
    const r = await translateBroadcast("   ");
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("success → i18n map; sends Bearer token + text to the admin endpoint", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, i18n: full }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await translateBroadcast("  Big sale  ");
    expect(r.ok).toBe(true);
    expect(r.i18n).toEqual(full);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://srv.test/admin/broadcast-translate");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-abc");
    expect(JSON.parse(init.body as string).text).toBe("Big sale"); // trimmed
  });

  it("403 (non-admin, server-enforced) → forbidden", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: "forbidden" }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await translateBroadcast("hi");
    expect(r).toEqual({ ok: false, error: "forbidden" });
  });

  it("502 translate failure → surfaces the server error (offer English-only)", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ success: false, error: "anthropic_http_429" }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await translateBroadcast("hi");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("anthropic_http_429");
  });

  it("server unreachable (not deployed yet) → unreachable flag", async () => {
    const f = vi.fn(async () => { throw new Error("network"); });
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await translateBroadcast("hi");
    expect(r.ok).toBe(false);
    expect(r.unreachable).toBe(true);
  });
});
