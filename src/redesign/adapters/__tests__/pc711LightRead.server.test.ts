// @vitest-environment node
// The hourly light read of the saved 賣貨便 login (Jeff 2026-11-18, server/pc711Login.js lightRead).
// Since the kept E-Map session, the checks no longer use the saved login between two E-Map opens, so it can
// sit unused for days. ONE GET of the cart page an hour when it was not used, redirects not followed, never
// 01:00–05:00 Taipei. Logged in → the last-used time moves. No answer / an error page → nothing changes.
// Logged out twice in a row (10 minutes apart) → the E-Map open's OWN cart step, once, with the existing
// session object: its one quick re-login (10-minute gap, 6 a day), needs_login + the alert only if that fails.
// ⚠️ Fake fetch only — no real request to 7-11 / OPENPOINT is made.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createPc711Login, lightReadDue, lightStepWord, PC711_ROUTES, PC711_QUICK_GAP_MS,
  PC711_LIGHT_EVERY_MS, PC711_LIGHT_CONFIRM_MS, PC711_LIGHT_OUT_KINDS, PC711_LIGHT_STEP_WORDS, PC711_PASSIVE_EVERY_MS,
} from "../../../../server/pc711Login.js";
import { runPcServerProbe, isMaintWindow } from "../../../../server/pcServerProbe.js";
import { EMAP_KEEPALIVE_STORE } from "../../../../server/pc711Emap.js";

const SERVER = readFileSync("server.js", "utf8");
const LOGIN_SRC = readFileSync("server/pc711Login.js", "utf8");
const PROBE_SRC = readFileSync("server/pcServerProbe.js", "utf8");
const code = (src: string) => src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");

const KEY = "a".repeat(64);
const PW = "MARKPASSq9xz", SMS = "987654", PHONE = "0912345678", VCODE = "48213";
const GM = "GM2609096130694";
const IMG = "R0lGODlhAQABAAAAACwAAAAAAQABAAACAkQBADs=".repeat(3);
const OP = "bu-group.openpoint.com.tw";
const MYSHIP = "myship.7-11.com.tw";
const CART = `/cart/easy/${GM}`;
const MIN = 60_000;

type Reply = { status?: number; ct?: string; body?: string; location?: string; cookies?: string[] } | "timeout" | "network";
type Call = { method: string; url: string; host: string; path: string; headers: Record<string, string>; body: string; redirect: string };
const reply = (r: Exclude<Reply, string>) => {
  const bytes = new TextEncoder().encode(r.body ?? "");
  return {
    status: r.status ?? 200,
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-type" ? r.ct ?? "text/html; charset=utf-8" : k.toLowerCase() === "location" ? r.location ?? null : null),
      getSetCookie: () => r.cookies ?? [],
    },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), // the login module
    text: async () => r.body ?? "",                                                                      // the probe
  };
};
const site = (routes: Record<string, Reply | ((c: Call) => Reply)>) => {
  const calls: Call[] = [];
  const f = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; redirect?: string }) => {
    const u = new URL(url);
    const c: Call = { method: init.method || "GET", url, host: u.hostname, path: u.pathname, headers: init.headers || {}, body: String(init.body ?? ""), redirect: String(init.redirect ?? "") };
    calls.push(c);
    const hit = routes[`${c.method} ${u.hostname}${u.pathname}`];
    const r = !hit ? { status: 404, body: "nope" } : typeof hit === "function" ? hit(c) : hit;
    if (r === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (r === "network") throw new TypeError("fetch failed");
    return reply(r);
  });
  return { f, calls };
};
const authorizePage = () => `<html><head><script>${Object.entries({ oidc_client_id: "CID1", state: "ST1", nonce: "NON1", scope: "openid", maxAge: "0", codeChallenge: "CC1", loginTxId: "TX1", redirectUri: "https://myship.7-11.com.tw/Member/FromUniopen" }).map(([k, v]) => `var ${k} = "${v}";`).join(" ")}</script></head><body>login</body></html>`;
const cartPage = (sid: string) => `<html><form id="MyCart" action="/cart/detail" method="post"><input type="hidden" name="MemberSid" value="${sid}"></form></html>`;
const JSONH = "application/json; charset=utf-8";
// the login cookie the first connect gives; RENEWED is what a quick re-login gives
const loggedInBy = (cookieNeedle: string) => (c: Call): Reply => ({ body: cartPage(String(c.headers.cookie || "").includes(cookieNeedle) ? "SID12345" : "") });
const fullSite = (over: Record<string, Reply | ((c: Call) => Reply)> = {}) => site({
  [`GET ${MYSHIP}/Member/Login/`]: { status: 302, location: `https://${OP}/auth/service/authorize?client=CID1` },
  [`GET ${OP}/auth/service/authorize`]: { body: authorizePage(), cookies: ["opsess=OPS1; path=/"] },
  [`POST ${OP}${PC711_ROUTES.captcha}`]: { ct: JSONH, body: JSON.stringify({ imgInfo: IMG }) },
  [`POST ${OP}${PC711_ROUTES.validate}`]: { ct: JSONH, body: JSON.stringify({ identifier: "AB", isOtpAlnum: false }) },
  [`POST ${OP}${PC711_ROUTES.doLogin}`]: { ct: JSONH, body: JSON.stringify({ redirect: { lgtk: "LGTK1", state: "ST1", redirect_uri: "https://myship.7-11.com.tw/Member/FromUniopen" } }) },
  [`POST ${OP}${PC711_ROUTES.redirect}`]: { status: 302, location: "https://myship.7-11.com.tw/Member/FromUniopen?code=C1" },
  [`GET ${MYSHIP}/Member/FromUniopen`]: { status: 302, location: "/", cookies: ["MemberLogin=LOGGEDIN1; path=/"] },
  [`GET ${MYSHIP}/`]: { body: "<html>home</html>" },
  [`GET ${MYSHIP}${CART}`]: loggedInBy("MemberLogin="),
  ...over,
});
// 7-11 forgot the first login; the page's own quick login gives a new one
const quickRoutes = (ok = true): Record<string, Reply | ((c: Call) => Reply)> => ({
  [`POST ${OP}${PC711_ROUTES.quickCandidates}`]: { ct: JSONH, body: JSON.stringify({ candidates: ok ? [{ id: "cand1" }] : [{ id: "x", type: "passkey" }] }) },
  [`POST ${OP}${PC711_ROUTES.quickSelect}`]: { ct: JSONH, body: JSON.stringify({ redirect: { lgtk: "QLGTK", state: "ST1", redirect_uri: "https://myship.7-11.com.tw/Member/FromUniopen" } }) },
  [`POST ${OP}${PC711_ROUTES.quickHandoff}`]: { status: 302, location: "https://myship.7-11.com.tw/Member/FromUniopen?code=Q1" },
  [`GET ${MYSHIP}/Member/FromUniopen`]: { status: 302, location: "/", cookies: ["MemberLogin=RENEWED; path=/"] },
  [`GET ${MYSHIP}${CART}`]: loggedInBy("MemberLogin=RENEWED"),
});
const memStore = () => {
  const saves: Record<string, unknown>[] = [];
  let row: Record<string, unknown> | null = null;
  return { saves, get row() { return row; }, store: { load: async () => row, save: async (r: Record<string, unknown>) => { row = { ...r }; saves.push({ ...r }); }, clear: async () => { row = null; } } };
};
const readSetting = async (k: string) => (k === "parcel_check_shared_gms" ? JSON.stringify([GM]) : null);
const DAY = Date.UTC(2026, 10, 17, 2, 0);   // 10:00 Taipei
const LOGIN_PATHS = ["/Member/Login/", "/auth/service/authorize", ...Object.values(PC711_ROUTES)];

