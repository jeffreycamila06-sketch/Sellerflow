// @vitest-environment node
// 7-11 server checker — the three speed changes (Jeff 2026-11-18, server/pc711Speed.js + server/pc711Shadow.js)
// and "a lost login stops nothing while the kept E-Map session still answers".
//   A  the connections to the two 7-11 hosts stay open between checks (REAL local connections are counted);
//   B  the three settings are read once a pass;
//   C  the store row is saved after the phone check;
//   D  logged out of 7-11 with a kept E-Map session that answers → the checks go on.
// The REAL shadow job, the REAL kept E-Map session and the REAL probe run on a fake 7-11 and a virtual clock —
// no real request to 7-11 is made. The extension's order, rests, timers and limits are pinned in
// pc711Emap.server.test.ts (unchanged, still green).
import { describe, it, expect, vi, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import net from "node:net";
import {
  createKeepAliveFetch, keepAliveMsFrom, keepAliveLogLine, builtInAgentClass, hostOfRequest, createPassSettings, createSerial,
  PC711_KEEPALIVE_MS, PC711_KEEPALIVE_MIN_MS, PC711_KEEPALIVE_MAX_MS, PC711_KEEPALIVE_ENV, PC711_KEEPALIVE_HOSTS,
} from "../../../../server/pc711Speed.js";
import { createPc711Shadow, SHADOW_ROW_GAP_MS, SHADOW_STORE_BACKOFF_MS, SHADOW_POLL_MS, SHADOW_LIMIT } from "../../../../server/pc711Shadow.js";
import { createPc711Emap, EMAP_KEEPALIVE_STORE, EMAP_MAX_RELOADS, EMAP_RECOVER_MIN_SPAN_MS, EMAP_RELOAD_COOLDOWN_MS } from "../../../../server/pc711Emap.js";
import { runPcServerProbe } from "../../../../server/pcServerProbe.js";
import { MIRROR_SWITCH } from "../../../../server/pc711Evidence.js";

const SERVER = readFileSync("server.js", "utf8");
const SPEED_SRC = readFileSync("server/pc711Speed.js", "utf8");
const SHADOW_SRC = readFileSync("server/pc711Shadow.js", "utf8");
const code = (src: string) => src.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");

type R = Record<string, unknown>;
const NOW = Date.parse("2026-11-17T04:00:00Z"); // 12:00 Taipei
const HOST = "emap.unipcsc.com.tw";
const MYSHIP = "myship.7-11.com.tw";
const PAGE = `https://${HOST}/mobilemap/default.aspx`;
const GM = "GM2609096130694";
// never in a log line
const MARK = { guid: "MARKGUID-1111-2222", cookie: "MARKCOOKIEval", phone: "0912345678", name: "陳小美", sender: "0979000111", token: "MARKTOKEN:9" };
const STORE = "151003";

// ═══ A. the connections stay open between checks ═════════════════════════════════════════════════════════════
describe("A1 numbers and the Render setting", () => {
  it("an unused connection is kept 50 s (Node's own fetch: 4 s); never under 5 s or over 120 s", () => {
    expect(PC711_KEEPALIVE_MS).toBe(50_000);
    expect(PC711_KEEPALIVE_MIN_MS).toBe(5_000);
    expect(PC711_KEEPALIVE_MAX_MS).toBe(120_000);
    expect(PC711_KEEPALIVE_ENV).toBe("PC711_KEEPALIVE_MS");
  });
  it("the two 7-11 hosts of a check: 賣貨便 and E-Map (its two names) — no other host", () => {
    expect(PC711_KEEPALIVE_HOSTS).toEqual(["myship.7-11.com.tw", "emap.unipcsc.com.tw", "emap.pcsc.com.tw"]);
  });
  it("PC711_KEEPALIVE_MS on Render: not set → 50 s · 0 → off · a number → that, held to 5–120 s · anything else → 50 s", () => {
    const of = (v?: string) => keepAliveMsFrom(v === undefined ? {} : { PC711_KEEPALIVE_MS: v });
    expect(of()).toBe(50_000);
    expect(of("")).toBe(50_000);
    expect(of("0")).toBe(0);
    expect(of("30000")).toBe(30_000);
    expect(of("1")).toBe(5_000);
    expect(of("999999")).toBe(120_000);
    for (const bad of ["abc", "-5", "1e4", "50s", " 12 000", "12345678"]) expect(of(bad)).toBe(50_000);
    expect(keepAliveMsFrom(undefined as never)).toBe(50_000);
  });
});

// A local server that speaks plain HTTP/1.1 and counts the connections opened to it. hint = the
// "Keep-Alive: timeout=<s>" a server may send (0 = none, like a server that says nothing).
const servers: net.Server[] = [];
afterAll(() => { for (const s of servers) { try { s.close(); } catch { /* nothing */ } } });
function localServer(hint = 0) {
  let conns = 0; const seen: string[] = [];
  const srv = net.createServer((sock) => {
    conns += 1;
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      while (buf.includes("\r\n\r\n")) {
        const head = buf.slice(0, buf.indexOf("\r\n\r\n"));
        const len = Number((/content-length:\s*(\d+)/i.exec(head) || [])[1] || 0);
        const rest = buf.slice(buf.indexOf("\r\n\r\n") + 4);
        if (rest.length < len) return;
        seen.push(`${head.split("\r\n")[0]}|${rest.slice(0, len)}`);
        buf = rest.slice(len);
        sock.write(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: keep-alive\r\n${hint ? `Keep-Alive: timeout=${hint}\r\n` : ""}\r\nok`);
      }
    });
    sock.on("error", () => {});
  });
  servers.push(srv);
  return new Promise<{ url: string; conns: () => number; seen: string[] }>((res) => srv.listen(0, "127.0.0.1", () => {
    res({ url: `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}/`, conns: () => conns, seen });
  }));
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// two requests, `gap` ms apart, through `f` → how many connections the server saw
const twice = async (f: typeof fetch, s: { url: string; conns: () => number }, gap: number) => {
  expect(await (await f(s.url)).text()).toBe("ok");
  await wait(gap);
  expect(await (await f(s.url, { method: "POST", body: "k=1", headers: { "content-type": "application/x-www-form-urlencoded" } })).text()).toBe("ok");
  return s.conns();
};

describe("A2 REAL connections (a local server, counted): the 4-second limit of Node's own fetch is lifted", () => {
  it("Node's own pool class is found (the same library as its fetch — no extra package)", () => {
    const C = builtInAgentClass();
    expect(typeof C).toBe("function");
    expect(typeof (C as unknown as { prototype: { dispatch: unknown } }).prototype.dispatch).toBe("function");
    // nothing is imported from a package: the module has no import line at all
    expect(code(SPEED_SRC)).not.toMatch(/\bimport\b|\brequire\(/);
  });
  it("6 s between two requests: Node's own fetch opens 2 connections; the kept-open fetch opens 1 (both pools); a server that says 'close after 2 s' wins; a 1 s setting closes", async () => {
    const [plainSrv, anonSrv, sessSrv, hintSrv, shortSrv] = await Promise.all([localServer(), localServer(), localServer(), localServer(2), localServer()]);
    const hosts = ["127.0.0.1"];
    const ka = createKeepAliveFetch({ ms: PC711_KEEPALIVE_MS, hosts, log: () => {} });
    const short = createKeepAliveFetch({ ms: 1000, hosts, log: () => {} });
    expect(ka.on).toBe(true);
    try {
      const [plain, anon, session, hinted, closed] = await Promise.all([
        twice(fetch, plainSrv, 6000),               // as before this branch
        twice(ka.anon as typeof fetch, anonSrv, 6000),
        twice(ka.session as typeof fetch, sessSrv, 6000),
        twice(ka.session as typeof fetch, hintSrv, 6000),  // the far server's own limit is respected
        twice(short.session as typeof fetch, shortSrv, 4000),
      ]);
      expect(plain).toBe(2);
      expect(anon).toBe(1);
      expect(session).toBe(1);
      expect(hinted).toBe(2);
      expect(closed).toBe(2);
      // the SAME requests arrived either way: one GET, one POST with its body — nothing added
      expect(anonSrv.seen).toEqual(plainSrv.seen);
      expect(anonSrv.seen).toEqual(["GET / HTTP/1.1|", "POST / HTTP/1.1|k=1"]);
    } finally { await ka.close(); await short.close(); }
  }, 20_000);
  it("a request without the login never rides a connection that carried a session: anon and session have their own connections", async () => {
    const s = await localServer();
    const ka = createKeepAliveFetch({ ms: PC711_KEEPALIVE_MS, hosts: ["127.0.0.1"], log: () => {} });
    try {
      await (await (ka.anon as typeof fetch)(s.url)).text();
      await (await (ka.session as typeof fetch)(s.url)).text();
      await (await (ka.anon as typeof fetch)(s.url)).text();
      await (await (ka.session as typeof fetch)(s.url)).text();
      expect(s.conns()).toBe(2);
    } finally { await ka.close(); }
  });
});

describe("A3 only the 7-11 hosts, only the connection: the request itself is passed on untouched", () => {
  class FakePool { opts: R; constructor(o: R) { this.opts = o; } dispatch() { return true; } async close() { /* nothing */ } }
  const make = (o: R = {}) => {
    const calls: { url: string; init: R }[] = [];
    const f = vi.fn(async (url: string, init: R) => { calls.push({ url, init }); return { status: 200 }; });
    const ka = createKeepAliveFetch({ fetchImpl: f as never, AgentClass: FakePool as never, log: () => {}, ...o });
    return { ka, calls };
  };
  it("a 7-11 host gets the pool; any other host goes through the plain fetch; the init is the caller's own", async () => {
    const { ka, calls } = make();
    const ctl = new AbortController();
    const init = { method: "POST", headers: { "user-agent": "UA", cookie: "a=b" }, body: "k=1", redirect: "manual", signal: ctl.signal };
    for (const h of PC711_KEEPALIVE_HOSTS) await ka.session(`https://${h}/x`, init as never);
    await ka.session("https://bu-group.openpoint.com.tw/auth/service/authorize", init as never);
    await ka.anon("https://example.com/", init as never);
    expect(calls.map((c) => Boolean(c.init.dispatcher))).toEqual([true, true, true, false, false]);
    for (const c of calls) {
      const { dispatcher: _d, ...rest } = c.init;
      expect(rest).toEqual(init);                  // method, headers, body, redirect, signal: untouched
    }
    expect(init).not.toHaveProperty("dispatcher"); // the caller's object is not changed
    // the pool is built with the idle time only
    const pool = calls[0].init.dispatcher as FakePool;
    expect(pool.opts).toEqual({ keepAliveTimeout: 50_000, keepAliveMaxTimeout: 120_000 });
    // anon and session: two pools
    await ka.anon(`https://${MYSHIP}/cart/easy/${GM}`, {} as never);
    expect(calls.at(-1)!.init.dispatcher).not.toBe(pool);
    expect(calls.at(-1)!.init.dispatcher).toBeInstanceOf(FakePool);
  });
  it("hostOfRequest reads a string, a URL and a Request-like; a bad value → '' (no pool)", () => {
    expect(hostOfRequest("https://MYSHIP.7-11.com.tw/a")).toBe("myship.7-11.com.tw");
    expect(hostOfRequest(new URL("https://emap.pcsc.com.tw/ecmap/byIDData.aspx"))).toBe("emap.pcsc.com.tw");
    expect(hostOfRequest({ url: "https://emap.unipcsc.com.tw/x" })).toBe("emap.unipcsc.com.tw");
    for (const bad of ["", "nope", null, undefined, 5]) expect(hostOfRequest(bad as never)).toBe("");
  });
  it("off: the setting 0, no pool class, or a pool that cannot be built → the plain fetch, exactly as before", async () => {
    class Throws { constructor() { throw new Error("no"); } }
    class NoDispatch { constructor(_o: R) { /* nothing */ } }
    const cases: [R, string][] = [[{ ms: 0 }, "off by_setting"], [{ AgentClass: null }, "off no_pool"], [{ AgentClass: Throws }, "off pool_failed"], [{ AgentClass: NoDispatch }, "off pool_failed"]];
    for (const [o, word] of cases) {
      const { ka, calls } = make(o);
      expect(ka.on).toBe(false);
      expect(ka.word).toBe(word);
      await ka.anon(`https://${MYSHIP}/a`, { method: "GET" } as never);
      await ka.session(`https://${HOST}/b`, { method: "GET" } as never);
      expect(calls.map((c) => c.init)).toEqual([{ method: "GET" }, { method: "GET" }]);
      expect(keepAliveLogLine(ka)).toBe(`[PC711_KEEPALIVE] ${word}`);
      await ka.close();
    }
    expect(builtInAgentClass({} as never)).toBeNull();
    expect(builtInAgentClass({ get Response() { throw new Error("x"); } } as never)).toBeNull();
    expect(builtInAgentClass({ [Symbol.for("undici.globalDispatcher.1")]: { constructor: class { /* no dispatch */ } } } as never)).toBeNull();
  });
  it("the start line: a word and a number", () => {
    expect(keepAliveLogLine(make().ka)).toBe("[PC711_KEEPALIVE] on idle=50s");
    expect(keepAliveLogLine(make({ ms: 30_000 }).ka)).toBe("[PC711_KEEPALIVE] on idle=30s");
    expect(keepAliveLogLine(null as never)).toBe("[PC711_KEEPALIVE] off");
  });
});

// the fake 賣貨便 of a phone check: the token page, then the check
const phoneSite = () => {
  const calls: { method: string; url: string; headers: R; body: string; dispatcher: boolean }[] = [];
  const f = vi.fn(async (url: string, init: { method?: string; headers?: R; body?: string; dispatcher?: unknown }) => {
    calls.push({ method: init.method || "GET", url, headers: init.headers || {}, body: String(init.body ?? ""), dispatcher: Boolean(init.dispatcher) });
    if (url.includes("/cart/easy/")) return { status: 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, text: async () => `<script>var tokenID = '${MARK.token}';</script>` };
    return { status: 200, ok: true, headers: { get: (k: string) => (k === "content-type" ? "application/json" : null), getSetCookie: () => [] }, text: async () => JSON.stringify({ Status: true }) };
  });
  return { f, calls };
};
const SETTINGS: Record<string, string> = { parcel_check_shared_gms: JSON.stringify([GM]), parcel_check_sender_phone: MARK.sender, parcel_check_probe_buyer: "0919000222" };

describe("A4 a phone check through the kept-open fetch = the SAME requests (no new request, nothing changed in one)", () => {
  it("the probe's phone check: same URLs, methods, headers and bodies with the kept-open fetch as with the plain one", async () => {
    class FakePool { constructor(_o: R) { /* nothing */ } dispatch() { return true; } async close() { /* nothing */ } }
    const run = async (kept: boolean) => {
      const s = phoneSite();
      const ka = createKeepAliveFetch({ fetchImpl: s.f as never, AgentClass: FakePool as never, ms: kept ? PC711_KEEPALIVE_MS : 0, log: () => {} });
      const r = await runPcServerProbe({ fetchImpl: ka.anon as never, now: () => NOW, log: () => {}, readSetting: async (k: string) => SETTINGS[k] ?? null, gate: false,
        target: { kind: "phone", phone: MARK.phone, name: MARK.name, storeId: STORE } as never });
      return { verdict: r.phone.verdict, calls: s.calls };
    };
    const before = await run(false), after = await run(true);
    expect(after.verdict).toBe("ok");
    expect(after.calls.map(({ dispatcher: _d, ...c }) => c)).toEqual(before.calls.map(({ dispatcher: _d, ...c }) => c));
    expect(after.calls).toHaveLength(2);                                     // the token page + the check: no extra request
    expect(after.calls.map((c) => c.dispatcher)).toEqual([true, true]);
    expect(before.calls.map((c) => c.dispatcher)).toEqual([false, false]);
    for (const c of after.calls) expect(c.headers).not.toHaveProperty("cookie"); // still sent without the login
  });
});

describe("A5 server.js: which request rides which connection", () => {
  it("the pools are built once, from the Render setting; one start line", () => {
    expect(SERVER).toContain("const pc711Net = createKeepAliveFetch({ ms: keepAliveMsFrom(process.env) });");
    expect(SERVER).toContain("console.log(keepAliveLogLine(pc711Net));");
    expect(SERVER.split("createKeepAliveFetch(").length - 1).toBe(1);
  });
  it("the phone check → anon; the E-Map open and the kept E-Map session → session; the backup's phone check → anon", () => {
    expect(SERVER).toContain('fetchImpl: input && input.kind === "phone" ? pc711Net.anon : pc711Net.session, session: { get: pc711.getSession');
    const open = SERVER.split("\n").find((l) => l.includes("openOnly: true")) || "";
    expect(open).toContain("fetchImpl: pc711Net.session");
    expect(SERVER).toMatch(/gate: false, openOnly: true, log: \(\) => \{\} \}\)\),\n\s+fetchImpl: pc711Net\.session,\n\s+\}\);/); // createPc711Emap's own requests
    const backupPhone = SERVER.split("\n").find((l) => l.includes('target: { kind: "phone", ...input }')) || "";
    expect(backupPhone).toContain("fetchImpl: pc711Net.anon");
    expect(SERVER.split("pc711Net.anon").length - 1).toBe(2);
    expect(SERVER.split("pc711Net.session").length - 1).toBe(3);
  });
  it("NOT on the kept-open connections: the 7-11 login module, the test probe and the light read's step (their lines have no fetchImpl)", () => {
    expect(SERVER).toContain("const pc711 = createPc711Login({ store: createPc711Store(serviceSb), readSetting, env: process.env, onState: (change) => adminAlert.fire(change) });");
    expect(SERVER).toContain("const runPcProbe = () => runPcServerProbe({ readSetting, session: { get: pc711.getSession, relogin: pc711.quickRelogin, save: pc711.saveCookies, lost: pc711.markLoggedOut } });");
    const step = SERVER.split("\n").find((l) => l.includes("cartOnly: true")) || "";
    expect(step).not.toContain("fetchImpl");
  });
});

