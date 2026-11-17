// @vitest-environment node
// The server copies the Chrome extension's phone + store check flow (Jeff 2026-11-18). One test per rule of
// the table in the branch report; every number is read from the extension's own files and compared. The REAL
// shadow job and the REAL kept E-Map session run on a fake 7-11 and a virtual clock — no real request is made.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createPc711Shadow, SHADOW_FROZEN_STORE_GAP_MS, SHADOW_FROZEN_SLOW_PAUSE_MS, phoneBackoffDelay, storeBackoffDelay, rowsOf, SHADOW_ROW_GAP_MS, SHADOW_LIMIT, SHADOW_PHONE_TOKEN_MS, SHADOW_PHONE_TOKEN_RETRY_FAILS,
  SHADOW_STORE_BACKOFF_MS, SHADOW_PHONE_BACKOFF_MS, SHADOW_MAINT_RETRY_MS, SHADOW_POLL_MS, SHADOW_FETCH_LIMIT } from "../../../../server/pc711Shadow.js";
import {
  createPc711Emap, emapKeepaliveDue, emapRecoveryDue, emapDerive, emapParseByIdData, emapEndpointOrder,
  EMAP_RECENT_MS, EMAP_KEEPALIVE_MS, EMAP_KEEPALIVE_STORE, EMAP_RELOAD_COOLDOWN_MS, EMAP_MAX_RELOADS, EMAP_RECOVER_VERDICT_GUARD_MS,
  EMAP_RECOVER_MIN_MISSES, EMAP_RECOVER_MIN_SPAN_MS, EMAP_REQUEST_MS, EMAP_STORE_VERDICTS, EMAP_OPEN_RETRY_MS,
  EMAP_FROZEN_REQUEST_MS, EMAP_FROZEN_STORE_GAP_MS, EMAP_FROZEN_SLOW_PAUSE_MS,
} from "../../../../server/pc711Emap.js";
import { runPcServerProbe } from "../../../../server/pcServerProbe.js";
import { MIRROR_SWITCH } from "../../../../server/pc711Evidence.js";

const BG = readFileSync("chrome-extension/background.js", "utf8");
const EMAP_JS = readFileSync("chrome-extension/emap-711.js", "utf8");
const MYSHIP_JS = readFileSync("chrome-extension/myship-711.js", "utf8");
const SERVER = readFileSync("server.js", "utf8");
const FROZEN_JS = readFileSync("chrome-extension/frozen-check.js", "utf8");
const EMAP_FROZEN_JS = readFileSync("chrome-extension/emap-frozen-711.js", "utf8");

// ── reading the extension's own code ───────────────────────────────────────────
const constOf = (src: string, name: string): unknown => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(src);
  if (!m) throw new Error(`no ${name}`);
  return new Function(`return (${m[1].split("//")[0]});`)();
};
const fnSrc = (src: string, name: string) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`no function ${name}`);
  let depth = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") depth++; if (src[k] === "}" && --depth === 0) { j = k; break; } }
  return src.slice(i, j + 1);
};
const C = (n: string) => constOf(BG, n);
const extFns = (inMaint: boolean) => new Function(
  "PC_KEEPALIVE_MS", "PC_RECENT_MS", "PC_RELOAD_COOLDOWN_MS", "PC_MAX_RELOADS", "PC_RECOVER_VERDICT_GUARD_MS", "PC_RECOVER_MIN_MISSES", "PC_RECOVER_MIN_SPAN_MS", "PC_BACKOFF_MS", "PC_PHONE_FAST_BACKOFF_MS",
  `const pcInMaintenance = () => ${inMaint};
   ${fnSrc(BG, "pcKeepaliveDue")} ${fnSrc(BG, "pcRecoveryDue")} ${fnSrc(BG, "pcDeriveEmap")} ${fnSrc(BG, "pcBackoffDelay")} ${fnSrc(BG, "pcPhoneFastKind")} ${fnSrc(BG, "pcPhoneBackoffDelay")} ${fnSrc(BG, "pcPhoneNoAnswer")}
   return { pcKeepaliveDue, pcRecoveryDue, pcDeriveEmap, pcBackoffDelay, pcPhoneBackoffDelay, pcPhoneNoAnswer };`,
)(C("PC_KEEPALIVE_MS"), C("PC_RECENT_MS"), C("PC_RELOAD_COOLDOWN_MS"), C("PC_MAX_RELOADS"), C("PC_RECOVER_VERDICT_GUARD_MS"), C("PC_RECOVER_MIN_MISSES"), C("PC_RECOVER_MIN_SPAN_MS"), C("PC_BACKOFF_MS"), C("PC_PHONE_FAST_BACKOFF_MS"));
const extParse = new Function(`${fnSrc(EMAP_JS, "parseByIdData")} return parseByIdData;`)();
const extEndpoints = new Function(`${fnSrc(EMAP_JS, "sectionOf")} ${fnSrc(EMAP_JS, "endpointCandidates")} return endpointCandidates;`)();

// ── the fake 7-11 (E-Map side) and the job ────────────────────────────────────
const NOW = Date.parse("2026-11-17T04:00:00Z"); // 12:00 Taipei
const NIGHT = Date.parse("2026-11-17T18:00:00Z"); // 02:00 Taipei
const HOST = "emap.unipcsc.com.tw";
const PAGE = `https://${HOST}/mobilemap/default.aspx`;
// never in a log line
const MARK = { guid: "MARKGUID-1111-2222", guid2: "MARKGUID-3333-4444", cookie: "MARKCOOKIEval", phone: "0912345678", name: "陳小美" };
const STORE = "151003", STORE2 = "277895";
type R = Record<string, unknown>;
type Reply = { status?: number; body?: string; location?: string; cookies?: string[] } | "timeout" | "network";
type Call = { method: string; path: string; url: string; body: string; headers: Record<string, string>; at: number };
const ago = (min: number, from = NOW) => new Date(from - min * 60_000).toISOString();
let seq = 0;
const sid = () => `00000000-0000-0000-0000-${String(++seq).padStart(12, "0")}`;
const pend = (kind: string, o: R = {}): R => ({
  scan_id: sid(), kind, ext: kind === "phone" ? "ok" : kind === "frozen" ? "ok" : "open", at: ago(2), store_id: STORE, phone: kind === "phone" ? MARK.phone : null,
  customer_name: kind === "phone" ? MARK.name : null, input: kind === "phone" ? MARK.phone : STORE, seller_id: "s1", created_at: ago(3), msg: null, until: null,
  cache_at: null, source: "fresh", prev_input: null, prev_ext_at: null, round: 1, ...o,
});
const parcel = (o: R = {}) => { const s = sid(); return [pend("store", { scan_id: s, ...o }), pend("phone", { scan_id: s, ...o })]; };
const OPENED = (guid = MARK.guid) => ({ store: { emap: { cookies: { [HOST]: `ASP.NET_SessionId=${MARK.cookie}`, "myship.7-11.com.tw": "other=x" }, guid, pageUrl: PAGE }, kind: "",
  steps: [{ step: "store.cart", http: 200 }, { step: "store.detail", http: 200 }, { step: "store.map", http: 200 }, { step: "store.emap", http: 200 }] } });

