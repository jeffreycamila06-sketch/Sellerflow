// 7-11 checker login (server/pc711Login.js). ⚠️ Fake fetch only — the pages below are made up from
// the field names the login walk measured from Render. NO real request to 7-11 / OPENPOINT was made.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPc711Login, createPc711Handlers, createPc711Jar, isAllowedPc711Url, sessionKeyFrom, encryptBlob, decryptBlob,
  captchaCandidates, findQuickLogin, pageErrorText, normalizeMobile, pageInfo, smsShownMarker,
  PC711_FLOW_MS, PC711_QUICK_GAP_MS, PC711_QUICK_PER_DAY,
} from "../../../../server/pc711Login.js";

const KEY = "a".repeat(64);
const PW = "MARKPASSq9xz";
const SMS = "987654";
const PHONE = "0912345678";
const VCODE = "48213";
const GM = "GM2609096130694";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(120).fill(7)]);

type Reply = { status?: number; ct?: string; body?: string | Uint8Array; location?: string; cookies?: string[] };
type Call = { method: string; url: string; host: string; path: string; search: string; headers: Record<string, string>; body: string };
const reply = (r: Reply) => {
  const body = r.body ?? "";
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
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
    const c: Call = { method: init.method || "GET", url, host: u.hostname, path: u.pathname, search: u.search, headers: init.headers || {}, body: String(init.body ?? "") };
    calls.push(c);
    const hit = routes[`${c.method} ${u.hostname}${u.pathname}`];
    if (!hit) return reply({ status: 404, body: "nope" });
    return reply(typeof hit === "function" ? hit(c) : hit);
  });
  return { f, calls };
};

const OP = "bu-group.openpoint.com.tw";
const authorizePage = (extra = "") => `<html><head><script src="/cdn/js/lib/checkDevice.js"></script></head><body>
<form id="loginForm" method="post" action="/auth/service/login">
<input type="hidden" name="state" value="st1"><input type="text" name="mobile" value=""><input type="password" name="passwd_d" value="">
<input type="text" name="verifyCode" value=""><input type="checkbox" name="trust_browser" value="1"></form>
<img id="captchaImg" src="">
<script>function refreshCode(){ $('#captchaImg').attr('src','/auth/captcha/image?t=' + Date.now()); } refreshCode();</script>
${extra}<p>快速登入 驗證碼 OTP 簡訊</p></body></html>`;
const smsPage = `<html><form id="smsCodeForm" method="get" action="/auth/service/sms">
<input type="hidden" name="flow" value="f1"><input type="hidden" name="smsCode" value="">
${[0, 1, 2, 3, 4, 5].map(() => '<input type="text" name="smsVerify" value="">').join("")}</form></html>`;
const cartPage = (sid: string) => `<html><form id="MyCart" action="/cart/detail" method="post"><input type="hidden" name="MemberSid" value="${sid}"></form></html>`;