// A server that was connected at `start` (a login a moment before), running on `routes` from then on.
async function setup(routes: Record<string, Reply | ((c: Call) => Reply)> = {}, o: { start?: number } = {}) {
  let t = o.start ?? DAY;
  const m = memStore();
  const first = createPc711Login({ fetchImpl: fullSite().f as never, now: () => t, log: () => {}, store: m.store, env: { PC711_SESSION_KEY: KEY }, readSetting });
  const st = await first.start();
  await first.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE });
  await first.sms({ flowId: st.flowId, code: SMS });
  const s = fullSite(routes);
  const logs: string[] = [], changes: string[] = [];
  const login = createPc711Login({ fetchImpl: s.f as never, now: () => t, log: (l: string) => logs.push(l), store: m.store, env: { PC711_SESSION_KEY: KEY }, readSetting, onState: (c: string) => { changes.push(c); } });
  await login.load();
  const step = vi.fn(async () => ({ store: { kind: "", steps: [{ step: "store.cart", ok: true }] } }));
  const h = {
    login, s, logs, m, changes, step, at: () => t, set: (x: number) => { t = x; }, advance: (ms: number) => { t += ms; },
    // the server wakes the read once a minute
    wake: async (minutes: number, stepFn: unknown = step) => { const out: unknown[] = []; for (let i = 0; i < minutes; i++) { t += MIN; const r = await login.lightRead(stepFn as never); if (r) out.push(r); } return out; },
    reads: () => s.calls.filter((c) => c.method === "GET" && c.host === MYSHIP && c.path === CART),
    row: () => m.row as Record<string, string | number | null>,
  };
  return h;
}
const iso = (ms: number) => new Date(ms).toISOString();

// ═══ the rule ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("L1 numbers and the rule", () => {
  it("an hour · 10 minutes · logged out = the cart form without a member id, or a redirect to / a page with a login", () => {
    expect(PC711_LIGHT_EVERY_MS).toBe(60 * MIN);
    expect(PC711_LIGHT_CONFIRM_MS).toBe(10 * MIN);
    expect(PC711_LIGHT_OUT_KINDS).toEqual(["logged_out", "login_page"]);
  });
  it("lightReadDue: connected, nothing running, not 01:00–05:00; an hour after the last use AND after the last read; after ONE logged-out answer, 10 minutes after it", () => {
    const base = { nowMs: 100 * MIN, connected: true, busy: false, inMaint: false, lastOkMs: 0, lastReadMs: 0, outs: 0, outAtMs: 0 };
    expect(lightReadDue(base)).toBe(true);
    expect(lightReadDue({ ...base, connected: false })).toBe(false);
    expect(lightReadDue({ ...base, busy: true })).toBe(false);
    expect(lightReadDue({ ...base, inMaint: true })).toBe(false);
    expect(lightReadDue({ ...base, lastOkMs: 41 * MIN })).toBe(false);          // used 59 minutes ago
    expect(lightReadDue({ ...base, lastOkMs: 40 * MIN })).toBe(true);           // used exactly an hour ago
    expect(lightReadDue({ ...base, lastReadMs: 41 * MIN })).toBe(false);        // read 59 minutes ago
    expect(lightReadDue({ ...base, lastOkMs: 10 * MIN, lastReadMs: 41 * MIN })).toBe(false);
    // one logged-out answer: the second read, 10 minutes after it — and not before
    expect(lightReadDue({ ...base, lastReadMs: 91 * MIN, outs: 1, outAtMs: 91 * MIN })).toBe(false);
    expect(lightReadDue({ ...base, lastReadMs: 90 * MIN, outs: 1, outAtMs: 90 * MIN })).toBe(true);
    expect(lightReadDue({ ...base, outs: 1, outAtMs: 90 * MIN, inMaint: true })).toBe(false);
    expect(lightReadDue(null as never)).toBe(false);
  });
  it("01:00–05:00 Taipei is the probe's own window", () => {
    expect(isMaintWindow(Date.UTC(2026, 10, 17, 16, 59))).toBe(false);  // 00:59
    expect(isMaintWindow(Date.UTC(2026, 10, 17, 17, 0))).toBe(true);    // 01:00
    expect(isMaintWindow(Date.UTC(2026, 10, 17, 20, 59))).toBe(true);   // 04:59
    expect(isMaintWindow(Date.UTC(2026, 10, 17, 21, 0))).toBe(false);   // 05:00
  });
});

