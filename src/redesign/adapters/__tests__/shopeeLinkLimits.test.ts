// The Shopee connect adapter (adapters/shopeeLink.ts) and the sql/199 refusals: 409 + code, with the numbers
// the "Plan full" popup needs. Every code main already knew answers exactly as before.
import { describe, it, expect, vi } from "vitest";
vi.mock("../../../supabase", () => ({ supabase: null }));
import { shopeeLinkConnect, shopeeLinkFailOf, isShopeeLimitFail, SHOPEE_LINK_ERR_KEY } from "../shopeeLink";

const answer = (status: number, body: unknown) => vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;

describe("sql/199 refusals", () => {
  it("409 shop_limit → the code + used / limit", async () => {
    const r = await shopeeLinkConnect("https://ph.shp.ee/x", { fetchImpl: answer(409, { ok: false, error: "shop_limit", used: 1, limit: 1 }), sessionId: () => "b" });
    expect(r).toEqual({ ok: false, error: "shop_limit", info: { used: 1, limit: 1, nextFreeAt: null, serverNow: null } });
  });
  it("409 shop_locked → the wait end and the server's now (for the countdown)", async () => {
    const r = await shopeeLinkConnect("https://ph.shp.ee/x", { fetchImpl: answer(409, { ok: false, error: "shop_locked", used: 2, limit: 2, next_free_at: "2026-11-22T12:00:00Z", now: "2026-11-22T09:45:00Z" }), sessionId: () => "b" });
    expect(r).toEqual({ ok: false, error: "shop_locked", info: { used: 2, limit: 2, nextFreeAt: "2026-11-22T12:00:00Z", serverNow: "2026-11-22T09:45:00Z" } });
  });
  it("409 not_covered; garbage numbers / times read as unknown", async () => {
    const r = await shopeeLinkConnect("https://ph.shp.ee/x", { fetchImpl: answer(409, { ok: false, error: "not_covered", used: "2", next_free_at: "soon" }), sessionId: () => "b" });
    expect(r).toEqual({ ok: false, error: "not_covered", info: { used: null, limit: null, nextFreeAt: null, serverNow: null } });
  });
  it("503 try_again → not responding (retry); a 409 with another code → not responding", () => {
    expect(shopeeLinkFailOf(503, "try_again")).toBe("unreachable");
    expect(shopeeLinkFailOf(409, "something_else")).toBe("unreachable");
    expect(shopeeLinkFailOf(403, "shop_limit")).toBe("no_beta"); // only a 409 carries the new codes
  });
  it("every code main knew answers as before; each new one has its own text", () => {
    expect(shopeeLinkFailOf(400, "bad_link")).toBe("bad_link");
    expect(shopeeLinkFailOf(403, "not_own")).toBe("not_own");
    expect(shopeeLinkFailOf(410, "ended")).toBe("ended");
    expect(shopeeLinkFailOf(403, "no_beta")).toBe("no_beta");
    expect(shopeeLinkFailOf(403, "")).toBe("no_beta");
    expect(shopeeLinkFailOf(502, "unreachable")).toBe("unreachable");
    expect(SHOPEE_LINK_ERR_KEY.shop_limit).toBe("rd_sh_err_shop_limit");
    expect(SHOPEE_LINK_ERR_KEY.shop_locked).toBe("rd_sh_err_shop_locked");
    expect(SHOPEE_LINK_ERR_KEY.not_covered).toBe("rd_sh_err_not_covered");
    expect(["shop_limit", "shop_locked", "not_covered"].every((c) => isShopeeLimitFail(c as never))).toBe(true);
    expect(isShopeeLimitFail("ended")).toBe(false);
  });
  it("a refusal that is not a limit carries no numbers (the old shape)", async () => {
    const r = await shopeeLinkConnect("https://ph.shp.ee/x", { fetchImpl: answer(410, { ok: false, error: "ended" }), sessionId: () => "b" });
    expect(r).toEqual({ ok: false, error: "ended" });
  });
});