const fullSite = (over: Record<string, Reply | ((c: Call) => Reply)> = {}) => site({
  "GET myship.7-11.com.tw/Member/Login/": { status: 302, location: `https://${OP}/auth/service/authorize?client=x` },
  [`GET ${OP}/auth/service/authorize`]: { body: authorizePage(), cookies: ["opsess=OPS1; path=/; HttpOnly"] },
  [`GET ${OP}/cdn/js/lib/checkDevice.js`]: { ct: "application/javascript", body: "var x=1;" },
  [`GET ${OP}/auth/captcha/image`]: { ct: "image/png", body: PNG },
  [`POST ${OP}/auth/service/login`]: { body: smsPage },
  [`GET ${OP}/auth/service/sms`]: { status: 302, location: "https://myship.7-11.com.tw/Member/Callback?code=abc", cookies: ["optrust=DEVICE1; path=/; Max-Age=31536000"] },
  "GET myship.7-11.com.tw/Member/Callback": { status: 302, location: "/", cookies: ["MemberLogin=LOGGEDIN1; path=/"] },
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
    store: {
      load: async () => row,
      save: async (r: Record<string, unknown>) => { row = { ...r }; saves.push({ ...r }); },
      clear: async () => { row = null; },
    },
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

describe("pc711 login — the admin flow", () => {
  it("start → picture (found in the page's own script) → submit → SMS → connected; secrets never logged / returned / stored", async () => {
    const s = fullSite();
    const m = memStore();
    const { login, logs } = make(s.f, { store: m.store });
    const { st, sub, done } = await connectAll(login);
    expect(st.flowId).toMatch(/^[0-9a-f]{32}$/);
    expect(st.captcha).toMatch(/^data:image\/png;base64,/);
    expect(logs.some((l) => /\[PC711_LOGIN\] captcha http=200 ms=\d+ inline$/.test(l))).toBe(true);
    expect(sub).toEqual({ step: "sms", phoneTail: "678" });
    expect(done).toEqual({ step: "connected" });
    // the login form went exactly as served + the three typed values + trust_browser checked
    const post = s.calls.find((c) => c.method === "POST" && c.path === "/auth/service/login")!;
    expect([...new URLSearchParams(post.body)]).toEqual([["state", "st1"], ["mobile", PHONE], ["passwd_d", PW], ["verifyCode", VCODE], ["trust_browser", "1"]]);
    expect(s.calls.filter((c) => c.body.includes(encodeURIComponent(PW)) || c.body.includes(PW)).length).toBe(1);
    const smsCall = s.calls.find((c) => c.path === "/auth/service/sms")!;
    const q = [...new URLSearchParams(smsCall.search)];
    expect(q.filter(([k]) => k === "smsVerify").map(([, v]) => v).join("")).toBe(SMS);
    expect(q.find(([k]) => k === "smsCode")![1]).toBe(SMS);
    // the status
    const status = login.status();
    expect(status).toMatchObject({ state: "connected", autoLogins: 0, phoneTail: "678" });
    // NEVER: in a log line, an answer, the saved row
    const everything = [logs.join("\n"), JSON.stringify([st, sub, done, status]), JSON.stringify(m.saves)].join("\n");
    for (const secret of [PW, SMS, VCODE, PHONE, "LOGGEDIN1", "DEVICE1", "OPS1"]) expect(everything).not.toContain(secret);
    for (const l of logs) expect(l).toMatch(/^\[PC711_LOGIN\] [a-z_]+ http=\d+ ms=\d+ (?:[A-Za-z0-9_-]+|forms=[A-Za-z0-9_,-]* err=[01] ct=(?:html|json) sms_marker=[01])$/);
    // the saved row = an encrypted blob that decrypts to the cookies (the key never leaves the server)
    const row = m.row as Record<string, unknown>;
    expect(String(row.blob)).toMatch(/^v1\./);
    const blob = decryptBlob(row.blob, sessionKeyFrom({ PC711_SESSION_KEY: KEY }));
    expect(JSON.stringify(blob)).toContain("LOGGEDIN1");
    expect(JSON.stringify(blob)).not.toContain(PW);
  });
  it("a refused host stops the flow before any request to it", async () => {
    const s = fullSite({ "GET myship.7-11.com.tw/Member/Login/": { status: 302, location: "https://evil.example.com/login" } });
    const { login } = make(s.f);
    expect(await login.start()).toEqual({ error: "refused_host" });
    expect(s.calls.some((c) => c.host === "evil.example.com")).toBe(false);
    expect(isAllowedPc711Url("https://myship.7-11.com.tw/cart/finish")).toBe(false);
    expect(isAllowedPc711Url("https://bu-group.openpoint.com.tw/x")).toBe(true);
    expect(isAllowedPc711Url("https://openpoint.com.tw.evil.com/")).toBe(false);
  });
  it("one flow at a time; a flow ends after 10 minutes", async () => {
    let t = Date.UTC(2026, 10, 14, 4);
    const s = fullSite();
    const { login } = make(s.f, { now: () => t });
    const a = await login.start();
    const b = await login.start();
    expect((await login.submit({ flowId: a.flowId, mobile: PHONE, password: PW, verifyCode: VCODE })).message).toBe("flow_expired");
    t += PC711_FLOW_MS + 1;
    expect((await login.submit({ flowId: b.flowId, mobile: PHONE, password: PW, verifyCode: VCODE })).message).toBe("flow_expired");
    expect(s.calls.some((c) => c.method === "POST")).toBe(false); // the password never went anywhere
  });
  it("the page's own error text comes back (≤ 120 chars), never what was typed", async () => {
    const s = fullSite({ [`POST ${OP}/auth/service/login`]: { body: `${authorizePage('<div class="error-msg">驗證碼錯誤，請重新輸入</div>')}` } });
    const { login } = make(s.f);
    const st = await login.start();
    const r = await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    expect(r).toEqual({ step: "error", message: "驗證碼錯誤，請重新輸入" });
    expect(pageErrorText(`<div class="error">wrong ${PW}</div>`, [PW])).toBeNull();
    expect(pageErrorText(`<span class="msg">${"字".repeat(200)}</span>`)!.length).toBe(120);
  });
});

describe("pc711 login — submit decides by the answer, not by #smsCodeForm being present", () => {
  // the measured login page ALWAYS carries #smsCodeForm (and #loginForm), so presence is not a signal
  const bothForms = (extra = "") => `<html><body>
<form id="loginForm" method="post" action="/auth/service/login"><input type="hidden" name="state" value="s"><input type="text" name="mobile" value=""><input type="password" name="passwd_d" value=""><input type="text" name="verifyCode" value=""></form>
<form id="smsCodeForm" method="get" action="/auth/service/sms"><input type="hidden" name="smsCode" value="">${[0, 1, 2, 3, 4, 5].map(() => '<input type="text" name="smsVerify" value="">').join("")}</form>
${extra}</body></html>`;
  const submitWith = async (body: string) => {
    const s = fullSite({ [`POST ${OP}/auth/service/login`]: { body } });
    const { login } = make(s.f);
    const st = await login.start();
    const r = await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    return { r, calls: s.calls };
  };

  it("a wrong code / password page (login + sms forms + error text) → error, NEVER sms", async () => {
    const { r } = await submitWith(bothForms('<div class="error">驗證碼錯誤，請重新輸入</div>'));
    expect(r).toEqual({ step: "error", message: "驗證碼錯誤，請重新輸入" });
  });
  it("both forms, no error, no sent marker → login_failed (not a silent sms step)", async () => {
    const { r } = await submitWith(bothForms());
    expect(r).toEqual({ step: "error", message: "login_failed" });
  });
  it("the SMS step shown (a sent marker, no error) → sms", async () => {
    const { r } = await submitWith(bothForms("<p>簡訊驗證碼已發送至您的手機</p>"));
    expect(r).toEqual({ step: "sms", phoneTail: "678" });
  });
  it("the login form gone → sms (the real success-to-sms page)", async () => {
    const { r } = await submitWith('<html><form id="smsCodeForm" method="get" action="/auth/service/sms"><input name="smsCode" value=""></form></html>');
    expect(r).toEqual({ step: "sms", phoneTail: "678" });
  });
  it("smsShownMarker: sent words / JSON / shown-sms-hidden-login only", () => {
    expect(smsShownMarker(bothForms("<p>簡訊驗證碼已發送</p>"))).toBe(true);
    expect(smsShownMarker(bothForms())).toBe(false);
    expect(smsShownMarker('{"ok":true,"step":"sms"}', "application/json")).toBe(true);
    const hiddenLogin = `<form id="loginForm" style="display:none" action="/x"><input name="passwd_d" value=""></form><form id="smsCodeForm" action="/y"><input name="smsCode" value=""></form>`;
    expect(smsShownMarker(hiddenLogin)).toBe(true);
  });

  it("the password + the 驗證碼 go ONLY to bu-group.openpoint.com.tw: another action host → refused_host, nothing sent", async () => {
    const s = fullSite({ [`GET ${OP}/auth/service/authorize`]: { body: authorizePage().replace('action="/auth/service/login"', 'action="https://myship.7-11.com.tw/evil/login"') } });
    const { login } = make(s.f);
    const st = await login.start();
    const r = await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    expect(r).toEqual({ step: "error", message: "refused_host" });
    expect(s.calls.every((c) => !c.body.includes(PW) && !c.body.includes(encodeURIComponent(PW)))).toBe(true);
    expect(s.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("the SMS code goes ONLY to openpoint: an sms-form action on another host → refused_host", async () => {
    const smsElsewhere = '<html><form id="smsCodeForm" method="get" action="https://myship.7-11.com.tw/evil/sms"><input name="smsCode" value=""></form></html>';
    const s = fullSite({ [`POST ${OP}/auth/service/login`]: { body: smsElsewhere } });
    const { login } = make(s.f);
    const st = await login.start();
    const sub = await login.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
    expect(sub).toEqual({ step: "sms", phoneTail: "678" });
    const before = s.calls.length;
    const r = await login.sms({ flowId: st.flowId, code: SMS });
    expect(r).toEqual({ step: "error", message: "refused_host" });
    expect(s.calls.slice(before).some((c) => c.body.includes(SMS) || c.search.includes(SMS))).toBe(false);
  });
});

describe("pc711 login — key and store", () => {
  it("no PC711_SESSION_KEY → key_missing everywhere, no request, the route answers 503", async () => {
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
    // a Render "Generate" value: any string of ≥ 32 characters is hashed to the 32-byte key; 31 is refused
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
    const first = make(fullSite().f, { store: m.store });
    await connectAll(first.login);
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
  it("the routes never echo a secret, and the limiter answers 429", async () => {
    const { login } = make(fullSite().f);
    const h = createPc711Handlers(login, { allowed: () => true });
    const out: unknown[] = [];
    const res = () => ({ code: 200, status(c: number) { this.code = c; return this; }, json(b: unknown) { out.push(b); return this; } });
    await h.start({ body: {} } as never, res() as never);
    const flowId = (out[0] as { flowId: string }).flowId;
    await h.submit({ body: { flowId, mobile: PHONE, password: PW, verifyCode: VCODE } } as never, res() as never);
    await h.sms({ body: { flowId, code: SMS } } as never, res() as never);
    const text = JSON.stringify(out);
    for (const secret of [PW, SMS, VCODE, PHONE]) expect(text).not.toContain(secret);
    const blocked = createPc711Handlers(login, { statusAllowed: () => false });
    const r = res();
    await blocked.status({} as never, r as never);
    expect(r.code).toBe(429);
  });
  it("status has its OWN limiter: status calls never use up the login budget, and either can 429 alone", async () => {
    const { login } = make(fullSite().f);
    let loginUses = 0, statusUses = 0;
    const h = createPc711Handlers(login, { allowed: () => { loginUses += 1; return true; }, statusAllowed: () => { statusUses += 1; return true; } });
    const res = () => ({ code: 200, status(c: number) { this.code = c; return this; }, json() { return this; } });
    for (let i = 0; i < 5; i++) await h.status({} as never, res() as never);
    expect(statusUses).toBe(5);
    expect(loginUses).toBe(0); // status never touched the login limiter
    // the login routes do NOT use the status limiter
    const h2 = createPc711Handlers(login, { allowed: () => false, statusAllowed: () => { throw new Error("status limiter must not run for login routes"); } });
    const r = res();
    await h2.start({ body: {} } as never, r as never);
    expect(r.code).toBe(429);
  });
});

describe("pc711 login — the one-tap quick re-login", () => {
  const quickPage = authorizePage('<form id="quickLoginForm" method="post" action="/auth/service/quick"><input type="hidden" name="device" value="dev1"></form>');
  it("uses the page's own 快速登入 form (no password typed), counts the success; limits: 1 per 10 min, 6 per day", async () => {
    let t = Date.UTC(2026, 10, 14, 4);
    const m = memStore();
    const s = fullSite({
      [`GET ${OP}/auth/service/authorize`]: { body: quickPage },
      [`POST ${OP}/auth/service/quick`]: { status: 302, location: "https://myship.7-11.com.tw/Member/Callback?code=q" },
    });
    // connect first with the normal flow (the authorize page also has the quick form; it is ignored there)
    const { login } = make(s.f, { store: m.store, now: () => t });
    await connectAll(login);
    const before = s.calls.length;
    const again = await login.quickRelogin();
    expect(again).toMatchObject({ cookies: expect.any(Object) });
    const quick = s.calls.slice(before);
    expect(quick.some((c) => c.method === "POST" && c.path === "/auth/service/quick")).toBe(true);
    expect(quick.some((c) => c.path === "/auth/service/login")).toBe(false);
    for (const c of quick) expect(c.body).not.toContain(PW);
    expect(login.status().autoLogins).toBe(1);
    // within 10 minutes → nothing is sent
    const n = s.calls.length;
    expect(await login.quickRelogin()).toBeNull();
    expect(s.calls.length).toBe(n);
    // 6 tries per Taipei day at most
    for (let i = 0; i < 10; i++) { t += PC711_QUICK_GAP_MS + 1; await login.quickRelogin(); }
    expect(Number((m.row as Record<string, unknown>).quick_day_count)).toBe(PC711_QUICK_PER_DAY);
  });
  it("a page that asks for the password / SMS → needs_login, stop (nothing typed)", async () => {
    const m = memStore();
    const s = fullSite();
    const { login } = make(s.f, { store: m.store });
    await connectAll(login);
    const before = s.calls.length;
    expect(await login.quickRelogin()).toBeNull();
    expect(login.status().state).toBe("needs_login");
    expect(s.calls.slice(before).some((c) => c.method === "POST")).toBe(false);
    expect(await login.getSession()).toBeNull(); // store checks pause
    expect(await login.quickRelogin()).toBeNull();
  });
});

describe("pc711 login — page reading", () => {
  it("the 驗證碼 picture: an <img> that looks like one, else a quoted path in the page's script", () => {
    expect(captchaCandidates('<img id="vcodeImg" src="/auth/vcode.png">', "https://bu-group.openpoint.com.tw/a")[0]).toMatchObject({ source: "img", url: "https://bu-group.openpoint.com.tw/auth/vcode.png" });
    expect(captchaCandidates(authorizePage(), "https://bu-group.openpoint.com.tw/auth/service/authorize")[0]).toMatchObject({ source: "inline", url: "https://bu-group.openpoint.com.tw/auth/captcha/image?t=" });
  });
  it("quick login: a form or link that says 快速登入 / quick and asks no secret — never the login form", () => {
    const f = pageInfo(authorizePage()).forms;
    expect(findQuickLogin(authorizePage(), f, "https://x.openpoint.com.tw/")).toBeNull();
    const link = '<a href="/auth/service/quick?d=1">快速登入</a>';
    expect(findQuickLogin(authorizePage(link), pageInfo(authorizePage(link)).forms, "https://bu-group.openpoint.com.tw/a")).toMatchObject({ kind: "link" });
    const secret = '<form id="quickForm" action="/q" method="post"><input name="passwd_d" value=""></form>';
    expect(findQuickLogin(secret, pageInfo(secret).forms, "https://bu-group.openpoint.com.tw/a")).toBeNull();
  });
  it("phone numbers", () => {
    expect(normalizeMobile("912345678")).toBe(PHONE);
    expect(normalizeMobile("+886 912-345-678")).toBe(PHONE);
    expect(normalizeMobile("12345")).toBe("");
  });
  it("the jar drops an expired cookie", () => {
    const j = createPc711Jar({ h: "a=1; b=2" });
    j.store("h", { getSetCookie: () => ["a=; Max-Age=0"] });
    expect(j.header("h")).toBe("b=2");
  });
});

describe("pc711 login — server.js wiring (additions only)", () => {
  it("six admin routes behind requireAuth + requireAdmin + the 4kb parser + its own limiter; the probe gets the session; the env cookie is gone", () => {
    const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
    for (const [path, routes] of [["login/start", "pc711Routes.start"], ["login/captcha", "pc711Routes.captcha"], ["login/submit", "pc711Routes.submit"], ["login/sms", "pc711Routes.sms"], ["disconnect", "pc711Routes.disconnect"]])
      expect(src).toContain(`app.post("/admin/pc711/${path}", requireAuth, requireAdmin, pc711Json, ${routes});`);
    expect(src).toContain('app.get("/admin/pc711/status", requireAuth, requireAdmin, pc711Routes.status);');
    expect(src).toContain('const pc711Allowed = createWindowLimiter({ max: 20, windowMs: 10 * 60 * 1000 });');
    expect(src).toContain('const pc711StatusAllowed = createWindowLimiter({ max: 120, windowMs: 10 * 60 * 1000 });'); // status: its own limiter
    expect(src).toContain('const pc711Routes = createPc711Handlers(pc711, { allowed: pc711Allowed, statusAllowed: pc711StatusAllowed });');
    expect(src).toContain('const pc711Json = express.json({ limit: "4kb" });');
    expect(src).toContain("const runPcProbe = () => runPcServerProbe({ readSetting, session: { get: pc711.getSession, relogin: pc711.quickRelogin, save: pc711.saveCookies } });");
    expect(src).not.toContain("PC_PROBE_MYSHIP_COOKIE"); // the probe no longer reads the env cookie
    expect(src).toContain('req.path.startsWith("/admin/pc711/")'); // bodies skip the global parser
  });
});