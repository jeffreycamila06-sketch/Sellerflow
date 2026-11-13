// FamilyMart store # check — server core (server/fmStoreCheck.js) + the route's wiring.
// ⚠️ The pages below are built from what Jeff measured in a browser (2026-11-12): the short
// "抱歉無此店鋪" body, the store block "店鋪代號：<code> (全家…店)" + "地址：", and the extra
// "封閉型店舖" words. They are NOT bytes captured from Render.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import http from "node:http";
import express from "express";
import { parseFmStoreVerdict, decodeFmBytes, checkFmStore, createFmStoreCache, fmStoreUrl, FM_STORE_CANARY, FM_STORE_CHECK_MAX_PER_MIN } from "../../../../server/fmStoreCheck.js";
import { createFmStoreCheckHandler } from "../../../../server/fmStoreCheckRoute.js";
import { createWindowLimiter, EMAP_CHECK_MAX_PER_MIN } from "../../../../server/rateWindow.js";

const storePage = (code: string, name = "全家樹林新柑園店", extra = "") =>
  `<html><head><meta charset="utf-8"></head><body><table><tr><td>店鋪代號：</td><td>${code} (${name})</td></tr><tr><td>地址：</td><td>新北市樹林區測試路1號</td></tr>${extra}</table></body></html>`;
const NONE = "抱歉無此店鋪";
const resp = (body: string | Uint8Array, init: { status?: number; ct?: string; cookies?: string[] } = {}) => ({
  ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300, status: init.status ?? 200,
  headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? init.ct ?? "text/html; charset=utf-8" : null), getSetCookie: () => init.cookies ?? [] },
  arrayBuffer: async () => { const u = typeof body === "string" ? new TextEncoder().encode(body) : body; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); },
});
const NOW = 1_800_000_000_000;
const opts = (fetchImpl: unknown) => ({ fetchImpl: fetchImpl as typeof fetch, cache: createFmStoreCache(), timeoutMs: 200, now: NOW });

describe("parseFmStoreVerdict — the three measured shapes", () => {
  it("no such store (015905): the whole answer is the sorry sentence → not_found (either 鋪 / 舖, tags and spaces around it allowed)", () => {
    expect(parseFmStoreVerdict("015905", NONE)).toEqual({ status: "not_found" });
    expect(parseFmStoreVerdict("015905", "抱歉無此店舖")).toEqual({ status: "not_found" });
    expect(parseFmStoreVerdict("015905", "<span> 抱歉無此店鋪 </span>\r\n")).toEqual({ status: "not_found" });
  });
  it("a store (022131) → valid, closed false", () => {
    expect(parseFmStoreVerdict("022131", storePage("022131"))).toEqual({ status: "valid", closed: false });
  });
  it("封閉型店舖 (024563) → still valid, closed true", () => {
    expect(parseFmStoreVerdict("024563", storePage("024563", "全家日月光七店", "<tr><td>封閉型店舖</td></tr>"))).toEqual({ status: "valid", closed: true });
  });
});

describe("parseFmStoreVerdict — anything else is unknown", () => {
  it.each([
    ["empty", ""],
    ["an error page", "<html><body><h1>Service Unavailable</h1></body></html>"],
    ["a login / other page", "<html><body>請先登入</body></html>"],
    ["the store block of ANOTHER code", storePage("022132")],
    ["a store block with no address", "<html><body>店鋪代號：022131 (全家樹林新柑園店)</body></html>"],
    ["the sorry words inside a long page", `<html><body>${"說明".repeat(200)}抱歉無此店鋪</body></html>`],
    ["the sorry words with ANY other text (1a: only the exact sentence counts)", "<html><body>抱歉無此店鋪 請稍後再試</body></html>"],
    ["the sorry words inside a short error page", "系統忙碌 抱歉無此店鋪"],
    ["JSON", '{"error":"x"}'],
  ])("%s", (_n, body) => {
    expect(parseFmStoreVerdict("022131", body).status).toBe("unknown");
  });
});

