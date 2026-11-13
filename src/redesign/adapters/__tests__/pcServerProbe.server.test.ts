// 7-11 server probe (server/pcServerProbe.js) — diagnostic only.
// ⚠️ Fake fetch only. The pages below are built from the field names in the task notes; NO
// real request to 7-11 was ever made by these tests.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import http from "node:http";
import express from "express";
import {
  runPcServerProbe, createGuardedFetch, isAllowedProbeUrl, isMaintWindow, parseForms, parseProbeConfig,
  createPcProbeHandler, schedulePcProbeBoot, pcProbeEnabled,
  PC_PROBE_LIMIT_WINDOW_MS, PC_PROBE_BOOT_DELAY_MS, PC_PROBE_REQUEST_MS,
} from "../../../../server/pcServerProbe.js";
import { createWindowLimiter } from "../../../../server/rateWindow.js";

const GM = "GM2609096130694";
// every one of these must never show up in a log line or in the result
const MARK = {
  token: "MARKTOKENaaa:MARKTOKENbbb", cookie: "MARKCOOKIEvalue", setCookie: "MARKSETCOOKIE", guid: "MARKGUID-1234-5678",
  sender: "0979000111", buyer: "0919000222", pwd: "MARKPWD", field: "MARKFIELDVALUE", sid: "MARKSID8", name: "王小明",
};
const NOON = Date.UTC(2026, 10, 13, 4, 0, 0);   // 12:00 Asia/Taipei
const TWO_AM = Date.UTC(2026, 10, 13, 18, 0, 0); // 02:00 Asia/Taipei

type Call = { method: string; url: string; host: string; path: string; headers: Record<string, string>; body: string };
type Reply = { status?: number; ct?: string; body?: string; location?: string; cookies?: string[] };
const reply = (r: Reply) => ({
  status: r.status ?? 200, ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
  headers: {
    get: (k: string) => (k.toLowerCase() === "content-type" ? r.ct ?? "text/html; charset=utf-8" : k.toLowerCase() === "location" ? r.location ?? null : null),
    getSetCookie: () => r.cookies ?? [],
  },
  text: async () => r.body ?? "",
});
const site = (routes: Record<string, Reply | ((c: Call) => Reply)>) => {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url);
    const c: Call = { method: init.method || "GET", url, host: u.hostname, path: u.pathname, headers: init.headers || {}, body: String(init.body ?? "") };
    calls.push(c);
    const hit = routes[`${c.method} ${u.hostname}${u.pathname}`];
    if (!hit) return reply({ status: 404, body: "nope" });
    return reply(typeof hit === "function" ? hit(c) : hit);
  });
  return { f, calls };
};

const cartPage = (sid: string) => `<html><script>var tokenID = '${MARK.token}';</script>
<form id="MyCart" action="/cart/detail" method="post">
<input type="hidden" name="MemberSid" value="${sid}"><input type="hidden" name="fee_1" value="38">
<input type="hidden" name="__RequestVerificationToken" value="${MARK.field}"><input type="hidden" name="CarQty" value="0">
<input type="text" name="item_name_1" value=""><input type="checkbox" name="Agree"><input type="submit" name="go" value="x">
</form></html>`;
const detailPage = `<html><form id="MyCart" action="/cart/finish" method="post">
<input type="hidden" name="Total" value="100"><input type="hidden" name="rcv" value="${MARK.field}"><input type="hidden" name="k3" value="3">
</form></html>`;
const emapNames = ["eshopparid", "eshopid", "eshoppwd", "url", "storecategory", "tempvar", "sid", "showtype", "storeid", "EcMapPhone", "EcMapWeb"];
const mapPage = (action = "https://emap.unipcsc.com.tw/ecmap/default.aspx") => `<html><form method="post" action="${action}">
${emapNames.map((n) => `<input type="hidden" name="${n}" value="${n === "eshoppwd" ? MARK.pwd : MARK.field}">`).join("")}</form></html>`;
const emapPage = `<html><script>var eshopGuid="${MARK.guid}";</script></html>`;