// ═══ the read ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("L2 ONE GET of the cart page, redirects not followed, only when the login was not used for an hour", () => {
  it("nothing for 59 minutes; at the hour: one GET of the cart page with the saved login, redirect 'manual', nothing else requested", async () => {
    const h = await setup();
    expect(await h.wake(59)).toEqual([]);
    expect(h.s.calls).toEqual([]);
    expect(await h.wake(1)).toEqual([{ kind: "logged_in" }]);
    expect(h.s.calls).toHaveLength(1);
    const c = h.s.calls[0];
    expect([c.method, c.host, c.path, c.redirect, c.body]).toEqual(["GET", MYSHIP, CART, "manual", ""]);
    expect(c.headers.cookie).toContain("MemberLogin=LOGGEDIN1");
    expect(h.step).not.toHaveBeenCalled();
  });
  it("logged in → the last-used time moves to the read; 'since' and the state do not; no alert", async () => {
    const h = await setup();
    const before = { ...h.row() };
    await h.wake(60);
    const after = h.row();
    expect(after.last_ok_at).toBe(iso(DAY + 60 * MIN));
    expect(after.since).toBe(before.since);
    expect(after.state).toBe("connected");
    expect(h.login.status()).toMatchObject({ state: "connected", since: before.since, lastOkAt: iso(DAY + 60 * MIN) });
    expect(h.changes).toEqual([]);
    expect(await h.login.getSession()).toMatchObject({ cookies: { [MYSHIP]: expect.stringContaining("MemberLogin=LOGGEDIN1") } });
  });
  it("a cookie 7-11 renews on that read is kept (as the E-Map open keeps it)", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: () => ({ body: cartPage("SID12345"), cookies: ["Slide=NEWVALUE1; path=/"] }) });
    await h.wake(60);
    expect((await h.login.getSession())!.cookies[MYSHIP]).toContain("Slide=NEWVALUE1");
  });
  it("never more than once an hour: woken every minute for 6 hours → 6 reads, each 60 minutes after the one before", async () => {
    const h = await setup();
    const times: number[] = [];
    h.s.f.mockImplementation((async (_url: string, init: { headers?: Record<string, string> }) => { times.push(h.at()); return reply({ body: cartPage(String(init.headers?.cookie || "").includes("MemberLogin=") ? "SID12345" : "") }); }) as never);
    await h.wake(6 * 60 + 30);
    expect(times.map((x) => (x - DAY) / MIN)).toEqual([60, 120, 180, 240, 300, 360]);
  });
  it("…also when the read gets NO answer every time (timeouts): still one try an hour, and nothing changes", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: "timeout" });
    const before = JSON.stringify(h.row());
    const out = await h.wake(5 * 60 + 30);
    expect(out).toEqual(Array(5).fill({ kind: "error" }));
    expect(h.reads()).toHaveLength(5);
    expect(JSON.stringify(h.row())).toBe(before);          // not one write
    expect(h.m.saves.length).toBeGreaterThan(0);
    expect(h.step).not.toHaveBeenCalled();
    expect(h.changes).toEqual([]);
  });
  it("the login was used 30 minutes ago (an E-Map open saved it) → no read now; the read comes an hour after THAT use", async () => {
    const h = await setup();
    await h.wake(30);
    await h.login.saveCookies({ [MYSHIP]: "MemberLogin=LOGGEDIN1" });     // what the E-Map open does on a logged-in cart
    expect(await h.wake(59)).toEqual([]);                                  // minute 31 … 89
    expect(h.reads()).toHaveLength(0);
    expect(await h.wake(1)).toEqual([{ kind: "logged_in" }]);              // minute 90
  });
  it("a server start is not a reason to read: the first read is an hour after the start, even when the saved login is older", async () => {
    const h = await setup({}, { start: DAY });
    h.set(DAY + 5 * 60 * MIN);                                             // the login was last used 5 hours ago
    const logs: string[] = [];
    const again = createPc711Login({ fetchImpl: h.s.f as never, now: () => h.at(), log: (l: string) => logs.push(l), store: h.m.store, env: { PC711_SESSION_KEY: KEY }, readSetting });
    await again.load();
    for (let i = 0; i < 59; i++) { h.advance(MIN); expect(await again.lightRead(h.step as never)).toBeNull(); }
    expect(h.s.calls).toEqual([]);
    h.advance(MIN);
    expect(await again.lightRead(h.step as never)).toEqual({ kind: "logged_in" });
  });
});