// ═══ the job on a fake 7-11 (pc711Emap.server.test.ts's harness + the saves as events) ═══════════════════════
type Reply = { status?: number; body?: string; location?: string } | "timeout" | "network";
const ago = (min: number, from = NOW) => new Date(from - min * 60_000).toISOString();
let seq = 0;
const sid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
const pend = (kind: string, o: R = {}): R => ({
  scan_id: sid(), kind, ext: kind === "phone" ? "ok" : "open", at: ago(2), store_id: STORE, phone: kind === "phone" ? MARK.phone : null,
  customer_name: kind === "phone" ? MARK.name : null, input: kind === "phone" ? MARK.phone : STORE, seller_id: "s1", created_at: ago(3), msg: null, until: null,
  cache_at: null, source: "fresh", prev_input: null, prev_ext_at: null, round: 1, ...o,
});
const parcel = (o: R = {}) => { const s = sid(); return [pend("store", { scan_id: s, ...o }), pend("phone", { scan_id: s, ...o })]; };
const OPENED = () => ({ store: { emap: { cookies: { [HOST]: `ASP.NET_SessionId=${MARK.cookie}` }, guid: MARK.guid, pageUrl: PAGE }, kind: "",
  steps: [{ step: "store.cart", http: 200 }, { step: "store.detail", http: 200 }, { step: "store.map", http: 200 }, { step: "store.emap", http: 200 }] } });
