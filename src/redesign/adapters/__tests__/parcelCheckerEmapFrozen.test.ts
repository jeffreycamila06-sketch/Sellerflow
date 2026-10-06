// 1.16.0 — the FROZEN check in the E-Map content script (the REAL emap-711.js + the MAIN-world
// helper against jsdom pages). Pins: the page's own globals decide the mode and the request
// values (cate / eshopparid / eshopid exactly as the page says); the exact answers captured on
// 2026-10-06; an answer about ANOTHER store, "I0100", or anything unclean → 'unknown'; E0014 →
// busy; the NORMAL request body stays byte-for-byte; the normal question is refused on a frozen
// page; the session value is never logged.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const GUID_N = "c4e1b2a0-1111-2222-3333-444455556666";
const GUID_F = "f7a0c3d1-9999-8888-7777-666655554444";
const NORMAL_HTML = `<!DOCTYPE html><html><body><script>var isSelectSeven="N";var storecategory="";var storeid="";var multiple_type="";var eshopparid="7M0";var eshopid="7M0";var eshopGuid="${GUID_N}";</script></body></html>`;
// the frozen picker's E-Map page (8Q7 link): numeric storecategory (unquoted), 870 / 870
const FROZEN_HTML = `<!DOCTYPE html><html><body><script>var storecategory = 27; var storeid=""; var eshopparid = "870"; var eshopid = "870"; var eshopGuid = "${GUID_F}";</script></body></html>`;
const FROZEN_NO_ESHOP_HTML = `<!DOCTYPE html><html><body><script>var storecategory = 27; var eshopGuid = "${GUID_F}";</script></body></html>`;
const FROZEN_RUNTIME_ONLY_HTML = `<!DOCTYPE html><html><body><script src="/ecmap/js/default.js"></script></body></html>`;
// 1.16.1 (audit Medium 6): the session value IS in the script text, the mode values are only runtime globals
const FROZEN_GUID_TEXT_MODE_RUNTIME_HTML = `<!DOCTYPE html><html><body><script>var eshopGuid = "${GUID_F}";</script><script src="/ecmap/js/default.js"></script></body></html>`;

// exact strings captured on 2026-10-06
const ANS_968551 = "OK;968551+新蓮盈+花蓮縣吉安鄉建國路二段285號1F+disable+0++門市";
const ANS_NEAREST = "OK;264141+吉昌+花蓮縣吉安鄉吉安路一段114號1樓+enable+0++新蓮盈+543";
const ANS_I0100 = "NG;I0100;0000"; // a 13-character non-OK answer containing "I0100" (normal question on a frozen session)
const ANS_E0014 = "系統忙碌中 錯誤代碼: E0014";

type Msg = { type: string; row?: { store_id: string } };
type Handler = (m: Msg, s: unknown, send: (r: unknown) => void) => boolean;

function load(html: string, opts: { answer?: (body: string) => string; globals?: Record<string, unknown>; url?: string; throwFetch?: boolean } = {}) {
  const url = opts.url ?? "https://emap.unipcsc.com.tw/ecmap/default.aspx";
  const dom = new JSDOM(html, { url });
  const win = dom.window as unknown as Window & Record<string, unknown>;
  for (const [k, v] of Object.entries(opts.globals ?? {})) win[k] = v;
  let handler: Handler | null = null;
  const calls = { fetch: [] as { url: string; body: string }[], logs: [] as string[] };
  const fetch = vi.fn(async (u: string, init?: { body?: string }) => {
    const body = String(init?.body ?? "");
    calls.fetch.push({ url: u, body });
    if (opts.throwFetch) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
    return { url: `https://emap.unipcsc.com.tw${u}`, ok: true, status: 200, text: async () => (opts.answer ? opts.answer(body) : "OK;198002+德民+台北市+enable+0++門市") };
  });
  const g = win as unknown as typeof globalThis;
  const sandbox: Record<string, unknown> = {
    window: win, document: win.document, location: win.location,
    CustomEvent: g.CustomEvent, URLSearchParams: g.URLSearchParams, AbortController: g.AbortController,
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    fetch, Promise, Date, Math, String, Number, Boolean, Object, Array, RegExp, Error, JSON,
    console: { log: (...a: unknown[]) => calls.logs.push(a.join(" ")), warn: () => {}, error: () => {} },
    chrome: { runtime: { onMessage: { addListener: (h: Handler) => { handler = h; } } } },
  };
  vm.createContext(sandbox);
  vm.runInNewContext(readFileSync("chrome-extension/emap-guid-main.js", "utf8"), sandbox, { filename: "emap-guid-main.js" });
  vm.runInNewContext(readFileSync("chrome-extension/emap-711.js", "utf8"), sandbox, { filename: "emap-711.js" });
  const send = (msg: Msg) => new Promise<Record<string, unknown>>((resolve) => { handler!(msg, {}, (r) => resolve(r as Record<string, unknown>)); });
  return { send, calls };
}
const frozenCheck = (store: string, answer: string) => load(FROZEN_HTML, { answer: () => answer }).send({ type: "PC_CHECK_STORE_FROZEN", row: { store_id: store } });

