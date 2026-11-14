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
  createPcProbeHandler, schedulePcProbeBoot, pcProbeEnabled, safeCookieNames, pageKind, safeLocPath,
  PC_PROBE_LIMIT_WINDOW_MS, PC_PROBE_BOOT_DELAY_MS, PC_PROBE_REQUEST_MS, PC_PROBE_BODY_MAX, PC_PROBE_SETTINGS_MS, PC_PROBE_MAX_HOPS,
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

type Call = { method: string; url: string; host: string; path: string; headers: Record<string, string>; body: string; redirect?: string };
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
  const f = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; redirect?: string }) => {
    const u = new URL(url);
    const c: Call = { method: init.method || "GET", url, host: u.hostname, path: u.pathname, headers: init.headers || {}, body: String(init.body ?? ""), redirect: init.redirect };
    calls.push(c);
    const hit = routes[`${c.method} ${u.hostname}${u.pathname}`];
    if (!hit) return reply({ status: 404, body: "nope" });
    return reply(typeof hit === "function" ? hit(c) : hit);
  });
  return { f, calls };
};

// Page 1 like the real cart page (measured in a logged-in browser): fee_1, Count and Agree have an
// id but NO name (never submitted); the fee is the NAMED fullAmountFee_1; six totals are served as 0.
const CART_NAMES = ["MemberSid", "__RequestVerificationToken", "Cgdm_Id", "item_name_1", "item_price_1", "item_qty_1", "item_amt_1",
  "fullAmountFee_1", "Sum", "CarQty", "Carm_Cgptshipprice", "Total", "Seller_GoodsTotalAmt", "tail"];
const cartPage = (sid: string, o: { drop?: string[]; fee?: string; carQty?: string } = {}) => {
  const served: Record<string, string> = {
    MemberSid: sid, __RequestVerificationToken: MARK.field, Cgdm_Id: `${MARK.field}2`, item_name_1: "", item_price_1: "", item_qty_1: "",
    item_amt_1: "0", fullAmountFee_1: o.fee ?? "38", Sum: "0", CarQty: o.carQty ?? "0", Carm_Cgptshipprice: "0", Total: "0", Seller_GoodsTotalAmt: "0", tail: `${MARK.field}3`,
  };
  const inputs = CART_NAMES.filter((n) => !(o.drop || []).includes(n)).map((n) => `<input type="hidden" name="${n}" value="${served[n]}">`).join("");
  return `<html><script>var tokenID = '${MARK.token}';</script>
<form id="MyCart" action="/cart/detail" method="post">
<input type="hidden" id="fee_1" value="38"><input type="hidden" id="Count" value="1"><input type="checkbox" id="Agree" checked>
${inputs}<input type="submit" name="go" value="x">
</form></html>`;
};
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
// The saved 7-11 login (server/pc711Login.js) — the ONLY cookie source of the store step. ON also
// carries the old env cookie, which must never be read.
const SESSION = { get: async () => ({ cookies: { "myship.7-11.com.tw": `auth=${MARK.cookie}; other=${MARK.cookie}2` } }) };
const ON = { PC_SERVER_PROBE: "1", PC_PROBE_MYSHIP_COOKIE: "auth=MARKENVCOOKIE" };
type Sess = { get?: () => Promise<unknown>; relogin?: () => Promise<unknown>; save?: (d: unknown) => Promise<unknown> } | null;
const run = (f: unknown, o: { env?: Record<string, string>; now?: number; readSetting?: (k: string) => Promise<string | null>; session?: Sess } = {}) => {
  const logs: string[] = [];
  const p = runPcServerProbe({
    fetchImpl: f as typeof fetch, now: () => o.now ?? NOON, log: (l: string) => logs.push(l),
    readSetting: o.readSetting ?? settings(), env: o.env ?? { PC_SERVER_PROBE: "1" },
    session: (o.session !== undefined ? o.session : o.env === ON ? SESSION : null) as never,
  });
  return p.then((result) => ({ result, logs }));
};

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
    expect(result.store).toMatchObject({ kind: "no_session" }); // no saved 7-11 login → the store step is skipped
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