function harness(o: { queue?: R[]; mqueue?: R[]; mirror?: boolean; start?: number; byid?: (store: string, c: Call) => Reply; page?: () => Reply;
  phone?: (i: R) => R; open?: () => unknown; status?: () => R } = {}) {
  let t = o.start ?? NOW;
  const logs: string[] = [], evRows: R[] = [], events: string[] = [], calls: Call[] = [], phoneInputs: R[] = [];
  const settings: Record<string, string> = { pc711_shadow_enabled: "true", [MIRROR_SWITCH]: o.mirror ? "true" : "false" };
  const queue = o.queue ?? [], mqueue = o.mqueue ?? [];
  const written = (r: R) => evRows.some((x) => x.scan_id === r.scan_id && x.kind === r.kind);
  const f = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const u = new URL(url);
    const c: Call = { method: init.method || "GET", path: u.pathname, url, body: String(init.body ?? ""), headers: init.headers || {}, at: t };
    calls.push(c);
    t += 600;
    let rep: Reply;
    if (u.pathname.endsWith("/byIDData.aspx")) {
      const k = new URLSearchParams(c.body).get("k") || "";
      events.push(`byid:${new URLSearchParams(c.body).get("cate") === "27" ? "frozen" : k === EMAP_KEEPALIVE_STORE ? "keepalive" : "parcel"}`);
      rep = o.byid ? o.byid(k, c) : { body: "OK;123456+店+addr+enable+0++門市" };
    } else {
      events.push("reload");
      rep = o.page ? o.page() : { body: `<script>var eshopGuid="${MARK.guid2}";</script>` };
    }
    if (rep === "timeout") throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (rep === "network") throw new TypeError("fetch failed");
    const r = rep;
    return {
      status: r.status ?? 200, ok: (r.status ?? 200) < 300,
      headers: { get: (k: string) => (k.toLowerCase() === "location" ? r.location ?? null : null), getSetCookie: () => r.cookies ?? [] },
      text: async () => r.body ?? "",
    };
  });
  const opens = vi.fn(async () => { events.push("open"); t += 3200; return o.open ? o.open() : OPENED(); });
  const emap = createPc711Emap({ open: opens, fetchImpl: f as unknown as typeof fetch, now: () => t, log: (l: string) => logs.push(l), random: () => 0.5 });
  const ev = {
    pass: vi.fn(async (_s: string, _l: number, _rl: number, mirrorAllowed: boolean) => {
      const w = queue.filter((r) => !written(r));
      const mirror = settings[MIRROR_SWITCH] === "true";
      const mw = mqueue.filter((r) => !written(r));
      return { shadow: true, waiting: w.length, jobs: w, mirror, reasks: [], awaiting: [], mirrorQueue: mirror && mirrorAllowed ? { waiting: mw.length, jobs: mw } : null, health: null };
    }),
    insert: vi.fn(async (r: R) => { evRows.push({ ...r, id: evRows.length + 1 }); }),
    update: vi.fn(async () => {}), stopMirror: vi.fn(async () => false), parcelForReask: vi.fn(async () => null),
  };
  const db = { pending: vi.fn(), dayMax: vi.fn(async () => ({})), saveDayMax: vi.fn(async () => {}), insert: vi.fn(async () => {}), purgeBefore: vi.fn(async () => {}) };
  const check = vi.fn(async (i: R) => {
    phoneInputs.push(i); events.push("phone"); t += 900;
    return o.phone ? o.phone(i) : { verdict: "ok", http: 200, ms: 900, kind: "", raw: "Status:true", steps: [{ step: "phone.token", http: 200, ms: 100, ok: true, note: "" }, { step: "phone.validate", http: 200, ms: 800, ok: true, note: "" }] };
  });
  const job = createPc711Shadow({ db, evidence: ev, check, pc711: { status: () => (o.status ? o.status() : { state: "connected", since: "c1" }) }, readSetting: async (k: string) => settings[k] ?? null,
    emap, now: () => t, log: (l: string) => logs.push(l), sleep: async (ms: number) => { events.push(`sleep:${ms}`); t += ms; } });
  return { job, emap, f, calls, opens, check, logs, evRows, events, phoneInputs, settings, queue, at: () => t, set: (x: number) => { t = x; }, advance: (ms: number) => { t += ms; } };
}
const parcelByids = (h: ReturnType<typeof harness>) => h.calls.filter((c) => c.path.endsWith("/byIDData.aspx") && new URLSearchParams(c.body).get("k") !== EMAP_KEEPALIVE_STORE);

// ═══ the numbers: read from the extension's files, compared one by one ═══════════
describe("numbers = the extension's", () => {
  it("background.js: poll / limit / fetch / gap / ladders / maintenance retry / keepalive / recovery", () => {
    expect(SHADOW_POLL_MS).toBe(C("PC_POLL_MS")); expect(SHADOW_LIMIT).toBe(C("PC_LIMIT")); expect(SHADOW_FETCH_LIMIT).toBe(C("PC_FETCH_LIMIT"));
    expect(SHADOW_ROW_GAP_MS).toBe(C("PC_ROW_GAP_MS"));
    expect(SHADOW_STORE_BACKOFF_MS).toEqual(C("PC_BACKOFF_MS")); expect(SHADOW_PHONE_BACKOFF_MS).toEqual(C("PC_PHONE_FAST_BACKOFF_MS"));
    expect(SHADOW_STORE_BACKOFF_MS.length + 1).toBe(C("PC_STORE_GIVE_UP"));
    expect(SHADOW_MAINT_RETRY_MS).toBe(C("PC_MAINT_RETRY_MS"));
    expect(SHADOW_PHONE_TOKEN_RETRY_FAILS).toBe(C("PC_PHONE_TOKEN_RETRY_FAILS"));
    expect(EMAP_KEEPALIVE_MS).toBe(C("PC_KEEPALIVE_MS")); expect(EMAP_KEEPALIVE_STORE).toBe(C("PC_KEEPALIVE_STORE")); expect(EMAP_RECENT_MS).toBe(C("PC_RECENT_MS"));
    expect(EMAP_RELOAD_COOLDOWN_MS).toBe(C("PC_RELOAD_COOLDOWN_MS")); expect(EMAP_MAX_RELOADS).toBe(C("PC_MAX_RELOADS"));
    expect(EMAP_RECOVER_VERDICT_GUARD_MS).toBe(C("PC_RECOVER_VERDICT_GUARD_MS")); expect(EMAP_RECOVER_MIN_MISSES).toBe(C("PC_RECOVER_MIN_MISSES"));
    expect(EMAP_RECOVER_MIN_SPAN_MS).toBe(C("PC_RECOVER_MIN_SPAN_MS"));
    expect(EMAP_STORE_VERDICTS).toEqual(C("PC_STORE_VERDICTS"));
  });
  it("emap-711.js: 10 s per byIDData; myship-711.js: 5 s per token GET", () => {
    expect(EMAP_REQUEST_MS).toBe(constOf(EMAP_JS, "TIMEOUT_MS"));
    expect(SHADOW_PHONE_TOKEN_MS).toBe(constOf(MYSHIP_JS, "TOKEN_TIMEOUT_MS"));
  });
});