describe("page mode — read from the page itself", () => {
  it("frozen page: probe says frozen with the page's own values; normal page says not frozen", async () => {
    const f = await load(FROZEN_HTML).send({ type: "PC_EMAP_PROBE" });
    expect(f).toMatchObject({ frozen: true, cate: "27", eshopparid: "870", eshopid: "870", guidFound: true });
    const n = await load(NORMAL_HTML).send({ type: "PC_EMAP_PROBE" });
    expect(n).toMatchObject({ frozen: false, cate: "", eshopparid: "7M0", eshopid: "7M0" });
  });
  it("the values may come from the runtime globals (MAIN-world helper) when the script text has none", async () => {
    const r = await load(FROZEN_RUNTIME_ONLY_HTML, { globals: { storecategory: 27, eshopparid: "870", eshopid: "870", eshopGuid: GUID_F } }).send({ type: "PC_EMAP_PROBE" });
    expect(r).toMatchObject({ frozen: true, cate: "27", eshopparid: "870", eshopid: "870" });
  });
  it("fix 9: session value in the page text + mode values only at runtime → still seen as frozen (the helper is asked on every probe)", async () => {
    const globals = { storecategory: 27, eshopparid: "870", eshopid: "870", eshopGuid: GUID_F };
    const p = await load(FROZEN_GUID_TEXT_MODE_RUNTIME_HTML, { globals }).send({ type: "PC_EMAP_PROBE" });
    expect(p).toMatchObject({ frozen: true, cate: "27", eshopparid: "870", eshopid: "870", guidFound: true });
    const { send, calls } = load(FROZEN_GUID_TEXT_MODE_RUNTIME_HTML, { globals, answer: () => ANS_968551 });
    expect(await send({ type: "PC_CHECK_STORE_FROZEN", row: { store_id: "968551" } })).toMatchObject({ store_full_status: "frozen_unavailable" });
    expect(new URLSearchParams(calls.fetch[0].body).get("cate")).toBe("27");
  });
  it("fix 9: the normal question is refused on such a page too", async () => {
    const { send, calls } = load(FROZEN_GUID_TEXT_MODE_RUNTIME_HTML, { globals: { storecategory: 27, eshopparid: "870", eshopid: "870", eshopGuid: GUID_F } });
    expect(await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } })).toMatchObject({ store_full_status: "unknown", store_reason: "frozen E-Map page — normal check refused" });
    expect(calls.fetch).toHaveLength(0);
  });
  it("a value missing → not a frozen page → 'unknown', no request sent", async () => {
    const { send, calls } = load(FROZEN_NO_ESHOP_HTML);
    const r = await send({ type: "PC_CHECK_STORE_FROZEN", row: { store_id: "968551" } });
    expect(r).toMatchObject({ store_full_status: "unknown", transient: false, session: true }); // 1.16.1: this tab can't serve the frozen check
    expect(calls.fetch).toHaveLength(0);
  });
  it("the frozen question on a NORMAL page is refused ('unknown', no request)", async () => {
    const { send, calls } = load(NORMAL_HTML);
    expect((await send({ type: "PC_CHECK_STORE_FROZEN", row: { store_id: "968551" } })).store_full_status).toBe("unknown");
    expect(calls.fetch).toHaveLength(0);
  });
});