describe("L3 never 01:00–05:00 Taipei", () => {
  it("due at 00:59 → read; due between 01:00 and 04:59 → no read at all; at 05:00 → read", async () => {
    // started 23:59 Taipei: the first read is due at 00:59
    const h = await setup({}, { start: Date.UTC(2026, 10, 17, 15, 59) });
    await h.wake(60);
    expect(h.reads()).toHaveLength(1);
    expect(isMaintWindow(h.at())).toBe(false);
    // the next is due at 01:59 — inside the window: nothing until 05:00
    const times: number[] = [];
    h.s.f.mockImplementation((async () => { times.push(h.at()); return reply({ body: cartPage("SID12345") }); }) as never);
    await h.wake(4 * 60);                                                  // 01:00 … 04:59
    expect(times).toEqual([]);
    await h.wake(1);                                                       // 05:00
    expect(times).toEqual([Date.UTC(2026, 10, 17, 21, 0)]);
  });
  it("the second read of a logged-out answer does not happen at night either; it waits for 05:00", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } }, { start: Date.UTC(2026, 10, 17, 15, 55) });
    await h.wake(60);                                                      // 00:55: logged out (1)
    expect(h.reads()).toHaveLength(1);
    await h.wake(4 * 60 + 4);                                              // … 04:59
    expect(h.reads()).toHaveLength(1);
    expect(h.step).not.toHaveBeenCalled();
    await h.wake(1);                                                       // 05:00: the second read → the step
    expect(h.reads()).toHaveLength(2);
    expect(h.step).toHaveBeenCalledTimes(1);
  });
});

// ═══ logged out ═════════════════════════════════════════════════════════════════════════════════════════════
describe("L4 one logged-out read alone does nothing", () => {
  it("logged out once: no step, no login request, the state stays connected, not one write, no alert", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } });
    const before = JSON.stringify(h.row()), saves = h.m.saves.length;
    expect(await h.wake(60)).toEqual([{ kind: "logged_out", outs: 1 }]);
    expect(h.step).not.toHaveBeenCalled();
    expect(h.s.calls.map((c) => c.path)).toEqual([CART]);
    expect(h.s.calls.some((c) => LOGIN_PATHS.includes(c.path) || c.host === OP)).toBe(false);
    expect(h.login.status().state).toBe("connected");
    expect(JSON.stringify(h.row())).toBe(before);
    expect(h.m.saves.length).toBe(saves);
    expect(h.changes).toEqual([]);
    // and nothing more for the next 9 minutes
    expect(await h.wake(9)).toEqual([]);
    expect(h.reads()).toHaveLength(1);
  });
  it("the second read, 10 minutes later, says logged in → nothing happened: the last-used time moves, the count starts over", async () => {
    let out = true;
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: () => ({ body: cartPage(out ? "" : "SID12345") }) });
    await h.wake(60);
    out = false;
    expect(await h.wake(10)).toEqual([{ kind: "logged_in" }]);
    expect(h.step).not.toHaveBeenCalled();
    expect(h.row().last_ok_at).toBe(iso(DAY + 70 * MIN));
    // a single logged-out answer an hour later is again "one alone"
    out = true;
    expect(await h.wake(60)).toEqual([{ kind: "logged_out", outs: 1 }]);
    expect(h.step).not.toHaveBeenCalled();
  });
  it("the second read gets no answer / an error page → nothing changes and the count starts over (no step on the next single logged-out answer)", async () => {
    for (const second of ["timeout", "network", { status: 500, body: "Server Error" }, { status: 403, body: "Access Denied" }, { body: "<html>maintenance</html>" }] as Reply[]) {
      let n = 0;
      const h = await setup({ [`GET ${MYSHIP}${CART}`]: () => { n += 1; return n === 2 ? second : { body: cartPage("") }; } });
      await h.wake(60);                                    // logged out (1)
      const r = await h.wake(10);                          // no answer
      expect(r).toHaveLength(1);
      expect(PC711_LIGHT_OUT_KINDS).not.toContain((r[0] as { kind: string }).kind);
      expect(h.login.status().state).toBe("connected");
      expect(await h.wake(59)).toEqual([]);                // and no third read before the hour
      expect(await h.wake(1)).toEqual([{ kind: "logged_out", outs: 1 }]); // an hour after the last read: one alone again
      expect(h.step).not.toHaveBeenCalled();
      expect(h.changes).toEqual([]);
    }
  });
  it("an E-Map open used the login (and found it fine) between the two reads → the second read is not needed any more", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } });
    await h.wake(60);
    h.advance(3 * MIN);
    await h.login.saveCookies({ [MYSHIP]: "MemberLogin=LOGGEDIN1" });
    expect(await h.wake(30)).toEqual([]);
    expect(h.reads()).toHaveLength(1);
    expect(h.step).not.toHaveBeenCalled();
  });
});

