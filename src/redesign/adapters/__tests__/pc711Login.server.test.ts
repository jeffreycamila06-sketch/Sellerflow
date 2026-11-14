// 7-11 checker login (server/pc711Login.js) — the REAL OPENPOINT AJAX flow. ⚠️ Fake fetch only: the
// routes and JSON below are built from the field names read off OPENPOINT's own login scripts; NO real
// request to 7-11 / OPENPOINT was made.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPc711Login, createPc711Handlers, createPc711Jar, isAllowedPc711Url, sessionKeyFrom, encryptBlob, decryptBlob,
  normalizeMobile, readScriptVars, PC711_ROUTES, PC711_FLOW_MS, PC711_QUICK_GAP_MS, PC711_QUICK_PER_DAY,
} from "../../../../server/pc711Login.js";

const KEY = "a".repeat(64);
const PW = "MARKPASSq9xz";
const PWB64 = Buffer.from(PW, "utf8").toString("base64");
const SMS = "987654";
const PHONE = "0912345678";
const VCODE = "48213";
const GM = "GM2609096130694";
const IMG = "R0lGODlhAQABAAAAACwAAAAAAQABAAACAkQBADs=".repeat(3); // a base64-looking string ≥ 50 chars
const OP = "bu-group.openpoint.com.tw";

type Reply = { status?: number; ct?: string; body?: string; location?: string; cookies?: string[] };
type Call = { method: string; url: string; host: string; path: string; headers: Record<string, string>; body: string };
const reply = (r: Reply) => {
  const bytes = new TextEncoder().encode(r.body ?? "");
  return {
    status: r.status ?? 200,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? r.ct ?? "text/html; charset=utf-8" : k.toLowerCase() === "location" ? r.location ?? null : null),
      getSetCookie: () => r.cookies ?? [],
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
};
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

const authorizePage = (vars: Record<string, string> = {}) => {
  const v = { oidc_client_id: "CID1", state: "ST1", nonce: "NON1", scope: "openid", maxAge: "0", codeChallenge: "CC1", loginTxId: "TX1", redirectUri: "https://myship.7-11.com.tw/Member/FromUniopen", ...vars };
  const lines = Object.entries(v).filter(([, val]) => val !== "").map(([k, val]) => `var ${k} = "${val}";`).join(" ");
  return `<html><head><script>${lines}</script></head><body>login</body></html>`;
};
const cartPage = (sid: string) => `<html><form id="MyCart" action="/cart/detail" method="post"><input type="hidden" name="MemberSid" value="${sid}"></form></html>`;
const JSONH = "application/json; charset=utf-8";

// the happy path: myship login → authorize → captcha → validate(sms) → doLogin → OidcRedirect → myship
const fullSite = (over: Record<string, Reply | ((c: Call) => Reply)> = {}) => site({
  "GET myship.7-11.com.tw/Member/Login/": { status: 302, location: `https://${OP}/auth/service/authorize?client=CID1` },
  [`GET ${OP}/auth/service/authorize`]: { body: authorizePage(), cookies: ["opsess=OPS1; path=/"] },
  [`POST ${OP}${PC711_ROUTES.captcha}`]: { ct: JSONH, body: JSON.stringify({ imgInfo: IMG }) },
  [`POST ${OP}${PC711_ROUTES.validate}`]: { ct: JSONH, body: JSON.stringify({ identifier: "AB", isOtpAlnum: false }) },
  [`POST ${OP}${PC711_ROUTES.doLogin}`]: { ct: JSONH, body: JSON.stringify({ redirect: { lgtk: "LGTK1", state: "ST1", redirect_uri: "https://myship.7-11.com.tw/Member/FromUniopen" } }) },
  [`POST ${OP}${PC711_ROUTES.redirect}`]: { status: 302, location: "https://myship.7-11.com.tw/Member/FromUniopen?code=C1" },
  "GET myship.7-11.com.tw/Member/FromUniopen": { status: 302, location: "/", cookies: ["MemberLogin=LOGGEDIN1; path=/"] },
  "GET myship.7-11.com.tw/": { body: "<html>home</html>" },
  [`GET myship.7-11.com.tw/cart/easy/${GM}`]: (c) => ({ body: cartPage(String(c.headers.cookie || "").includes("MemberLogin=") ? "SID12345" : "") }),
  ...over,
});
const memStore = () => {
  const saves: unknown[] = [];
  let row: Record<string, unknown> | null = null;
  return {
    saves,
    get row() { return row; },
    store: { load: async () => row, save: async (r: Record<string, unknown>) => { row = { ...r }; saves.push({ ...r }); }, clear: async () => { row = null; } },
  };
};
const make = (f: unknown, o: { env?: Record<string, string>; now?: () => number; store?: ReturnType<typeof memStore>["store"] | null } = {}) => {
  const logs: string[] = [];
  const login = createPc711Login({
    fetchImpl: f as typeof fetch, now: o.now ?? (() => Date.UTC(2026, 10, 14, 4)), log: (l: string) => logs.push(l),
    store: o.store === undefined ? memStore().store : o.store, env: o.env ?? { PC711_SESSION_KEY: KEY },
    readSetting: async (k: string) => (k === "parcel_check_shared_gms" ? JSON.stringify([GM]) : null),
  });
  return { login, logs };
};
const connectAll = async (login: ReturnType<typeof createPc711Login>) => {
  const st = await login.start();
  const sub = await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
  const done = await login.sms({ flowId: st.flowId, code: SMS });
  return { st, sub, done };
};

