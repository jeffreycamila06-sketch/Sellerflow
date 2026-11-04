// 1.17.0 — the FROZEN E-Map content script (chrome-extension/emap-frozen-711.js) evaluated
// against jsdom fixtures, next to the untouched normal script (emap-711.js): it answers ONLY
// PC_FROZEN_CHECK, posts byIDData with cate=27 (the one difference from the normal check),
// reads field index 3 (enable → ok, disable → no_frozen, close/NO2/other → unknown), falls back to
// the other section's endpoint, and reports a timeout as transient 'unknown'. The normal script's
// own answer to PC_CHECK_STORE is byte-unchanged with the frozen script loaded beside it.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
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

type Msg = { type: string; row?: { id?: string; store_id: string } };
type Handler = (m: Msg, s: unknown, send: (r: unknown) => void) => boolean;

function load(html: string, url: string, opts: { answer?: (store: string, cate: string, endpoint: string) => { ok?: boolean; status?: number; text?: string; url?: string; hang?: boolean } } = {}) {
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
    return { url: a.url ?? `${origin}${u}`, ok: a.ok ?? true, status: a.status ?? 200, text: async () => a.text ?? "" };
  });
  const g = win as unknown as typeof globalThis;
  const sandbox: Record<string, unknown> = {
    window: win, document: win.document, location: win.location,
    CustomEvent: g.CustomEvent, URLSearchParams: g.URLSearchParams, AbortController: g.AbortController,
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
  it("mobilemap tab: its own endpoint first, then the desktop one (same origin); guid from the page SOURCE without executing it", async () => {
    const e = load(MOBILEMAP_HTML, "https://emap.unipcsc.com.tw/mobilemap/default.aspx", {
      answer: (store, cate, endpoint) => (endpoint === "/mobilemap/byIDData.aspx" ? { url: "https://emap.unipcsc.com.tw/MobileMap/error.aspx", text: "" } : { text: ANSWERS[`${store}:${cate}`] }),
    });
    const r = await e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } });
    expect(r.frozen_store_status).toBe("no_frozen");
    expect(e.calls.fetch.map((c) => c.url.split("?")[0])).toEqual(["/mobilemap/byIDData.aspx", "/ecmap/byIDData.aspx"]);
    expect(new URLSearchParams(e.calls.fetch[1].body).get("Guid")).toBe("a9f0e8d7-aaaa-bbbb-cccc-ddddeeeeffff");
  });
  it("a timeout on every endpoint → transient unknown; HTTP 500 → transient; a bounce to error.aspx → not transient", async () => {
    vi.useFakeTimers();
    try {
      const e = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: () => ({ hang: true }) });
      const p = e.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } });
      await vi.advanceTimersByTimeAsync(10_500); await vi.advanceTimersByTimeAsync(10_500);
      const r = await p;
      expect(r).toMatchObject({ frozen_store_status: "unknown", transient: true });
      expect(String(r.frozen_reason)).toMatch(/timeout \(10s\)/);
    } finally { vi.useRealTimers(); }
    const e5 = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: () => ({ ok: false, status: 503, text: "" }) });
    expect(await e5.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } })).toMatchObject({ frozen_store_status: "unknown", transient: true });
    const eb = load(ECMAP_HTML, "https://emap.unipcsc.com.tw/ecmap/default.aspx", { answer: () => ({ url: "https://emap.unipcsc.com.tw/ecmap/error.aspx", text: "" }) });
    expect(await eb.send({ type: "PC_FROZEN_CHECK", row: { store_id: "968551" } })).toMatchObject({ frozen_store_status: "unknown", transient: false });
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
});