describe("L5 logged out twice in a row, 10 minutes apart → the existing step runs ONCE", () => {
  it("the read itself still sends nothing but its GET and writes nothing; the step is the caller's", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } });
    const before = JSON.stringify(h.row());
    await h.wake(60);
    expect(await h.wake(10)).toEqual([{ kind: "logged_out", outs: 2, step: "logged_in" }]);
    expect(h.step).toHaveBeenCalledTimes(1);
    expect(h.step.mock.calls[0]).toEqual([]);              // the step gets nothing from the read (no cookie, no page)
    expect(h.s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${CART}`, `GET ${CART}`]);
    expect(JSON.stringify(h.row())).toBe(before);          // the read never marks needs_login itself
    expect(h.login.status().state).toBe("connected");
    expect(h.changes).toEqual([]);
  });
  it("once: woken every minute for the next hour → no second step; the next step needs two NEW logged-out reads", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } });
    await h.wake(70);
    expect(h.step).toHaveBeenCalledTimes(1);
    await h.wake(59);                                      // … minute 129
    expect(h.step).toHaveBeenCalledTimes(1);
    expect(h.reads()).toHaveLength(2);
    await h.wake(1);                                       // minute 130: an hour after the last read → logged out (1)
    expect(h.reads()).toHaveLength(3);
    expect(h.step).toHaveBeenCalledTimes(1);
    await h.wake(10);                                      // minute 140: logged out (2) → the step again
    expect(h.step).toHaveBeenCalledTimes(2);
  });
  it("a redirect to the login counts as logged out — and is NOT followed", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: { status: 302, location: `https://${MYSHIP}/Member/Login/` } });
    expect(await h.wake(60)).toEqual([{ kind: "login_page", outs: 1 }]);
    await h.wake(10);
    expect(h.step).toHaveBeenCalledTimes(1);
    expect(h.s.calls.map((c) => c.path)).toEqual([CART, CART]);
  });
  it("a step that throws, or no step at all, stops nothing", async () => {
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } });
    await h.wake(60);
    expect(await h.wake(10, async () => { throw new Error("x"); })).toEqual([{ kind: "logged_out", outs: 2, step: "threw" }]);
    const h2 = await setup({ [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } });
    await h2.wake(60, undefined);
    expect(await h2.wake(10, null)).toEqual([{ kind: "logged_out", outs: 2, step: "no_step" }]);
    expect(h2.login.status().state).toBe("connected");
  });
});

// ═══ the step = the E-Map open's own cart step, with the existing session object ════════════════════════════
const sessionOf = (login: ReturnType<typeof createPc711Login>) => ({ get: login.getSession, relogin: login.quickRelogin, save: login.saveCookies, lost: login.markLoggedOut });
const realStep = (h: Awaited<ReturnType<typeof setup>>) => () => runPcServerProbe({ fetchImpl: h.s.f as never, now: () => h.at(), log: () => {}, readSetting, gate: false, cartOnly: true,
  session: sessionOf(h.login) as never, target: { kind: "store", storeId: EMAP_KEEPALIVE_STORE } as never });

describe("L6 the whole thing on one fake 7-11: the read, then the REAL cart step with the REAL login module", () => {
  it("7-11 forgot the login, the quick re-login works → connected throughout: no needs_login, no alert; the new login is saved", async () => {
    const h = await setup(quickRoutes(true));
    const since = h.row().since;
    await h.wake(60, realStep(h));
    const out = await h.wake(10, realStep(h));
    expect(out).toEqual([{ kind: "logged_out", outs: 2, step: "relogin_ok" }]);
    expect(h.login.status()).toMatchObject({ state: "connected", since, autoLogins: 1, lastProblem: null });
    expect(h.changes).toEqual([]);
    expect((await h.login.getSession())!.cookies[MYSHIP]).toContain("MemberLogin=RENEWED");
    expect(h.row().last_ok_at).toBe(iso(DAY + 70 * MIN));
    // what was requested: the two reads, the step's cart read, the quick re-login's own requests, the cart again
    const paths = h.s.calls.map((c) => `${c.method} ${c.host}${c.path}`);
    expect(paths.slice(0, 3)).toEqual(Array(3).fill(`GET ${MYSHIP}${CART}`));
    expect(paths).toContain(`POST ${OP}${PC711_ROUTES.quickCandidates}`);
    expect(paths).toContain(`POST ${OP}${PC711_ROUTES.quickSelect}`);
    expect(paths.at(-1)).toBe(`GET ${MYSHIP}${CART}`);
    // nothing of the store chain after the cart page; no password / SMS route
    expect(h.s.calls.some((c) => ["/cart/detail", "/CPF3101/MAP/", "/cart/finish"].includes(c.path) || /byIDData|eMap/i.test(c.path))).toBe(false);
    expect(h.s.calls.some((c) => [PC711_ROUTES.validate, PC711_ROUTES.doLogin, PC711_ROUTES.captcha].includes(c.path))).toBe(false);
    // the next read is an hour later and finds it logged in
    expect(await h.wake(59, realStep(h))).toEqual([]);
    expect(await h.wake(1, realStep(h))).toEqual([{ kind: "logged_in" }]);
  });
  it("the quick re-login fails → needs_login and ONE 'logged out' alert — from the existing step, never from the read", async () => {
    const h = await setup(quickRoutes(false));
    await h.wake(60, realStep(h));
    expect(h.login.status().state).toBe("connected");      // one logged-out read: nothing yet
    expect(h.changes).toEqual([]);
    const out = await h.wake(10, realStep(h));
    expect(out).toEqual([{ kind: "logged_out", outs: 2, step: "relogin_failed" }]);
    expect(h.login.status()).toMatchObject({ state: "needs_login" });
    expect(h.changes).toEqual(["logged_out"]);
    // logged out now: the hourly read stops; the 10-minute read of the logged-out state takes over
    h.s.calls.length = 0;
    expect(await h.wake(3 * 60, realStep(h))).toEqual([]);
    expect(h.s.calls).toEqual([]);
    h.advance(PC711_PASSIVE_EVERY_MS);
    expect(await h.login.passiveCheck()).toMatchObject({ resumed: false });
  });
  it("the quick re-login's own limits hold: tried less than 10 minutes ago → not tried again (no login request), then lost — as on an E-Map open", async () => {
    const h = await setup(quickRoutes(true));
    await h.wake(60, realStep(h));
    h.advance(5 * MIN);
    // an E-Map open's cart step tried the quick re-login 5 minutes before the second read (a blip: no answer)
    h.s.f.mockImplementationOnce((async () => { throw new TypeError("fetch failed"); }) as never);
    expect(await h.login.quickRelogin()).toBeNull();
    expect(h.login.status().state).toBe("connected");
    h.s.calls.length = 0;
    const out = await h.wake(5, realStep(h));
    expect(out).toEqual([{ kind: "logged_out", outs: 2, step: "relogin_failed" }]);
    expect(h.s.calls.some((c) => c.host === OP || LOGIN_PATHS.includes(c.path))).toBe(false); // inside the 10-minute gap: nothing sent
    expect(h.logs.some((l) => l === "[PC711_LOGIN] quick http=0 ms=0 too_soon")).toBe(true);
    expect(h.login.status().state).toBe("needs_login");
    expect(h.changes).toEqual(["logged_out"]);
    expect(PC711_QUICK_GAP_MS).toBe(10 * MIN);
  });
  it("the step finds the cart logged in after all (the two reads were wrong) → nothing changes but the last-used time", async () => {
    let n = 0;
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: () => { n += 1; return { body: cartPage(n <= 2 ? "" : "SID12345") }; } });
    await h.wake(60, realStep(h));
    expect(await h.wake(10, realStep(h))).toEqual([{ kind: "logged_out", outs: 2, step: "logged_in" }]);
    expect(h.login.status()).toMatchObject({ state: "connected", autoLogins: 0 });
    expect(h.s.calls.some((c) => c.host === OP)).toBe(false);
    expect(h.changes).toEqual([]);
  });
  it("the step's cart read gets no answer → no re-login, no lost: connected, and the next read is an hour later", async () => {
    let n = 0;
    const h = await setup({ [`GET ${MYSHIP}${CART}`]: () => { n += 1; return n <= 2 ? { body: cartPage("") } : "timeout"; } });
    await h.wake(60, realStep(h));
    expect(await h.wake(10, realStep(h))).toEqual([{ kind: "logged_out", outs: 2, step: "no_answer" }]);
    expect(h.login.status().state).toBe("connected");
    expect(h.s.calls.some((c) => c.host === OP)).toBe(false);
    expect(h.changes).toEqual([]);
  });
});