describe("pc711 login — the real OPENPOINT AJAX flow", () => {
  it("start → captcha → validate (SMS) → doLogin → OidcRedirect → connected; exact field names; secrets never logged/returned/stored", async () => {
    const s = fullSite();
    const m = memStore();
    const { login, logs } = make(s.f, { store: m.store });
    const { st, sub, done } = await connectAll(login);
    expect(st.flowId).toMatch(/^[0-9a-f]{32}$/);
    expect(st.captcha).toMatch(/^data:image\/gif;base64,/);
    expect(sub).toMatchObject({ step: "sms", phoneTail: "678" });
    expect(done).toEqual({ step: "connected" });
    // every $.ajax call (not the plain OidcRedirect form post) went to OPENPOINT, urlencoded, as ajax
    const AJAX_PATHS = [PC711_ROUTES.captcha, PC711_ROUTES.validate, PC711_ROUTES.doLogin, PC711_ROUTES.resend];
    const ajax = s.calls.filter((c) => c.method === "POST" && c.host === OP && AJAX_PATHS.includes(c.path));
    for (const c of ajax) {
      expect(c.headers["x-requested-with"]).toBe("XMLHttpRequest");
      expect(c.headers["content-type"]).toMatch(/application\/x-www-form-urlencoded/);
      expect(c.headers.accept).toBe("application/json");
    }
    const validate = s.calls.find((c) => c.path === PC711_ROUTES.validate)!;
    expect(validate.host).toBe(OP);
    expect([...new URLSearchParams(validate.body)].sort()).toEqual([["mobile", PHONE], ["mobileCountry", "886"], ["oidc_client_id", "CID1"], ["passwd", PWB64], ["verify", VCODE], ["verifyType", "sms"]].sort());
    const doLogin = s.calls.find((c) => c.path === PC711_ROUTES.doLogin)!;
    const dl = new URLSearchParams(doLogin.body);
    expect(doLogin.host).toBe(OP);
    expect(dl.get("smsCode")).toBe(SMS);
    expect(dl.get("passwd")).toBe(PWB64);
    expect(dl.get("verify")).toBe(VCODE);
    expect(dl.get("state")).toBe("ST1");
    expect(dl.get("nonce")).toBe("NON1");
    expect(dl.get("scope")).toBe("openid");
    expect(dl.get("max_age")).toBe("0");
    expect(dl.get("code_challenge")).toBe("CC1");
    expect(dl.get("trust_browser")).toBe("Y");
    expect(dl.get("login_tx_id")).toBe("TX1");
    // the OidcRedirect form post carried the lgtk, then followed to myship
    const red = s.calls.find((c) => c.path === PC711_ROUTES.redirect)!;
    expect(new URLSearchParams(red.body).get("lgtk")).toBe("LGTK1");
    // connected + password wiped from memory
    expect(login.status()).toMatchObject({ state: "connected", phoneTail: "678" });
    expect(login._flow()).toBeNull();
    // NEVER: in a log line, an answer, the saved row — the raw password / its base64 / the SMS / the picture code / the phone
    const everything = [logs.join("\n"), JSON.stringify([st, sub, done, login.status()]), JSON.stringify(m.saves)].join("\n");
    for (const secret of [PW, PWB64, SMS, VCODE, PHONE, "LOGGEDIN1", "OPS1", "LGTK1"]) expect(everything).not.toContain(secret);
    for (const l of logs) expect(l).toMatch(/^\[PC711_LOGIN\] [a-z_]+ http=\d+ ms=\d+ [^\n]*$/);
    const blob = decryptBlob((m.row as Record<string, unknown>).blob, sessionKeyFrom({ PC711_SESSION_KEY: KEY }));
    expect(JSON.stringify(blob)).toContain("LOGGEDIN1");
    expect(JSON.stringify(blob)).not.toContain(PW);
    expect(JSON.stringify(blob)).not.toContain(PWB64);
  });

  it("a wrong picture code (B111002) → the code's own text + a NEW picture; secrets not kept", async () => {
    const s = fullSite({ [`POST ${OP}${PC711_ROUTES.validate}`]: { status: 400, ct: JSONH, body: JSON.stringify({ codeId: "B111002", codeDescription: "圖形驗證碼錯誤" }) } });
    const { login } = make(s.f);
    const st = await login.start();
    const r = await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    expect(r.step).toBe("error");
    expect(r.message).toBe("圖形驗證碼錯誤");
    expect(r.captcha).toMatch(/^data:image\/gif;base64,/); // a fresh picture came back
    expect(login._flow().pw).toBe(""); // the wrong input is not kept
    expect(login._flow().sms).toBeNull();
  });

  it("735 (too many wrong SMS) → restart at step 1 with a new picture; the flow's password + sms are wiped", async () => {
    const s = fullSite({ [`POST ${OP}${PC711_ROUTES.doLogin}`]: { status: 400, ct: JSONH, body: JSON.stringify({ codeId: "735", codeDescription: "簡訊驗證碼錯誤次數過多" }) } });
    const m = memStore();
    const { login } = make(s.f, { store: m.store });
    const st = await login.start();
    await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    const r = (await login.sms({ flowId: st.flowId, code: SMS })) as { step?: string; message?: string; captcha?: string };
    expect(r.step).toBe("restart");
    expect(r.message).toBe("簡訊驗證碼錯誤次數過多");
    expect(r.captcha).toMatch(/^data:image\/gif;base64,/);
    expect(login._flow().pw).toBe("");
    expect(login._flow().sms).toBeNull();
  });

  it("resend stays on step 2 — mobile + oidc_client_id only, no password, no new picture", async () => {
    let resendHit = 0;
    const s = fullSite({ [`POST ${OP}${PC711_ROUTES.resend}`]: (c) => { resendHit += 1; expect(c.body).not.toContain("passwd"); return { ct: JSONH, body: JSON.stringify({ codeId: "0" }) }; } });
    const { login } = make(s.f);
    const st = await login.start();
    await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    const captchaBefore = s.calls.filter((c) => c.path === PC711_ROUTES.captcha).length;
    const r = await login.resend({ flowId: st.flowId });
    expect(r).toMatchObject({ step: "sms", resent: true });
    expect(resendHit).toBe(1);
    const body = new URLSearchParams(s.calls.find((c) => c.path === PC711_ROUTES.resend)!.body);
    expect(body.get("mobile")).toBe(PHONE);
    expect(body.get("mobileCountry")).toBe("886");
    expect(body.get("oidc_client_id")).toBe("CID1");
    expect(s.calls.filter((c) => c.path === PC711_ROUTES.captcha).length).toBe(captchaBefore); // no new picture
  });

  it("alnum OTP: letters accepted and upper-cased in the doLogin body", async () => {
    const s = fullSite({ [`POST ${OP}${PC711_ROUTES.validate}`]: { ct: JSONH, body: JSON.stringify({ identifier: "", isOtpAlnum: true }) } });
    const { login } = make(s.f);
    const st = await login.start();
    const sub = await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    expect(sub).toMatchObject({ step: "sms", alnum: true });
    const done = await login.sms({ flowId: st.flowId, code: "ab12cd" });
    expect(done).toEqual({ step: "connected" });
    expect(new URLSearchParams(s.calls.find((c) => c.path === PC711_ROUTES.doLogin)!.body).get("smsCode")).toBe("AB12CD");
  });

  it("Back wipes the password + picture code from memory and returns a fresh picture", async () => {
    const s = fullSite();
    const { login } = make(s.f);
    const st = await login.start();
    await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    const r = await login.back({ flowId: st.flowId });
    expect(r.step).toBe("login");
    expect(r.captcha).toMatch(/^data:image\/gif;base64,/);
    expect(login._flow().pw).toBe("");
    expect(login._flow().vc).toBe("");
    expect(login._flow().sms).toBeNull();
  });

  it("a changed login page (a missing inline var) → login_page_changed, the missing name is logged, no captcha call", async () => {
    const s = fullSite({ [`GET ${OP}/auth/service/authorize`]: { body: authorizePage({ state: "" }) } });
    const { login, logs } = make(s.f);
    expect(await login.start()).toEqual({ error: "login_page_changed" });
    expect(logs.some((l) => l.includes("missing=") && l.includes("state"))).toBe(true);
    expect(s.calls.some((c) => c.path === PC711_ROUTES.captcha)).toBe(false);
  });

  it("the picture is the getCaptcha JSON imgInfo as a GIF data URL; ↻ fetches it again", async () => {
    const s = fullSite();
    const { login } = make(s.f);
    const st = await login.start();
    expect(st.captcha).toBe(`data:image/gif;base64,${IMG}`);
    const again = await login.captcha({ flowId: st.flowId });
    expect(again.captcha).toBe(`data:image/gif;base64,${IMG}`);
    expect(s.calls.filter((c) => c.path === PC711_ROUTES.captcha).length).toBe(2);
  });

  it("every password / SMS request goes ONLY to bu-group.openpoint.com.tw", async () => {
    const s = fullSite();
    const { login } = make(s.f);
    await connectAll(login);
    for (const p of [PC711_ROUTES.validate, PC711_ROUTES.doLogin])
      for (const c of s.calls.filter((x) => x.path === p)) expect(c.host).toBe(OP);
  });
});

