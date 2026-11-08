// 1.17.0 — the FROZEN E-Map content script (chrome-extension/emap-frozen-711.js) evaluated
// against jsdom fixtures, next to the untouched normal script (emap-711.js): it answers ONLY
// PC_FROZEN_CHECK, posts byIDData with cate=27 (the one difference from the normal check),
// reads field index 3 (enable → ok, disable → no_frozen, close/NO2/other → unknown), asks ONE endpoint per
// check (a non-verdict answer switches the NEXT check), aborts at 2.5 s (transient 'unknown'). The normal script's
// own answer to PC_CHECK_STORE is byte-unchanged with the frozen script loaded beside it.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const ECMAP_HTML = `<!DOCTYPE html><html><head><title>7-ELEVEN電子地圖</title></head><body>
<form id="frm"><input type="hidden" name="storeid" id="storeid" /></form>
<div><script type="text/javascript">var eshopparid="7M0";var eshopid="7M0";var eshopGuid="c4e1b2a0-1111-2222-3333-444455556666";</script></div>
</body></html>`;
const MOBILEMAP_HTML = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"></head><body>
<script>var eshopGuid = 'a9f0e8d7-aaaa-bbbb-cccc-ddddeeeeffff';</script><form id="frm"></form></body></html>`;

// the probe answers (Jeff, 2026-11-05, normal E-Map session): 968551 disable on cate=27 / enable on cate=3
const ANSWERS: Record<string, string> = {
  "968551:27": "OK;968551+新蓮盈+花蓮縣吉安鄉建國路二段285號1F+disable+0++門市",
  "968551:3": "OK;968551+新蓮盈+花蓮縣吉安鄉建國路二段285號1F+enable+0++門市",
  "151003:27": "OK;151003+大智通+新北市樹林區佳園路二段70-1號+enable+0++門市",
  "151003:3": "OK;151003+大智通+新北市樹林區佳園路二段70-1號+enable+0++門市",
  "180849:27": "OK;180849+明月+高雄市楠梓區+close+0++門市",
  "277895:27": "NO2",
  "123456:27": "<html>login</html>",
};

type Msg = { type: string; row?: { id?: string; store_id: string }; nightWarm?: boolean };
type Handler = (m: Msg, s: unknown, send: (r: unknown) => void) => boolean;

function load(html: string, url: string, opts: { answer?: (store: string, cate: string, endpoint: string) => { ok?: boolean; status?: number; text?: string; url?: string; hang?: boolean; hangBody?: boolean } } = {}) {
  const dom = new JSDOM(html, { url });
  const win = dom.window as unknown as Window;
  const handlers: Handler[] = [];
  const calls = { fetch: [] as { url: string; body: string; cate: string; store: string }[] };
  const fetch = vi.fn(async (u: string, init?: { body?: string; signal?: AbortSignal }) => {
    const params = new URLSearchParams(String(init?.body ?? ""));
    const cate = params.get("cate") || "", store = params.get("k") || "";
    calls.fetch.push({ url: u, body: String(init?.body ?? ""), cate, store });
    const endpoint = u.split("?")[0];
    const a = opts.answer ? opts.answer(store, cate, endpoint) : { text: ANSWERS[`${store}:${cate}`] ?? "???" };
    if (a.hang) return new Promise((_res, rej) => { init?.signal?.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); });
    const origin = url.split("/").slice(0, 3).join("/");
    const abortErr = () => { const e = new Error("aborted"); e.name = "AbortError"; return e; };
    // hangBody: the headers arrive at once, the body never does — only the abort ends the read
    const text = a.hangBody ? () => new Promise<string>((_res, rej) => { init?.signal?.addEventListener("abort", () => rej(abortErr())); }) : async () => a.text ?? "";
    return { url: a.url ?? `${origin}${u}`, ok: a.ok ?? true, status: a.status ?? 200, text };
  });
  const g = win as unknown as typeof globalThis;
  const sandbox: Record<string, unknown> = {
    window: win, document: win.document, location: win.location,
    CustomEvent: g.CustomEvent, URL: g.URL, URLSearchParams: g.URLSearchParams, AbortController: g.AbortController,
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    fetch, Promise, Date, Math, String, Number, Boolean, Object, Array, RegExp, Error, JSON,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    chrome: { runtime: { onMessage: { addListener: (h: Handler) => { handlers.push(h); } } } },
  };
  vm.createContext(sandbox);
  const dir = process.env.SFL_EXT_DIR || "chrome-extension";
  for (const f of ["emap-guid-main.js", "emap-711.js", "emap-frozen-711.js"]) vm.runInNewContext(readFileSync(`${dir}/${f}`, "utf8"), sandbox, { filename: f });
  // deliver a message the way Chrome does: every listener sees it; the one returning true answers
  const send = (msg: Msg) => new Promise<Record<string, unknown>>((resolve) => {
    let claimed = 0;
    for (const h of handlers) if (h(msg, {}, (r) => resolve(r as Record<string, unknown>))) claimed += 1;
    if (!claimed) resolve({ __unclaimed: true });
  });
  return { send, calls, handlers, fetch };
}