// ═══ R4/R5 the store request and its answer ═══════════════════════════════════════
describe("R4 byIDData = emap-711.js postByIdData", () => {
  it("POST, the same body fields in the same order, cate 3, the XHR header, the kept guid + cookie", async () => {
    const h = harness({ queue: [pend("store")] });
    await h.job.tick(); await h.job.tick();
    const c = parcelByids(h)[0];
    expect(c.method).toBe("POST");
    expect([...new URLSearchParams(c.body).keys()]).toEqual(["mode", "k", "cate", "eshopparid", "eshopid", "multiple_type", "Guid", "Nan4AjaxTrickNumber"]);
    expect(Object.fromEntries(new URLSearchParams(c.body))).toMatchObject({ k: STORE, cate: "3", eshopparid: "7M0", eshopid: "7M0", Guid: MARK.guid });
    expect(c.headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(c.headers.cookie).toBe(`ASP.NET_SessionId=${MARK.cookie}`); // only the E-Map host's cookie goes to E-Map
  });
  it("endpoint order = endpointCandidates: own section first, the other second; the one that answered is asked first afterwards", async () => {
    expect(emapEndpointOrder("mobilemap", null)).toEqual(extEndpoints("/mobilemap/default.aspx"));
    expect(emapEndpointOrder("ecmap", null)).toEqual(extEndpoints("/ecmap/default.aspx"));
    let n = 0;
    const h = harness({ queue: [pend("store"), pend("store")], byid: (_k, c) => (c.path.startsWith("/mobilemap/") ? { body: "garbage" } : (n++, { body: "OK;1+a+b+disable+0++門市" })) });
    await h.job.tick(); await h.job.tick();
    expect(parcelByids(h).map((c) => c.path)).toEqual(["/mobilemap/byIDData.aspx", "/ecmap/byIDData.aspx", "/ecmap/byIDData.aspx"]);
    expect(n).toBe(2);
  });
});

describe("R5 the answer = emap-711.js parseByIdData", () => {
  it("enable → open · disable → full · close → company · NO2 → not_found · anything else → no answer (same function result)", () => {
    for (const body of ["OK;1+a+b+enable+0++門市", "OK;1+a+b+disable+0++門市", "OK;1+a+b+close+0++門市", "NO2", " NO2 ", "OK;1+a+b+x+0", "<html>", "", "OK;"]) {
      const ext = extParse(body);
      expect(emapParseByIdData(body)).toBe(ext ? ext.store_full_status : null);
    }
  });
});

// ═══ R6 what is "no answer", and whether it is a 7-11 blip (transient) ═════════════
describe("R6 no answer: error.aspx / HTTP / timeout / network / odd text", () => {
  const one = async (rep: Reply) => {
    const h = harness({ queue: [pend("store")], byid: () => rep });
    await h.job.tick(); // opens the session
    return h.emap.checkStore(STORE);
  };
  it("error.aspx bounce and 4xx and odd text are NOT transient; 5xx, timeout and network are", async () => {
    expect(await one({ status: 302, location: "/mobilemap/error.aspx" })).toMatchObject({ verdict: "unknown", kind: "error_aspx", transient: false });
    expect(await one({ status: 404 })).toMatchObject({ kind: "http", transient: false });
    expect(await one({ body: "<html>hello</html>" })).toMatchObject({ kind: "unexpected_answer", transient: false });
    expect(await one({ status: 503 })).toMatchObject({ kind: "http", transient: true });
    expect(await one("timeout")).toMatchObject({ kind: "timeout", transient: true });
    expect(await one("network")).toMatchObject({ kind: "network", transient: true });
  });
  it("both endpoints are asked before it is a no-answer; transient only when every attempt was", async () => {
    const r = await one("timeout");
    expect(r.steps.length).toBe(2); // both endpoints asked
    expect(r.transient).toBe(true);
    let k = 0;
    const h = harness({ queue: [pend("store")], byid: () => (k++ === 0 ? "timeout" : { status: 302, location: "/ecmap/error.aspx" }) });
    await h.job.tick();
    expect(await h.emap.checkStore(STORE)).toMatchObject({ transient: false });
  });
});

// ═══ R2/R3 the session: opened once, kept; opening = the 選擇取貨門市 click's requests ═
describe("R2 the E-Map session is opened ONCE and kept", () => {
  it("10 parcels over several passes → one open, then ONE byIDData per store check (same guid, same cookie)", async () => {
    const h = harness({ queue: Array.from({ length: 10 }, () => pend("store")) });
    for (let i = 0; i < 6; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.opens).toHaveBeenCalledTimes(1);
    expect(parcelByids(h).length).toBe(10);
    expect(new Set(parcelByids(h).map((c) => new URLSearchParams(c.body).get("Guid")))).toEqual(new Set([MARK.guid]));
    expect(h.evRows.filter((r) => r.kind === "store").every((r) => r.srv_verdict === "open")).toBe(true);
  });
  it("no session yet → the first pass makes no store request (doStore needs the tab); the session is opened at the END of the pass (pcRefreshTabStatus)", async () => {
    const h = harness({ queue: [pend("store")] });
    await h.job.tick();
    expect(h.events).toEqual(["open"]);
    await h.job.tick();
    expect(h.events.slice(1)).toEqual(["byid:parcel", `sleep:${SHADOW_ROW_GAP_MS}`]);
  });
});

describe("R3 opening = the requests of the 選擇取貨門市 click, with main's saved-login session (its relogin step unchanged)", () => {
  // a small myship + E-Map fake for the probe chain
  const GM = "GM2609096130694";
  const cart = (sid: string) => `<html><form id="MyCart" action="/cart/detail" method="post">${["MemberSid", "item_name_1", "item_price_1", "item_qty_1", "item_amt_1", "fullAmountFee_1", "Sum", "Carm_Cgptshipprice", "Total", "Seller_GoodsTotalAmt"].map((n) => `<input type="hidden" name="${n}" value="${n === "MemberSid" ? sid : n === "fullAmountFee_1" ? "38" : "0"}">`).join("")}</form></html>`;
  const site = (sid: string) => {
    const calls: string[] = [];
    const routes: Record<string, { status?: number; body?: string; location?: string }> = {
      [`GET myship.7-11.com.tw/cart/easy/${GM}`]: { body: cart(sid) },
      "POST myship.7-11.com.tw/cart/detail": { body: `<html><form id="MyCart" action="/cart/finish" method="post"><input type="hidden" name="a" value="1"></form></html>` },
      "POST myship.7-11.com.tw/CPF3101/MAP/": { status: 302, location: `/eMap/MM1/${GM}` },
      [`GET myship.7-11.com.tw/eMap/MM1/${GM}`]: { body: `<html><form method="post" action="${PAGE}"><input type="hidden" name="x" value="1"></form></html>` },
      [`POST ${HOST}/mobilemap/default.aspx`]: { body: `<script>var eshopGuid="${MARK.guid}";</script>` },
    };
    const f = vi.fn(async (url: string, init: { method?: string }) => {
      const u = new URL(url); const key = `${init.method || "GET"} ${u.hostname}${u.pathname}`; calls.push(key);
      const r = routes[key] || { status: 404 };
      return { status: r.status ?? 200, ok: (r.status ?? 200) < 300, headers: { get: (k: string) => (k === "location" ? r.location ?? null : null), getSetCookie: () => [`s=${MARK.cookie}`] }, text: async () => r.body ?? "" };
    });
    return { f, calls };
  };
  const settings = async (k: string) => ({ parcel_check_shared_gms: JSON.stringify([GM]), parcel_check_sender_phone: "0979000111", parcel_check_probe_buyer: "0919000222" } as Record<string, string>)[k] ?? null;
  const openWith = (s: { f: unknown }, relogin: () => Promise<unknown>, lost = vi.fn(async () => true)) => runPcServerProbe({
    fetchImpl: s.f as never, now: () => NOW, log: () => {}, readSetting: settings, gate: false, openOnly: true,
    session: { get: async () => ({ cookies: { "myship.7-11.com.tw": "auth=1" } }), relogin, save: async () => {}, lost } as never,
    target: { kind: "store", storeId: EMAP_KEEPALIVE_STORE } as never,
  });
  it("a logged-out cart during the open calls the existing relogin ONCE (then marks the session lost, as on main)", async () => {
    const s = site(""); // the cart page without a member id = logged out
    const relogin = vi.fn(async () => ({ cookies: { "myship.7-11.com.tw": "auth=2" } }));
    const lost = vi.fn(async () => true);
    const r = await openWith(s, relogin, lost);
    expect(relogin).toHaveBeenCalledTimes(1);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(r.store.emap).toBeUndefined();
    expect(r.store.kind).toBe("login_not_accepted");
  });
  it("a logged-in cart during the open never calls the relogin", async () => {
    const relogin = vi.fn(async () => ({ cookies: {} }));
    await openWith(site("SID12345"), relogin);
    expect(relogin).not.toHaveBeenCalled();
  });
  it("openOnly: cart → detail → MAP → E-Map, NO byIDData, the session handed back; relogin is never called", async () => {
    const s = site("SID12345");
    const relogin = vi.fn(async () => ({ cookies: {} }));
    const r = await runPcServerProbe({ fetchImpl: s.f as never, now: () => NOW, log: () => {}, readSetting: settings, gate: false, openOnly: true,
      session: { get: async () => ({ cookies: { "myship.7-11.com.tw": "auth=1" } }), relogin } as never, target: { kind: "store", storeId: EMAP_KEEPALIVE_STORE } as never });
    expect(s.calls).toEqual([`GET myship.7-11.com.tw/cart/easy/${GM}`, "POST myship.7-11.com.tw/cart/detail", "POST myship.7-11.com.tw/CPF3101/MAP/", `GET myship.7-11.com.tw/eMap/MM1/${GM}`, `POST ${HOST}/mobilemap/default.aspx`]);
    expect(r.store.emap).toMatchObject({ guid: MARK.guid, pageUrl: PAGE });
    expect(relogin).not.toHaveBeenCalled();
  });
  it("server.js: the open() call gets the SAME session object as the store check on main (get, relogin, save, lost); main's two lines unchanged", () => {
    const line = SERVER.split("\n").find((l) => l.includes("openOnly: true")) || "";
    expect(line).toContain("session: { get: pc711.getSession, relogin: pc711.quickRelogin, save: pc711.saveCookies, lost: pc711.markLoggedOut }");
    expect(SERVER.split("relogin: pc711.quickRelogin").length - 1).toBe(3); // main's two + the open call
    expect(SERVER).toContain("const runPcProbe = () => runPcServerProbe({ readSetting, session: { get: pc711.getSession, relogin: pc711.quickRelogin, save: pc711.saveCookies, lost: pc711.markLoggedOut } });");
    expect(SERVER).toContain("const r = await runPcServerProbe({ readSetting, session: { get: pc711.getSession, relogin: pc711.quickRelogin, save: pc711.saveCookies, lost: pc711.markLoggedOut }, target: input, gate: false, log: () => {} });");
    expect(readFileSync("server/pc711Emap.js", "utf8")).not.toMatch(/quickRelogin|openpoint|\/auth\//i); // no new login code
    expect(execSync("git diff origin/main -- server/pc711Login.js").toString()).toBe(""); // the login module untouched
  });
});

// ═══ R7/R8 the store ladder and the E-Map miss count ══════════════════════════════
describe("R7 store backoff = pcBackoffDelay, from the pass start; gives up on the 5th failure", () => {
  it("delay per failure count = the extension's function", () => {
    const x = extFns(false);
    for (let n = 0; n <= 9; n++) expect(storeBackoffDelay(n)).toBe(x.pcBackoffDelay(n));
  });
  it("a parcel that never answers: 15 s · 30 s · 60 s · 2 min after the PASS START, then the error row on the 5th", async () => {
    const h = harness({ queue: [pend("store")], byid: () => ({ body: "<html>" }) });
    await h.job.tick(); // open
    const tries: number[] = [];
    for (let i = 0; i < 400 && !h.evRows.length; i++) {
      const before = parcelByids(h).length;
      const passStart = h.at();
      await h.job.tick();
      if (parcelByids(h).length > before) tries.push(passStart);
      h.advance(5000);
    }
    const gaps = tries.slice(1).map((x, i) => x - tries[i]);
    expect(tries.length).toBe(5);
    // the wait is counted from the pass start, so each retry comes on the first 5 s pass at or after it
    gaps.forEach((g, i) => { expect(g).toBeGreaterThanOrEqual(SHADOW_STORE_BACKOFF_MS[i]); expect(g).toBeLessThan(SHADOW_STORE_BACKOFF_MS[i] + 5000 + 3000); });
    expect(h.evRows[0]).toMatchObject({ kind: "store", srv_verdict: "unknown" });
  });
  it("exactly: after the 1st failure the next try is due 15 s after the PASS START (not after the check)", async () => {
    const h = harness({ byid: () => ({ body: "<html>" }) });
    await h.job.tick(); h.advance(5000);
    h.queue.push(pend("store"));
    const passStart = h.at();
    await h.job.tick();
    const b = [...h.job._state().backoff.values()][0];
    expect(b.nextAt).toBe(passStart + SHADOW_STORE_BACKOFF_MS[0]);
  });
});

describe("R8 a parcel's no-answer counts toward the recovery ladder ONCE per verdict generation; a blip never", () => {
  it("one parcel failing 4 times = 1 miss; a verdict on another store lets it count again", async () => {
    const a = pend("store", { store_id: STORE2, input: STORE2 });
    const h = harness({ queue: [a], byid: (k) => (k === STORE2 ? { body: "<html>" } : { body: "OK;1+a+b+enable+0++門市" }) });
    await h.job.tick(); // open
    const fails = () => [...h.job._state().backoff.values()][0]?.fails ?? 0;
    for (let i = 0; i < 200 && fails() < 4; i++) { await h.job.tick(); h.advance(5000); }
    expect(fails()).toBe(4);
    expect(h.emap._e().misses).toBe(1); // 4 failures of ONE parcel = ONE miss
    h.queue.push(pend("store")); // another store answers → a new generation
    for (let i = 0; i < 200 && h.emap._e().misses !== 0; i++) { await h.job.tick(); h.advance(1000); }
    expect(h.emap._e().misses).toBe(0);
    for (let i = 0; i < 200 && fails() < 5 && h.evRows.filter((r) => r.store_id === STORE2 || r.input === STORE2).length === 0; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.emap._e().misses).toBe(1); // the same parcel counts again in the new generation
  });
  it("timeouts never count (transient)", async () => {
    const h = harness({ queue: [pend("store")], byid: () => "timeout" });
    for (let i = 0; i < 40; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.emap._e().misses).toBe(0);
  });
});

// ═══ R9/R10 recovery: the GET re-navigation, then the once-per-episode re-open ═════
describe("R9 recovery = pcRecoveryDue / pcDeriveEmap", () => {
  it("same decision as the extension over a grid of states (day and night)", () => {
    for (const inMaint of [false, true]) {
      const x = extFns(inMaint);
      const T = NOW;
      for (const lastVerdictAgo of [0, 60_000, 4 * 60_000, 5 * 60_000, 7 * 60_000, Infinity])
        for (const misses of [0, 2, 3, 5])
          for (const span of [0, 60_000, 2 * 60_000, 3 * 60_000])
            for (const reloads of [0, 1, 2])
              for (const reloadAgo of [0, 30_000, 60_000, Infinity])
                for (const lastMissAgo of [0, 10_000, Infinity]) for (const present of [true, false]) for (const error of [false, true]) {
                  const e = {
                    present, error, lastVerdictAt: lastVerdictAgo === Infinity ? 0 : T - lastVerdictAgo, misses, firstMissAt: misses ? T - span : 0,
                    reloads, reloadAt: reloadAgo === Infinity ? 0 : T - reloadAgo, lastMissAt: lastMissAgo === Infinity ? 0 : T - lastMissAgo, remint: { until: 0 },
                  };
                  expect(emapRecoveryDue(T, e, inMaint)).toBe(x.pcRecoveryDue(T, e));
                  expect(emapDerive(T, e, inMaint)).toBe(x.pcDeriveEmap(T, e));
                  expect(emapKeepaliveDue(T, T - lastVerdictAgo === -Infinity ? 0 : T - Math.min(lastVerdictAgo, 1e9), misses > 2)).toBe(x.pcKeepaliveDue(T, T - Math.min(lastVerdictAgo, 1e9), misses > 2));
                }
    }
  });
  it("a session that stops answering: after ≥ 3 misses over ≥ 2 min and no verdict for 5 min → ONE GET of the page; at most 2, 60 s apart", async () => {
    const h = harness({ byid: () => ({ body: "<html>" }), page: () => ({ body: "<html>no guid here</html>" }) });
    await h.job.tick(); // open
    h.emap.verdict(); // a verdict now: the 5-min guard starts
    for (let i = 0; i < 12 * 20; i++) {
      h.queue.push(pend("store", { store_id: String(200000 + i), input: String(200000 + i) })); // each a new store id → each counts
      await h.job.tick(); h.advance(5000);
    }
    const firstReopen = h.events.indexOf("open", 1);
    const reloadsBefore = h.events.slice(0, firstReopen < 0 ? undefined : firstReopen).filter((x) => x === "reload").length;
    expect(reloadsBefore).toBe(EMAP_MAX_RELOADS); // at most 2 GETs, then the re-open (pcTryRemint)
    const reloads = h.calls.filter((c) => c.method === "GET");
    expect(reloads[0].url).toBe(PAGE);
    expect(reloads[1].at - reloads[0].at).toBeGreaterThanOrEqual(EMAP_RELOAD_COOLDOWN_MS);
    expect(reloads[0].at - NOW).toBeGreaterThanOrEqual(EMAP_RECOVER_VERDICT_GUARD_MS);
  });
  it("never during 01:00–05:00 Taipei", async () => {
    const h = harness({ start: NIGHT, byid: () => ({ body: "<html>" }) });
    await h.job.tick(); // night: the session is not opened either (pcRefreshTabStatus: !inMaint)
    expect(h.opens).not.toHaveBeenCalled();
  });
});

describe("R10 dead / expired / no session → re-open (the extension: once per episode; a verdict ends the episode)", () => {
  it("the first death of a session that had answered → re-opened at once (the extension's rule)", async () => {
    let answer = true;
    const h = harness({ byid: () => (answer ? { body: "OK;1+a+b+enable+0++門市" } : { body: "<html>" }), page: () => ({ status: 302, location: "/mobilemap/error.aspx" }) });
    await h.job.tick(); // open #1
    h.queue.push(pend("store")); await h.job.tick(); // verdict → episode over
    answer = false;
    for (let i = 0; i < 12 * 30 && h.opens.mock.calls.length < 2; i++) { h.queue.push(pend("store", { store_id: String(400000 + i), input: String(400000 + i) })); await h.job.tick(); h.advance(5000); }
    expect(h.opens).toHaveBeenCalledTimes(2);
    const lines = h.logs.filter((l) => l.includes("[PC711_EMAP]"));
    const reopen = lines.lastIndexOf("[PC711_EMAP] open result=ok");
    expect(lines[reopen - 1]).toMatch(/recover .*result=error_aspx/); // the death and the re-open in the same pass
  });
});

// ═══ R10c Jeff 2026-11-18: opened, but the session died before giving any answer ═══════════════
describe("R10c opened but died before any answer → the failed-open schedule: once at once, then every 2 min until an answer", () => {
  const ODD = () => ({ body: "<html>" } as Reply); // no answer from E-Map (the keepalive cannot end the schedule)
  const die = (h: ReturnType<typeof harness>) => { h.emap._e().error = true; }; // the kept session lands on error.aspx
  it("a real run: every death before an answer is followed by a re-open in the SAME pass; tries ≥ 2 min apart", async () => {
    const h = harness({ byid: ODD, page: () => ({ status: 302, location: "/mobilemap/error.aspx" }) });
    const tries: number[] = [];
    h.opens.mockImplementation(async () => { tries.push(h.at()); h.events.push("open"); h.advance(3200); return OPENED(); });
    for (let i = 0; i < 12 * 30; i++) { h.queue.push(pend("store", { store_id: String(300000 + i), input: String(300000 + i) })); await h.job.tick(); h.advance(5000); }
    expect(tries.length).toBeGreaterThan(3);
    tries.slice(1).forEach((x, i) => expect(x - tries[i]).toBeGreaterThanOrEqual(EMAP_OPEN_RETRY_MS));
    const lines = h.logs.filter((l) => l.includes("[PC711_EMAP]"));
    lines.forEach((l, i) => { if (i > 0 && l === "[PC711_EMAP] open result=ok") expect(lines[i - 1]).toMatch(/recover .*result=error_aspx/); });
  });
  it("the first death before an answer → one try at once", async () => {
    const h = harness({ byid: ODD });
    await h.job.tick(); // open #1 (ok, no answer yet)
    h.advance(5000); die(h);
    await h.job.tick();
    expect(h.opens).toHaveBeenCalledTimes(2);
  });
  it("then every 2 min: a second death right after → no try before 2 min from the last try, one try at 2 min", async () => {
    const tries: number[] = [];
    const h = harness({ byid: ODD });
    h.opens.mockImplementation(async () => { tries.push(h.at()); h.advance(3200); return OPENED(); });
    await h.job.tick(); h.advance(5000); die(h); await h.job.tick(); // open #1, death → open #2 at once
    expect(tries.length).toBe(2);
    h.advance(5000); die(h);
    for (let i = 0; i < 5; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.emap.state().openFails).toBe(2); // each death counted ONCE (not once per pass while it waits)
    for (let i = 0; i < 30 && tries.length === 2; i++) { await h.job.tick(); h.advance(5000); }
    expect(tries.length).toBe(3);
    expect(tries[2] - tries[1]).toBeGreaterThanOrEqual(EMAP_OPEN_RETRY_MS);
    expect(tries[2] - tries[1]).toBeLessThanOrEqual(EMAP_OPEN_RETRY_MS + 5000 + 3200);
  });
  it("a session that gives an answer ends the schedule (the next death is the extension's single re-open again)", async () => {
    const h = harness({ byid: ODD });
    await h.job.tick(); h.advance(5000); die(h); await h.job.tick(); // open #1, death → #2
    expect(h.emap.state()).toMatchObject({ openFails: 1, unanswered: true });
    h.emap.verdict();
    expect(h.emap.state()).toMatchObject({ openFails: 0, unanswered: false, nextOpenAt: null });
    h.advance(5000); die(h); await h.job.tick();
    expect(h.opens).toHaveBeenCalledTimes(3); // at once, not 2 min later
  });
  it("a 7-11 login → a try at once (not waiting the 2 min)", async () => {
    let since = "c1";
    const h = harness({ byid: ODD, status: () => ({ state: "connected", since }) });
    await h.job.tick(); h.advance(5000); die(h); await h.job.tick(); // #1, #2
    h.advance(5000); die(h); await h.job.tick();
    expect(h.opens).toHaveBeenCalledTimes(2); // < 2 min: waiting
    since = "c2"; h.advance(5000);
    await h.job.tick();
    expect(h.opens).toHaveBeenCalledTimes(3);
  });
  it("never during 01:00–05:00 Taipei", async () => {
    const h = harness({ start: NIGHT - 2 * 3600_000 + 1000, byid: ODD }); // 00:00:01 Taipei (NIGHT = 02:00)
    await h.job.tick(); // open #1 before 01:00
    h.set(NIGHT); die(h);
    for (let i = 0; i < 12 * 30; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.opens).toHaveBeenCalledTimes(1);
    h.set(Date.parse("2026-11-17T21:00:10Z")); // 05:00:10
    await h.job.tick();
    expect(h.opens).toHaveBeenCalledTimes(2);
  });
  it("the safety brake: the re-opens refused 5 times in a row (HTTP 429) → 15 min with no try", async () => {
    const tries: number[] = [];
    const h = harness({ byid: ODD });
    await h.job.tick(); h.advance(5000); // open #1 ok
    h.opens.mockImplementation(async () => { tries.push(h.at()); h.advance(3200); return { store: { kind: "cart_form_missing", steps: [{ step: "store.cart", http: 429 }] } }; });
    die(h);
    for (let i = 0; i < 12 * 60 && tries.length < 5; i++) { await h.job.tick(); h.advance(5000); }
    expect(tries.length).toBe(5);
    const fifth = tries[4];
    for (let i = 0; i < 12 * 14; i++) { await h.job.tick(); h.advance(5000); }
    expect(tries.length).toBe(5);
    expect(h.job.state().pausedUntil).toBeGreaterThanOrEqual(fifth + 15 * 60_000 - 1);
  });
});

// ═══ R10b Jeff 2026-11-18: after a failed open (the extension waits for a person here) ═══════
describe("R10b a failed open: one more try at once; then every 2 min; at once after a 7-11 login; never 01:00–05:00; the brake applies", () => {
  const FAIL = (http = 200, kind = "login_not_accepted") => ({ store: { kind, steps: [{ step: "store.cart", http }] } });
  it("a single failed open is followed by ONE immediate retry (same pass); then nothing for 2 min", async () => {
    const h = harness({ open: () => FAIL() });
    await h.job.tick();
    expect(h.opens).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 23; i++) { h.advance(5000); await h.job.tick(); } // < 2 min later
    expect(h.opens).toHaveBeenCalledTimes(2);
  });
  it("two failures in a row → the next try 2 min later, not less and not more", async () => {
    const tries: number[] = [];
    const h = harness({ open: () => { tries.push(h.at()); return FAIL(); } });
    for (let i = 0; i < 600 && tries.length < 5; i++) { await h.job.tick(); h.advance(1000); }
    expect(tries.length).toBe(5);
    const gaps = tries.slice(1).map((x, i) => x - tries[i]);
    expect(gaps[0]).toBeLessThan(5000);                     // the immediate confirm try
    for (const g of gaps.slice(1)) { expect(g).toBeGreaterThanOrEqual(EMAP_OPEN_RETRY_MS); expect(g).toBeLessThanOrEqual(EMAP_OPEN_RETRY_MS + 1000 + 3200); }
  });
  it("a successful open stops the retries", async () => {
    let n = 0;
    const h = harness({ open: () => (++n <= 3 ? FAIL() : OPENED()) });
    for (let i = 0; i < 12 * 30; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.opens).toHaveBeenCalledTimes(4);
    expect(h.emap.usable()).toBe(true);
  });
  it("after a successful open the count starts again: the next failed open gets its immediate confirm try", async () => {
    const seq = [FAIL(), FAIL(), OPENED(), FAIL(), FAIL()];
    const h = harness({ open: () => seq.shift() ?? FAIL() });
    for (let i = 0; i < 400 && h.opens.mock.calls.length < 3; i++) { await h.job.tick(); h.advance(1000); }
    expect(h.emap.usable()).toBe(true);
    h.emap.verdict();               // an answer ends the episode
    h.emap._e().error = true;       // then the session lands on error.aspx
    const before = h.opens.mock.calls.length;
    await h.job.tick();
    expect(h.opens.mock.calls.length - before).toBe(2);
  });
  it("a 7-11 login → a try at once (not waiting the 2 min)", async () => {
    let since = "c1";
    const tries: number[] = [];
    const h = harness({ open: () => { tries.push(h.at()); return FAIL(); }, status: () => ({ state: "connected", since }) });
    await h.job.tick(); // 2 failed tries
    h.advance(10_000); since = "c2";
    await h.job.tick();
    expect(tries.length).toBe(3);
    expect(tries[2] - tries[1]).toBeLessThan(EMAP_OPEN_RETRY_MS);
  });
  it("never during 01:00–05:00 Taipei; the tries resume after 05:00", async () => {
    const h = harness({ start: NIGHT, open: () => FAIL() });
    for (let i = 0; i < 12 * 60; i++) { await h.job.tick(); h.advance(5000); } // 02:00 → 03:00
    expect(h.opens).not.toHaveBeenCalled();
    h.set(Date.parse("2026-11-17T21:00:10Z")); // 05:00:10 Taipei
    await h.job.tick();
    expect(h.opens).toHaveBeenCalledTimes(2);
  });
  it("the safety brake: 5 refused opens in a row (HTTP 429) → 15 min with no try at all", async () => {
    const tries: number[] = [];
    const h = harness({ open: () => { tries.push(h.at()); return FAIL(429, "cart_form_missing"); } });
    for (let i = 0; i < 12 * 60 && tries.length < 5; i++) { await h.job.tick(); h.advance(5000); }
    expect(tries.length).toBe(5);
    const fifth = tries[4];
    for (let i = 0; i < 12 * 14; i++) { await h.job.tick(); h.advance(5000); } // 14 more minutes
    expect(tries.length).toBe(5);
    expect(h.job.state().pausedUntil).toBeGreaterThanOrEqual(fifth + 15 * 60_000 - 1);
  });
  it("one log line per try, the outcome word only", async () => {
    const h = harness({ open: () => FAIL(200, "login_not_accepted") });
    await h.job.tick();
    const lines = h.logs.filter((l) => l.startsWith("[PC711_EMAP] open"));
    expect(lines).toEqual(["[PC711_EMAP] open result=login_not_accepted", "[PC711_EMAP] open result=login_not_accepted"]);
  });
});

// ═══ R11/R12 keepalive and the per-pass guid miss ═══════════════════════════════════
describe("R11 keepalive = pcEmapKeepalive: store 198002 every 5 min, only while nothing needs the store half", () => {
  it("idle 30 min → exactly one keepalive per 5 min (+ one right after opening)", async () => {
    const h = harness();
    for (let t = 0; t < 30 * 60_000; t += 5000) { await h.job.tick(); h.advance(5000); }
    const ka = h.calls.filter((c) => new URLSearchParams(c.body).get("k") === EMAP_KEEPALIVE_STORE);
    expect(ka.length).toBe(6); // right after opening, then every 5 min (5 s … 25 min 5 s)
    ka.slice(1).forEach((c, i) => expect(c.at - ka[i].at).toBeGreaterThanOrEqual(EMAP_KEEPALIVE_MS));
  });
  it("a pending store half (even in backoff) → no keepalive", async () => {
    const h = harness({ queue: [pend("store")], byid: (k) => (k === EMAP_KEEPALIVE_STORE ? { body: "OK;1+a+b+enable+0++門市" } : "timeout") });
    for (let t = 0; t < 12 * 60_000; t += 5000) { await h.job.tick(); h.advance(5000); }
    expect(h.calls.filter((c) => new URLSearchParams(c.body).get("k") === EMAP_KEEPALIVE_STORE).length).toBe(0);
  });
  it("NO2 for 198002 = a miss (never proof of life); open / full / company = a verdict; a timeout counts nothing", async () => {
    for (const [body, misses] of [["NO2", 1], ["OK;1+a+b+disable+0++門市", 0], ["OK;1+a+b+close+0++門市", 0]] as [string, number][]) {
      const h = harness({ byid: () => ({ body }) });
      await h.job.tick(); await h.job.tick();
      expect(h.emap._e().misses).toBe(misses);
    }
    const h = harness({ byid: () => "timeout" });
    await h.job.tick(); await h.job.tick();
    expect(h.emap._e().misses).toBe(0);
  });
  it("runs AFTER the parcels of the pass (pcRunOnce order: rows → keepalive → refresh)", async () => {
    const h = harness();
    await h.job.tick(); // open
    h.queue.push(pend("phone"));
    await h.job.tick();
    expect(h.events.slice(1)).toEqual(["phone", `sleep:${SHADOW_ROW_GAP_MS}`, "byid:keepalive"]);
  });
});

describe("R12 pick: a kept session with no guid (not on error.aspx) = one miss per pass", () => {
  it("3 passes → 3 misses", async () => {
    const h = harness({ page: () => ({ body: "<html>no guid</html>" }), byid: () => ({ body: "<html>" }) });
    await h.job.tick();
    const e = h.emap._e();
    e.guid = false; // as after a reload page without a guid
    h.emap._session()!.guid = "";
    const before = e.misses;
    h.queue.push(pend("store")); // keeps the keepalive away
    for (let i = 0; i < 3; i++) { await h.job.tick(); h.advance(1000); }
    expect(e.misses - before).toBeGreaterThanOrEqual(3);
  });
});

// ═══ R13 the row loop ═════════════════════════════════════════════════════════════
describe("R13 rows = pcPollMulti: a parcel's store half, then its phone half, then 2 s; ≤ 5 parcels a pass", () => {
  it("store → phone → 2 s, per parcel, in queue order", async () => {
    const h2 = harness();
    await h2.job.tick(); h2.events.length = 0; // the session is open
    h2.queue.push(...parcel(), ...parcel());
    await h2.job.tick();
    expect(h2.events.slice(0, 6)).toEqual(["byid:parcel", "phone", `sleep:${SHADOW_ROW_GAP_MS}`, "byid:parcel", "phone", `sleep:${SHADOW_ROW_GAP_MS}`]);
  });
  it("7 parcels → 5 this pass, the rest next pass", async () => {
    const h = harness();
    await h.job.tick(); h.events.length = 0;
    for (let i = 0; i < 7; i++) h.queue.push(...parcel());
    await h.job.tick();
    expect(h.events.filter((x) => x.startsWith("sleep")).length).toBe(5);
  });
  it("a parcel with nothing to do this pass (both halves waiting) is skipped: no request, no 2 s", async () => {
    const h = harness({ byid: () => "timeout", phone: () => ({ verdict: "unknown", http: 200, ms: 900, kind: "html", steps: [{ step: "phone.token", http: 200, ms: 900, ok: false, note: "kind=html" }] }) });
    await h.job.tick(); // open
    h.queue.push(...parcel());
    h.events.length = 0;
    await h.job.tick();
    expect(h.events).toEqual(["byid:parcel", "byid:parcel", "phone", `sleep:${SHADOW_ROW_GAP_MS}`]);
    h.events.length = 0; h.advance(1000);
    await h.job.tick();
    expect(h.events).toEqual([]);
  });
  it("rowsOf groups by parcel (and keeps a frozen job its own row)", () => {
    const j = (scanId: string, kind: string, mode = "after") => ({ job: { scanId, kind, mode } });
    const rows = rowsOf([j("a", "phone"), j("a", "store"), j("b", "frozen"), j("b", "phone"), j("a", "store", "mirror")]);
    expect(rows.map((r: { key: string; store: unknown; phone: unknown }) => [r.key, Boolean(r.store), Boolean(r.phone)])).toEqual([["after:a", true, true], ["after:b:frozen", true, false], ["after:b", false, true], ["mirror:a", true, false]]);
  });
});

// ═══ R14–R16 the phone half ═══════════════════════════════════════════════════════
describe("R14 phone token GET: 5 s, ONE immediate retry on timeout / network while < 2 failures, not at night", () => {
  it("the shadow asks for tokenMs 5000 and tokenRetry exactly when the extension would", async () => {
    const fail = { verdict: "unknown", http: 0, ms: 5000, kind: "timeout", steps: [{ step: "phone.token", http: 0, ms: 5000, ok: false, note: "kind=timeout" }] };
    const h = harness({ queue: [pend("phone")], phone: () => fail });
    for (let i = 0; i < 200; i++) { await h.job.tick(); h.advance(5000); }
    expect(h.phoneInputs.map((x) => x.tokenRetry)).toEqual([true, true, false, false, false, false]);
    expect(h.phoneInputs.every((x) => x.tokenMs === 5000)).toBe(true);
    const n = harness({ start: NIGHT, queue: [pend("phone")], phone: () => fail });
    await n.job.tick();
    expect(n.phoneInputs[0].tokenRetry).toBe(false);
  });
  it("the probe: a second token GET only after a timeout / network error and only with tokenRetry; 5 s per GET", async () => {
    const GM = "GM2609096130694";
    const settings = async (k: string) => ({ parcel_check_shared_gms: JSON.stringify([GM]), parcel_check_sender_phone: "0979000111" } as Record<string, string>)[k] ?? null;
    const run = async (first: Reply, retry: boolean) => {
      const gets: number[] = [];
      let i = 0;
      const timeouts: number[] = [];
      const realSet = globalThis.setTimeout;
      const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => { timeouts.push(Number(ms)); return realSet(fn, ms); }) as never);
      const f = vi.fn(async (url: string) => {
        if (url.includes("/cart/easy/")) { gets.push(1); const r = i++ === 0 ? first : { body: "<script>var tokenID = 'T:1';</script>" };
          if (r === "timeout") throw Object.assign(new Error("a"), { name: "AbortError" }); if (r === "network") throw new TypeError("x");
          return { status: r.status ?? 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, text: async () => r.body ?? "" }; }
        return { status: 200, ok: true, headers: { get: (k: string) => (k === "content-type" ? "application/json" : null), getSetCookie: () => [] }, text: async () => JSON.stringify({ Status: true }) };
      });
      const r = await runPcServerProbe({ fetchImpl: f as never, now: () => NOW, log: () => {}, readSetting: settings, gate: false,
        target: { kind: "phone", phone: MARK.phone, name: MARK.name, storeId: STORE, tokenMs: 5000, tokenRetry: retry } as never });
      spy.mockRestore();
      return { gets: gets.length, verdict: r.phone.verdict, timeouts };
    };
    expect(await run("timeout", true)).toMatchObject({ gets: 2, verdict: "ok" });
    expect(await run("network", true)).toMatchObject({ gets: 2, verdict: "ok" });
    expect(await run("timeout", false)).toMatchObject({ gets: 1, verdict: "unknown" });
    expect(await run({ status: 500 }, true)).toMatchObject({ gets: 1, verdict: "unknown" });
    expect((await run({ body: "<script>var tokenID = 'T:1';</script>" }, true)).timeouts).toContain(5000);
  });
});