const SAVE_MS = 250; // every database save takes this long on the virtual clock

function harness(o: { queue?: R[]; mqueue?: R[]; mirror?: boolean; byid?: (store: string) => Reply; phone?: (i: R) => R; status?: () => R; open?: () => unknown;
  check?: (i: R, t: () => number) => Promise<R>; passStart?: () => void; evFail?: (r: R) => boolean; backup?: { tick: () => Promise<R> } } = {}) {
  let t = NOW;
  const logs: string[] = [], evRows: R[] = [], oldRows: R[] = [], events: string[] = [], phoneInputs: R[] = [];
  const settings: Record<string, string> = { pc711_shadow_enabled: "true", [MIRROR_SWITCH]: o.mirror ? "true" : "false" };
  const queue = o.queue ?? [], mqueue = o.mqueue ?? [];
  const written = (r: R) => evRows.some((x) => x.scan_id === r.scan_id && x.kind === r.kind);
  const f = vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    const u = new URL(url);
    t += 600;
    let rep: Reply;
    if (u.pathname.endsWith("/byIDData.aspx")) {
      const k = new URLSearchParams(String(init.body ?? "")).get("k") || "";
      events.push(k === EMAP_KEEPALIVE_STORE ? "byid:keepalive" : "byid:parcel");
      rep = o.byid ? o.byid(k) : { body: "OK;123456+店+addr+enable+0++門市" };
    } else { events.push("reload"); rep = { body: "<html>no guid here</html>" }; }
    if (rep === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (rep === "network") throw new TypeError("fetch failed");
    const r = rep;
    return { status: r.status ?? 200, ok: (r.status ?? 200) < 300, headers: { get: (k: string) => (k.toLowerCase() === "location" ? r.location ?? null : null), getSetCookie: () => [] }, text: async () => r.body ?? "" };
  });
  const opens = vi.fn(async () => { events.push("open"); t += 3200; return o.open ? o.open() : OPENED(); });
  const emap = createPc711Emap({ open: opens, fetchImpl: f as unknown as typeof fetch, now: () => t, log: (l: string) => logs.push(l), random: () => 0.5 });
  const stopMirror = vi.fn(async (..._a: unknown[]) => true);
  const ev = {
    pass: vi.fn(async (_s: string, _l: number, _rl: number, mirrorAllowed: boolean) => {
      events.push("read");
      const w = queue.filter((r) => !written(r));
      const mirror = settings[MIRROR_SWITCH] === "true";
      const mw = mqueue.filter((r) => !written(r));
      return { shadow: true, waiting: w.length, jobs: w, mirror, reasks: [], awaiting: [], mirrorQueue: mirror && mirrorAllowed ? { waiting: mw.length, jobs: mw } : null, health: null };
    }),
    insert: vi.fn(async (r: R) => {
      events.push(`save:evidence:${r.kind}`); t += SAVE_MS;
      if (o.evFail && o.evFail(r)) throw new Error("db");
      evRows.push({ ...r, id: evRows.length + 1 });
    }),
    update: vi.fn(async () => {}), stopMirror, parcelForReask: vi.fn(async () => null),
  };
  const db = { pending: vi.fn(), dayMax: vi.fn(async () => ({})), saveDayMax: vi.fn(async () => {}), purgeBefore: vi.fn(async () => {}),
    insert: vi.fn(async (r: R) => { events.push(`save:compare:${r.fail_reason === "paused_http" ? "pause" : r.kind}`); t += SAVE_MS; oldRows.push({ ...r }); }) };
  const check = vi.fn(async (i: R) => {
    phoneInputs.push(i); events.push("phone");
    if (o.check) return o.check(i, () => t);
    t += 900;
    return o.phone ? o.phone(i) : { verdict: "ok", http: 200, ms: 900, kind: "", raw: "Status:true", steps: [{ step: "phone.token", http: 200, ms: 100, ok: true, note: "" }, { step: "phone.validate", http: 200, ms: 800, ok: true, note: "" }] };
  });
  const job = createPc711Shadow({ db, evidence: ev, check, pc711: { status: () => (o.status ? o.status() : { state: "connected", since: "c1" }) }, readSetting: async (k: string) => settings[k] ?? null,
    emap, passStart: o.passStart, backup: o.backup as never, now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { events.push(`sleep:${ms}`); t += ms; } });
  return { job, emap, opens, check, logs, evRows, oldRows, events, phoneInputs, settings, stopMirror, queue, mqueue, at: () => t, advance: (ms: number) => { t += ms; }, clear: () => { events.length = 0; } };
}
type H = ReturnType<typeof harness>;
const noReads = (events: string[]) => events.filter((e) => e !== "read");
// The job opens its E-Map session at the END of its first pass (as the extension needs its tab first). ready():
// that first pass, then the parcels arrive for the next one.
const ready = async (h: H, rows: R[] = [], mrows: R[] = []) => {
  await h.job.tick();
  expect(h.emap.usable()).toBe(true);
  h.queue.push(...rows); h.mqueue.push(...mrows); h.clear(); h.advance(SHADOW_POLL_MS);
  return h;
};