const fullSite = (over: Record<string, Reply | ((c: Call) => Reply)> = {}) => site({
  [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage(MARK.sid), cookies: [`ASP.NET_SessionId=${MARK.setCookie}; path=/; HttpOnly`] },
  "POST myship.7-11.com.tw/CPF3101/CheckoutValidation/": { ct: "application/json; charset=utf-8", body: JSON.stringify({ Status: true }) },
  "POST myship.7-11.com.tw/cart/detail": { body: detailPage },
  "POST myship.7-11.com.tw/CPF3101/MAP/": { status: 302, location: `/eMap/MM1/${GM}` },
  [`GET myship.7-11.com.tw/eMap/MM1/${GM}`]: { body: mapPage() },
  "POST emap.unipcsc.com.tw/ecmap/default.aspx": { body: emapPage, cookies: [`emapsess=${MARK.setCookie}2; path=/`] },
  "POST emap.unipcsc.com.tw/ecmap/byIDData.aspx": { body: "OK;198002+德民+addr+disable+0++門市" },
  ...over,
});
const settings = (over: Record<string, string | null> = {}) => async (key: string) => ({
  parcel_check_shared_gms: JSON.stringify([GM, "GM2610017302504"]), parcel_check_sender_phone: MARK.sender, parcel_check_probe_buyer: MARK.buyer, ...over,
} as Record<string, string | null>)[key] ?? null;
const run = (f: unknown, o: { env?: Record<string, string>; now?: number; readSetting?: (k: string) => Promise<string | null> } = {}) => {
  const logs: string[] = [];
  const p = runPcServerProbe({
    fetchImpl: f as typeof fetch, now: () => o.now ?? NOON, log: (l: string) => logs.push(l),
    readSetting: o.readSetting ?? settings(), env: o.env ?? { PC_SERVER_PROBE: "1" },
  });
  return p.then((result) => ({ result, logs }));
};
const ON = { PC_SERVER_PROBE: "1", PC_PROBE_MYSHIP_COOKIE: `auth=${MARK.cookie}; other=${MARK.cookie}2` };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("off / on", () => {
  it('on only when PC_SERVER_PROBE is exactly "1"; off = no request at all', async () => {
    for (const v of [undefined, "", "0", "true", "1 ", "01"]) expect(pcProbeEnabled({ PC_SERVER_PROBE: v as string })).toBe(false);
    expect(pcProbeEnabled({ PC_SERVER_PROBE: "1" })).toBe(true);
    const s = fullSite();
    const { result, logs } = await run(s.f, { env: { PC_SERVER_PROBE: "true" } });
    expect(result).toEqual({ disabled: true });
    expect(s.f).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });
});