describe("R15 phone ladder = pcPhoneBackoffDelay, from the END of the attempt", () => {
  it("fast 5/10/20/60/120 s for a token GET with no answer; the store ladder for every other no-answer (a POST timeout too)", () => {
    const x = extFns(false);
    const tok = (kind: string) => ({ kind, steps: [{ step: "phone.token" }] });
    const post = (kind: string) => ({ kind, steps: [{ step: "phone.token" }, { step: "phone.validate" }] });
    for (let n = 1; n <= 7; n++) {
      expect(phoneBackoffDelay(n, tok("timeout"))).toBe(x.pcPhoneBackoffDelay(n, "timeout"));
      expect(phoneBackoffDelay(n, tok("network"))).toBe(x.pcPhoneBackoffDelay(n, "network"));
      expect(phoneBackoffDelay(n, post("timeout"))).toBe(x.pcPhoneBackoffDelay(n, "post_timeout"));
      expect(phoneBackoffDelay(n, post("network"))).toBe(x.pcPhoneBackoffDelay(n, "post_network"));
      for (const k of ["http", "html", "redirect", "bad_json", "rejected"]) expect(phoneBackoffDelay(n, post(k))).toBe(x.pcPhoneBackoffDelay(n, k));
    }
  });
  it("a real run: an html answer waits 15 s / 30 s (not 5 s / 10 s) after the end of the attempt", async () => {
    const h = harness({ queue: [pend("phone")], phone: () => ({ verdict: "unknown", http: 200, ms: 900, kind: "html", steps: [{ step: "phone.token", http: 200, ms: 900, ok: false, note: "kind=html" }] }) });
    const at: number[] = [];
    for (let i = 0; i < 30; i++) { const n = h.phoneInputs.length; const s = h.at(); await h.job.tick(); if (h.phoneInputs.length > n) at.push(s); h.advance(5000); }
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(15_000);
    const h2 = harness({ queue: [pend("phone")], phone: () => ({ verdict: "unknown", http: 200, ms: 900, kind: "html", steps: [{ step: "phone.token", http: 200, ms: 900, ok: false, note: "kind=html" }] }) });
    const s = h2.at();
    await h2.job.tick();
    expect([...h2.job._state().backoff.values()][0].nextAt).toBe(s + 900 + 15_000); // the END of the attempt (+900 ms check) + 15 s
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(30_000);
  });
});