describe("1b store step (only with the saved 7-11 login)", () => {
  it("happy path: cart → detail → MAP → the served E-Map form → byIDData; verdict mapped like the extension", async () => {
    const s = fullSite();
    const { result } = await run(s.f, { env: ON });
    expect(result.store).toMatchObject({ verdict: "full", kind: "" });
    expect(s.calls.slice(2).map((c) => `${c.method} ${c.host}${c.path}`)).toEqual([
      `GET myship.7-11.com.tw/cart/easy/${GM}`, "POST myship.7-11.com.tw/cart/detail", "POST myship.7-11.com.tw/CPF3101/MAP/",
      `GET myship.7-11.com.tw/eMap/MM1/${GM}`, "POST emap.unipcsc.com.tw/ecmap/default.aspx", "POST emap.unipcsc.com.tw/ecmap/byIDData.aspx",
    ]);
    const [cart, detail, map, , emap, byid] = s.calls.slice(2);
    // the cookie jar: seeded from the saved session for myship, every Set-Cookie applied, one jar per host
    expect(cart.headers.cookie).toBe(`auth=${MARK.cookie}; other=${MARK.cookie}2`);
    expect(detail.headers.cookie).toContain(`ASP.NET_SessionId=${MARK.setCookie}`);
    expect(emap.headers.cookie).toBeUndefined();
    expect(byid.headers.cookie).toBe(`emapsess=${MARK.setCookie}2`);
    // step 2: exactly the served names in the served order; eight values set (fee 38 → 100); the rest — CarQty
    // included — unchanged.
    // fee_1 / Count / Agree (no name on the page) and the submit button are never sent.
    const sent = [...new URLSearchParams(detail.body)];
    expect(sent.map((x) => x[0])).toEqual(CART_NAMES);
    expect(Object.fromEntries(sent)).toEqual({
      MemberSid: MARK.sid, __RequestVerificationToken: MARK.field, Cgdm_Id: `${MARK.field}2`, fullAmountFee_1: "38", tail: `${MARK.field}3`,
      item_name_1: "test", item_price_1: "62", item_qty_1: "1", item_amt_1: "62", Sum: "62", CarQty: "0",
      Carm_Cgptshipprice: "38", Total: "100", Seller_GoodsTotalAmt: "100",
    });
    expect(result.store.steps[1].note).toContain("fee=38");
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
  it("no fullAmountFee_1 (missing, empty or not a number) → fee_missing, the form is not posted", async () => {
    for (const body of [cartPage(MARK.sid, { drop: ["fullAmountFee_1"] }), cartPage(MARK.sid, { fee: "" }), cartPage(MARK.sid, { fee: "abc" })]) {
      const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body } });
      const { result } = await run(s.f, { env: ON });
      expect(result.store).toMatchObject({ verdict: "unknown", kind: "fee_missing" });
      expect(s.calls.some((c) => c.method === "POST" && c.path === "/cart/detail")).toBe(false);
      expect(s.calls.length).toBe(3);
    }
  });
  it("one of the eight names is not in the served form → cart_field_missing (names only), nothing posted, no name added", async () => {
    const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage(MARK.sid, { drop: ["Total", "Sum"] }) } });
    const { result, logs } = await run(s.f, { env: ON });
    expect(result.store).toMatchObject({ verdict: "unknown", kind: "cart_field_missing" });
    expect(result.store.steps[1].note).toContain("missing=Sum,Total");
    expect(logs.some((l) => l.includes("store.detail") && l.includes("kind=cart_field_missing missing=Sum,Total"))).toBe(true);
    expect(s.calls.length).toBe(3);
  });
  it("CarQty is sent exactly as served (0 → 0, 1 → 1); a form without CarQty is posted without it", async () => {
    for (const carQty of ["0", "1"]) {
      const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage(MARK.sid, { carQty }) } });
      const { result } = await run(s.f, { env: ON });
      expect(result.store.kind).toBe("");
      const detail = s.calls.find((c) => c.method === "POST" && c.path === "/cart/detail");
      expect(new URLSearchParams(detail!.body).get("CarQty")).toBe(carQty);
    }
    const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage(MARK.sid, { drop: ["CarQty"] }) } });
    const { result } = await run(s.f, { env: ON });
    expect(result.store).toMatchObject({ verdict: "full", kind: "" });
    const detail = s.calls.find((c) => c.method === "POST" && c.path === "/cart/detail");
    expect(new URLSearchParams(detail!.body).has("CarQty")).toBe(false);
  });
  it("no saved 7-11 login → the store step makes no request (the env cookie is never read)", async () => {
    const s = fullSite();
    const { result, logs } = await run(s.f, { env: ON, session: null });
    expect(result.store.kind).toBe("no_session");
    expect(s.calls.length).toBe(2);
    expect(logs.some((l) => l.includes("store.skip") && l.includes("no_session"))).toBe(true);
    for (const c of s.calls) expect(String(c.headers.cookie || "")).not.toContain("MARKENVCOOKIE");
  });
  it("uses the saved session, never the env cookie; a logged-in cart saves the jar back", async () => {
    const s = fullSite();
    const saved: unknown[] = [];
    const { result } = await run(s.f, { env: ON, session: { ...SESSION, save: async (d) => { saved.push(d); } } });
    expect(result.store.verdict).toBe("full");
    for (const c of s.calls) expect(String(c.headers.cookie || "")).not.toContain("MARKENVCOOKIE");
    expect(String(s.calls[2].headers.cookie)).toContain(MARK.cookie);
    expect(saved.length).toBe(1);
    expect(JSON.stringify(saved[0])).toContain(`ASP.NET_SessionId=${MARK.setCookie}`);
  });
  it("logged out → ONE quick re-login, then the cart page once more with the new session", async () => {
    let relogins = 0;
    const s = fullSite({
      [`GET myship.7-11.com.tw/cart/easy/${GM}`]: (c) => (String(c.headers.cookie || "").includes("NEWSESS") ? { body: cartPage(MARK.sid) } : { status: 500, body: "<html>Server Error</html>" }),
    });
    const { result, logs } = await run(s.f, { env: ON, session: { ...SESSION, relogin: async () => { relogins += 1; return { cookies: { "myship.7-11.com.tw": "auth=NEWSESS" } }; } } });
    expect(relogins).toBe(1);
    expect(result.store.verdict).toBe("full");
    expect(logs.some((l) => l.includes("store.relogin") && l.includes(" ok "))).toBe(true);
  });
  it("logged out and the quick re-login gives nothing → the store step stops (login_not_accepted), one try only", async () => {
    let relogins = 0;
    const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage("") } });
    const { result } = await run(s.f, { env: ON, session: { ...SESSION, relogin: async () => { relogins += 1; return null; } } });
    expect(relogins).toBe(1);
    expect(result.store.kind).toBe("login_not_accepted");
  });
  it("a transient cart failure (network/timeout) → NO re-login; only a real logged-out page triggers one", async () => {
    let relogins = 0;
    const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: () => { throw new Error("boom"); } });
    const { result } = await run(s.f, { env: ON, session: { ...SESSION, relogin: async () => { relogins += 1; return { cookies: { "myship.7-11.com.tw": "auth=NEWSESS" } }; } } });
    expect(relogins).toBe(0); // a transient failure is not a logged-out verdict
    expect(result.store.kind).toBe("network");
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
    const result = await runPcServerProbe({ fetchImpl: f as unknown as typeof fetch, now: () => t, log: (l: string) => logs.push(l), readSetting: settings(), env: ON, session: SESSION as never });
    expect(f).toHaveBeenCalledTimes(3); // 0 s, 15 s, 30 s — the next one would start at 45 s
    expect(result.store.kind).toBe("budget");
  });
  it("parseForms sends what a browser would: unchecked boxes and buttons are left out", () => {
    const [f] = parseForms('<form id="a" action="/x" method="POST"><input name="h" type="hidden" value="1&amp;2"><input type="checkbox" name="c1"><input type="checkbox" name="c2" checked><input type="submit" name="s" value="go"><select name="sel"><option value="1">a<option value="2" selected>b</select><textarea name="t">hi</textarea></form>');
    expect(f).toEqual({ id: "a", action: "/x", method: "post", fields: [["h", "1&2"], ["c2", "on"], ["sel", "2"], ["t", "hi"]] });
  });
});

