// Admin downgrade (sql/154), server half: POST /admin/accounts/stop-removed stops the running
// live of an account the admin just REMOVED — and can never stop one that is still connected.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { parseStopItems, stopRemovedAccounts, ADMIN_STOP_MAX_ITEMS } from "../../../../server/adminLiveStop.js";

const rt = (connected: boolean | Error, running = true) => ({
  stillConnected: vi.fn(async () => { if (connected instanceof Error) throw connected; return connected; }),
  stop: vi.fn(() => running),
});

describe("parseStopItems", () => {
  it("keeps Facebook / Instagram / Shopee items; drops TikTok, junk, repeats; caps the list", () => {
    expect(parseStopItems([
      { platform: "Facebook", key: " 123 " }, { platform: "facebook", key: "123" }, { platform: "instagram", key: "I1" }, { platform: "shopee", key: 501 },
      { platform: "tiktok", key: "name" }, { platform: "orders", key: "1" }, { platform: "facebook", key: "" }, null, "x",
    ])).toEqual([{ platform: "facebook", key: "123" }, { platform: "instagram", key: "I1" }, { platform: "shopee", key: "501" }]);
    expect(parseStopItems(null)).toEqual([]);
    expect(parseStopItems({})).toEqual([]);
    expect(parseStopItems(Array.from({ length: 50 }, (_, i) => ({ platform: "facebook", key: String(i) })))).toHaveLength(ADMIN_STOP_MAX_ITEMS);
  });
});

describe("stopRemovedAccounts", () => {
  it("row gone + a live running → stopped", async () => {
    const fb = rt(false);
    const out = await stopRemovedAccounts({ userId: "u1", items: [{ platform: "facebook", key: "P1" }], runtimes: { facebook: fb } });
    expect(out).toEqual({ stopped: 1, results: [{ platform: "facebook", stopped: true, reason: "stopped" }] });
    expect(fb.stillConnected).toHaveBeenCalledWith("u1", "P1");
    expect(fb.stop).toHaveBeenCalledWith("u1", "P1");
  });
  it("the account is STILL connected → never stopped (this route cannot cut a live the seller still has)", async () => {
    const fb = rt(true);
    const out = await stopRemovedAccounts({ userId: "u1", items: [{ platform: "facebook", key: "P1" }], runtimes: { facebook: fb } });
    expect(out).toEqual({ stopped: 0, results: [{ platform: "facebook", stopped: false, reason: "still_connected" }] });
    expect(fb.stop).not.toHaveBeenCalled();
  });
  it("the row cannot be read → not stopped (a failed read is never 'gone')", async () => {
    const ig = rt(new Error("db"));
    const out = await stopRemovedAccounts({ userId: "u1", items: [{ platform: "instagram", key: "I1" }], runtimes: { instagram: ig } });
    expect(out.results).toEqual([{ platform: "instagram", stopped: false, reason: "check_failed" }]);
    expect(ig.stop).not.toHaveBeenCalled();
  });
  it("an odd answer from the read (not exactly false) → treated as still connected", async () => {
    const fb = { stillConnected: vi.fn(async () => undefined), stop: vi.fn(() => true) };
    const out = await stopRemovedAccounts({ userId: "u1", items: [{ platform: "facebook", key: "P1" }], runtimes: { facebook: fb } });
    expect(out.stopped).toBe(0);
    expect(fb.stop).not.toHaveBeenCalled();
  });
  it("row gone but no live running → not_running; a platform that is switched off → unavailable; a throwing stop never throws out", async () => {
    const sh = rt(false, false);
    const bad = { stillConnected: vi.fn(async () => false), stop: vi.fn(() => { throw new Error("x"); }) };
    const out = await stopRemovedAccounts({ userId: "u1", items: [{ platform: "shopee", key: "501" }, { platform: "instagram", key: "I1" }, { platform: "facebook", key: "P1" }], runtimes: { shopee: sh, facebook: bad } });
    expect(out).toEqual({ stopped: 0, results: [
      { platform: "shopee", stopped: false, reason: "not_running" },
      { platform: "instagram", stopped: false, reason: "unavailable" },
      { platform: "facebook", stopped: false, reason: "not_running" },
    ] });
  });
});

describe("server.js wiring (source)", () => {
  const src = readFileSync("server.js", "utf8");
  const route = src.slice(src.indexOf('app.post("/admin/accounts/stop-removed"'), src.indexOf("// Build 11 (M8) — LAST"));
  it("admin only: requireAuth then requireAdmin, before the handler", () => {
    expect(route.startsWith('app.post("/admin/accounts/stop-removed", requireAuth, requireAdmin, async (req, res) => {')).toBe(true);
  });
  it("re-reads the row with the service key and stops with reason 'removed' through each runtime's own stopPoller", () => {
    expect(route).toContain('serviceSb.from(table).select("id", { count: "exact", head: true }).eq("user_id", uid)');
    expect(route).toContain('fbRuntime.stopPoller(liveKey(uid, "Facebook", key), "removed")');
    expect(route).toContain('igRuntime.stopPoller(liveKey(uid, IG_PLATFORM, key), "removed")');
    expect(route).toContain('shopeeRuntime.stopPoller(liveKey(uid, "Shopee", key), "removed")');
    expect(route).toContain("stopRemovedAccounts({ userId, items, runtimes })");
  });
  it("writes nothing: no insert / update / delete / rpc in the route, and the log line carries counts only", () => {
    expect(route).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    const log = route.split("\n").find((l) => l.includes("console.log"))!;
    expect(log).toContain("asked=${items.length} stopped=${out.stopped}");
    expect(log).not.toMatch(/key|name|token/);
  });
  it("the route sits before the final error handler (still the last app.use)", () => {
    expect(src.indexOf('app.post("/admin/accounts/stop-removed"')).toBeLessThan(src.indexOf("app.use(finalErrorHandler());"));
  });
});