describe("R16 a phone with no answer → the other phone halves wait this pass (stalledGms); store halves go on", () => {
  it("first phone times out → the next parcels' phones are not asked this pass, their stores are", async () => {
    const h = harness({ phone: () => ({ verdict: "unknown", http: 0, ms: 5000, kind: "timeout", steps: [{ step: "phone.token", http: 0, ms: 5000, ok: false, note: "kind=timeout" }] }) });
    await h.job.tick(); h.events.length = 0;
    h.queue.push(...parcel(), ...parcel(), ...parcel());
    await h.job.tick();
    expect(h.events.filter((x) => x === "phone").length).toBe(1);
    expect(h.events.filter((x) => x === "byid:parcel").length).toBe(3);
  });
});

// ═══ R17 maintenance 01:00–05:00 ══════════════════════════════════════════════════
describe("R17 01:00–05:00 Taipei: failures not counted, retry in 10 min, no recovery, no re-open, no token retry", () => {
  it("a store failure at night: no miss, no fail count, next try 10 min after the pass start", async () => {
    const h = harness({ start: NIGHT - 6 * 3600_000, byid: () => ({ body: "<html>" }) });
    await h.job.tick(); // opened in the day
    h.set(NIGHT);
    h.queue.push(pend("store"));
    const passStart = h.at();
    await h.job.tick();
    const b = [...h.job._state().backoff.values()][0];
    expect(b).toMatchObject({ fails: 0, nextAt: passStart + SHADOW_MAINT_RETRY_MS });
    expect(h.emap._e().misses).toBe(0);
  });
});