describe("pc711 login — key, store, routes", () => {
  it("no key → key_missing everywhere, no request, the route answers 503; Render 32-char key accepted, 31 refused", async () => {
    const s = fullSite();
    const { login } = make(s.f, { env: {} });
    expect(login.status().state).toBe("key_missing");
    expect(await login.start()).toEqual({ error: "key_missing" });
    expect(s.calls.length).toBe(0);
    const h = createPc711Handlers(login);
    const res = { code: 200, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await h.start({ body: {} } as never, res as never);
    expect(res.code).toBe(503);
    expect(sessionKeyFrom({ PC711_SESSION_KEY: "short" })).toBeNull();
    expect(sessionKeyFrom({ PC711_SESSION_KEY: Buffer.alloc(32, 1).toString("base64") })).not.toBeNull();
    const k32 = sessionKeyFrom({ PC711_SESSION_KEY: "R".repeat(32) });
    expect(k32).not.toBeNull();
    expect(k32!.length).toBe(32);
    expect(sessionKeyFrom({ PC711_SESSION_KEY: "R".repeat(31) })).toBeNull();
  });
  it("the blob round-trips with the key and fails closed with any other key", () => {
    const k = sessionKeyFrom({ PC711_SESSION_KEY: KEY })!;
    const b = encryptBlob({ cookies: { h: "a=b" } }, k);
    expect(decryptBlob(b, k)).toEqual({ cookies: { h: "a=b" } });
    expect(decryptBlob(b, Buffer.alloc(32, 2))).toBeNull();
  });
  it("loaded at boot: a saved session survives a restart", async () => {
    const m = memStore();
    await connectAll(make(fullSite().f, { store: m.store }).login);
    const second = make(fullSite().f, { store: m.store });
    await second.login.load();
    expect(second.login.status()).toMatchObject({ state: "connected", phoneTail: "678" });
    expect(await second.login.getSession()).toMatchObject({ cookies: { "myship.7-11.com.tw": expect.stringContaining("MemberLogin=") } });
  });
  it("disconnect forgets the session", async () => {
    const m = memStore();
    const { login } = make(fullSite().f, { store: m.store });
    await connectAll(login);
    await login.disconnect();
    expect(login.status().state).toBe("not_connected");
    expect(m.row).toBeNull();
    expect(await login.getSession()).toBeNull();
  });
  it("one flow at a time; a flow ends after 10 minutes; the password never goes out after expiry", async () => {
    let t = Date.UTC(2026, 10, 14, 4);
    const s = fullSite();
    const { login } = make(s.f, { now: () => t });
    const a = await login.start();
    t += PC711_FLOW_MS + 1;
    expect((await login.submit({ flowId: a.flowId, mobile: PHONE, password: PW, verifyCode: VCODE })).message).toBe("flow_expired");
    expect(s.calls.some((c) => c.path === PC711_ROUTES.validate)).toBe(false);
  });
  it("status has its OWN limiter: status never uses the login budget, and either can 429 alone", async () => {
    const { login } = make(fullSite().f);
    let loginUses = 0, statusUses = 0;
    const h = createPc711Handlers(login, { allowed: () => { loginUses += 1; return true; }, statusAllowed: () => { statusUses += 1; return true; } });
    const res = () => ({ code: 200, status(c: number) { this.code = c; return this; }, json() { return this; } });
    for (let i = 0; i < 5; i++) await h.status({} as never, res() as never);
    expect(statusUses).toBe(5);
    expect(loginUses).toBe(0);
    const blocked = createPc711Handlers(login, { statusAllowed: () => false });
    const r = res();
    await blocked.status({} as never, r as never);
    expect(r.code).toBe(429);
  });
});

// the JSON quick-login happy path (authorize → candidates → select → handoff → myship)
const quickSite = (over: Record<string, Reply | ((c: Call) => Reply)> = {}) => fullSite({
  [`POST ${OP}${PC711_ROUTES.quickCandidates}`]: { ct: JSONH, body: JSON.stringify({ candidates: [{ id: "cand1" }] }) },
  [`POST ${OP}${PC711_ROUTES.quickSelect}`]: { ct: JSONH, body: JSON.stringify({ redirect: { lgtk: "QLGTK", state: "ST1", redirect_uri: "https://myship.7-11.com.tw/Member/FromUniopen" } }) },
  [`POST ${OP}${PC711_ROUTES.quickHandoff}`]: { status: 302, location: "https://myship.7-11.com.tw/Member/FromUniopen?code=Q1" },
  ...over,
});

describe("pc711 login — the one-tap quick re-login (JSON, unproven)", () => {
  it("already logged in on myship with saved cookies → ok, no password", async () => {
    const m = memStore();
    const { login } = make(fullSite().f, { store: m.store });
    await connectAll(login);
    // the saved cookies land straight on myship logged in
    const s2 = site({
      "GET myship.7-11.com.tw/Member/Login/": (c) => (String(c.headers.cookie || "").includes("MemberLogin=") ? { status: 302, location: "https://myship.7-11.com.tw/" } : { status: 302, location: `https://${OP}/auth/service/authorize` }),
      "GET myship.7-11.com.tw/": { body: "home" },
      [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cartPage("SID12345") },
    });
    const login2 = createPc711Login({ fetchImpl: s2.f as never, now: () => Date.UTC(2026, 10, 14, 5), log: () => {}, store: m.store, env: { PC711_SESSION_KEY: KEY }, readSetting: async () => JSON.stringify([GM]) });
    await login2.load();
    const again = await login2.quickRelogin();
    expect(again).toMatchObject({ cookies: expect.any(Object) });
    for (const c of s2.calls) expect(c.body).not.toContain(PWB64);
  });
  it("the quick-login candidates ask for a secret (passkey) → needs_login, stop", async () => {
    const m = memStore();
    await connectAll(make(fullSite().f, { store: m.store }).login);
    const s2 = fullSite({ [`POST ${OP}${PC711_ROUTES.quickCandidates}`]: { ct: JSONH, body: JSON.stringify({ candidates: [{ id: "x", type: "passkey" }] }) } });
    const login2 = createPc711Login({ fetchImpl: s2.f as never, now: () => Date.UTC(2026, 10, 14, 5), log: () => {}, store: m.store, env: { PC711_SESSION_KEY: KEY }, readSetting: async () => JSON.stringify([GM]) });
    await login2.load();
    expect(await login2.quickRelogin()).toBeNull();
    expect(login2.status().state).toBe("needs_login");
  });
  it("limits: 1 per 10 minutes, 6 per Taipei day", async () => {
    let t = Date.UTC(2026, 10, 14, 4);
    const m = memStore();
    await connectAll(make(fullSite().f, { store: m.store }).login);
    const login2 = createPc711Login({ fetchImpl: quickSite().f as never, now: () => t, log: () => {}, store: m.store, env: { PC711_SESSION_KEY: KEY }, readSetting: async () => JSON.stringify([GM]) });
    await login2.load();
    expect(await login2.quickRelogin()).toMatchObject({ cookies: expect.any(Object) });
    const n = (m.row as Record<string, unknown>).quick_day_count;
    expect(await login2.quickRelogin()).toBeNull(); // within 10 min
    expect((m.row as Record<string, unknown>).quick_day_count).toBe(n);
    for (let i = 0; i < 10; i++) { t += PC711_QUICK_GAP_MS + 1; await login2.quickRelogin(); }
    expect(Number((m.row as Record<string, unknown>).quick_day_count)).toBe(PC711_QUICK_PER_DAY);
  });
});

describe("pc711 login — page reading + helpers", () => {
  it("readScriptVars reads the inline string values; an empty value is treated as missing", () => {
    const v = readScriptVars(authorizePage({ token: "TK9" }));
    expect(v).toMatchObject({ oidc_client_id: "CID1", state: "ST1", nonce: "NON1", scope: "openid", maxAge: "0", codeChallenge: "CC1", loginTxId: "TX1", token: "TK9" });
    expect(readScriptVars(authorizePage({ state: "" })).state).toBeUndefined();
  });
  it("phone numbers", () => {
    expect(normalizeMobile("912345678")).toBe(PHONE);
    expect(normalizeMobile("+886 912-345-678")).toBe(PHONE);
    expect(normalizeMobile("12345")).toBe("");
  });
  it("hosts: openpoint allowed, /cart/finish and a look-alike refused", () => {
    expect(isAllowedPc711Url("https://bu-group.openpoint.com.tw/auth/service/getCaptcha")).toBe(true);
    expect(isAllowedPc711Url("https://myship.7-11.com.tw/cart/finish")).toBe(false);
    expect(isAllowedPc711Url("https://openpoint.com.tw.evil.com/")).toBe(false);
  });
  it("the jar drops an expired cookie", () => {
    const j = createPc711Jar({ h: "a=1; b=2" });
    j.store("h", { getSetCookie: () => ["a=; Max-Age=0"] });
    expect(j.header("h")).toBe("b=2");
  });
});

describe("pc711 login — server.js wiring (additions only)", () => {
  it("the admin routes (incl. resend + back) behind requireAuth + requireAdmin + the 4kb parser; status has its own limiter; the probe gets the session", () => {
    const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
    for (const [path, routes] of [["login/start", "pc711Routes.start"], ["login/captcha", "pc711Routes.captcha"], ["login/submit", "pc711Routes.submit"], ["login/sms", "pc711Routes.sms"], ["login/resend", "pc711Routes.resend"], ["login/back", "pc711Routes.back"], ["disconnect", "pc711Routes.disconnect"]])
      expect(src).toContain(`app.post("/admin/pc711/${path}", requireAuth, requireAdmin, pc711Json, ${routes});`);
    expect(src).toContain('app.get("/admin/pc711/status", requireAuth, requireAdmin, pc711Routes.status);');
    expect(src).toContain('const pc711StatusAllowed = createWindowLimiter({ max: 120, windowMs: 10 * 60 * 1000 });');
    expect(src).toContain('const pc711Routes = createPc711Handlers(pc711, { allowed: pc711Allowed, statusAllowed: pc711StatusAllowed });');
    expect(src).toContain('const pc711Json = express.json({ limit: "4kb" });');
    expect(src).toContain("const runPcProbe = () => runPcServerProbe({ readSetting, session: { get: pc711.getSession, relogin: pc711.quickRelogin, save: pc711.saveCookies } });");
    expect(src).not.toContain("PC_PROBE_MYSHIP_COOKIE");
    expect(src).toContain('req.path.startsWith("/admin/pc711/")');
  });
});