describe("decodeFmBytes", () => {
  it("decodes by the charset the answer names (Big5), else by the bytes", () => {
    const big5 = new Uint8Array([0xa9, 0xea, 0xba, 0x70, 0xb5, 0x4c, 0xa6, 0xb9, 0xa9, 0xb1, 0xbe, 0x51]); // 抱歉無此店鋪
    expect(decodeFmBytes(big5.buffer, "text/html; charset=big5")).toBe(NONE);
    expect(decodeFmBytes(big5.buffer, "text/html")).toBe(NONE);
    expect(decodeFmBytes(new TextEncoder().encode(NONE).buffer, "")).toBe(NONE);
  });
});

describe("checkFmStore", () => {
  it("6 digits only — anything else is unknown with no request", async () => {
    const f = vi.fn();
    for (const bad of ["", "12345", "1234567", "02213a", "022 131"]) expect((await checkFmStore(bad, opts(f))).status).toBe("unknown");
    expect(f).not.toHaveBeenCalled();
  });
  it("plain GET of the measured URL; a known shape needs one request", async () => {
    const f = vi.fn(async (_u: string) => resp(storePage("022131")));
    const r = await checkFmStore("022131", opts(f));
    expect(r).toMatchObject({ storeId: "022131", status: "valid", closed: false });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(fmStoreUrl("022131"));
    expect(String(f.mock.calls[0][0])).toContain("cvsname=WWW.FAMILY.COM.TW&cvsid=1&cvstemp=test&exchange=true&cvslink=&city=&area=&pkey=022131&searchType=2&searchWord=022131");
  });
  it("an answer of no known shape → opens default.aspx, keeps the cookies, asks ONCE more", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp("<html><body>session</body></html>"))
      .mockResolvedValueOnce(resp("<html>home</html>", { cookies: ["ASP.NET_SessionId=abc; path=/; HttpOnly"] }))
      .mockResolvedValueOnce(resp(NONE))
      .mockResolvedValueOnce(resp(storePage(FM_STORE_CANARY))); // the canary confirms the not_found
    const r = await checkFmStore("015905", opts(f));
    expect(r).toMatchObject({ status: "not_found", retried: true });
    expect(f).toHaveBeenCalledTimes(4);
    expect(String(f.mock.calls[1][0])).toContain("default.aspx");
    expect(f.mock.calls[2][1].headers.Cookie).toBe("ASP.NET_SessionId=abc");
  });
  it("still no known shape after the retry → unknown + a short raw piece (no more requests)", async () => {
    const f = vi.fn(async () => resp(`<html><body>${"x".repeat(900)}</body></html>`));
    const r = await checkFmStore("022131", opts(f));
    expect(r.status).toBe("unknown");
    expect(f).toHaveBeenCalledTimes(3);
    expect(String(r.raw).length).toBeLessThanOrEqual(160);
  });
  it("non-200, a network error and a timeout are unknown — never a verdict, never a throw", async () => {
    expect((await checkFmStore("022131", opts(vi.fn(async () => resp("x", { status: 503 }))))).status).toBe("unknown");
    expect((await checkFmStore("022131", opts(vi.fn(async () => { throw new Error("ECONNRESET"); })))).status).toBe("unknown");
    const hang = vi.fn((_u: string, o: { signal: AbortSignal }) => new Promise((_res, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const t0 = Date.now();
    expect((await checkFmStore("022131", { ...opts(hang), timeoutMs: 60 })).status).toBe("unknown");
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(hang).toHaveBeenCalledTimes(1); // a timeout is not retried
  });
  it("cache: valid is kept 12 hours, not_found 10 minutes only, unknown never; the size is bounded", async () => {
    const cache = createFmStoreCache();
    const f = vi.fn(async (u: string) => resp(String(u).includes("pkey=015905") ? NONE : storePage(String(u).match(/pkey=(\d{6})/)![1])));
    const o = { fetchImpl: f as unknown as typeof fetch, cache, timeoutMs: 200 };
    await checkFmStore("022777", { ...o, now: NOW });
    expect(await checkFmStore("022777", { ...o, now: NOW + 11 * 3600_000 })).toMatchObject({ status: "valid", cached: true });
    expect(f).toHaveBeenCalledTimes(1);
    await checkFmStore("022777", { ...o, now: NOW + 13 * 3600_000 });
    expect(f).toHaveBeenCalledTimes(2);
    const t1 = NOW + 20 * 3600_000;
    expect((await checkFmStore("015905", { ...o, now: t1 })).status).toBe("not_found"); // 015905 + the canary
    await checkFmStore("015905", { ...o, now: t1 + 11 * 60_000 });
    expect(f.mock.calls.filter((c) => String(c[0]).includes("pkey=015905")).length).toBe(2); // 11 minutes: asked again
    const bad = vi.fn(async () => resp("x", { status: 500 }));
    await checkFmStore("022999", { ...o, fetchImpl: bad as unknown as typeof fetch, now: NOW });
    const once = bad.mock.calls.length;
    await checkFmStore("022999", { ...o, fetchImpl: bad as unknown as typeof fetch, now: NOW });
    expect(bad.mock.calls.length).toBe(once * 2); // asked again: an unknown is not kept
    const small = createFmStoreCache({ max: 2 });
    small.set("000001", { status: "valid" }); small.set("000002", { status: "valid" }); small.set("000003", { status: "not_found" });
    expect(small.size()).toBe(2);
    expect(small.get("000001")).toBeNull();
  });
  it("fresh (a Re-check tap): the cache is not read; a fresh not_found AND a fresh valid answer are stored", async () => {
    const cache = createFmStoreCache();
    let page = storePage("022777");
    const f = vi.fn(async (u: string) => resp(String(u).includes(`pkey=${FM_STORE_CANARY}`) ? storePage(FM_STORE_CANARY) : page));
    const o = { fetchImpl: f as unknown as typeof fetch, cache, timeoutMs: 200, now: NOW };
    await checkFmStore("022777", o);
    page = NONE;
    expect((await checkFmStore("022777", o)).status).toBe("valid"); // cached
    expect(f).toHaveBeenCalledTimes(1);
    expect(await checkFmStore("022777", { ...o, fresh: true })).toMatchObject({ status: "not_found" });
    expect(await checkFmStore("022777", o)).toMatchObject({ status: "not_found", cached: true }); // the new answer replaced the old one
    page = storePage("022777");
    expect(await checkFmStore("022777", { ...o, fresh: true })).toMatchObject({ status: "valid" });
    expect(cache.get("022777", NOW)).toMatchObject({ status: "valid" }); // a fresh valid answer is stored
    expect(await checkFmStore("022777", o)).toMatchObject({ status: "valid", cached: true });
  });
});

describe("canary — never a false 'wrong store code'", () => {
  const siteWith = (canaryPage: string) => vi.fn(async (u: string) => resp(String(u).includes(`pkey=${FM_STORE_CANARY}`) ? canaryPage : NONE));
  const pkeys = (f: { mock: { calls: unknown[][] } }) => f.mock.calls.map((c) => String(c[0]).match(/pkey=(\d{6})/)![1]);
  it("default canary store is 022131", () => { expect(FM_STORE_CANARY).toBe("022131"); });
  it("1a EVERY not_found from the site is confirmed with the canary right then (no 10-minute trust)", async () => {
    const f = siteWith(storePage(FM_STORE_CANARY));
    const cache = createFmStoreCache();
    const o = { fetchImpl: f as unknown as typeof fetch, cache, timeoutMs: 200 };
    expect((await checkFmStore("015905", { ...o, now: NOW })).status).toBe("not_found");
    expect(cache.get("015905", NOW)).toEqual({ status: "not_found" });
    expect((await checkFmStore("015906", { ...o, now: NOW + 60_000 })).status).toBe("not_found"); // 1 minute later: canary asked again
    expect(pkeys(f)).toEqual(["015905", FM_STORE_CANARY, "015906", FM_STORE_CANARY]);
  });
  it("1a a cached not_found is answered from the cache with NO canary lookup", async () => {
    const f = siteWith(storePage(FM_STORE_CANARY));
    const cache = createFmStoreCache();
    const o = { fetchImpl: f as unknown as typeof fetch, cache, timeoutMs: 200 };
    await checkFmStore("015905", { ...o, now: NOW });
    const n = f.mock.calls.length;
    expect(await checkFmStore("015905", { ...o, now: NOW + 9 * 60_000 })).toEqual({ storeId: "015905", status: "not_found", cached: true });
    expect(f.mock.calls.length).toBe(n);
  });
  it("1a the canary is not valid (site says 'sorry' for everything) → unknown, not cached, canaryFailed", async () => {
    const f = siteWith(NONE);
    const cache = createFmStoreCache();
    const r = await checkFmStore("015905", { fetchImpl: f as unknown as typeof fetch, cache, timeoutMs: 200, now: NOW });
    expect(r).toMatchObject({ status: "unknown", canaryFailed: { store: FM_STORE_CANARY, got: "not_found" } });
    expect(cache.get("015905", NOW)).toBeNull();
  });
  it("the canary cannot be read (error page) → unknown", async () => {
    const f = siteWith("<html><body>Service Unavailable</body></html>");
    const r = await checkFmStore("015905", { fetchImpl: f as unknown as typeof fetch, cache: createFmStoreCache(), timeoutMs: 200, now: NOW });
    expect(r).toMatchObject({ status: "unknown", canaryFailed: { store: FM_STORE_CANARY, got: "unknown" } });
  });
  it("1b a not_found for the canary store itself → unknown, never cached, canaryFailed — also when fresh; no extra request", async () => {
    for (const fresh of [false, true]) {
      const sorry = vi.fn(async () => resp(NONE));
      const cache = createFmStoreCache();
      const r = await checkFmStore(FM_STORE_CANARY, { fetchImpl: sorry as unknown as typeof fetch, cache, timeoutMs: 200, now: NOW, fresh });
      expect(r).toMatchObject({ status: "unknown", canaryFailed: { store: FM_STORE_CANARY, got: "not_found" } });
      expect(cache.get(FM_STORE_CANARY, NOW)).toBeNull();
      expect(sorry).toHaveBeenCalledTimes(1);
    }
  });
  it("the canary lookup stays inside the ONE time limit of the whole check", async () => {
    // the store answers 'sorry' quickly; the canary hangs until it is aborted
    const f = vi.fn((u: string, o: { signal: AbortSignal }) => String(u).includes(`pkey=${FM_STORE_CANARY}`)
      ? new Promise((_res, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))
      : Promise.resolve(resp(NONE)));
    const t0 = Date.now();
    const r = await checkFmStore("015905", { fetchImpl: f as unknown as typeof fetch, cache: createFmStoreCache(), timeoutMs: 80, now: NOW });
    expect(r.status).toBe("unknown");
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("a valid store needs no canary", async () => {
    const f = vi.fn(async () => resp(storePage("022777")));
    await checkFmStore("022777", { fetchImpl: f as unknown as typeof fetch, cache: createFmStoreCache(), timeoutMs: 200, now: NOW });
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("the route, really run (auth stubbed)", () => {
  const post = (port: number, body: unknown, seller = "s1") => new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path: "/admin/fm-store-check", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "x-seller": seller } }, (res) => {
      let buf = ""; res.on("data", (c) => { buf += c; }); res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(buf || "{}") }));
    });
    req.on("error", reject); req.end(data);
  });
  const serve = async (check: (id: string, o: { fresh: boolean }) => Promise<Record<string, unknown>>, max = FM_STORE_CHECK_MAX_PER_MIN) => {
    const logs: string[] = [];
    const app = express();
    app.use(express.json());
    const auth = (req: express.Request & { sellerId?: string }, _res: express.Response, next: express.NextFunction) => { req.sellerId = String(req.headers["x-seller"]); next(); };
    app.post("/admin/fm-store-check", auth, createFmStoreCheckHandler({ check, allowed: createWindowLimiter({ max, windowMs: 60_000 }), log: (l: string) => logs.push(l) }));
    const server = await new Promise<http.Server>((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
    return { port: (server.address() as { port: number }).port, logs, close: () => new Promise((res) => server.close(res)) };
  };
  it("200 with the verdict only; fresh is passed on; 400 on anything but 6 digits (the lookup is never called)", async () => {
    const check = vi.fn(async (id: string) => ({ storeId: id, status: "valid", closed: true }));
    const s = await serve(check);
    try {
      const ok = await post(s.port, { storeId: "022131" });
      expect(ok).toEqual({ status: 200, json: { success: true, storeId: "022131", status: "valid" } });
      expect(check).toHaveBeenLastCalledWith("022131", { fresh: false });
      await post(s.port, { storeId: "022131", fresh: true });
      expect(check).toHaveBeenLastCalledWith("022131", { fresh: true });
      for (const notTrue of ["true", 1, "1", {}]) { // only the boolean true counts as fresh
        await post(s.port, { storeId: "022131", fresh: notTrue });
        expect(check).toHaveBeenLastCalledWith("022131", { fresh: false });
      }
      // 1c: a string of 6 digits only — a number, an array or an object is refused too (never a 500)
      for (const bad of [{}, { storeId: "12345" }, { storeId: "1234567" }, { storeId: "02213a" }, { storeId: "0221 31" }, { storeId: 221310 }, { storeId: ["022131"] }, { storeId: { toString: 1 } }, { storeId: null }]) {
        expect(await post(s.port, bad)).toEqual({ status: 400, json: { success: false, error: "bad_store_id" } });
      }
      expect(check).toHaveBeenCalledTimes(6);
      expect(s.logs[0]).toMatch(/^\[FM_STORE_CHECK\] store=022131 result=valid closed=true ms=\d+$/);
    } finally { await s.close(); }
  });
  it("1e the limit is per seller: 429 past it, another seller still passes; the number is 120 (the 7-11 one is unchanged)", async () => {
    expect(FM_STORE_CHECK_MAX_PER_MIN).toBe(120);
    expect(EMAP_CHECK_MAX_PER_MIN).toBe(30);
    const check = vi.fn(async (id: string) => ({ storeId: id, status: "valid" }));
    const s = await serve(check, 3);
    try {
      for (let i = 0; i < 3; i++) expect((await post(s.port, { storeId: "022131" })).status).toBe(200);
      const over = await post(s.port, { storeId: "022131" });
      expect(over.status).toBe(429);
      expect(over.json).toMatchObject({ success: false, error: "rate_limited" });
      expect(check).toHaveBeenCalledTimes(3);
      expect((await post(s.port, { storeId: "022131" }, "s2")).status).toBe(200);
    } finally { await s.close(); }
  });
  it("log: canary_failed line; a raw piece only on unknown", async () => {
    const s = await serve(async (id: string) => ({ storeId: id, status: "unknown", canaryFailed: { store: "022131", got: "not_found" }, raw: "x" }));
    try {
      await post(s.port, { storeId: "015905" });
      expect(s.logs).toContain("[FM_STORE_CHECK] canary_failed store=022131 got=not_found");
      expect(s.logs.some((l) => l.startsWith("[FM_STORE_CHECK] RAW store=015905 "))).toBe(true);
    } finally { await s.close(); }
  });
});

describe("server.js wiring (source contract)", () => {
  const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
  it("same auth as the 7-11 check, its own limiter with its own number", () => {
    expect(src).toContain('app.post("/admin/fm-store-check", requireAuth, requirePlanActive, createFmStoreCheckHandler({ check: checkFmStore, allowed: fmStoreCheckAllowed }));');
    expect(src).toContain("const fmStoreCheckAllowed = createWindowLimiter({ max: FM_STORE_CHECK_MAX_PER_MIN, windowMs: 60_000 });");
    expect(src).toContain("const emapCheckAllowed = createWindowLimiter({ max: EMAP_CHECK_MAX_PER_MIN, windowMs: 60_000 });");
  });
});

describe("sql/155 (file only — not applied)", () => {
  const up = readFileSync(resolve(__dirname, "../../../../sql/155_fm_store_check.sql"), "utf8");
  it("adds three nullable columns to fm_parcel_scans only (no trigger), the switch starts 'false', one new key; the rollback drops them", () => {
    expect(up).toContain("alter table public.fm_parcel_scans\n  add column if not exists store_check_status text null,\n  add column if not exists store_check_at     timestamptz null,\n  add column if not exists store_check_store_id text null;");
    expect(up.replace(/^--.*$/gm, "")).not.toMatch(/create\s+(or replace\s+)?trigger/i);
    const down = readFileSync(resolve(__dirname, "../../../../sql/155_fm_store_check_rollback.sql"), "utf8");
    for (const c of ["store_check_status", "store_check_at", "store_check_store_id"]) expect(down).toContain(`drop column if exists ${c}`);
    expect(up.replace(/^--.*$/gm, "")).not.toMatch(/public\.parcel_scans\b/);
    expect(up).toContain("insert into public.app_settings (key, value) values ('fm_store_check_enabled', 'false')");
    expect(up).toContain("('scan_qr_lookup'), ('fm_store_check')");
  });
});