// ═══ R18 logs ═════════════════════════════════════════════════════════════════════
describe("R18 logs hold no store number, phone, name, cookie, token or guid", () => {
  it("a day of mixed passes", async () => {
    const h = harness({ byid: (k) => (k === STORE2 ? { body: "<html>" } : { body: "OK;1+a+b+enable+0++門市" }), page: () => ({ status: 302, location: "/mobilemap/error.aspx" }) });
    for (let i = 0; i < 200; i++) { if (i % 3 === 0) h.queue.push(...parcel(), pend("store", { store_id: STORE2, input: STORE2 })); await h.job.tick(); h.advance(5000); }
    for (let i = 0; i < 200; i++) { await h.job.tick(); h.advance(5000); } // idle: keepalive lines too
    const all = h.logs.join("\n");
    expect(all).toContain("[PC711_EMAP] keepalive");
    for (const v of [STORE, STORE2, EMAP_KEEPALIVE_STORE, MARK.guid, MARK.guid2, MARK.cookie, MARK.phone, MARK.name]) expect(all).not.toContain(v);
    expect(all).toContain("[PC711_EMAP] open result=ok");
  });
});

// ═══ F the frozen lane = frozen-check.js + emap-frozen-711.js (not the warm-up) ══════════════════
describe("F frozen numbers = the extension's", () => {
  it("2.5 s per frozen request; a store at most once per 10 min; 10 min pause after a slow answer", () => {
    expect(EMAP_FROZEN_REQUEST_MS).toBe(constOf(EMAP_FROZEN_JS, "TIMEOUT_MS"));
    expect(EMAP_FROZEN_STORE_GAP_MS).toBe(constOf(FROZEN_JS, "STORE_GAP_MS"));
    expect(SHADOW_FROZEN_STORE_GAP_MS).toBe(constOf(FROZEN_JS, "STORE_GAP_MS"));
    expect(EMAP_FROZEN_SLOW_PAUSE_MS).toBe(constOf(FROZEN_JS, "SLOW_PAUSE_MS"));
    expect(SHADOW_FROZEN_SLOW_PAUSE_MS).toBe(constOf(FROZEN_JS, "SLOW_PAUSE_MS"));
  });
});