describe("1a phone step (no cookies)", () => {
  it("token page then the validation POST: same body fields and headers as the extension, no cookie; Status true → ok", async () => {
    const s = fullSite();
    const { result } = await run(s.f, { env: { PC_SERVER_PROBE: "1" } });
    expect(result.phone).toMatchObject({ verdict: "ok", kind: "" });
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /cart/easy/${GM}`, "POST /CPF3101/CheckoutValidation/"]);
    const post = s.calls[1];
    expect(Object.fromEntries(new URLSearchParams(post.body))).toEqual({
      rcvName: MARK.name, revPhone: "", revMobile: MARK.buyer, ordPhone: "", ordMobile: MARK.sender, Cgdm_Id: GM,
      Carm_Cgptshiptype: "1", Carm_Cgptpaymenttype: "1", RcvStoreID: "195965",
    });
    expect(post.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", VerificationToken: MARK.token,
      origin: "https://myship.7-11.com.tw", referer: `https://myship.7-11.com.tw/cart/easy/${GM}`,
    });
    expect(post.headers["user-agent"]).toMatch(/Mozilla/);
    for (const c of s.calls) expect(Object.keys(c.headers).map((k) => k.toLowerCase())).not.toContain("cookie");
    expect(result.store).toMatchObject({ kind: "no_cookie" }); // no cookie env → the store step is skipped
  });
  it("verdicts like the extension: restricted only for the real wording; other refusals / shapes are unknown + a kind", async () => {
    const cases: [Reply, string, string][] = [
      [{ ct: "application/json", body: JSON.stringify({ Status: false, Message: "此門號多次未取，限制使用取貨付款至2026年12月01日" }) }, "restricted", ""],
      [{ ct: "application/json", body: JSON.stringify({ Status: false, Message: "門市資料錯誤" }) }, "unknown", "rejected"],
      [{ ct: "application/json", body: JSON.stringify({ ok: 1 }) }, "unknown", "bad_json"],
      [{ ct: "application/json", body: "{not json" }, "unknown", "bad_json"],
      [{ ct: "text/html", body: "<html>login</html>" }, "unknown", "html"],
      [{ status: 302, location: "/login" }, "unknown", "redirect"],
      [{ status: 503, body: "x" }, "unknown", "http"],
    ];
    for (const [answer, verdict, kind] of cases) {
      const s = fullSite({ "POST myship.7-11.com.tw/CPF3101/CheckoutValidation/": answer });
      const { result } = await run(s.f, { env: { PC_SERVER_PROBE: "1" } });
      expect([result.phone.verdict, result.phone.kind]).toEqual([verdict, kind]);
      expect(s.f).toHaveBeenCalledTimes(2); // never a retry, never a followed redirect
    }
  });
  it("token page: no token → html; http error → http; network error → network; none of them sends the POST", async () => {
    const cases: [Reply | (() => Reply), string][] = [
      [{ body: "<html>no token here</html>" }, "html"], [{ status: 500, body: "x" }, "http"], [{ status: 302, location: "/x" }, "redirect"],
      [() => { throw new Error("ECONNRESET"); }, "network"],
    ];
    for (const [answer, kind] of cases) {
      const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: answer });
      const { result } = await run(s.f, { env: { PC_SERVER_PROBE: "1" } });
      expect(result.phone).toMatchObject({ verdict: "unknown", kind });
      expect(s.calls.length).toBe(1);
    }
  });
  it("a request that never answers → timeout after 10 s, not retried", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))));
    const p = runPcServerProbe({ fetchImpl: f as unknown as typeof fetch, log: () => {}, readSetting: settings(), env: { PC_SERVER_PROBE: "1" } });
    await vi.advanceTimersByTimeAsync(PC_PROBE_REQUEST_MS + 50);
    const result = await p;
    expect(PC_PROBE_REQUEST_MS).toBe(10_000);
    expect(result.phone).toMatchObject({ verdict: "unknown", kind: "timeout" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("settings missing or malformed → config_missing and no request", async () => {
    expect(parseProbeConfig({ gms: '["GM2609096130694"]', sender: "0979000111", buyer: "0919000222" })).toEqual({ gm: "GM2609096130694", sender: "0979000111", buyer: "0919000222" });
    for (const over of [{ parcel_check_shared_gms: "[]" }, { parcel_check_shared_gms: "not json" }, { parcel_check_shared_gms: null }, { parcel_check_sender_phone: "12345" }, { parcel_check_probe_buyer: null }]) {
      const s = fullSite();
      const { result } = await run(s.f, { env: { PC_SERVER_PROBE: "1" }, readSetting: settings(over) });
      expect(result.phone).toMatchObject({ verdict: "unknown", kind: "config_missing" });
      expect(s.f).not.toHaveBeenCalled();
    }
    const s = fullSite();
    const { result } = await run(s.f, { env: { PC_SERVER_PROBE: "1" }, readSetting: async () => { throw new Error("db down"); } });
    expect(result.phone.kind).toBe("config_missing");
    expect(s.f).not.toHaveBeenCalled();
  });
});