describe("emap-frozen-711.js — the frozen (cate=27) E-Map check", () => {
  it("answers PC_FROZEN_CHECK with cate=27 on the tab's own section; disable → no_frozen, enable → ok", async () => {
    const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx");
    const r1 = await e.send({ type: "PC_FROZEN_CHECK", row: { id: "p1", store_id: "968551" } });
    expect(r1).toMatchObject({ ok: true, script: "emap-frozen", frozen_store_status: "no_frozen", frozen_reason: "", transient: false, guidFound: true, endpoint: "/ecmap/byIDData.aspx" });
    const r2 = await e.send({ type: "PC_FROZEN_CHECK", row: { id: "p2", store_id: "151003" } });
    expect(r2.frozen_store_status).toBe("ok");
    expect(e.calls.fetch.map((c) => `${c.store}:${c.cate}`)).toEqual(["968551:27", "151003:27"]);
    const p = new URLSearchParams(e.calls.fetch[0].body);
    expect(Object.fromEntries(p)).toMatchObject({ mode: "", k: "968551", cate: "27", eshopparid: "7M0", eshopid: "7M0", multiple_type: "", Guid: "c4e1b2a0-1111-2222-3333-444455556666" });
    expect(p.get("Nan4AjaxTrickNumber")).toMatch(/^\d{10,}$/);
    expect(e.calls.fetch[0].url).toMatch(/^\/ecmap\/byIDData\.aspx\?rnd=/);
  });
  it("close / NO2 / an unexpected page → unknown with a reason (never a fabricated ok)", async () => {
    const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx");
    expect((await e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "180849" } })).frozen_store_status).toBe("unknown");
    expect((await e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "277895" } })).frozen_store_status).toBe("unknown");
    const r = await e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "123456" } });
    expect(r.frozen_store_status).toBe("unknown");
    expect(String(r.frozen_reason)).toMatch(/unexpected response/);
    expect((await e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "12" } })).frozen_reason).toBe("store id not 6 digits");
  });
  it("A. ONE endpoint per check (no fallback retry): a mobilemap tab asks /mobilemap/ only; a bounce there switches the NEXT check to /ecmap/; guid from the page SOURCE without executing it", async () => {
    const e = load(MOBILEMAP_HTML, "https://emap.unipcsc.com.tw/mobilemap/default.aspx", {
      answer: (store, cate, endpoint) => (endpoint === "/mobilemap/byIDData.aspx" ? { url: "https://emap.unipcsc.com.tw/MobileMap/error.aspx", text: "" } : { text: ANSWERS[`${store}:${cate}`] }),
    });
    const r1 = await e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } });
    expect(r1).toMatchObject({ frozen_store_status: "unknown", transient: false, endpoint: "/mobilemap/byIDData.aspx" });
    expect(String(r1.frozen_reason)).toMatch(/bounced to error\.aspx/);
    expect(e.calls.fetch.map((c) => c.url.split("?")[0])).toEqual(["/mobilemap/byIDData.aspx"]); // one request, no retry
    const r2 = await e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } });
    expect(r2).toMatchObject({ frozen_store_status: "no_frozen", endpoint: "/ecmap/byIDData.aspx" });
    expect(e.calls.fetch.map((c) => c.url.split("?")[0])).toEqual(["/mobilemap/byIDData.aspx", "/ecmap/byIDData.aspx"]);
    expect(new URLSearchParams(e.calls.fetch[1].body).get("Guid")).toBe("a9f0e8d7-aaaa-bbbb-cccc-ddddeeeeffff");
  });
  it("A. a request that hangs is aborted at 2.5 s (one fetch, transient, same endpoint next time); HTTP 5xx → transient, no switch; a bounce → not transient", async () => {
    vi.useFakeTimers();
    try {
      let hang = true;
      const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: (store, cate) => (hang ? { hang: true } : { text: ANSWERS[`${store}:${cate}`] }) });
      const p = e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } });
      await vi.advanceTimersByTimeAsync(2_400);
      let done = false; void p.then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);                                          // still open at 2.4 s
      await vi.advanceTimersByTimeAsync(400);                            // past 300 ms guid wait + 2.5 s
      const r = await p;
      expect(r).toMatchObject({ frozen_store_status: "unknown", transient: true, endpoint: "/ecmap/byIDData.aspx" });
      expect(String(r.frozen_reason)).toMatch(/timeout \(2\.5s\)/);
      expect(e.calls.fetch).toHaveLength(1);
      hang = false;
      const p2 = e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } });
      await vi.advanceTimersByTimeAsync(400);                            // the 300 ms guid wait
      expect(await p2).toMatchObject({ frozen_store_status: "no_frozen", endpoint: "/ecmap/byIDData.aspx" }); // a timeout never switches
    } finally { vi.useRealTimers(); }
    let st = 503;
    const e5 = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: (store, cate) => (st ? { ok: false, status: st, text: "" } : { text: ANSWERS[`${store}:${cate}`] }) });
    expect(await e5.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } })).toMatchObject({ frozen_store_status: "unknown", transient: true });
    st = 0;
    expect(await e5.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } })).toMatchObject({ frozen_store_status: "no_frozen", endpoint: "/ecmap/byIDData.aspx" });
    expect(e5.calls.fetch).toHaveLength(2);
    const eb = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: () => ({ url: "https://emap.unipcsc.com.tw/ecmap/error.aspx", text: "" }) });
    expect(await eb.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } })).toMatchObject({ frozen_store_status: "unknown", transient: false });
    expect(eb.calls.fetch).toHaveLength(1);
  });
  it("3. the 2.5 s abort covers the response BODY too: headers at once, body never → aborted at 2.5 s, transient timeout, one fetch", async () => {
    vi.useFakeTimers();
    try {
      const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: () => ({ hangBody: true }) });
      const p = e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } });
      let done = false; void p.then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(2_700);                          // 300 ms guid wait + 2.4 s: still reading the body
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      const r = await p;
      expect(r).toMatchObject({ frozen_store_status: "unknown", transient: true, endpoint: "/ecmap/byIDData.aspx" });
      expect(String(r.frozen_reason)).toMatch(/timeout \(2\.5s\)/);
      expect(e.calls.fetch).toHaveLength(1);
    } finally { vi.useRealTimers(); }
    const src = readFileSync(`${process.env.SFL_EXT_DIR || "chrome-extension"}/emap-frozen-711.js`, "utf8");
    expect(src.indexOf("await r.text()")).toBeLessThan(src.indexOf("finally { clearTimeout(t); }")); // the timer is cleared only after the body
    expect(src).not.toMatch(/fetchWithTimeout/);
  });
  it("B. the load guard is a LIVENESS check: a second copy is skipped while the first is still connected; after an extension reload (old runtime id gone) the new copy installs its listener", () => {
    const dom = new JSDOM(ECMAP_HTML, { url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
    const win = dom.window as unknown as Window & Record<string, unknown>;
    const src = readFileSync(`${process.env.SFL_EXT_DIR || "chrome-extension"}/emap-frozen-711.js`, "utf8");
    const runWith = (runtime: Record<string, unknown>) => {
      const handlers: unknown[] = [];
      const sb: Record<string, unknown> = { window: win, document: win.document, location: win.location, CustomEvent: (win as unknown as typeof globalThis).CustomEvent, setTimeout, clearTimeout, Promise, Date, Math, String, Number, Boolean, Object, Array, RegExp, Error, JSON, URLSearchParams,
        chrome: { runtime: { ...runtime, onMessage: { addListener: (h: unknown) => { handlers.push(h); } } } } };
      vm.createContext(sb);
      vm.runInNewContext(src, sb);
      return { handlers, runtime: (sb.chrome as { runtime: Record<string, unknown> }).runtime };
    };
    const first = runWith({ id: "ext-1" });
    expect(first.handlers).toHaveLength(1);
    expect(runWith({ id: "ext-1" }).handlers).toHaveLength(0);       // the old copy is alive → skip
    delete first.runtime.id;                                          // extension reloaded: the old copy is orphaned
    expect(runWith({ id: "ext-2" }).handlers).toHaveLength(1);       // → the new copy is NOT blocked
    expect(typeof win.__sflPcEmapFrozenAlive).toBe("function");
  });
  it("ignores every other message (the normal script keeps PC_CHECK_STORE, cate=3, byte-unchanged with the frozen script loaded)", async () => {
    const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx");
    expect(e.handlers).toHaveLength(2);
    const normal = await e.send({ type: "PC_CHECK_STORE", row: { store_id: "968551" } });
    expect(normal).toMatchObject({ store_full_status: "open" }); // cate=3 → enable → open (the frozen answer would be no_frozen)
    expect(e.calls.fetch.map((c) => `${c.store}:${c.cate}`)).toEqual(["968551:3"]);
    const frozenHandler = e.handlers[1];
    expect(frozenHandler({ type: "PC_CHECK_STORE", row: { store_id: "968551" } }, {}, () => {})).toBe(false);
    expect(frozenHandler({ type: "PC_PING" }, {}, () => {})).toBe(false);
    expect(frozenHandler({ type: "PC_FROZEN_CHECK" }, {}, () => {})).toBe(false); // no row → not ours either
  });
  it("source pins: the frozen script never writes, never injects a script, and cate=27 is its only cate", () => {
    const src = readFileSync(`${process.env.SFL_EXT_DIR || "chrome-extension"}/emap-frozen-711.js`, "utf8");
    expect(src.match(/cate: "(\d+)"/g)).toEqual(['cate: "27"']);
    expect(src).not.toMatch(/createElement\(\s*["']script["']|innerHTML|chrome\.storage|localStorage|\.submit\(/);
    expect(src).toContain('message.type !== "PC_FROZEN_CHECK"');
  });

  // 1.18.0 audit (13): the `blocked` flag the warm-up lane stops on. Real page script, jsdom, every case.
  describe("1.18.0 blocked detection (the warm-up stop signal)", () => {
    const ask = async (a: { ok?: boolean; status?: number; text?: string; url?: string }) => {
      const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: () => a });
      const r = await e.send({ type: "PC_FROZEN_CHECK", row: { id: "w1", store_id: "968551" } });
      return { r, fetches: e.calls.fetch.length };
    };
    it("HTTP 403 → blocked, unknown, not transient (one request)", async () => {
      const { r, fetches } = await ask({ ok: false, status: 403, text: "Forbidden" });
      expect(r).toMatchObject({ frozen_store_status: "unknown", blocked: true, transient: false });
      expect(String(r.frozen_reason)).toMatch(/HTTP 403/);
      expect(fetches).toBe(1);
    });
    it("HTTP 429 → blocked, unknown, not transient", async () => {
      const { r } = await ask({ ok: false, status: 429, text: "Too Many Requests" });
      expect(r).toMatchObject({ frozen_store_status: "unknown", blocked: true, transient: false });
      expect(String(r.frozen_reason)).toMatch(/HTTP 429/);
    });
    it("a captcha page in a 200 body → blocked (驗證碼 and captcha both)", async () => {
      for (const text of ["<html><body><h1>請輸入驗證碼</h1></body></html>", "<html><div class=\"g-recaptcha\"></div></html>", "<html>Please complete the CAPTCHA</html>"]) {
        const { r } = await ask({ text });
        expect(r, text).toMatchObject({ frozen_store_status: "unknown", blocked: true, transient: false });
        expect(String(r.frozen_reason), text).toMatch(/unexpected response/);
      }
    });
    it("a redirect to a login page → blocked (the final URL is the login page); day keeps the 1.17.0 reason text", async () => {
      const { r } = await ask({ url: "https://emap.unipcsc.com.tw/Login.aspx?ReturnUrl=%2fecmap%2fbyIDData.aspx", text: "<html>bye</html>" });
      expect(r).toMatchObject({ frozen_store_status: "unknown", blocked: true, transient: false });
      expect(String(r.frozen_reason)).toMatch(/unexpected response/);           // 1.17.0 order: the body was read
    });
    it("an empty 200 → NOT blocked (an odd answer, unknown, not transient — the worker counts it as a no-answer)", async () => {
      const { r } = await ask({ text: "" });
      expect(r).toMatchObject({ frozen_store_status: "unknown", blocked: false, transient: false });
      expect(String(r.frozen_reason)).toMatch(/unexpected response/);
    });
    it("controls: a real verdict, NO2, HTTP 500 and a bounce are never blocked", async () => {
      expect((await ask({ text: ANSWERS["968551:27"] })).r).toMatchObject({ frozen_store_status: "no_frozen", blocked: false });
      expect((await ask({ text: "NO2" })).r).toMatchObject({ frozen_store_status: "unknown", blocked: false });
      expect((await ask({ ok: false, status: 500 })).r).toMatchObject({ blocked: false, transient: true });
      expect((await ask({ url: "https://emap.unipcsc.com.tw/ecmap/error.aspx" })).r).toMatchObject({ blocked: false, transient: false });
    });
  });
  // item 5 + round 5: an E-Map MAINTENANCE page is a transient no-answer ONLY for the night warm-up probe
  // (message.nightWarm === true). Live lane + day warm-up = the 1.17.0 outcome: unknown, not transient,
  // the next check uses the other section.
  describe("maintenance pages (01:00–05:00 Taipei)", () => {
    const ask = async (a: { ok?: boolean; status?: number; text?: string; url?: string }, nightWarm = true, store = "968551") => {
      const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: () => a });
      const msg = (id: string) => (nightWarm ? { type: "PC_FROZEN_CHECK", row: { id, store_id: store }, nightWarm: true } : { type: "PC_FROZEN_CHECK", row: { id, store_id: store } });
      const r = await e.send(msg("w1"));
      const r2 = await e.send(msg("w2"));
      return { r, endpoints: e.calls.fetch.map((c) => c.url.split("?")[0]), r2 };
    };
    // what main (1.17.0) answers for the same page: unknown, not transient, section switched
    const load117 = (a: { ok?: boolean; status?: number; text?: string; url?: string }) => {
      const dom = new JSDOM(ECMAP_HTML, { url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
      const win = dom.window as unknown as Window;
      const handlers: Handler[] = [];
      const urls: string[] = [];
      const fetch = vi.fn(async (u: string) => { urls.push(u.split("?")[0]); return { url: a.url ?? `https://emap.unipcsc.com.tw${u}`, ok: a.ok ?? true, status: a.status ?? 200, text: async () => a.text ?? "" }; });
      const g = win as unknown as typeof globalThis;
      const sandbox: Record<string, unknown> = { window: win, document: win.document, location: win.location, CustomEvent: g.CustomEvent, URL: g.URL, URLSearchParams: g.URLSearchParams, AbortController: g.AbortController,
        setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win), fetch, Promise, Date, Math, String, Number, Boolean, Object, Array, RegExp, Error, JSON,
        console: { log: () => {}, warn: () => {}, error: () => {} }, chrome: { runtime: { onMessage: { addListener: (h: Handler) => { handlers.push(h); } } } } };
      vm.createContext(sandbox);
      vm.runInNewContext(execSync("git show origin/main:chrome-extension/emap-frozen-711.js", { encoding: "utf8" }), sandbox, { filename: "main-emap-frozen-711.js" });
      const send = (id: string) => new Promise<Record<string, unknown>>((res) => { for (const h of handlers) h({ type: "PC_FROZEN_CHECK", row: { id, store_id: "968551" } }, {}, (r) => res(r as Record<string, unknown>)); });
      return { send, urls };
    };
    const has117 = (() => { try { execSync("git cat-file -e origin/main:chrome-extension/emap-frozen-711.js", { stdio: "ignore" }); return true; } catch { return false; } })();
    const BODIES = [
      "<html><head><title>系統維護中</title></head><body><h1>7-ELEVEN 電子地圖系統維護中，請於 05:00 後再試</h1><a href=\"/Login.aspx\">會員登入</a></body></html>",
      "<html><body>為提供更好的服務，本系統於 01:00~05:00 進行系統更新，暫停服務</body></html>",
      "<!DOCTYPE html><html><body><h2>Scheduled Maintenance</h2><p>Sign in / login after 05:00</p></body></html>",
      // a maintenance body shaped like an answer (';' and '+' and a field 3 "enable") must still NOT be a verdict
      "<p>維護公告;968551+新蓮盈+花蓮縣+enable+0++門市</p>",
      "<html>&nbsp;維護;123456+a+b+disable+</html>",
    ];
    it("NIGHT warm-up probe: a maintenance body in a 200 → unknown, transient, NOT blocked, never a verdict; the endpoint is not switched", { timeout: 30_000 }, async () => {
      for (const text of BODIES) {
        const { r, endpoints, r2 } = await ask({ text });
        expect(r, text).toMatchObject({ frozen_store_status: "unknown", blocked: false, transient: true, maintenance: true });
        expect(String(r.frozen_reason), text).toMatch(/maintenance page/);
        expect(String(r.frozen_reason), text).not.toMatch(/login|登入|captcha|blocked/i);   // the worker's block check reads the reason
        expect(r2.frozen_store_status, text).toBe("unknown");
        expect(endpoints, text).toEqual(["/ecmap/byIDData.aspx", "/ecmap/byIDData.aspx"]); // transient → same endpoint
      }
    });
    it("DAY / LIVE lane (no nightWarm): the SAME maintenance body = the 1.17.0 outcome — unknown, NOT transient, never maintenance, next check on the other section", { timeout: 30_000 }, async () => {
      for (const text of BODIES) {
        const { r, endpoints } = await ask({ text }, false);
        expect(r, text).toMatchObject({ frozen_store_status: "unknown", transient: false, maintenance: false });
        expect(String(r.frozen_reason), text).toMatch(/unexpected response/);
        expect(endpoints, text).toEqual(["/ecmap/byIDData.aspx", "/mobilemap/byIDData.aspx"]); // non-answer → switch
        // byte-for-byte the same as main's 1.17.0 script — except the answer-SHAPED bodies (';' '+' 'enable'),
        // which 1.17.0 wrongly read as a verdict; the round-4 "OK;<6 digits>+" gate fixed that on purpose
        if (has117 && !/;\d{6}\+|;\d+\+/.test(text)) {
          const m = load117({ text });
          const o = await m.send("w1"); await m.send("w2");
          expect({ s: r.frozen_store_status, why: r.frozen_reason, tr: r.transient }, text).toEqual({ s: o.frozen_store_status, why: o.frozen_reason, tr: o.transient });
          expect(endpoints, text).toEqual(m.urls);
        }
      }
    });
    it("DAY / LIVE lane: a redirect to a maintenance path = the 1.17.0 outcome (unknown, not transient, switch)", async () => {
      const { r, endpoints } = await ask({ url: "https://emap.unipcsc.com.tw/maintain.aspx", text: "<html>Sorry</html>" }, false);
      expect(r).toMatchObject({ frozen_store_status: "unknown", transient: false, maintenance: false });
      expect(endpoints).toEqual(["/ecmap/byIDData.aspx", "/mobilemap/byIDData.aspx"]);
      if (has117) {
        const m = load117({ url: "https://emap.unipcsc.com.tw/maintain.aspx", text: "<html>Sorry</html>" });
        const o = await m.send("w1");
        expect({ s: r.frozen_store_status, why: r.frozen_reason, tr: r.transient }).toEqual({ s: o.frozen_store_status, why: o.frozen_reason, tr: o.transient });
      }
    });
    it("NIGHT: a redirect to a maintenance page → unknown, transient, NOT blocked (even when its body has a login link)", async () => {
      for (const url of ["https://emap.unipcsc.com.tw/maintain.aspx", "https://emap.unipcsc.com.tw/Maintenance/index.html", "https://emap.unipcsc.com.tw/sorry.html"]) {
        const { r } = await ask({ url, text: "<html><a href=\"/x\">登入</a> OK;968551+x+y+enable+0</html>" });
        expect(r, url).toMatchObject({ frozen_store_status: "unknown", blocked: false, transient: true, maintenance: true });
      }
    });
    it("2: MAINT_URL_RE reads the redirect PATH only — default.aspx?url=…/update.aspx is NOT maintenance", { timeout: 30_000 }, async () => {
      for (const url of ["https://emap.unipcsc.com.tw/ecmap/default.aspx?url=https://x.tw/update.aspx", "https://emap.unipcsc.com.tw/ecmap/byIDData.aspx?next=/maint/sorry.html&busy=1"]) {
        const { r } = await ask({ url, text: "OK;968551+新蓮盈+addr+enable+0++門市" });
        expect(r, url).toMatchObject({ frozen_store_status: "ok", maintenance: false });       // the real answer still reads
        const odd = await ask({ url, text: "<html>hi</html>" });
        expect(odd.r, url).toMatchObject({ frozen_store_status: "unknown", maintenance: false, transient: false });
      }
    });
    it("3: a login form / password input = BLOCK even when the page also looks like maintenance (night and day)", { timeout: 30_000 }, async () => {
      const PAGES = [
        "<html><h1>系統維護中</h1><form method=post><input name=u><input type=\"password\" name=p></form></html>",
        "<html><body>Scheduled maintenance<form id=\"loginForm\" action=\"/login\"><input name=u></form></body></html>",
        "<html>暫停服務 <input type=password></html>",
      ];
      for (const text of PAGES) {
        for (const night of [true, false]) {
          const { r } = await ask({ text }, night);
          expect(r, `${night ? "night" : "day"} ${text}`).toMatchObject({ frozen_store_status: "unknown", blocked: true, transient: false });
        }
      }
    });
    it("a page that is NOT an answer (no leading 'OK;<6 digits>+') is never parsed as a verdict, maintenance or not", { timeout: 30_000 }, async () => {
      for (const night of [true, false]) {
        for (const text of ["公告;968551+新蓮盈+addr+enable+0++門市", " ok;968551+x+y+enable+0", "OK;96855+x+y+enable+0", "<b>OK;968551+x+y+enable+0</b>"]) {
          const { r } = await ask({ text }, night);
          expect(r.frozen_store_status, text).toBe("unknown");
        }
        expect((await ask({ text: "  OK;968551+新蓮盈+addr+enable+0++門市\n" }, night)).r.frozen_store_status).toBe("ok"); // a real answer (trimmed) still works
      }
    });
    it("blocks still win at night: 403 / 429 on a maintenance URL, a captcha body that mentions 維護, a login redirect → blocked", async () => {
      expect((await ask({ ok: false, status: 403, url: "https://emap.unipcsc.com.tw/maintain.aspx", text: "系統維護" })).r).toMatchObject({ blocked: true });
      expect((await ask({ ok: false, status: 429, url: "https://emap.unipcsc.com.tw/maintain.aspx" })).r).toMatchObject({ blocked: true });
      expect((await ask({ text: "<html>系統維護中，請輸入驗證碼</html>" })).r).toMatchObject({ blocked: true });
      expect((await ask({ url: "https://emap.unipcsc.com.tw/maintain/Login.aspx" })).r).toMatchObject({ blocked: true });
    });
    it("HTTP 503 (a common maintenance answer) → transient, not blocked (night and day — as in 1.17.0)", async () => {
      for (const night of [true, false]) expect((await ask({ ok: false, status: 503, text: "Service Unavailable" }, night)).r).toMatchObject({ frozen_store_status: "unknown", blocked: false, transient: true });
    });
  });
});