const frozen = (store: string, o: R = {}) => pend("frozen", { store_id: store, input: store, ...o });
const frozenByids = (h: ReturnType<typeof harness>) => h.calls.filter((c) => new URLSearchParams(c.body).get("cate") === "27");

describe("F1 the frozen request is cut at 2.5 s (headers AND body); the store request keeps 10 s", () => {
  it("timer lengths used for a frozen check and a store check", async () => {
    const h = harness({ queue: [frozen("100001"), pend("store")] });
    await h.job.tick(); // open
    const seen: number[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => { seen.push(Number(ms)); return real(fn, ms); }) as never);
    await h.job.tick();
    spy.mockRestore();
    expect(frozenByids(h).length).toBe(1);
    expect(seen).toContain(EMAP_FROZEN_REQUEST_MS);
    expect(seen).toContain(EMAP_REQUEST_MS);
  });
});

describe("F2 at most ONE frozen request a pass, after the parcels, before the keepalive; not one of the 5 parcels, no 2 s after it", () => {
  it("3 frozen parcels of 3 stores → one per pass", async () => {
    const h = harness({ queue: [frozen("100001"), frozen("100002"), frozen("100003")] });
    await h.job.tick(); // open
    for (let i = 1; i <= 3; i++) { await h.job.tick(); expect(frozenByids(h).length).toBe(i); h.advance(5000); }
  });
  it("order in a pass: the parcels (store → phone → 2 s) → the frozen request → the keepalive; 5 parcels + 1 frozen", async () => {
    const h = harness();
    await h.job.tick(); h.advance(EMAP_KEEPALIVE_MS); h.events.length = 0;
    for (let i = 0; i < 5; i++) h.queue.push(pend("phone"));
    h.queue.push(frozen("100009"));
    await h.job.tick();
    expect(h.events).toEqual([...Array.from({ length: 5 }, () => ["phone", `sleep:${SHADOW_ROW_GAP_MS}`]).flat(), "byid:frozen", "byid:keepalive"]);
  });
});