describe("fix round 1, part 2", () => {
  it("1 parseForms is linear: hostile pages parse in under 100 ms; an unclosed element is skipped", () => {
    const timed = (html: string) => { const t0 = performance.now(); const r = parseForms(html); return { ms: performance.now() - t0, r }; };
    const a = timed("<form>".repeat(42_000));                              // 250 KB of unclosed <form>
    const b = timed(`<form>${"<input ".repeat(23_000)}</form>`);            // 23,000 unclosed <input
    const c = timed(`<form ${"a".repeat(63_000)}>x</form>`);                // a 63 KB <form aaaa…>
    for (const x of [a, b, c]) expect(x.ms).toBeLessThan(100);
    expect(a.r).toEqual([]);
    expect(b.r[0].fields).toEqual([]);
    expect(c.r.length).toBe(1);
    // unclosed select / textarea are skipped, the fields around them are kept, in page order
    const [f] = parseForms('<form id="a"><input name="x" value="1"><select name="s"><option value="9"><input name="y" value="2"><textarea name="t">never closed<input name="z" value="3"></form><form id="b"><input name="k" value="v"></form>');
    expect(f.fields).toEqual([["x", "1"], ["y", "2"], ["z", "3"]]);
    expect(parseForms('<FORM ID="q" ACTION="/x"><INPUT NAME="n" VALUE="v"><select name="s"><option>one<option selected>two</select></FORM>')[0])
      .toEqual({ id: "q", action: "/x", method: "get", fields: [["n", "v"], ["s", "two"]] });
  });
  it("2 an answer is read as a stream and stopped at 1 MB → too_big, never more than the cap in memory", async () => {
    expect(PC_PROBE_BODY_MAX).toBe(1024 * 1024);
    let reads = 0; const cancel = vi.fn(async () => {});
    const endless = { getReader: () => ({ read: async () => { reads += 1; return { done: false, value: new Uint8Array(300 * 1024) }; }, cancel }) };
    const f = vi.fn(async () => ({ ...reply({}), body: endless, text: async () => { throw new Error("text() must not be used"); } }));
    const { result } = await run(f, { env: { PC_SERVER_PROBE: "1" } });
    expect(result.phone).toMatchObject({ verdict: "unknown", kind: "too_big" });
    expect(reads).toBe(4); // 300 KB × 4 passes the cap; nothing more is read
    expect(cancel).toHaveBeenCalledTimes(1);
    // a declared length over the cap is refused before any read
    let read2 = 0;
    const g = vi.fn(async () => ({ ...reply({}), headers: { get: (k: string) => (k.toLowerCase() === "content-length" ? String(5 * 1024 * 1024) : null), getSetCookie: () => [] }, body: { getReader: () => ({ read: async () => { read2 += 1; return { done: true, value: undefined }; }, cancel }), cancel } }));
    expect((await run(g, { env: { PC_SERVER_PROBE: "1" } })).result.phone.kind).toBe("too_big");
    expect(read2).toBe(0);
    // a normal streamed page is read whole
    const page = new TextEncoder().encode(cartPage(MARK.sid));
    const h = vi.fn(async (u: string) => (String(u).includes("/cart/easy/")
      ? { ...reply({}), body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: page })), cancel }; } } }
      : reply({ ct: "application/json", body: JSON.stringify({ Status: true }) })));
    expect((await run(h, { env: { PC_SERVER_PROBE: "1" } })).result.phone.verdict).toBe("ok");
  });
  it("3 the settings read has a 10 s limit → config_missing, no request; the time counts in the run", async () => {
    vi.useFakeTimers();
    const s = fullSite();
    const logs: string[] = [];
    const p = runPcServerProbe({ fetchImpl: s.f as unknown as typeof fetch, log: (l: string) => logs.push(l), readSetting: () => new Promise(() => {}), env: ON, session: SESSION as never });
    await vi.advanceTimersByTimeAsync(PC_PROBE_SETTINGS_MS + 20);
    const result = await p;
    expect(PC_PROBE_SETTINGS_MS).toBe(10_000);
    expect(result.phone.kind).toBe("config_missing");
    expect(result.store.kind).toBe("config_missing");
    expect(s.f).not.toHaveBeenCalled();
    expect(result.ms).toBeGreaterThanOrEqual(10_000);
  });
  it("4 nothing chosen by the far side is copied out: content-type only when plain; a refused redirect / action is just 'refused'", async () => {
    const evilCt = "text/html MARKCT <script>";
    const s = fullSite({
      [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage(MARK.sid), ct: evilCt },
      "POST myship.7-11.com.tw/CPF3101/MAP/": { status: 302, location: "https://MARKHOST.example.com/MARKPATH?x=MARKQUERY" },
    });
    const { result, logs } = await run(s.f, { env: ON });
    const all = `${logs.join("\n")}\n${JSON.stringify(result)}`;
    for (const m of ["MARKCT", "MARKHOST", "markhost", "MARKPATH", "MARKQUERY", "example.com", "<script>"]) expect(all.includes(m), m).toBe(false);
    expect(result.phone.steps[0].note).toContain("ct=- ");
    expect(result.store.kind).toBe("refused");
    expect(result.store.steps[2]).toMatchObject({ step: "store.map", http: 0, path: "" });
    const ok = await run(fullSite().f, { env: ON });
    expect(ok.result.phone.steps[1].note).toContain("ct=application/json ");
    // a refused E-Map form action: the word only
    const bad = await run(fullSite({ [`GET myship.7-11.com.tw/eMap/MM1/${GM}`]: { body: mapPage("https://MARKHOST.example.com/ecmap/default.aspx") } }).f, { env: ON });
    expect(`${bad.logs.join("\n")}${JSON.stringify(bad.result)}`).not.toMatch(/MARKHOST|example\.com/i);
  });
  it("5 the cart form is posted only to exactly https://myship.7-11.com.tw/cart/detail → else cart_action_refused, no POST", async () => {
    for (const action of ["/cart/finish", "/cart/detail/x", "/cart/detail?x=1", "https://emap.pcsc.com.tw/ecmap/default.aspx", "https://evil.example.com/cart/detail", "http://myship.7-11.com.tw/cart/detail", "//evil.example.com/cart/detail"]) {
      const s = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage(MARK.sid).replace('action="/cart/detail"', `action="${action}"`) } });
      const { result, logs } = await run(s.f, { env: ON });
      expect(result.store.kind, action).toBe("cart_action_refused");
      expect(s.calls.length, action).toBe(3);
      expect(logs.join("\n")).not.toContain("example.com");
    }
    const same = fullSite({ [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage(MARK.sid).replace('action="/cart/detail"', 'action="https://myship.7-11.com.tw/cart/detail"') } });
    expect((await run(same.f, { env: ON })).result.store.verdict).toBe("full");
  });
  it("6 allowlist edges: anchored paths, no explicit port, exact E-Map host, bounded shop id", () => {
    for (const bad of [
      "https://myship.7-11.com.tw/cart/detail/x", "https://myship.7-11.com.tw/x/cart/detail", "https://myship.7-11.com.tw/CPF3101/MAP/x",
      "https://myship.7-11.com.tw:8443/cart/detail", "https://myship.7-11.com.tw:444/cart/detail", "https://emap.pcsc.com.tw:8080/ecmap/default.aspx",
      "https://evil-emap.pcsc.com.tw/ecmap/default.aspx", "https://emap.pcsc.com.tw.evil.com/ecmap/default.aspx", "https://xemap.unipcsc.com.tw/ecmap/byIDData.aspx",
      "https://emap.pcsc.com.tw/ecmap/x/default.aspx", `https://myship.7-11.com.tw/cart/easy/GM${"1".repeat(40)}`, "https://myship.7-11.com.tw/cart/easy/GM12",
    ]) expect(isAllowedProbeUrl(bad), bad).toBe(false);
  });
  it("6 the redirect hop cap: after 3 hops the run stops (too_many_redirects), no 4th hop", async () => {
    expect(PC_PROBE_MAX_HOPS).toBe(3);
    const s = fullSite({
      "POST myship.7-11.com.tw/CPF3101/MAP/": { status: 302, location: `/eMap/MM1/${GM}` },
      [`GET myship.7-11.com.tw/eMap/MM1/${GM}`]: { status: 302, location: `/eMap/MM1/${GM}` },
    });
    const { result } = await run(s.f, { env: ON });
    expect(result.store.kind).toBe("too_many_redirects");
    expect(s.calls.filter((c) => c.path === `/eMap/MM1/${GM}`).length).toBe(3);
  });
  it("6 every request uses redirect 'manual'; the phone step sends no cookie even when the cookie env is set", async () => {
    const s = fullSite();
    await run(s.f, { env: ON });
    expect(s.calls.length).toBe(8);
    expect(s.calls.every((c) => c.redirect === "manual")).toBe(true);
    for (const c of s.calls.slice(0, 2)) expect(Object.keys(c.headers).map((k) => k.toLowerCase())).not.toContain("cookie");
    expect(s.calls[2].headers.cookie).toContain(MARK.cookie); // the store step does
  });
  it("6 a log function that throws does not stop the run", async () => {
    const s = fullSite();
    const result = await runPcServerProbe({ fetchImpl: s.f as unknown as typeof fetch, now: () => NOON, log: () => { throw new Error("log is broken"); }, readSetting: settings(), env: ON, session: SESSION as never });
    expect(result).toMatchObject({ phone: { verdict: "ok" }, store: { verdict: "full" } });
    expect(s.calls.length).toBe(8);
  });
  it("6 schedulePcProbeBoot sets exactly one timer", () => {
    const timers = vi.fn((_fn: () => void, _ms: number) => ({ unref: () => {} }));
    schedulePcProbeBoot({ run: vi.fn(), enabled: true, setTimeoutImpl: timers as never });
    expect(timers).toHaveBeenCalledTimes(1);
  });
});