describe("1b store step (only with the cookie env)", () => {
  it("happy path: cart → detail → MAP → the served E-Map form → byIDData; verdict mapped like the extension", async () => {
    const s = fullSite();
    const { result } = await run(s.f, { env: ON });
    expect(result.store).toMatchObject({ verdict: "full", kind: "" });
    expect(s.calls.slice(2).map((c) => `${c.method} ${c.host}${c.path}`)).toEqual([
      `GET myship.7-11.com.tw/cart/easy/${GM}`, "POST myship.7-11.com.tw/cart/detail", "POST myship.7-11.com.tw/CPF3101/MAP/",
      `GET myship.7-11.com.tw/eMap/MM1/${GM}`, "POST emap.unipcsc.com.tw/ecmap/default.aspx", "POST emap.unipcsc.com.tw/ecmap/byIDData.aspx",
    ]);
    const [cart, detail, map, , emap, byid] = s.calls.slice(2);
    // the cookie jar: seeded from the env for myship, every Set-Cookie applied, one jar per host
    expect(cart.headers.cookie).toBe(`auth=${MARK.cookie}; other=${MARK.cookie}2`);
    expect(detail.headers.cookie).toContain(`ASP.NET_SessionId=${MARK.setCookie}`);
    expect(emap.headers.cookie).toBeUndefined();
    expect(byid.headers.cookie).toBe(`emapsess=${MARK.setCookie}2`);
    // step 2: every served field + the item / totals (fee 38 → 100), Agree on; the submit button is not sent
    const d = Object.fromEntries(new URLSearchParams(detail.body));
    expect(d).toEqual({
      MemberSid: MARK.sid, fee_1: "38", __RequestVerificationToken: MARK.field, CarQty: "0", item_name_1: "test", item_price_1: "62",
      item_qty_1: "1", item_amt_1: "62", Count: "1", Sum: "62", Total: "100", Seller_GoodsTotalAmt: "100", Agree: "on",
    });
    // step 3: page 2's fields unchanged; step 4: the 11 served fields unchanged
    expect(Object.fromEntries(new URLSearchParams(map.body))).toEqual({ Total: "100", rcv: MARK.field, k3: "3" });
    expect([...new URLSearchParams(emap.body).keys()]).toEqual(emapNames);
    expect(new URLSearchParams(emap.body).get("eshoppwd")).toBe(MARK.pwd);
    // step 5: the extension's byIDData body for store 198002
    const b = Object.fromEntries(new URLSearchParams(byid.body));
    expect(b).toMatchObject({ mode: "", k: "198002", cate: "3", eshopparid: "7M0", eshopid: "7M0", multiple_type: "", Guid: MARK.guid });
    expect(byid.headers).toMatchObject({ "x-requested-with": "XMLHttpRequest", "content-type": "application/x-www-form-urlencoded; charset=UTF-8" });
    expect(result.store.steps.map((x: { step: string }) => x.step)).toEqual(["store.cart", "store.detail", "store.map", "store.emap", "store.byid"]);
  });
  it("byIDData answers: enable → open, close → company, NO2 → not_found, anything else → unknown", async () => {
    for (const [body, verdict] of [["OK;198002+a+b+enable+0++x", "open"], ["OK;198002+a+b+close+0++x", "company"], ["NO2", "not_found"], ["<html>error</html>", "unknown"]]) {
      const { result } = await run(fullSite({ "POST emap.unipcsc.com.tw/ecmap/byIDData.aspx": { body } }).f, { env: ON });
      expect(result.store.verdict).toBe(verdict);
    }
  });
  it("a logged-out cart page (2-character MemberSid) stops at step 1 with login_not_accepted", async () => {
    const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage("ab") } });
    const { result } = await run(s.f, { env: ON });
    expect(result.store).toMatchObject({ verdict: "unknown", kind: "login_not_accepted" });
    expect(s.calls.length).toBe(3); // phone ×2 + the one cart GET
  });
  it("no cookie env → the store step makes no request", async () => {
    const s = fullSite();
    const { result } = await run(s.f, { env: { PC_SERVER_PROBE: "1", PC_PROBE_MYSHIP_COOKIE: "  " } });
    expect(result.store.kind).toBe("no_cookie");
    expect(s.calls.length).toBe(2);
  });
  it("the E-Map form is posted only to the two E-Map hosts", async () => {
    const s = fullSite({ [`GET myship.7-11.com.tw/eMap/MM1/${GM}`]: { body: mapPage("https://evil.example.com/ecmap/default.aspx") } });
    const { result } = await run(s.f, { env: ON });
    expect(result.store.kind).toBe("emap_host_refused");
    expect(s.calls.some((c) => c.host === "evil.example.com")).toBe(false);
    const ok = fullSite({
      [`GET myship.7-11.com.tw/eMap/MM1/${GM}`]: { body: mapPage("https://emap.pcsc.com.tw/ecmap/default.aspx") },
      "POST emap.pcsc.com.tw/ecmap/default.aspx": { body: emapPage }, "POST emap.pcsc.com.tw/ecmap/byIDData.aspx": { body: "NO2" },
    });
    expect((await run(ok.f, { env: ON })).result.store.verdict).toBe("not_found");
  });
});