describe("the frozen request + the captured answers", () => {
  it("sends exactly what the page says (cate 27 / 870 / 870) to the page's own endpoint", async () => {
    const { send, calls } = load(FROZEN_HTML, { answer: () => ANS_968551 });
    await send({ type: "PC_CHECK_STORE_FROZEN", row: { store_id: "968551" } });
    expect(calls.fetch).toHaveLength(1);
    expect(calls.fetch[0].url).toMatch(/^\/ecmap\/byIDData\.aspx\?rnd=/);
    const p = new URLSearchParams(calls.fetch[0].body);
    expect([...p.keys()]).toEqual(["mode", "k", "cate", "eshopparid", "eshopid", "multiple_type", "Guid", "Nan4AjaxTrickNumber"]);
    expect(Object.fromEntries(p)).toMatchObject({ mode: "", k: "968551", cate: "27", eshopparid: "870", eshopid: "870", multiple_type: "", Guid: GUID_F });
  });
  it("968551 'disable' → frozen_unavailable (not 'full')", async () => {
    expect(await frozenCheck("968551", ANS_968551)).toMatchObject({ store_full_status: "frozen_unavailable", transient: false, busy: false });
  });
  it("167765 'enable' → open (OK for frozen)", async () => {
    expect((await frozenCheck("167765", "OK;167765+某門市+地址+enable+0++門市")).store_full_status).toBe("open");
  });
  it("the nearest-store answer (a DIFFERENT store, 264141 enable) for 968551 → unknown, never OK", async () => {
    expect(await frozenCheck("968551", ANS_NEAREST)).toMatchObject({ store_full_status: "unknown", transient: false, session: false }); // 1.16.1: an odd answer, not a session failure
  });
  it("the 'I0100' answer (13 characters) → unknown, flagged as a SESSION failure (1.16.1)", async () => {
    expect(ANS_I0100).toHaveLength(13);
    expect(await frozenCheck("968551", ANS_I0100)).toMatchObject({ store_full_status: "unknown", transient: false, session: true });
  });
  it("E0014 → unknown + busy (transient)", async () => {
    expect(await frozenCheck("968551", ANS_E0014)).toMatchObject({ store_full_status: "unknown", busy: true, transient: true });
  });
  it("NO2 → not_found · close → company · an unknown field / empty / garbage → unknown", async () => {
    expect((await frozenCheck("968551", "NO2")).store_full_status).toBe("not_found");
    expect((await frozenCheck("180849", "OK;180849+明月+高雄市+close+0++門市")).store_full_status).toBe("company");
    for (const a of ["OK;968551+x+y+maybe+0++門市", "", "OK;", "<html>error</html>", "OK;968551"]) expect((await frozenCheck("968551", a)).store_full_status, a).toBe("unknown");
  });
  it("timeout → unknown + transient", async () => {
    const r = await load(FROZEN_HTML, { throwFetch: true }).send({ type: "PC_CHECK_STORE_FROZEN", row: { store_id: "968551" } });
    expect(r).toMatchObject({ store_full_status: "unknown", transient: true });
  });
});

describe("the NORMAL check is unchanged (except: refused on a frozen page; E0014 = busy)", () => {
  it("request body is byte-for-byte today's", async () => {
    const { send, calls } = load(NORMAL_HTML);
    await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    const body = calls.fetch[0].body;
    const nan = new URLSearchParams(body).get("Nan4AjaxTrickNumber")!;
    const today = new URLSearchParams({ mode: "", k: "198002", cate: "3", eshopparid: "7M0", eshopid: "7M0", multiple_type: "", Guid: GUID_N, Nan4AjaxTrickNumber: nan }).toString();
    expect(body).toBe(today);
    expect(body).toBe(`mode=&k=198002&cate=3&eshopparid=7M0&eshopid=7M0&multiple_type=&Guid=${GUID_N}&Nan4AjaxTrickNumber=${nan}`);
  });
  it("the normal question on a frozen page → refused, no request", async () => {
    const { send, calls } = load(FROZEN_HTML);
    const r = await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } });
    expect(r).toMatchObject({ store_full_status: "unknown", transient: true });
    expect(calls.fetch).toHaveLength(0);
  });
  it("normal E0014 → unknown + busy + transient, and the other endpoint is not hit", async () => {
    const { send, calls } = load(NORMAL_HTML, { answer: () => ANS_E0014 });
    expect(await send({ type: "PC_CHECK_STORE", row: { store_id: "198002" } })).toMatchObject({ store_full_status: "unknown", busy: true, transient: true });
    expect(calls.fetch).toHaveLength(1);
  });
});

describe("never logs the session value", () => {
  it("no guid in any log line or probe reply (frozen + normal)", async () => {
    for (const html of [FROZEN_HTML, NORMAL_HTML]) {
      const { send, calls } = load(html, { answer: () => ANS_968551 });
      const probe = await send({ type: "PC_EMAP_PROBE" });
      await send({ type: "PC_CHECK_STORE_FROZEN", row: { store_id: "968551" } });
      const all = calls.logs.join("\n") + JSON.stringify(probe);
      expect(all).not.toContain(GUID_F);
      expect(all).not.toContain(GUID_N);
    }
  });
});