// ═══ B. the three settings are read once a pass ═══════════════════════════════════════════════════════════════
describe("B1 createPassSettings", () => {
  it("a key is read once a pass; reset() starts the next pass; a missing setting (null) is an answer too", async () => {
    const reads: string[] = [];
    const ps = createPassSettings(async (k: string) => { reads.push(k); return k === "none" ? null : `v:${k}`; });
    expect(await ps.read("a")).toBe("v:a");
    expect(await ps.read("a")).toBe("v:a");
    expect(await ps.read("b")).toBe("v:b");
    expect(await ps.read("none")).toBeNull();
    expect(await ps.read("none")).toBeNull();
    expect(reads).toEqual(["a", "b", "none"]);
    expect(ps.size()).toBe(3);
    ps.reset();
    expect(ps.size()).toBe(0);
    expect(await ps.read("a")).toBe("v:a");
    expect(reads).toEqual(["a", "b", "none", "a"]);
  });
  it("two reads at the same moment share one read; a read that fails is NOT kept — the next one reads again", async () => {
    let n = 0, fail = true;
    const ps = createPassSettings(async () => { n += 1; if (fail) throw new Error("db"); return "ok"; });
    const [a, b] = await Promise.allSettled([ps.read("k"), ps.read("k")]);
    expect([a.status, b.status]).toEqual(["rejected", "rejected"]);
    expect(n).toBe(1);
    expect(ps.size()).toBe(0);
    fail = false;
    expect(await ps.read("k")).toBe("ok");
    expect(await ps.read("k")).toBe("ok");
    expect(n).toBe(2);
  });
  it("a slow read of the LAST pass can never fill the new pass", async () => {
    let release: (v: string) => void = () => {};
    let n = 0;
    const ps = createPassSettings(() => { n += 1; return n === 1 ? new Promise<string>((r) => { release = r; }) : Promise.resolve("new"); });
    const old = ps.read("k");
    ps.reset();
    expect(await ps.read("k")).toBe("new");
    release("old");
    expect(await old).toBe("old");
    expect(await ps.read("k")).toBe("new");
    expect(n).toBe(2);
  });
});