// ═══ when it does not run ═══════════════════════════════════════════════════════════════════════════════════
describe("L7 not when there is nothing to read, and never under a login", () => {
  it("not connected / no key / logged out (needs_login) → null, no request", async () => {
    const s = fullSite();
    const noKey = createPc711Login({ fetchImpl: s.f as never, now: () => DAY + 5 * 60 * MIN, log: () => {}, store: memStore().store, env: {}, readSetting });
    expect(await noKey.lightRead()).toBeNull();
    const fresh = createPc711Login({ fetchImpl: s.f as never, now: () => DAY + 5 * 60 * MIN, log: () => {}, store: memStore().store, env: { PC711_SESSION_KEY: KEY }, readSetting });
    expect(await fresh.lightRead()).toBeNull();
    expect(s.calls).toEqual([]);
    const h = await setup();
    await h.login.markLoggedOut("cart_logged_out");
    expect(await h.wake(5 * 60)).toEqual([]);
    expect(h.s.calls).toEqual([]);
  });
  it("not while Jeff's own login is open (the form in Admin)", async () => {
    const h = await setup();
    h.advance(61 * MIN);
    await h.login.start();                                 // the Admin login is open
    h.s.calls.length = 0;
    expect(await h.login.lightRead(h.step as never)).toBeNull();
    expect(h.s.calls).toEqual([]);
  });
  it("the shop setting is missing → no request, one word, the next try an hour later", async () => {
    let t = DAY;
    const m = memStore();
    const first = createPc711Login({ fetchImpl: fullSite().f as never, now: () => t, log: () => {}, store: m.store, env: { PC711_SESSION_KEY: KEY }, readSetting });
    const st = await first.start(); await first.submit({ flowId: st.flowId, mobile: PHONE, password: PW, verifyCode: VCODE }); await first.sms({ flowId: st.flowId, code: SMS });
    const s = fullSite(); const logs: string[] = [];
    const login = createPc711Login({ fetchImpl: s.f as never, now: () => t, log: (l: string) => logs.push(l), store: m.store, env: { PC711_SESSION_KEY: KEY }, readSetting: async () => null });
    await login.load();
    t += 60 * MIN;
    expect(await login.lightRead()).toEqual({ kind: "config_missing" });
    expect(s.calls).toEqual([]);
    t += 30 * MIN;
    expect(await login.lightRead()).toBeNull();
    expect(logs.filter((l) => l.includes(" light "))).toEqual(["[PC711_LOGIN] light http=0 ms=0 config_missing"]);
  });
  it("the login changed while the read was on its way (logged out by an E-Map open) → the answer is dropped", async () => {
    const h = await setup();
    h.s.f.mockImplementationOnce((async () => { await h.login.markLoggedOut("cart_logged_out"); return reply({ body: cartPage("SID12345") }); }) as never);
    expect(await h.wake(60)).toEqual([{ kind: "logged_in", dropped: true }]);
    expect(h.login.status().state).toBe("needs_login");    // a logged-in READ never brings the state back by itself here
  });
  it("two wake-ups at the same moment → one read", async () => {
    const h = await setup();
    h.advance(60 * MIN);
    const [a, b] = await Promise.all([h.login.lightRead(h.step as never), h.login.lightRead(h.step as never)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(h.reads()).toHaveLength(1);
  });
});

// ═══ the probe's cart step alone ════════════════════════════════════════════════════════════════════════════
describe("L8 cartOnly = the store chain's first step and nothing after it", () => {
  const run = async (cart: Reply | ((c: Call) => Reply), sess: Record<string, unknown> = {}) => {
    const s = site({ [`GET ${MYSHIP}${CART}`]: cart });
    const session = { get: vi.fn(async () => ({ cookies: { [MYSHIP]: "auth=1" } })), relogin: vi.fn(async () => null), save: vi.fn(async () => {}), lost: vi.fn(async () => true), ...sess };
    const r = await runPcServerProbe({ fetchImpl: s.f as never, now: () => DAY, log: () => {}, readSetting, gate: false, cartOnly: true, session: session as never, target: { kind: "store", storeId: EMAP_KEEPALIVE_STORE } as never });
    return { r, s, session };
  };
  it("logged in → ONE request (the cart page), the login is saved, no re-login, no lost, nothing after the cart", async () => {
    const { r, s, session } = await run({ body: cartPage("SID12345") });
    expect(s.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${CART}`]);
    expect(session.save).toHaveBeenCalledTimes(1);
    expect(session.relogin).not.toHaveBeenCalled();
    expect(session.lost).not.toHaveBeenCalled();
    expect(r.store.kind).toBe("");
    expect(r.store.steps.map((x: { step: string }) => x.step)).toEqual(["store.cart"]);
    expect(r.store.emap).toBeUndefined();
    expect(lightStepWord(r)).toBe("logged_in");
  });
  it("logged out → the ONE quick re-login; it fails → lost('cart_logged_out'); still nothing after the cart", async () => {
    const { r, s, session } = await run({ body: cartPage("") });
    expect(session.relogin).toHaveBeenCalledTimes(1);
    expect(session.lost).toHaveBeenCalledTimes(1);
    expect(session.lost).toHaveBeenCalledWith("cart_logged_out");
    expect(session.save).not.toHaveBeenCalled();
    expect(s.calls.map((c) => c.path)).toEqual([CART]);
    expect(lightStepWord(r)).toBe("relogin_failed");
  });
  it("logged out → the quick re-login works → the cart again, logged in → saved; no lost", async () => {
    const { r, s, session } = await run((c) => ({ body: cartPage(String(c.headers.cookie).includes("new=1") ? "SID12345" : "") }), { relogin: vi.fn(async () => ({ cookies: { [MYSHIP]: "new=1" } })) });
    expect(s.calls.map((c) => c.path)).toEqual([CART, CART]);
    expect(session.save).toHaveBeenCalledTimes(1);
    expect(session.lost).not.toHaveBeenCalled();
    expect(lightStepWord(r)).toBe("relogin_ok");
  });
  it("no answer (timeout / network) → no re-login, no lost, no save", async () => {
    for (const fail of ["timeout", "network"] as Reply[]) {
      const { r, session } = await run(fail);
      expect(session.relogin).not.toHaveBeenCalled();
      expect(session.lost).not.toHaveBeenCalled();
      expect(session.save).not.toHaveBeenCalled();
      expect(lightStepWord(r)).toBe("no_answer");
    }
  });
  it("the same step as the E-Map open: openOnly on the same pages makes the SAME first request and the same session calls, then goes on; cartOnly stops", async () => {
    const pages = { [`GET ${MYSHIP}${CART}`]: { body: cartPage("") } as Reply };
    const mk = () => ({ get: vi.fn(async () => ({ cookies: { [MYSHIP]: "auth=1" } })), relogin: vi.fn(async () => null), save: vi.fn(async () => {}), lost: vi.fn(async () => true) });
    const a = site(pages), b = site(pages), sa = mk(), sb = mk();
    const args = { now: () => DAY, log: () => {}, readSetting, gate: false, target: { kind: "store", storeId: EMAP_KEEPALIVE_STORE } };
    const ra = await runPcServerProbe({ ...args, fetchImpl: a.f, cartOnly: true, session: sa } as never);
    const rb = await runPcServerProbe({ ...args, fetchImpl: b.f, openOnly: true, session: sb } as never);
    expect(a.calls).toEqual(b.calls);
    for (const k of ["get", "relogin", "save", "lost"] as const) expect(sa[k].mock.calls).toEqual(sb[k].mock.calls);
    expect(ra.store.kind).toBe(rb.store.kind);
    expect(ra.store.steps).toEqual(rb.store.steps);
  });
  it("source: cartOnly adds ONE branch after the cart step — the step itself is not touched", () => {
    const src = code(PROBE_SRC);
    expect(src.split("cartOnly").length - 1).toBe(2);      // the option, and the one branch
    expect(src).toMatch(/else if \(!loggedIn\) stop\("login_not_accepted"\);\n\s+else if \(cartOnly\) \{ \/\* [^*]+ \*\/ \}\n\s+else \{/);
    expect(src).toContain('if (!p1.fail && !(f1 && loggedIn) && session && typeof session.relogin === "function") {');
    expect(src).toContain('if (!p1.fail && f1 && !loggedIn && session && typeof session.lost === "function") await call(() => session.lost("cart_logged_out"));');
  });
  it("lightStepWord: one word from the step's result", () => {
    const st = (kind: string, steps: unknown[]) => ({ store: { kind, steps } });
    const cartOk = { step: "store.cart", ok: true }, cartBad = { step: "store.cart", ok: false }, re = { step: "store.relogin", ok: false };
    expect(lightStepWord(st("", [cartOk]))).toBe("logged_in");
    expect(lightStepWord(st("", [re, cartOk]))).toBe("relogin_ok");
    expect(lightStepWord(st("login_not_accepted", [re, cartBad]))).toBe("relogin_failed");
    expect(lightStepWord(st("cart_form_missing", [re, cartBad]))).toBe("relogin_failed");
    expect(lightStepWord(st("login_not_accepted", [cartBad]))).toBe("logged_out");
    expect(lightStepWord(st("no_session", [{ step: "store.skip", ok: false }]))).toBe("no_session");
    for (const k of ["timeout", "network", "too_big", "config_missing", "error"]) expect(lightStepWord(st(k, [cartBad]))).toBe("no_answer");
    expect(lightStepWord(st("", []))).toBe("no_answer");
    for (const bad of [null, undefined, {}, { store: null }, "x"]) expect(lightStepWord(bad as never)).toBe("no_answer");
    for (const w of ["logged_in", "relogin_ok", "relogin_failed", "logged_out", "no_session", "no_answer"]) expect(PC711_LIGHT_STEP_WORDS).toContain(w);
  });
});

// ═══ no new login code ══════════════════════════════════════════════════════════════════════════════════════
describe("L9 no new login code: the read calls nothing of the login, and quickRelogin is the function it was", () => {
  const src = code(LOGIN_SRC);
  const body = (name: string) => {
    const i = src.indexOf(`async function ${name}(`);
    let depth = 0, j = src.indexOf("{", i);
    for (let k = j; k < src.length; k++) { if (src[k] === "{") depth++; if (src[k] === "}" && --depth === 0) { j = k; break; } }
    return src.slice(i, j + 1);
  };
  it("lightRead never calls quickRelogin / markLoggedOut / persist / the login routes; its only request is the cart page", () => {
    const b = body("lightRead");
    expect(b).not.toMatch(/quickRelogin|markLoggedOut|persist\(|needs_login"\s*[,}]|ajax\(|ajaxJson\(|follow\(|PC711_ROUTES|PC711_LOGIN_URL|OPENPOINT/);
    expect(b.split("await request(").length - 1).toBe(1);
    expect(b).toContain("res = await request(jar, `https://${MYSHIP}/cart/easy/${gm}`);");
    expect(b.split("saveCookies(").length - 1).toBe(1);    // the only write: a logged-in answer
    expect(b).toContain('if (kind === "logged_in") { light.outs = 0; await saveCookies(jar.dump()); return { kind }; }');
  });
  it("the module's one request function never follows a redirect", () => {
    expect(src).toContain('redirect: "manual", signal: ctl.signal });');
  });
  it("quickRelogin is byte-for-byte the function on main (its text, hashed)", async () => {
    const { createHash } = await import("node:crypto");
    const full = (s: string) => { const i = s.indexOf("  async function quickRelogin() {"); const j = s.indexOf("\n  return { load, status,", i); return s.slice(i, j); };
    const fn = full(LOGIN_SRC);
    expect(fn.startsWith("  async function quickRelogin() {")).toBe(true);
    expect(fn.length).toBeGreaterThan(3000);
    // taken from main (31acb431) before this branch touched the file
    expect(createHash("sha256").update(fn).digest("hex")).toBe(QUICK_RELOGIN_SHA256);
  });
});
const QUICK_RELOGIN_SHA256 = "3319a0e7b6a706ad1391e8ed0db6d03fcc475e8118ef1a4cf71198b6af21ae9e";

// ═══ logs + wiring ══════════════════════════════════════════════════════════════════════════════════════════
describe("L10 logs: a word and numbers — no phone, name, store number, cookie, token or guid", () => {
  it("every line of the read and of the step", async () => {
    const h = await setup(quickRoutes(false));
    await h.wake(70, realStep(h));
    const h2 = await setup();
    await h2.wake(60);
    const lines = [...h.logs, ...h2.logs].filter((l) => / light(_step)? /.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l).toMatch(/^\[PC711_LOGIN\] (light http=\d+ ms=\d+ (logged_in|logged_out|login_page|error|blocked|other|config_missing)|light_step http=0 ms=\d+ (logged_in|relogin_ok|relogin_failed|logged_out|no_session|no_answer|no_step|threw))$/);
    const all = [...h.logs, ...h2.logs].join("\n");
    for (const m of ["LOGGEDIN1", "RENEWED", "OPS1", PHONE, GM, PW, SMS, "SID12345", EMAP_KEEPALIVE_STORE]) expect(all).not.toContain(m);
  });
});

describe("L11 server.js: the read is woken once a minute; its step is the E-Map open's cart step with the SAME session object; one at a time with the open", () => {
  it("the timer", () => {
    expect(SERVER).toContain("const pc711LightTimer = setInterval(() => { void pc711.lightRead(pc711CartStep).catch(() => {}); }, 60 * 1000);");
    expect(SERVER).toContain('if (typeof pc711LightTimer.unref === "function") pc711LightTimer.unref();');
    expect(SERVER.split("pc711.lightRead(").length - 1).toBe(1);
  });
  it("the step: the probe's cartOnly, the existing session object, the plain read of the settings, no kept-open connection", () => {
    expect(SERVER).toContain("const pc711CartStep = () => pc711CartLock(() => runPcServerProbe({ readSetting, session: { get: pc711.getSession, relogin: pc711.quickRelogin, save: pc711.saveCookies, lost: pc711.markLoggedOut }, target: { kind: \"store\", storeId: EMAP_KEEPALIVE_STORE }, gate: false, cartOnly: true, log: () => {} }));");
    expect(SERVER.split("cartOnly: true").length - 1).toBe(1);
  });
  it("the E-Map open and the step go through ONE lock (both may run the quick re-login on a logged-out cart)", () => {
    expect(SERVER).toContain("const pc711CartLock = createSerial();");
    const open = SERVER.split("\n").find((l) => l.includes("openOnly: true")) || "";
    expect(open).toContain("open: () => pc711CartLock(() => runPcServerProbe({");
    expect(SERVER.split("pc711CartLock(").length - 1).toBe(2);
  });
  it("the passive read of the logged-out state is untouched", () => {
    expect(SERVER).toContain("const pc711PassiveTimer = setInterval(() => { void pc711.passiveCheck().catch(() => {}); }, 60 * 1000);");
  });
});
