// Combined account limit (sql/84) — the Facebook / Shopee authorize callbacks.
// A failed plan or count read is a shown error (read_failed), never "no limit";
// the database's account_limit refusal maps to code=account_limit.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFbRuntime, signState as fbSign } from "../../../../server/fbLive.js";
import { createShopeeRuntime, signState as shSign } from "../../../../server/shopeeLive.js";

const mkRes = (status: number, body: unknown) => ({ status, json: async () => body });
const liveKey = (a: string, b: string, c: string) => `${a}:${b}:${c}`;
const loops = { setLoop: () => 1, clearLoop: () => {}, setTimer: () => 2, clearTimer: () => {} };

type Over = { planErr?: boolean; countErr?: boolean; saveErr?: string };

function fbStore(o: Over) {
  return {
    upserts: 0,
    async getPlan() { if (o.planErr) throw new Error("plan_read_failed"); return "basic"; },
    async countPages() { if (o.countErr) throw new Error("count_read_failed"); return 0; },
    async getPage() { return null; },
    async upsertPage() { if (o.saveErr) throw new Error(o.saveErr); this.upserts++; },
    async listActivePages() { return []; },
    async setActive() {}, async updateExpiry() {},
  };
}
function shStore(o: Over) {
  return {
    upserts: 0,
    async getPlan() { if (o.planErr) throw new Error("plan_read_failed"); return "basic"; },
    async countShops() { if (o.countErr) throw new Error("count_read_failed"); return 0; },
    async getShop() { return null; },
    async upsertShop() { if (o.saveErr) throw new Error(o.saveErr); this.upserts++; },
    async listActiveShops() { return []; },
    async updateTokens() {}, async setActive() {},
  };
}

async function fbCallback(o: Over) {
  const f = vi.fn()
    .mockResolvedValueOnce(mkRes(200, { access_token: "SHORT" }))
    .mockResolvedValueOnce(mkRes(200, { access_token: "LONG", expires_in: 5184000 }))
    .mockResolvedValue(mkRes(200, { data: [{ id: "P1", name: "Page", access_token: "PT" }] }));
  const store = fbStore(o);
  const rt = createFbRuntime({
    config: { enabled: true, appId: "a", appSecret: "s", tokenKey: "tk" }, store, liveKey,
    emitComment: vi.fn(), statusEmit: vi.fn(), renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl: f, now: () => 1_000_000, log: () => {}, ...loops,
  } as never);
  const out = await rt.handleCallback({ code: "C", state: fbSign({ userId: "u1", key: "s", nowMs: 1_000_000 }) });
  return { out, store };
}
async function shCallback(o: Over) {
  const f = vi.fn()
    .mockResolvedValueOnce(mkRes(200, { access_token: "AT", refresh_token: "RT", expire_in: 14400 }))
    .mockResolvedValue(mkRes(200, { shop_name: "Shop" }));
  const store = shStore(o);
  const rt = createShopeeRuntime({
    config: { enabled: true, partnerId: "1", partnerKey: "pk", tokenKey: "tk" }, store, liveKey,
    emitComment: vi.fn(), statusEmit: vi.fn(), renderUrl: "https://srv.test", appUrl: "https://app.test",
    fetchImpl: f, now: () => 1_000_000, log: () => {}, ...loops,
  } as never);
  const out = await rt.handleCallback({ code: "C", shopId: "5", state: shSign({ userId: "u1", key: "pk", nowMs: 1_000_000 }) });
  return { out, store };
}

describe("Facebook callback", () => {
  it("plan read error → read_failed, nothing saved", async () => {
    const { out, store } = await fbCallback({ planErr: true });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=read_failed");
    expect(store.upserts).toBe(0);
  });
  it("count read error → read_failed, nothing saved", async () => {
    const { out, store } = await fbCallback({ countErr: true });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=read_failed");
    expect(store.upserts).toBe(0);
  });
  it("database account_limit → code=account_limit", async () => {
    const { out } = await fbCallback({ saveErr: "account_limit" });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=account_limit");
  });
  it("other save error stays save_failed", async () => {
    const { out } = await fbCallback({ saveErr: "fb_page_save_failed" });
    expect(out.redirect).toBe("https://app.test/?fb=error&code=save_failed");
  });
  it("healthy reads → connected", async () => {
    expect((await fbCallback({})).out.redirect).toBe("https://app.test/?fb=connected");
  });
});

describe("Shopee callback", () => {
  it("plan read error → read_failed, nothing saved", async () => {
    const { out, store } = await shCallback({ planErr: true });
    expect(out.redirect).toBe("https://app.test/?shopee=error&code=read_failed");
    expect(store.upserts).toBe(0);
  });
  it("count read error → read_failed, nothing saved", async () => {
    const { out, store } = await shCallback({ countErr: true });
    expect(out.redirect).toBe("https://app.test/?shopee=error&code=read_failed");
    expect(store.upserts).toBe(0);
  });
  it("database account_limit → code=account_limit", async () => {
    const { out } = await shCallback({ saveErr: "account_limit" });
    expect(out.redirect).toBe("https://app.test/?shopee=error&code=account_limit");
  });
  it("healthy reads → connected", async () => {
    expect((await shCallback({})).out.redirect).toBe("https://app.test/?shopee=connected");
  });
});

describe("server.js stores never hide a read or save error", () => {
  const src = readFileSync("server.js", "utf8");
  it("getPlan throws plan_read_failed in both stores", () => {
    expect(src.match(/if \(error\) throw new Error\("plan_read_failed"\)/g)?.length).toBe(2);
  });
  it("countShops / countPages throw on error", () => {
    expect(src.match(/if \(error\) throw new Error\("count_read_failed"\)/g)?.length).toBe(2);
  });
  it("upsertShop / upsertPage carry account_limit", () => {
    expect(src.match(/\/account_limit\/\.test\(String\(error\.message/g)?.length).toBe(2);
  });
});