describe("1c hard guards", () => {
  it("allowlist: only the named paths on myship and the two E-Map hosts", () => {
    for (const ok of [
      `https://myship.7-11.com.tw/cart/easy/${GM}`, "https://myship.7-11.com.tw/CPF3101/CheckoutValidation/", "https://myship.7-11.com.tw/cart/detail",
      "https://myship.7-11.com.tw/CPF3101/MAP/", `https://myship.7-11.com.tw/eMap/MM1/${GM}`, "https://emap.unipcsc.com.tw/ecmap/default.aspx",
      "https://emap.pcsc.com.tw/ecmap/byIDData.aspx?rnd=0.5", "https://emap.unipcsc.com.tw/mobilemap/byIDData.aspx",
    ]) expect(isAllowedProbeUrl(ok)).toBe(true);
    for (const bad of [
      "https://myship.7-11.com.tw/cart/finish", "https://myship.7-11.com.tw/cart/finish/", "https://myship.7-11.com.tw/cart/detail/../finish",
      "https://myship.7-11.com.tw/", "https://myship.7-11.com.tw/seller/order", "http://myship.7-11.com.tw/cart/detail",
      "https://myship.7-11.com.tw.evil.com/cart/detail", "https://emap.unipcsc.com.tw/ecmap/other.aspx", "https://example.com/ecmap/default.aspx",
      "https://user:pw@myship.7-11.com.tw/cart/detail", "not a url",
    ]) expect(isAllowedProbeUrl(bad)).toBe(false);
  });
  it("a request outside the allowlist is refused BEFORE any request — /cart/finish included", async () => {
    const f = vi.fn(async () => reply({}));
    const guarded = createGuardedFetch(f as unknown as typeof fetch);
    await expect(guarded("https://myship.7-11.com.tw/cart/finish", { method: "POST" })).rejects.toThrow("pc_probe_url_refused");
    await expect(guarded("https://example.com/", {})).rejects.toThrow("pc_probe_url_refused");
    expect(f).not.toHaveBeenCalled();
  });
  it("cart/finish is never requested: not from the served action, not from a redirect", async () => {
    const s = fullSite();
    await run(s.f, { env: ON });
    expect(s.calls.some((c) => /finish/i.test(c.url))).toBe(false);
    const r = fullSite({ "POST myship.7-11.com.tw/CPF3101/MAP/": { status: 302, location: "/cart/finish" } });
    const { result } = await run(r.f, { env: ON });
    expect(result.store.kind).toBe("refused");
    expect(r.calls.some((c) => /finish/i.test(c.url))).toBe(false);
    // the words appear in the module only where the allowlist comment says it is never requested
    const src = readFileSync(resolve(__dirname, "../../../../server/pcServerProbe.js"), "utf8");
    expect(src.split("\n").filter((l) => /cart\/finish/.test(l)).every((l) => l.trim().startsWith("//"))).toBe(true);
  });
  it("the hour never stops a run: 02:00 Taipei still makes its requests and is marked maint=1", async () => {
    expect(isMaintWindow(TWO_AM)).toBe(true);
    expect([isMaintWindow(Date.UTC(2026, 10, 13, 17, 0)), isMaintWindow(Date.UTC(2026, 10, 13, 20, 59)), isMaintWindow(Date.UTC(2026, 10, 13, 21, 0)), isMaintWindow(NOON)]).toEqual([true, true, false, false]);
    const s = fullSite();
    const { result, logs } = await run(s.f, { env: ON, now: TWO_AM });
    expect(s.calls.length).toBe(8);
    expect(result).toMatchObject({ maintWindow: true, phone: { verdict: "ok" }, store: { verdict: "full" } });
    expect(logs.length).toBe(7);
    expect(logs.every((l) => l.endsWith(" maint=1"))).toBe(true);
    const day = await run(fullSite().f, { env: ON });
    expect(day.result.maintWindow).toBe(false);
    expect(day.logs.every((l) => l.endsWith(" maint=0"))).toBe(true);
  });
  it("nothing secret in the logs or in the result; one log line per step in the agreed shape", async () => {
    const s = fullSite();
    const { result, logs } = await run(s.f, { env: ON });
    const all = `${logs.join("\n")}\n${JSON.stringify(result)}`;
    for (const [what, value] of Object.entries(MARK)) expect(all.includes(value), what).toBe(false);
    expect(all).not.toMatch(/(?<!\d)09\d{8}(?!\d)/); // a phone number on its own (the shop id in a path holds digits too)
    for (const l of logs) expect(l).toMatch(/^\[PC_PROBE\] (phone|store)\.\w+ http=\d+ ms=\d+ .+ maint=[01]$/);
    expect(result.phone.steps[1]).toEqual({ step: "phone.validate", http: 200, path: "myship.7-11.com.tw/CPF3101/CheckoutValidation/", ms: 0, ok: true, note: expect.stringContaining("verdict=ok") });
    // also when things go wrong (a refusal message from the site is never copied out)
    const bad = fullSite({ "POST myship.7-11.com.tw/CPF3101/CheckoutValidation/": { ct: "application/json", body: JSON.stringify({ Status: false, Message: `${MARK.field} ${MARK.buyer}` }) } });
    const out = await run(bad.f, { env: ON });
    const text = `${out.logs.join("\n")}\n${JSON.stringify(out.result)}`;
    for (const value of Object.values(MARK)) expect(text.includes(value)).toBe(false);
  });
  it("the whole run stops asking after 40 s", async () => {
    let t = NOON;
    const s = fullSite();
    const f = vi.fn(async (u: string, init: never) => { t += 15_000; return s.f(u, init); });
    const logs: string[] = [];
    const result = await runPcServerProbe({ fetchImpl: f as unknown as typeof fetch, now: () => t, log: (l: string) => logs.push(l), readSetting: settings(), env: ON });
    expect(f).toHaveBeenCalledTimes(3); // 0 s, 15 s, 30 s — the next one would start at 45 s
    expect(result.store.kind).toBe("budget");
  });
  it("parseForms sends what a browser would: unchecked boxes and buttons are left out", () => {
    const [f] = parseForms('<form id="a" action="/x" method="POST"><input name="h" type="hidden" value="1&amp;2"><input type="checkbox" name="c1"><input type="checkbox" name="c2" checked><input type="submit" name="s" value="go"><select name="sel"><option value="1">a<option value="2" selected>b</select><textarea name="t">hi</textarea></form>');
    expect(f).toEqual({ id: "a", action: "/x", method: "post", fields: [["h", "1&2"], ["c2", "on"], ["sel", "2"], ["t", "hi"]] });
  });
});