describe("fix round 2", () => {
  const MB = 1024 * 1024;
  const rep = (unit: string) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
  const SHAPES: Array<[string, () => string, number]> = [
    ["<form></form> ×N", () => rep("<form></form>"), 80_659],
    ["<form><textarea name=a></form> ×N", () => rep("<form><textarea name=a></form>"), 34_952],
    ["<form><select name=a></select></form> ×N", () => rep("<form><select name=a></select></form>"), 28_339],
    ["<form><input name=a></form> ×N", () => rep("<form><input name=a></form>"), 38_836],
    ["one form, <select name=a><option>x</select> ×N", () => `<form>${rep("<select name=a><option>x</select>")}</form>`, 1],
    ["forms inside comments ×N", () => rep("<!-- <form><input name=a></form> -->"), 29_127],
    ["mixed case ×N", () => rep("<FoRm><InPuT NaMe=a></fOrM>"), 38_836],
    ["250 KB of unclosed <form>", () => "<form>".repeat(41_667) + "x".repeat(MB - 250_002), 0],
    ["23,000 unclosed <input ", () => `<form>${"<input ".repeat(23_000)}${"y".repeat(MB - 161_013)}</form>`, 1],
    ["<form aaaa…>", () => `<form ${"a".repeat(MB - 14)}></form>`, 1],
  ];
  it.each(SHAPES)("1 linear at 1 MB: %s parses in under 300 ms", (_name, build, forms) => {
    const html = build();
    expect(html.length).toBeGreaterThanOrEqual(MB);
    let best = Infinity; let r = parseForms("");
    for (let n = 0; n < 3; n++) { const t0 = performance.now(); r = parseForms(html, { budgetMs: 60_000 }); best = Math.min(best, performance.now() - t0); }
    expect(best).toBeLessThan(300);
    expect(r.length).toBe(forms);
  });
  it("1 the clock guard: past the budget the answer is an empty list marked slow", () => {
    const slow = parseForms('<form id="MyCart"><input name="a" value="1"></form>', { budgetMs: 0 });
    expect(slow).toHaveLength(0);
    expect((slow as unknown as { slow?: boolean }).slow).toBe(true);
    expect((parseForms("<form><input name=a></form>") as unknown as { slow?: boolean }).slow).toBeUndefined();
  });
  it("1 a forced budget (0) stops the store step with parse_too_slow and no request after it", async () => {
    const s = fullSite();
    const logs: string[] = [];
    const result = await runPcServerProbe({
      fetchImpl: s.f as unknown as typeof fetch, now: () => NOON, log: (l: string) => logs.push(l), readSetting: settings(), env: ON, session: SESSION as never, parseBudgetMs: 0,
    });
    expect(result.store).toMatchObject({ verdict: "unknown", kind: "parse_too_slow" });
    expect(s.calls.slice(2).map((c) => `${c.method} ${c.host}${c.path}`)).toEqual([`GET myship.7-11.com.tw/cart/easy/${GM}`]);
    expect(logs.some((l) => l.includes("store.cart") && l.includes("kind=parse_too_slow"))).toBe(true);
  });
  it("2a a disabled control is never sent (input, select, textarea)", () => {
    const [f] = parseForms('<form><input name="a" value="1" disabled><input name="b" value="2"><input name="c" value="3" DISABLED="disabled"><select name="s" disabled><option value="9" selected>x</select><select name="s2"><option value="8">y</select><textarea name="t" disabled>no</textarea><textarea name="t2">yes</textarea><input name="data" data-disabled="1" value="4"></form>');
    expect(f.fields).toEqual([["b", "2"], ["s2", "8"], ["t2", "yes"], ["data", "4"]]);
  });
  it("2b checked / selected / disabled are read outside quoted values only", () => {
    const [f] = parseForms(`<form><input type="checkbox" name="c1" title="not checked"><input type="checkbox" name="c2" title='x' checked><input type="checkbox" name="c3" value="checked"><input type="checkbox" name="c4" checked="checked" value="v"><input name="d1" title="is disabled" value="1"><select name="s"><option value="1" label="not selected">a<option value="2">b</select><select name="s3"><option value="1">a<option value="2" title="x"selected>b</select></form>`);
    expect(f.fields).toEqual([["c2", "on"], ["c4", "v"], ["d1", "1"], ["s", "1"], ["s3", "2"]]);
  });
  it("2c numeric entities are decoded in attribute values, option text and textarea text; letters that change length when lowered do not shift the page", () => {
    const [f] = parseForms('<form action="/x?a=1&#38;b=2"><input name="a" value="1&#38;2&#x26;3&amp;4&#39;"><input name="lit" value="&amp;#38;"><select name="s"><option selected>A&#x26;B</select><textarea name="t">x&#60;y&#x3E;</textarea></form>');
    expect(f.action).toBe("/x?a=1&b=2");
    expect(f.fields).toEqual([["a", "1&2&3&4'"], ["lit", "&#38;"], ["s", "A&B"], ["t", "x<y>"]]);
    expect(parseForms('İİİ<form id="q"><input name="n" value="v"></form>')[0]).toEqual({ id: "q", action: "", method: "get", fields: [["n", "v"]] });
  });
});