describe("F3 a store is asked for frozen at most once per 10 min (from the request, answered or not)", () => {
  it("two frozen parcels of the SAME store: the second waits 10 min after the first request", async () => {
    const h = harness({ queue: [frozen("100001"), frozen("100001")] });
    await h.job.tick(); // open
    await h.job.tick();
    const first = frozenByids(h)[0].at;
    for (let i = 0; i < 12 * 12 && frozenByids(h).length < 2; i++) { h.advance(5000); await h.job.tick(); }
    const second = frozenByids(h)[1].at;
    expect(second - first).toBeGreaterThanOrEqual(EMAP_FROZEN_STORE_GAP_MS);
    expect(second - first).toBeLessThan(EMAP_FROZEN_STORE_GAP_MS + 5000 + 5000);
  });
  it("a frozen no-answer also holds that store 10 min (the floor starts at the request)", async () => {
    const h = harness({ queue: [frozen("100001")], byid: (_k, c) => (new URLSearchParams(c.body).get("cate") === "27" ? { body: "<html>" } : { body: "OK;1+a+b+enable+0++門市" }) });
    await h.job.tick(); await h.job.tick();
    const first = frozenByids(h)[0].at;
    for (let i = 0; i < 12 * 12 && frozenByids(h).length < 2; i++) { h.advance(5000); await h.job.tick(); }
    expect(frozenByids(h)[1].at - first).toBeGreaterThanOrEqual(EMAP_FROZEN_STORE_GAP_MS);
  });
});

describe("F4 one map address per frozen check; a real non-answer → the other address NEXT time; a blip keeps it", () => {
  it("odd answer from /mobilemap/ → next frozen check asks /ecmap/ (and only that one)", async () => {
    const h = harness({ queue: [frozen("100001"), frozen("100002")], byid: (_k, c) => (c.path.startsWith("/mobilemap/") ? { body: "<html>" } : { body: "OK;1+a+b+enable+0++門市" }) });
    await h.job.tick(); await h.job.tick(); h.advance(5000); await h.job.tick();
    expect(frozenByids(h).map((c) => c.path)).toEqual(["/mobilemap/byIDData.aspx", "/ecmap/byIDData.aspx"]);
  });
  it("a timeout keeps the address", async () => {
    let n = 0;
    const h = harness({ start: NIGHT - 6 * 3600_000, queue: [frozen("100001"), frozen("100002")], byid: () => (n++ === 0 ? "timeout" : { body: "OK;1+a+b+enable+0++門市" }) });
    await h.job.tick(); await h.job.tick(); h.advance(EMAP_FROZEN_SLOW_PAUSE_MS); await h.job.tick();
    expect(frozenByids(h).map((c) => c.path)).toEqual(["/mobilemap/byIDData.aspx", "/mobilemap/byIDData.aspx"]);
  });
});

describe("F5 a slow / missing frozen answer by day → no frozen request for 10 min; the night never pauses", () => {
  it("day: a timeout → the next frozen request ≥ 10 min later", async () => {
    let n = 0;
    const h = harness({ queue: [frozen("100001"), frozen("100002")], byid: (_k, c) => (new URLSearchParams(c.body).get("cate") === "27" && n++ === 0 ? "timeout" : { body: "OK;1+a+b+enable+0++門市" }) });
    await h.job.tick(); await h.job.tick();
    const first = frozenByids(h)[0].at;
    for (let i = 0; i < 12 * 12 && frozenByids(h).length < 2; i++) { h.advance(5000); await h.job.tick(); }
    expect(frozenByids(h)[1].at - first).toBeGreaterThanOrEqual(EMAP_FROZEN_SLOW_PAUSE_MS);
  });
  it("night: a timeout → the next frozen parcel (another store) is asked on the next pass", async () => {
    let n = 0;
    const h = harness({ start: NIGHT - 6 * 3600_000, queue: [], byid: (_k, c) => (new URLSearchParams(c.body).get("cate") === "27" && n++ === 0 ? "timeout" : { body: "OK;1+a+b+enable+0++門市" }) });
    await h.job.tick(); // opened by day
    h.set(NIGHT); h.queue.push(frozen("100001"), frozen("100002"));
    await h.job.tick(); h.advance(5000); await h.job.tick();
    expect(frozenByids(h).length).toBe(2);
  });
  it("a frozen check never touches the E-Map recovery evidence", async () => {
    const h = harness({ queue: [frozen("100001")], byid: (_k, c) => (new URLSearchParams(c.body).get("cate") === "27" ? { body: "<html>" } : "timeout") });
    await h.job.tick(); await h.job.tick();
    expect(h.emap._e().misses).toBe(0);
  });
});
