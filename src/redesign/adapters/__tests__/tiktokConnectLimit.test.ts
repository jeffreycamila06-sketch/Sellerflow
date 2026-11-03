// Nov 3, 2026 — admin client for the TikTok connection-limit routes (status + clear one
// account), JWT-authenticated; 403 = server-side is_admin refused; network failure = unreachable.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn(async () => ({ data: { session: { access_token: "jwt-abc" } } })) }));
vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: () => getSession() } } }));
vi.mock("../serverIdentity", () => ({ SERVER: "https://srv.test" }));

import { loadTikTokCooldownStatus, clearTikTokCooldown, usageWarns } from "../tiktokConnectLimit";

beforeEach(() => vi.clearAllMocks());
afterEach(() => { (globalThis.fetch as unknown) = undefined; });

describe("loadTikTokCooldownStatus", () => {
  it("GETs the admin status with the Bearer token and maps today + usage + cooldowns", async () => {
    const body = { success: true, today: { dayKey: "2026-11-03", count: 3, lastLabel: "daily_rooms", lastAt: 1 }, usage: { roomsToday: 12, concurrent: 4, dailyLimit: 1000, concurrentLimit: 100, warn: false, warnings: [] }, cooldowns: [{ username: "shop", sellerId: "a@x.com", remainingMs: 90_000 }] };
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await loadTikTokCooldownStatus();
    expect(r.ok).toBe(true);
    expect(r.status).toEqual({ count: 3, lastLabel: "daily_rooms", lastAt: 1, cooldowns: body.cooldowns, usage: { roomsToday: 12, concurrent: 4, dailyLimit: 1000, concurrentLimit: 100, warn: false } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://srv.test/admin/tiktok-cooldown/status?sfl_codes=1"); // Build 11 marker
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-abc");
  });
  it("403 → forbidden; network failure → unreachable; a server without usage → usage null", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: "forbidden" }) })) as unknown as typeof fetch;
    expect(await loadTikTokCooldownStatus()).toEqual({ ok: false, error: "forbidden" });
    globalThis.fetch = vi.fn(async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect(await loadTikTokCooldownStatus()).toEqual({ ok: false, error: "unreachable" });
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, today: { count: 0 }, cooldowns: [] }) })) as unknown as typeof fetch;
    expect((await loadTikTokCooldownStatus()).status?.usage).toBeNull();
  });
});

describe("clearTikTokCooldown", () => {
  it("POSTs the username (leading @ stripped) and returns the cleared count", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, cleared: 1 }) }));
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await clearTikTokCooldown(" @Thrifts.studio ")).toEqual({ ok: true, cleared: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://srv.test/admin/tiktok-cooldown/clear?sfl_codes=1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ username: "Thrifts.studio" });
  });
  it("empty username → no request; 403 → forbidden", async () => {
    const f = vi.fn(); globalThis.fetch = f as unknown as typeof fetch;
    expect(await clearTikTokCooldown("  ")).toEqual({ ok: false, error: "username_required" });
    expect(f).not.toHaveBeenCalled();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ success: false, error: "forbidden" }) })) as unknown as typeof fetch;
    expect(await clearTikTokCooldown("shop")).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("usageWarns — the red banner rule (70% of either limit)", () => {
  const u = (roomsToday: number, concurrent: number) => ({ roomsToday, concurrent, dailyLimit: 1000, concurrentLimit: 100, warn: false });
  it("off below 70%, on from 70% of rooms/day or concurrent; null usage never warns", () => {
    expect(usageWarns(u(699, 69))).toBe(false);
    expect(usageWarns(u(700, 0))).toBe(true);
    expect(usageWarns(u(0, 70))).toBe(true);
    expect(usageWarns(null)).toBe(false);
  });
});
