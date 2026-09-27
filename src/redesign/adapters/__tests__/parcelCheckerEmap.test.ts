// 1.14.1 — E-Map content-script tests: the REAL chrome-extension/emap-711.js (and
// the MAIN-world helper emap-guid-main.js) evaluated against jsdom fixtures of
// the desktop map (/ecmap/) and the mobile map (/mobilemap/ — what 賣貨便 →
// 選擇門市 opens now). Pins the root cause of the 1.14.0 mobilemap failure: the
// guid must be read WITHOUT any page-context execution (the mobilemap CSP blocks
// inline scripts), and byIDData must be posted to the section's own endpoint
// with a same-origin fallback.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const ECMAP_HTML = `<!DOCTYPE html><html><head><title>7-ELEVEN電子地圖</title></head><body>
<form id="frm"><input type="hidden" name="storeid" id="storeid" /><input type="hidden" name="ship" id="ship" /></form>
<div><script type="text/javascript">var isSelectSeven="N";var storecategory="";var storeid="";var multiple_type="";var eshopparid="7M0";var eshopid="7M0";var eshopGuid="c4e1b2a0-1111-2222-3333-444455556666";</script></div>
</body></html>`;

// mobilemap: strict CSP (meta), guid ONLY as inline script SOURCE (readable, not executable)
const MOBILEMAP_HTML = `<!DOCTYPE html><html><head>
<meta http-equiv="Content-Security-Policy" content="script-src 'self' 'wasm-unsafe-eval'">
<title>7-ELEVEN網路購物取貨服務</title></head><body>
<script src="/mobilemap/js/Nan4Ajax.js"></script>
<script>var logID="0";var eshopparid="7M0";var eshopid="7M0";var eshopGuid = 'a9f0e8d7-aaaa-bbbb-cccc-ddddeeeeffff';</script>
<form id="frm"><input type="hidden" name="storeid" id="storeid" /></form>
</body></html>`;

// mobilemap variant with NO guid in text at all — only the runtime window var (MAIN-world path)
const MOBILEMAP_RUNTIME_ONLY_HTML = `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'self'"></head><body>
<script src="/mobilemap/js/default.js"></script><form id="frm"></form></body></html>`;

type Msg = { type: string; row?: { store_id: string } };
type Handler = (m: Msg, s: unknown, send: (r: unknown) => void) => boolean;

function loadEmap(html: string, url: string, opts: { mainGuid?: string | null; byId?: (endpoint: string) => { url: string; ok: boolean; status: number; text: string } } = {}) {
  const dom = new JSDOM(html, { url });
  const win = dom.window as unknown as Window & { eshopGuid?: string };
  if (opts.mainGuid) win.eshopGuid = opts.mainGuid;
  const createElement = vi.spyOn(win.document, "createElement");
  let handler: Handler | null = null;
  const calls = { fetch: [] as { url: string; body: string }[], logs: [] as string[] };
  const fetch = vi.fn(async (u: string, init?: { body?: string }) => {
    calls.fetch.push({ url: u, body: String(init?.body ?? "") });
    const endpoint = u.split("?")[0];
    const r = opts.byId ? opts.byId(endpoint) : { url: `${url.split("/").slice(0, 3).join("/")}${u}`, ok: true, status: 200, text: "OK;198002+德民+台北市+enable+0++門市" };
    return { url: r.url, ok: r.ok, status: r.status, text: async () => r.text };
  });
  const sandbox: Record<string, unknown> = {
    window: win, document: win.document, location: win.location,
    CustomEvent: win.CustomEvent, URLSearchParams: win.URLSearchParams, AbortController: win.AbortController,
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    fetch, Promise, Date, Math, String, Number, Boolean, Object, Array, RegExp, Error, JSON,
    console: { log: (...a: unknown[]) => calls.logs.push(a.join(" ")), warn: () => {}, error: () => {} },
    chrome: { runtime: { onMessage: { addListener: (h: Handler) => { handler = h; } } } },
  };
  vm.createContext(sandbox);
  // MAIN-world helper first (as the manifest orders it), then the isolated script
  vm.runInNewContext(readFileSync("chrome-extension/emap-guid-main.js", "utf8"), sandbox, { filename: "emap-guid-main.js" });
  vm.runInNewContext(readFileSync("chrome-extension/emap-711.js", "utf8"), sandbox, { filename: "emap-711.js" });
  const send = (msg: Msg) => new Promise<Record<string, unknown>>((resolve) => { handler!(msg, {}, (r) => resolve(r as Record<string, unknown>)); });
  return { send, calls, createElement, win };
}

describe("emap-711 1.14.1 — guid without page-context execution", () => {
  it("ecmap fixture: reads `var eshopGuid=\"…\"` from inline script SOURCE (no eval), probe + store check resolve, endpoint /ecmap/byIDData.aspx", async () => {
    const { send, calls, createElement } = loadEmap(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx");
    const probe = await send({ type: "PC_EMAP_PROBE" });
    expect(probe.guidFound).toBe(true);
    expect(String(probe.guidSource)).toMatch(/^script\[/);
    expect(probe.section).toBe("ecmap");
    const res = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(res.store_full_status).toBe("open");
    expect(res.endpoint).toBe("/ecmap/byIDData.aspx");
    expect(calls.fetch[0].url).toMatch(/^\/ecmap\/byIDData\.aspx\?rnd=/);
    expect(calls.fetch[0].body).toContain("Guid=c4e1b2a0-1111-2222-3333-444455556666");
    // CSP-error absence: no <script> element was ever created
    expect(createElement.mock.calls.filter((c) => String(c[0]).toLowerCase() === "script")).toHaveLength(0);
  });

  it("mobilemap fixture (strict CSP): guid from script source, byIDData posted to /mobilemap/byIDData.aspx first; diagnostic line logged once", async () => {
    const { send, calls, createElement } = loadEmap(MOBILEMAP_HTML, "https://emap.unipcsc.com.tw/mobilemap/default.aspx?eshopid=7M0");
    const probe = await send({ type: "PC_EMAP_PROBE" });
    expect(probe.guidFound).toBe(true);
    expect(probe.section).toBe("mobilemap");
    const res = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(res.store_full_status).toBe("open");
    expect(res.endpoint).toBe("/mobilemap/byIDData.aspx");
    expect(calls.fetch).toHaveLength(1);
    expect(calls.fetch[0].url).toMatch(/^\/mobilemap\/byIDData\.aspx\?rnd=/);
    expect(calls.fetch[0].body).toContain("Guid=a9f0e8d7-aaaa-bbbb-cccc-ddddeeeeffff");
    expect(createElement.mock.calls.filter((c) => String(c[0]).toLowerCase() === "script")).toHaveLength(0);
    const diag = calls.logs.filter((l) => /^\[PC-EMAP\] mobilemap: guid candidates=1 source=script\[\d+\] endpoint=/.test(l));
    expect(diag).toHaveLength(1); // once per page life
    await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(calls.logs.filter((l) => /^\[PC-EMAP\] mobilemap:/.test(l))).toHaveLength(1);
  });

  it("mobilemap: when /mobilemap/byIDData.aspx bounces to error.aspx, falls back to /ecmap/byIDData.aspx (same origin, same session) and REMEMBERS the working endpoint", async () => {
    const byId = (endpoint: string) => endpoint === "/mobilemap/byIDData.aspx"
      ? { url: "https://emap.unipcsc.com.tw/MobileMap/error.aspx?aspxerrorpath=/mobilemap/byIDData.aspx", ok: true, status: 200, text: "<html>系統忙碌中</html>" }
      : { url: "https://emap.unipcsc.com.tw/ecmap/byIDData.aspx", ok: true, status: 200, text: "OK;198002+德民+台北市+disable+0++門市" };
    const { send, calls } = loadEmap(MOBILEMAP_HTML, "https://emap.unipcsc.com.tw/mobilemap/default.aspx", { byId });
    const res = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(res.store_full_status).toBe("full");
    expect(res.endpoint).toBe("/ecmap/byIDData.aspx");
    expect(calls.fetch.map((f) => f.url.split("?")[0])).toEqual(["/mobilemap/byIDData.aspx", "/ecmap/byIDData.aspx"]);
    const res2 = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(res2.store_full_status).toBe("full");
    expect(calls.fetch).toHaveLength(3); // second check went straight to the remembered endpoint
    expect(calls.fetch[2].url).toMatch(/^\/ecmap\/byIDData\.aspx/);
    const probe = await send({ type: "PC_EMAP_PROBE" });
    expect(probe.endpoint).toBe("/ecmap/byIDData.aspx");
  });

  it("mobilemap with NO guid in text: the MAIN-world helper relays window.eshopGuid over a CustomEvent (no injection) → guidFound", async () => {
    const { send, calls, createElement } = loadEmap(MOBILEMAP_RUNTIME_ONLY_HTML, "https://emap.unipcsc.com.tw/mobilemap/default.aspx", { mainGuid: "77777777-8888-9999-aaaa-bbbbccccdddd" });
    const probe = await send({ type: "PC_EMAP_PROBE" });
    expect(probe.guidFound).toBe(true);
    expect(probe.guidSource).toBe("main:eshopGuid");
    const res = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(res.store_full_status).toBe("open");
    expect(calls.fetch[0].body).toContain("Guid=77777777-8888-9999-aaaa-bbbbccccdddd");
    expect(createElement.mock.calls.filter((c) => String(c[0]).toLowerCase() === "script")).toHaveLength(0);
  });

  it("guid also accepted from the URL query and hidden inputs / data attributes (text sources, no execution)", async () => {
    const url = "https://emap.pcsc.com.tw/mobilemap/default.aspx?eshopid=7M0&Guid=12121212-3434-5656-7878-909090909090";
    const a = loadEmap(MOBILEMAP_RUNTIME_ONLY_HTML, url);
    expect((await a.send({ type: "PC_EMAP_PROBE" })).guidSource).toBe("url:Guid");
    const html = `<html><body><input type="hidden" id="eshopGuid" name="eshopGuid" value="abababab-cdcd-efef-0101-232323232323" /></body></html>`;
    const b = loadEmap(html, "https://emap.pcsc.com.tw/ecmap/default.aspx");
    expect((await b.send({ type: "PC_EMAP_PROBE" })).guidSource).toBe("input:eshopGuid");
    const c = loadEmap(`<html><body><div data-eshopguid="fefefefe-1212-3434-5656-787878787878"></div></body></html>`, "https://emap.pcsc.com.tw/ecmap/default.aspx");
    expect((await c.send({ type: "PC_EMAP_PROBE" })).guidFound).toBe(true);
  });

  it("no guid anywhere (bare E-Map URL, helper finds nothing) → 'unknown' + human reason, never a verdict; no fetch fired", async () => {
    const { send, calls, createElement } = loadEmap(MOBILEMAP_RUNTIME_ONLY_HTML, "https://emap.unipcsc.com.tw/mobilemap/default.aspx");
    const probe = await send({ type: "PC_EMAP_PROBE" });
    expect(probe.guidFound).toBe(false);
    expect(probe.guidCandidates).toBe(0);
    const res = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(res.store_full_status).toBe("unknown");
    expect(res.store_reason).toBe("eshopGuid not found on emap page");
    expect(calls.fetch).toHaveLength(0);
    expect(createElement.mock.calls.filter((c) => String(c[0]).toLowerCase() === "script")).toHaveLength(0);
  });

  it("both endpoints fail → 'unknown' with BOTH reasons (never a guessed verdict)", async () => {
    const byId = (endpoint: string) => endpoint === "/ecmap/byIDData.aspx"
      ? { url: "https://emap.unipcsc.com.tw/ecmap/byIDData.aspx", ok: true, status: 200, text: "訊息:I0100;驗證失敗" }
      : { url: "https://emap.unipcsc.com.tw/mobilemap/byIDData.aspx", ok: false, status: 500, text: "" };
    const { send } = loadEmap(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { byId });
    const res = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(res.store_full_status).toBe("unknown");
    expect(String(res.store_reason)).toContain('/ecmap/byIDData.aspx unexpected response: "訊息:I0100;驗證失敗"');
    expect(String(res.store_reason)).toContain("/mobilemap/byIDData.aspx returned HTTP 500");
    // a 302 → error.aspx (what an anonymous / dead-session POST gets) is named as such,
    // never mistaken for a response body to parse
    const bounce = (endpoint: string) => endpoint === "/mobilemap/byIDData.aspx"
      ? { url: "https://emap.unipcsc.com.tw/MobileMap/error.aspx?aspxerrorpath=/mobilemap/byIDData.aspx", ok: true, status: 200, text: "OK;198002+德民+x+enable+0++門市" }
      : { url: "https://emap.unipcsc.com.tw/ecmap/byIDData.aspx", ok: true, status: 200, text: "訊息:I0100;驗證失敗" };
    const b = loadEmap(MOBILEMAP_HTML, "https://emap.unipcsc.com.tw/mobilemap/default.aspx", { byId: bounce });
    const rb = await b.send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(rb.store_full_status).toBe("unknown"); // the bounced body must NOT be parsed as a verdict
    expect(String(rb.store_reason)).toContain("/mobilemap/byIDData.aspx bounced to error.aspx");
  });

  it("emap-guid-main.js: MAIN-world helper is CSP-exempt by construction — it only reads window vars and dispatches a CustomEvent (no DOM writes, no fetch)", () => {
    const src = readFileSync("chrome-extension/emap-guid-main.js", "utf8");
    expect(src).not.toMatch(/fetch\(|createElement|innerHTML|localStorage|chrome\./);
    expect(src).toContain('new CustomEvent("__sfl_emap_guid"');
    expect(src).toContain('document.addEventListener("__sfl_emap_guid_req"');
  });
});
