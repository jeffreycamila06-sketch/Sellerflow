// FamilyMart store # check — server core (server/fmStoreCheck.js) + the route's wiring.
// ⚠️ The pages below are built from what Jeff measured in a browser (2026-11-12): the short
// "抱歉無此店鋪" body, the store block "店鋪代號：<code> (全家…店)" + "地址：", and the extra
// "封閉型店舖" words. They are NOT bytes captured from Render.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseFmStoreVerdict, decodeFmBytes, checkFmStore, createFmStoreCache, fmStoreUrl } from "../../../../server/fmStoreCheck.js";

const storePage = (code: string, name = "全家樹林新柑園店", extra = "") =>
  `<html><head><meta charset="utf-8"></head><body><table><tr><td>店鋪代號：</td><td>${code} (${name})</td></tr><tr><td>地址：</td><td>新北市樹林區測試路1號</td></tr>${extra}</table></body></html>`;
const NONE = "抱歉無此店鋪";
const resp = (body: string | Uint8Array, init: { status?: number; ct?: string; cookies?: string[] } = {}) => ({
  ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300, status: init.status ?? 200,
  headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? init.ct ?? "text/html; charset=utf-8" : null), getSetCookie: () => init.cookies ?? [] },
  arrayBuffer: async () => { const u = typeof body === "string" ? new TextEncoder().encode(body) : body; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); },
});
const opts = (fetchImpl: unknown) => ({ fetchImpl: fetchImpl as typeof fetch, cache: createFmStoreCache(), timeoutMs: 200 });

describe("parseFmStoreVerdict — the three measured shapes", () => {
  it("no such store (015905): the short body → not_found", () => {
    expect(parseFmStoreVerdict("015905", NONE)).toEqual({ status: "not_found" });
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
      .mockResolvedValueOnce(resp(NONE));
    const r = await checkFmStore("015905", opts(f));
    expect(r).toMatchObject({ status: "not_found", retried: true });
    expect(f).toHaveBeenCalledTimes(3);
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
  it("cache: valid / not_found are kept 12 hours per store #, unknown never; the size is bounded", async () => {
    const cache = createFmStoreCache();
    const f = vi.fn(async () => resp(storePage("022131")));
    const o = { fetchImpl: f as unknown as typeof fetch, cache, timeoutMs: 200 };
    await checkFmStore("022131", { ...o, now: 1000 });
    expect(await checkFmStore("022131", { ...o, now: 1000 + 11 * 3600_000 })).toMatchObject({ status: "valid", cached: true });
    expect(f).toHaveBeenCalledTimes(1);
    await checkFmStore("022131", { ...o, now: 1000 + 13 * 3600_000 });
    expect(f).toHaveBeenCalledTimes(2);
    const bad = vi.fn(async () => resp("x", { status: 500 }));
    await checkFmStore("022999", { ...o, fetchImpl: bad as unknown as typeof fetch });
    const once = bad.mock.calls.length;
    await checkFmStore("022999", { ...o, fetchImpl: bad as unknown as typeof fetch });
    expect(bad.mock.calls.length).toBe(once * 2); // asked again: an unknown is not kept
    const small = createFmStoreCache({ max: 2 });
    small.set("000001", { status: "valid" }); small.set("000002", { status: "valid" }); small.set("000003", { status: "not_found" });
    expect(small.size()).toBe(2);
    expect(small.get("000001")).toBeNull();
  });
});

describe("server.js route (source contract)", () => {
  const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
  const route = src.slice(src.indexOf('app.post("/admin/fm-store-check"'), src.indexOf("// Parcel Scan A2 — 7-11 E-Map store-code check."));
  it("same auth as the 7-11 check, 6 digits only, its own per-seller limit before the lookup", () => {
    expect(route).toContain('app.post("/admin/fm-store-check", requireAuth, requirePlanActive, async');
    expect(src).toContain("const fmStoreCheckAllowed = createWindowLimiter({ max: EMAP_CHECK_MAX_PER_MIN, windowMs: 60_000 });");
    expect(route).toContain("if (!/^\\d{6}$/.test(storeId)) {");
    expect(route).toMatch(/status\(400\)\.json\(\{ success: false, error: "bad_store_id" \}\)/);
    expect(route.indexOf("bad_store_id")).toBeLessThan(route.indexOf("fmStoreCheckAllowed(req.sellerId)"));
    expect(route.indexOf("fmStoreCheckAllowed(req.sellerId)")).toBeLessThan(route.indexOf("await checkFmStore(storeId)"));
    expect(route).toMatch(/status\(429\)\.json\(\{ success: false, error: "rate_limited"/);
  });
  it("log = store #, verdict, closed; a raw piece only on unknown; the answer carries the verdict only", () => {
    expect(route).toContain("[FM_STORE_CHECK] store=${storeId} result=${result.status} closed=${result.closed === true}");
    expect(route).toContain('if (result.status === "unknown" && result.raw) {');
    expect(route).toContain("return res.json({ success: true, storeId: result.storeId, status: result.status });");
    expect(route).not.toMatch(/req\.body\.(name|phone|recipient)/);
  });
});

describe("sql/154 (file only — not applied)", () => {
  const up = readFileSync(resolve(__dirname, "../../../../sql/154_fm_store_check.sql"), "utf8");
  it("adds two nullable columns to fm_parcel_scans only, the switch starts 'false', one new key", () => {
    expect(up).toContain("alter table public.fm_parcel_scans\n  add column if not exists store_check_status text null,\n  add column if not exists store_check_at     timestamptz null;");
    expect(up.replace(/^--.*$/gm, "")).not.toMatch(/public\.parcel_scans\b/);
    expect(up).toContain("insert into public.app_settings (key, value) values ('fm_store_check_enabled', 'false')");
    expect(up).toContain("('scan_qr_lookup'), ('fm_store_check')");
  });
});