describe("cart diagnostics (names and words only)", () => {
  const cartRoute = `GET myship.7-11.com.tw/cart/easy/${GM}`;
  const cartNote = (logs: string[]) => logs.find((l) => l.includes("store.cart")) || "";
  it("a 500 cart page: sent_cookies / cookie_names / set_cookie_names / page, never a cookie value", async () => {
    const s = fullSite({ [cartRoute]: { status: 500, body: "<html>Runtime Error</html>", cookies: [`TS01ab=${MARK.setCookie}; path=/`, `odd name=${MARK.setCookie}x`] } });
    const { result, logs } = await run(s.f, { env: ON });
    const line = cartNote(logs);
    expect(line).toContain("http=500");
    expect(line).toContain("sent_cookies=2");
    expect(line).toContain("cookie_names=auth,other");
    expect(line).toContain("set_cookie_names=TS01ab,?");
    expect(line).toContain("page=server_error");
    expect(line).not.toContain("loc=");
    const all = JSON.stringify(result) + logs.join("\n");
    for (const v of [MARK.cookie, MARK.setCookie]) expect(all).not.toContain(v);
  });
  it("a redirect: loc = the path only (no host, no query); page kind from the body", async () => {
    const s = fullSite({ [cartRoute]: { status: 302, location: `https://myship.7-11.com.tw/Login/Index?return=${MARK.field}`, body: "請登入" } });
    const { logs } = await run(s.f, { env: ON });
    const line = cartNote(logs);
    expect(line).toContain("loc=/Login/Index");
    expect(line).toContain("page=login");
    expect(line).not.toContain(MARK.field);
    expect(line).not.toContain("myship.7-11.com.tw/Login");
  });
  it("a usable logged-in cart page adds no diagnostics", async () => {
    const { logs } = await run(fullSite().f, { env: ON });
    const line = cartNote(logs);
    for (const k of ["sent_cookies=", "cookie_names=", "set_cookie_names=", "page=", "loc="]) expect(line).not.toContain(k);
  });
  it("names: only [A-Za-z0-9_.-], max 15, each cut to 40 characters; odd ones → ?", () => {
    expect(safeCookieNames(["a.b-c_1", "x y", "名", "a=b", ""])).toBe("a.b-c_1,?,?,?,?");
    expect(safeCookieNames(["A".repeat(60)])).toBe("A".repeat(40));
    expect(safeCookieNames(Array.from({ length: 20 }, (_, i) => `n${i}`)).split(",")).toHaveLength(15);
    expect(safeCookieNames([])).toBe("");
  });
  it("page kind: first match wins; else other", () => {
    expect(pageKind("OpenPoint Runtime Error Forbidden")).toBe("login");
    expect(pageKind("系統錯誤 captcha")).toBe("server_error");
    expect(pageKind("Request Rejected")).toBe("blocked");
    expect(pageKind("<html>hello</html>")).toBe("other");
    expect(pageKind(undefined)).toBe("other");
  });
  it("loc path: no host, no query; odd characters → ?", () => {
    expect(safeLocPath("/a/b?x=1#y", "https://myship.7-11.com.tw/")).toBe("/a/b");
    expect(safeLocPath("https://other.example/p/q?z", "https://myship.7-11.com.tw/")).toBe("/p/q");
    expect(safeLocPath("/a b<x>", "https://myship.7-11.com.tw/")).toBe("?");
  });
  it("every probe request uses the Mac Chrome user-agent", async () => {
    const s = fullSite();
    await run(s.f, { env: ON });
    expect(s.calls.length).toBeGreaterThan(3);
    for (const c of s.calls) expect(c.headers["user-agent"]).toBe("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
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
    expect(src).toContain("schedulePcProbeBoot({ run: runPcProbeBoot, enabled: pcProbeEnabled() });");
    expect(src).toContain("const runPcProbeBoot = () => runPcProbe().catch(() => {}).then(() => runPcLoginWalk());");
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