describe("B2 a pass with three parcels: each of the three settings is read ONCE (before: before every phone check)", () => {
  const run = async (once: boolean) => {
    const reads: string[] = [];
    const readSetting = async (k: string) => { reads.push(k); return SETTINGS[k] ?? null; };
    const ps = createPassSettings(readSetting);
    const site = phoneSite();
    const h = harness({
      queue: [...parcel(), ...parcel(), ...parcel()],
      passStart: once ? ps.reset : undefined,
      check: async (i, t) => {
        const r = await runPcServerProbe({ fetchImpl: site.f as never, now: t, log: () => {}, readSetting: once ? ps.read : readSetting, gate: false, target: i as never });
        return { verdict: r.phone.verdict, http: 200, ms: 1, kind: r.phone.kind, raw: r.phone.raw, steps: r.phone.steps };
      },
    });
    await h.job.tick();
    const first = [...reads];
    h.advance(SHADOW_POLL_MS);
    await h.job.tick();                       // the store halves' pass: no phone check → nothing read
    return { h, reads, first, site };
  };
  it("once a pass", async () => {
    const { h, first, site, reads } = await run(true);
    expect(h.evRows.filter((r) => r.kind === "phone").map((r) => r.srv_verdict)).toEqual(["ok", "ok", "ok"]);
    expect(first.sort()).toEqual(["parcel_check_probe_buyer", "parcel_check_sender_phone", "parcel_check_shared_gms"]);
    expect(reads).toHaveLength(3);
    // the checks themselves used the shop and the sender of the settings — same requests as before
    expect(site.calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual(Array(3).fill(`https://${MYSHIP}/cart/easy/${GM}`));
    expect(site.calls.filter((c) => c.method === "POST")).toHaveLength(3);
    for (const c of site.calls.filter((x) => x.method === "POST")) expect(new URLSearchParams(c.body).get("ordMobile")).toBe(MARK.sender);
  });
  it("control — without it: nine reads for the same pass (the old cost)", async () => {
    const { first } = await run(false);
    expect(first).toHaveLength(9);
  });
  it("the NEXT pass reads again (a changed setting is picked up one pass later at most)", async () => {
    const reads: string[] = [];
    const cur = { ...SETTINGS };
    const ps = createPassSettings(async (k: string) => { reads.push(k); return cur[k] ?? null; });
    const site = phoneSite();
    const queue = [...parcel()];
    const h = harness({ queue, passStart: ps.reset, check: async (i, t) => {
      const r = await runPcServerProbe({ fetchImpl: site.f as never, now: t, log: () => {}, readSetting: ps.read, gate: false, target: i as never });
      return { verdict: r.phone.verdict, http: 200, ms: 1, kind: r.phone.kind, raw: r.phone.raw, steps: r.phone.steps };
    } });
    await h.job.tick();
    cur.parcel_check_sender_phone = "0979000999";
    queue.push(...parcel());
    await h.job.tick();
    expect(reads).toHaveLength(6);
    const posts = site.calls.filter((c) => c.method === "POST").map((c) => new URLSearchParams(c.body).get("ordMobile"));
    expect(posts).toEqual([MARK.sender, "0979000999"]);
  });
  it("a settings read that fails costs that ONE check (as before), not the whole pass", async () => {
    let n = 0;
    const ps = createPassSettings(async (k: string) => { n += 1; if (n <= 3) throw new Error("db"); return SETTINGS[k] ?? null; });
    const site = phoneSite();
    const kinds: string[] = [];
    const h = harness({ queue: [...parcel(), ...parcel()], passStart: ps.reset, check: async (i, t) => {
      const r = await runPcServerProbe({ fetchImpl: site.f as never, now: t, log: () => {}, readSetting: ps.read, gate: false, target: i as never });
      kinds.push(r.phone.kind || r.phone.verdict);
      return { verdict: r.phone.verdict, http: 200, ms: 1, kind: r.phone.kind, raw: r.phone.raw, steps: r.phone.steps };
    } });
    await h.job.tick();
    expect(kinds).toEqual(["config_missing", "ok"]);
  });
});

describe("B3 the job tells the pass start: once per pass, first thing, never able to stop it", () => {
  it("passStart is called once per tick, before the queue is read and before any check", async () => {
    const order: string[] = [];
    const h = harness({ queue: parcel(), passStart: () => order.push(`start@${h.events.length}`) });
    await h.job.tick();
    expect(order).toEqual(["start@0"]);        // nothing had happened yet in that pass: not the queue read, not a check
    expect(h.events[0]).toBe("read");
    await h.job.tick(); await h.job.tick();
    expect(order).toHaveLength(3);
  });
  it("before the backup checker's own pass too (its phone checks read the same settings)", async () => {
    const order: string[] = [];
    const h = harness({ queue: parcel(), passStart: () => order.push("start"), backup: { tick: async () => { order.push("backup"); return { onDuty: true, checked: 0 }; } } });
    expect(await h.job.tick()).toEqual({ duty: true, checked: 0 });
    expect(order).toEqual(["start", "backup"]);
  });
  it("a passStart that throws stops nothing", async () => {
    const h = await ready(harness({ passStart: () => { throw new Error("x"); } }), parcel());
    expect(await h.job.tick()).toMatchObject({ checked: 2 });
    expect(h.evRows).toHaveLength(2);
  });
  it("server.js: the pass settings feed the phone check, the E-Map open and the backup's phone check; the test probe, the login module and the light read keep the plain read", () => {
    expect(SERVER).toContain("const pc711Settings = createPassSettings(readSetting);");
    expect(SERVER).toContain("passStart: pc711Settings.reset, emap: pc711Emap, backup: pc711Backup });");
    expect(SERVER.split("readSetting: pc711Settings.read").length - 1).toBe(3);
    expect(SERVER).toContain("const pc711CartStep = () => pc711CartLock(() => runPcServerProbe({ readSetting, session:");
  });
});

// ═══ C. the store row is saved after the phone check ═════════════════════════════════════════════════════════
describe("C1 a parcel: store check → phone check → the store's saves → the phone's saves → 2 s", () => {
  const ONE_AFTER = ["byid:parcel", "phone", "save:compare:store", "save:evidence:store", "save:compare:phone", "save:evidence:phone", `sleep:${SHADOW_ROW_GAP_MS}`];
  it("a parcel the extension already answered (two saves per half)", async () => {
    const h = await ready(harness(), parcel());
    await h.job.tick();
    expect(noReads(h.events)).toEqual(ONE_AFTER);
  });
  it("a parcel still waiting for the extension (one save per half)", async () => {
    const h = await ready(harness({ mirror: true }), [], parcel({ ext: null }));
    await h.job.tick();
    expect(noReads(h.events)).toEqual(["byid:parcel", "phone", "save:evidence:store", "save:evidence:phone", `sleep:${SHADOW_ROW_GAP_MS}`]);
  });
  it("the phone check starts the moment the store check ends — no save in between (before: one or two saves, 0.25–0.5 s)", async () => {
    const h = await ready(harness(), parcel());
    await h.job.tick();
    const store = h.evRows.find((r) => r.kind === "store")!, phone = h.evRows.find((r) => r.kind === "phone")!;
    expect(Date.parse(String(phone.srv_started_at)) - Date.parse(String(store.srv_finished_at))).toBe(0);
    // each row's own times are the check's own: the store's end is the store request's end, whatever came after
    expect(Date.parse(String(store.srv_finished_at)) - Date.parse(String(store.srv_started_at))).toBe(600);
    expect(Date.parse(String(phone.srv_finished_at)) - Date.parse(String(phone.srv_started_at))).toBe(900);
  });
  it("what is saved is unchanged: the same two rows per half, the same answers, store before phone", async () => {
    const h = await ready(harness(), parcel());
    await h.job.tick();
    expect(h.evRows.map((r) => [r.kind, r.mode, r.srv_verdict, r.match])).toEqual([["store", "after", "open", true], ["phone", "after", "ok", true]]);
    expect(h.oldRows.map((r) => [r.kind, r.srv_verdict, r.match])).toEqual([["store", "open", true], ["phone", "ok", true]]);
    expect(h.logs.filter((l) => l.startsWith("[PC711_SHADOW] kind="))).toEqual([
      expect.stringMatching(/^\[PC711_SHADOW\] kind=store match=1 /), expect.stringMatching(/^\[PC711_SHADOW\] kind=phone match=1 /)]);
  });
  it("six parcels: every parcel in that order, 2 s after each one, at most 5 a pass — the extension's row loop is untouched", async () => {
    const h = await ready(harness(), [...parcel(), ...parcel(), ...parcel(), ...parcel(), ...parcel(), ...parcel()]);
    await h.job.tick();
    const ev = noReads(h.events);
    expect(ev).toEqual(Array(SHADOW_LIMIT).fill(ONE_AFTER).flat());
    expect(ev.filter((e) => e === "byid:parcel")).toHaveLength(SHADOW_LIMIT);
    expect(ev.filter((e) => e.startsWith("sleep:"))).toHaveLength(SHADOW_LIMIT);
    h.clear(); h.advance(SHADOW_POLL_MS);
    await h.job.tick();                        // the sixth, on the next pass
    expect(noReads(h.events)).toEqual(ONE_AFTER);
  });
});

describe("C2 every other case saves exactly as before", () => {
  it("a store half with no phone half this pass → saved at once, before the 2 s", async () => {
    const h = await ready(harness(), [pend("store")]);
    await h.job.tick();
    expect(noReads(h.events)).toEqual(["byid:parcel", "save:compare:store", "save:evidence:store", `sleep:${SHADOW_ROW_GAP_MS}`]);
  });
  it("a phone half alone → as before", async () => {
    const h = await ready(harness(), [pend("phone")]);
    await h.job.tick();
    expect(noReads(h.events).filter((e) => e !== "byid:keepalive")).toEqual(["phone", "save:compare:phone", "save:evidence:phone", `sleep:${SHADOW_ROW_GAP_MS}`]);
  });
  it("a store check with no answer (a retry is set, nothing is saved) → the phone half goes on as before", async () => {
    let odd = false;
    const h = await ready(harness({ byid: () => (odd ? { body: "odd page" } : { body: "OK;123456+店+addr+enable+0++門市" }) }), parcel());
    odd = true;
    await h.job.tick();
    expect(noReads(h.events)).toEqual(["byid:parcel", "byid:parcel", "phone", "save:compare:phone", "save:evidence:phone", `sleep:${SHADOW_ROW_GAP_MS}`]);
    expect(h.evRows.map((r) => r.kind)).toEqual(["phone"]);
  });
  it("the store's ERROR row (the ladder is used up) is saved at once, right after its own check — only a real answer waits", async () => {
    let odd = false;
    const h = await ready(harness({ byid: () => (odd ? { body: "odd page" } : { body: "OK;123456+店+addr+enable+0++門市" }) }), parcel());
    odd = true;
    for (let i = 0; i <= SHADOW_STORE_BACKOFF_MS.length && !h.evRows.some((r) => r.kind === "store"); i++) { h.clear(); await h.job.tick(); h.advance(3 * 60_000); }
    const row = h.evRows.find((r) => r.kind === "store")!;
    expect(row).toMatchObject({ srv_verdict: "unknown", fail_reason: "unexpected_answer" });
    const i = h.events.indexOf("save:evidence:store");
    expect(h.events.slice(i - 3, i + 1)).toEqual(["byid:parcel", "byid:parcel", "save:compare:store", "save:evidence:store"]); // its two map addresses, then its rows
  });
  it("the phone check stops the job (logged out, no kept session that answers) → the store's answer is still saved, once", async () => {
    const h = await ready(harness({ phone: () => ({ verdict: "unknown", http: 0, ms: 1, kind: "no_session", raw: "", steps: [] }) }), parcel());
    await h.job.tick();
    expect(noReads(h.events)).toEqual(["byid:parcel", "phone", "save:compare:store", "save:evidence:store", "save:compare:phone", "save:evidence:phone"]);
    expect(h.evRows.map((r) => [r.kind, r.fail_reason])).toEqual([["store", null], ["phone", "needs_login"]]);
    expect(h.logs.at(-1)).toMatch(/stop=needs_login/);
  });
  it("a store save that fails: the phone is still checked and saved; that store value is not asked again for 10 minutes (as before)", async () => {
    const h = await ready(harness({ evFail: (r) => r.kind === "store" }), parcel());
    await h.job.tick();
    expect(h.evRows.map((r) => r.kind)).toEqual(["phone"]);
    expect(h.logs.some((l) => /evidence save failed kind=store mode=after try=1\/3 next=600s/.test(l))).toBe(true);
    h.clear(); h.advance(SHADOW_POLL_MS);
    await h.job.tick();
    expect(h.events.filter((e) => e === "byid:parcel")).toHaveLength(0);
  });
});

describe("C3 source: only a real answer of a store half with a phone half waits; nothing else moved", () => {
  const src = code(SHADOW_SRC);
  it("the store's saves wait only when the row also has a phone half", () => {
    expect(src).toContain("const storeSaves = doStore && doPhone ? [] : null;");
    expect(src).toContain("const out = await runJob(sj, st, t, row.store.queued, storeExt(sj), storeSaves);");
    expect(src).toContain('if (out === "stop" || out === "pause") { await saveStore(); return checked; }');
  });
  it("they are written right after the phone's request, and again (nothing left) after the phone job — never lost", () => {
    expect(src).toContain("try { x = await inner(); } finally { await saveStore(); }");
    expect(src).toContain("try { out = await runJob(pj, st, t, row.phone.queued, ext); } finally { await saveStore(); }");
  });
  it("in runJob only the real-answer save can wait (one place)", () => {
    expect(src.split("later.push(save)").length - 1).toBe(1);
    expect(src).toContain("if (Array.isArray(later)) later.push(save); else await save();");
  });
  it("the rest and the numbers of the row loop are the ones pinned to the extension", () => {
    expect(src).toContain("await sleep(SHADOW_ROW_GAP_MS);");
    expect(src.split("await sleep(SHADOW_ROW_GAP_MS)").length - 1).toBe(1);
    expect(src).toContain("if (processed >= budget) break;");
  });
});

// ═══ D. a lost login stops nothing while the kept E-Map session still answers ═════════════════════════════════
describe("D1 emap.answering(): there is a session, it is not on the error page, and it has not been given up", () => {
  it("no session yet → false; opened → true; given up (two re-loads, still no answer) → false; an answer → true again", async () => {
    let ok = true;
    const h = harness({ byid: () => (ok ? { body: "OK;123456+店+addr+enable+0++門市" } : { body: "odd page" }), open: () => (ok ? OPENED() : { store: { kind: "no_session", steps: [{ step: "store.skip", http: 0 }] } }) });
    expect(h.emap.answering()).toBe(false);
    await ready(h);                                       // opens the session
    expect(h.emap.answering()).toBe(true);
    // it stops answering: misses → the two re-loads of the recovery → given up ("dead")
    ok = false;
    h.advance(6 * 60_000);
    for (let i = 0; i < 12; i++) { h.emap.miss("store: no_answer", false, false); h.advance(Math.max(EMAP_RECOVER_MIN_SPAN_MS, EMAP_RELOAD_COOLDOWN_MS) + 1000); await h.emap.refresh(false, { onOpenFail: async () => false }); }
    expect(h.emap._e().reloads).toBe(EMAP_MAX_RELOADS);
    expect(h.emap._e().misses).toBeGreaterThan(0);
    expect(h.emap.usable()).toBe(true);                   // still "a tab", but given up
    expect(h.emap.answering()).toBe(false);
    h.emap.verdict();
    expect(h.emap.answering()).toBe(true);
  });
  it("on the error page → false", async () => {
    const h = await ready(harness());
    h.emap._e().error = true;
    expect(h.emap.usable()).toBe(false);
    expect(h.emap.answering()).toBe(false);
  });
});

describe("D2 logged out of 7-11, the kept E-Map session answers → the pass runs as when connected", () => {
  it("store and phone are checked and compared; no 'needs_login' row, no stop, the mirror switch is not touched", async () => {
    let state = "connected";
    const h = await ready(harness({ mirror: true, status: () => ({ state, since: "c1" }) }), parcel());
    state = "needs_login";                                // the light read's step found the login gone
    const out = await h.job.tick();
    expect(out).toMatchObject({ checked: 2 });
    expect(noReads(h.events).slice(0, 2)).toEqual(["byid:parcel", "phone"]);
    expect(h.evRows.map((r) => [r.kind, r.srv_verdict, r.match, r.fail_reason])).toEqual([["store", "open", true, null], ["phone", "ok", true, null]]);
    expect(h.stopMirror).not.toHaveBeenCalled();
    expect(h.logs.join("\n")).not.toMatch(/needs_login|login_lost/);
    expect(h.opens).toHaveBeenCalledTimes(1);             // no new open is tried while the session answers
  });
  it("parcels still waiting for the extension keep being checked too (the mirror stays on)", async () => {
    let state = "connected";
    const h = await ready(harness({ mirror: true, status: () => ({ state, since: "c1" }) }), [], parcel({ ext: null }));
    state = "needs_login";
    await h.job.tick();
    expect(h.evRows.map((r) => [r.kind, r.mode])).toEqual([["store", "mirror"], ["phone", "mirror"]]);
    expect(h.settings[MIRROR_SWITCH]).toBe("true");
    expect(h.stopMirror).not.toHaveBeenCalled();
  });
  it("it goes on pass after pass, for as long as the session answers", async () => {
    let state = "connected";
    const h = await ready(harness({ status: () => ({ state, since: "c1" }) }));
    state = "needs_login";
    for (let i = 0; i < 6; i++) { h.queue.push(...parcel()); await h.job.tick(); h.advance(SHADOW_POLL_MS); }
    expect(h.evRows.filter((r) => r.kind === "store" && r.srv_verdict === "open")).toHaveLength(6);
    expect(h.evRows.filter((r) => r.kind === "phone" && r.srv_verdict === "ok")).toHaveLength(6);
    expect(h.opens).toHaveBeenCalledTimes(1);
  });
  it("the login is lost WHILE a pass runs (the light read has its own clock): the phone check of that pass is still a real comparison", async () => {
    let state = "connected";
    const h = await ready(harness({ status: () => ({ state, since: "c1" }), phone: () => { state = "needs_login"; return { verdict: "ok", http: 200, ms: 900, kind: "", raw: "Status:true", steps: [] }; } }), parcel());
    await h.job.tick();
    expect(h.evRows.map((r) => [r.kind, r.match, r.fail_reason])).toEqual([["store", true, null], ["phone", true, null]]);
    expect(h.logs.join("\n")).not.toMatch(/stop=needs_login/);
  });
});

describe("D3 logged out and NO kept session that answers → exactly as before", () => {
  it("never opened: no check, no request, the mirror is switched off once (rule login_lost)", async () => {
    const h = harness({ mirror: true, queue: parcel(), mqueue: parcel({ ext: null }), status: () => ({ state: "needs_login", since: "c1" }) });
    // the mirror switch is learned on a connected pass; here the server starts logged out
    expect(await h.job.tick()).toEqual({ skipped: "not_connected" });
    expect(h.events).toEqual([]);
    expect(h.opens).not.toHaveBeenCalled();
    expect(h.evRows).toHaveLength(0);
  });
  it("the kept session is given up while logged out → from the next pass: no check, the mirror off once", async () => {
    let state = "connected";
    const h = await ready(harness({ mirror: true, status: () => ({ state, since: "c1" }) }), parcel());
    await h.job.tick();                                   // connected: one parcel checked, the mirror switch is seen on
    state = "needs_login";
    // the session dies: two re-loads and still no answer
    const e = h.emap._e();
    e.reloads = EMAP_MAX_RELOADS; e.misses = 3; e.firstMissAt = h.at() - 10 * 60_000; e.lastMissAt = h.at(); e.lastVerdictAt = h.at() - 20 * 60_000;
    expect(h.emap.answering()).toBe(false);
    h.queue.push(...parcel()); h.clear(); h.advance(SHADOW_POLL_MS);
    expect(await h.job.tick()).toEqual({ skipped: "not_connected" });
    expect(h.events).toEqual([]);
    expect(h.stopMirror).toHaveBeenCalledTimes(1);
    expect(h.stopMirror.mock.calls[0][0]).toBe("login_lost");
    await h.job.tick(); await h.job.tick();
    expect(h.stopMirror).toHaveBeenCalledTimes(1);        // once
  });
  it("without the kept-session flow (the old path, no emap): logged out → stop, as before", async () => {
    const inserted: R[] = [];
    const db = { pending: vi.fn(async () => ({ waiting: 1, jobs: [{ scan_id: sid(), kind: "phone", ext: "ok", at: ago(1), phone: MARK.phone, customer_name: MARK.name, store_id: STORE }] })),
      dayMax: vi.fn(async () => ({})), saveDayMax: vi.fn(async () => {}), purgeBefore: vi.fn(async () => {}), insert: vi.fn(async (r: R) => { inserted.push(r); }) };
    let state = "connected";
    const job = createPc711Shadow({ db: db as never, check: (async () => { state = "needs_login"; return { verdict: "ok", http: 200, ms: 1, kind: "", raw: "", steps: [] }; }) as never,
      pc711: { status: () => ({ state, since: "c1" }) }, readSetting: async () => "true", now: () => NOW, log: () => {}, sleep: async () => {} });
    await job.tick();
    expect(inserted).toEqual([expect.objectContaining({ fail_reason: "needs_login", fail_step: "login" })]);
    expect(await job.tick()).toEqual({ skipped: "not_connected" });
  });
  it("source: the login state stops a check only when there is no kept session that answers", () => {
    const src = code(SHADOW_SRC);
    expect(src).toContain('Boolean(after && after.state === "needs_login" && !keptSession())');
    expect(src).toContain('const kept = Boolean(st) && st.state === "needs_login" && keptSession();');
    expect(src).toContain("if (loginLost(st)) await stopMirrorOnLoginLoss();");
    expect(code(readFileSync("server/pc711Emap.js", "utf8"))).toContain('const answering = () => usable() && emapDerive(now(), e, false) !== "dead";');
  });
});

// ═══ the helper that keeps two cart steps apart ═══════════════════════════════════════════════════════════════
describe("createSerial: one at a time, in order, whatever the result", () => {
  it("the second starts only after the first has ended; a throw does not block the next", async () => {
    const run = createSerial();
    const order: string[] = [];
    let free: () => void = () => {};
    const a = run(async () => { order.push("a:start"); await new Promise<void>((r) => { free = r; }); order.push("a:end"); return 1; });
    const b = run(async () => { order.push("b:start"); throw new Error("b"); });
    const c = run(async () => { order.push("c:start"); return 3; });
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(["a:start"]);
    free();
    expect(await a).toBe(1);
    await expect(b).rejects.toThrow("b");
    expect(await c).toBe(3);
    expect(order).toEqual(["a:start", "a:end", "b:start", "c:start"]);
  });
});

// ═══ logs ═════════════════════════════════════════════════════════════════════════════════════════════════════
describe("logs hold no phone, name, store number, cookie, token or guid", () => {
  it("a full pass with everything on, then a lost login with a kept session", async () => {
    let state = "connected";
    const h = await ready(harness({ mirror: true, status: () => ({ state, since: "c1" }) }), parcel(), parcel({ ext: null }));
    await h.job.tick();
    state = "needs_login"; h.queue.push(...parcel()); h.advance(SHADOW_POLL_MS);
    await h.job.tick();
    expect(h.evRows.length).toBeGreaterThanOrEqual(6);
    const all = [...h.logs, keepAliveLogLine(createKeepAliveFetch({ log: () => {} }))].join("\n");
    for (const m of [MARK.phone, MARK.name, MARK.guid, MARK.cookie, MARK.sender, MARK.token, STORE, GM]) expect(all).not.toContain(m);
    expect(all).toMatch(/\[PC711_KEEPALIVE\] on idle=50s/);
  });
});