describe("2 wiring", () => {
  const post = (port: number) => new Promise<{ status: number; json: Record<string, unknown> }>((res, rej) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/admin/pc-server-probe", method: "POST" }, (r) => {
      let buf = ""; r.on("data", (c) => { buf += c; }); r.on("end", () => res({ status: r.statusCode ?? 0, json: JSON.parse(buf || "{}") }));
    });
    req.on("error", rej); req.end();
  });
  const serve = async (enabled: boolean, runFn: () => Promise<unknown>) => {
    const app = express();
    app.post("/admin/pc-server-probe", createPcProbeHandler({ run: runFn, allowed: createWindowLimiter({ max: 1, windowMs: PC_PROBE_LIMIT_WINDOW_MS }), enabled: () => enabled }));
    const server = await new Promise<http.Server>((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
    return { port: (server.address() as { port: number }).port, close: () => new Promise((res) => server.close(res)) };
  };
  it("route off = 404 { success:false, error:'disabled' } and the probe is not run", async () => {
    const runFn = vi.fn(async () => ({}));
    const s = await serve(false, runFn);
    try {
      expect(await post(s.port)).toEqual({ status: 404, json: { success: false, error: "disabled" } });
      expect(runFn).not.toHaveBeenCalled();
    } finally { await s.close(); }
  });
  it("route on: runs once and answers the result; a second run within 10 minutes is refused (whole server)", async () => {
    expect(PC_PROBE_LIMIT_WINDOW_MS).toBe(600_000);
    const runFn = vi.fn(async () => ({ maintWindow: false }));
    const s = await serve(true, runFn);
    try {
      expect(await post(s.port)).toEqual({ status: 200, json: { success: true, result: { maintWindow: false } } });
      expect(await post(s.port)).toEqual({ status: 429, json: { success: false, error: "rate_limited" } });
      expect(runFn).toHaveBeenCalledTimes(1);
    } finally { await s.close(); }
  });
  it("server.js: admin only, its own limiter, the boot run — additions only", () => {
    const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
    expect(src).toContain('app.post("/admin/pc-server-probe", requireAuth, requireAdmin, createPcProbeHandler({ run: runPcProbe, allowed: pcProbeAllowed }));');
    expect(src).toContain("const pcProbeAllowed = createWindowLimiter({ max: 1, windowMs: PC_PROBE_LIMIT_WINDOW_MS });");
    expect(src).toContain("schedulePcProbeBoot({ run: runPcProbe, enabled: pcProbeEnabled() });");
  });
  it("boot run: no timer at all when off; when on, ONE unref'd timer of 90 s whose run never throws", async () => {
    const off = vi.fn();
    expect(schedulePcProbeBoot({ run: vi.fn(), enabled: false, setTimeoutImpl: off as never })).toBeNull();
    expect(off).not.toHaveBeenCalled();
    const unref = vi.fn();
    let fire: () => void = () => {};
    const timers = vi.fn((fn: () => void, _ms: number) => { fire = fn; return { unref }; });
    const runFn = vi.fn(async () => { throw new Error("boom"); });
    const logs: string[] = [];
    schedulePcProbeBoot({ run: runFn, enabled: true, setTimeoutImpl: timers as never, log: (l: string) => logs.push(l) });
    expect(timers).toHaveBeenCalledTimes(1);
    expect(timers.mock.calls[0][1]).toBe(90_000);
    expect(PC_PROBE_BOOT_DELAY_MS).toBe(90_000);
    expect(unref).toHaveBeenCalledTimes(1);
    expect(runFn).not.toHaveBeenCalled();
    expect(() => fire()).not.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    expect(runFn).toHaveBeenCalledTimes(1);
    expect(logs).toEqual(["[PC_PROBE] boot run failed"]);
  });
  it("importing the module starts nothing (no timer, no request)", async () => {
    vi.resetModules();
    const timer = vi.spyOn(globalThis, "setTimeout");
    const net = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("no network in tests"); });
    await import("../../../../server/pcServerProbe.js");
    expect(timer).not.toHaveBeenCalled();
    expect(net).not.toHaveBeenCalled();
  });
});
