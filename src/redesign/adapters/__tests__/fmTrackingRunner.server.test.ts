// server/fmTrackingRunner.js — the FamilyMart (全家) check against a FAKE site (no network, no
// tesseract) and a fake service-role client: session + one cookie jar, wrong captcha → retry,
// the daily cap, the breaker, a changed answer, which rows are asked, what is written, the logs.
import { describe, it, expect, vi } from "vitest";
import {
  runFmForJob, checkFmRows, readFmGate, fmGateFrom, selectFmRows, underFmCap, fmMaxRequestsPerSession,
  FM_DAILY_REQUEST_CAP, FM_PARCELS_PER_JOB, FM_JOB_MAX_MS, FM_BREAKER_FAILURES, FM_BREAKER_COOLDOWN_MS,
  FM_SETTING_ENABLED, FM_SETTING_COOLDOWN,
} from "../../../../server/fmTrackingRunner.js";
import { FM_CODES, FM_BASE } from "../../../../server/fmTracking.js";

const NOW = new Date("2026-11-12T03:00:00.000Z"); // 11:00 Taipei
const U1 = "user-1", U2 = "user-2";
const FAST = { requestGapMs: 0, requestJitterMs: 0, sessionGapMs: 0, sessionJitterMs: 0, baseBackoffMs: 0, maxBackoffMs: 0 };

type Step = Record<string, unknown>;
const steps = (ec: string, codes: string[], rtn = "2026/11/18", back: number[] = []): Step[] => codes.map((code, i) => ({
  ORDER_NO: back.includes(i) ? "16399999999" : ec, EC_ORDER_NO: ec, ORDER_STATUS: code, ORDER_DATE: `2026/11/${String(11 - Math.min(i, 9)).padStart(2, "0")}`,
  ORDER_TIME: "04:31", STATUS_D: (FM_CODES as Record<string, string>)[code] ?? "新狀態", RCV_STORE_NAME: "全家取件店", ORDER_DATE_RTN: rtn,
}));
const A = "16354220151", P = "16354226527", R = "16352835793", X = "16351746626", N = "16300000009", T = "16300000010";
const ANSWERS: Record<string, Step[] | null> = {
  [A]: steps(A, ["08", "073", "02", "01"]),
  [P]: steps(P, ["09", "08", "02", "01"]),
  [R]: steps(R, ["09", "08", "31", "12", "11", "08", "02", "01"], "2026/11/02", [0, 1]),
  [X]: steps(X, ["40", "01"], ""),
  [N]: null,
  [T]: steps(T, ["03", "02", "01"], ""),
};

// ── a fake 全家 site ────────────────────────────────────────────────────────────
type SiteOpts = { answers?: Record<string, Step[] | null>; perCaptcha?: number; http?: Record<string, number>; codeAnswer?: unknown };
function makeSite(o: SiteOpts = {}) {
  const answers = o.answers ?? ANSWERS;
  const log: { method: string; path: string; cookie: string; body: Record<string, unknown> | null }[] = [];
  const sessions = new Map<string, { verified: boolean; asked: number; codes: Map<string, string> }>();
  let sess = 0, codeN = 0, active = 0, maxActive = 0;
  const wrap = (inner: unknown) => JSON.stringify({ d: JSON.stringify(inner) });
  const res = (status: number, body: string | Uint8Array, cookies: string[] = []) => ({
    status, headers: { getSetCookie: () => cookies },
    text: async () => (typeof body === "string" ? body : ""),
    arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body).buffer : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
  });
  const fetchImpl = async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    active += 1; maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    try {
      if (!url.startsWith(FM_BASE)) return res(404, "");
      const u = new URL(url);
      const path = u.pathname.slice(new URL(FM_BASE).pathname.length);
      const method = init.method ?? "GET";
      const cookie = String(init.headers?.Cookie ?? "");
      const body = init.body ? JSON.parse(init.body) as Record<string, unknown> : null;
      log.push({ method, path, cookie, body });
      if (o.http?.[path]) return res(o.http[path], "blocked");
      if (path === "index.aspx" && method === "GET") {
        const id = `S${++sess}`;
        sessions.set(id, { verified: false, asked: 0, codes: new Map() });
        return res(200, "<html></html>", [`ASP.NET_SessionId=${id}; path=/; HttpOnly`, `TS01=ts${sess}; Path=/`]);
      }
      const s = sessions.get(/ASP\.NET_SessionId=(S\d+)/.exec(cookie)?.[1] ?? "");
      if (!s || !cookie.includes("TS01=")) return res(500, "no session"); // the jar was dropped
      if (path === "index.aspx/GetVerificationCode") {
        if (o.codeAnswer !== undefined) return res(200, wrap(o.codeAnswer));
        const code = `c${++codeN}||Y=`;
        s.codes.set(code, String(100000 + codeN * 7919).slice(0, 6));
        return res(200, wrap({ Code: code }), [`cookie_x=v${codeN}; path=/`]);
      }
      if (path === "CodeHandler.ashx") return res(200, new TextEncoder().encode(s.codes.get(u.searchParams.get("Code") ?? "") ?? "000000"));
      if (path === "index.aspx/ChkVerificationCode") {
        const ok = s.codes.get(String(body?.P_VCODE)) === body?.P_CODE;
        if (ok) { s.verified = true; s.asked = 0; }
        return res(200, wrap({ success: ok ? "1" : "0" }));
      }
      if (path === "list.aspx" && method === "GET") return res(200, "<html></html>");
      if (path === "list.aspx/InquiryOrders") {
        if (!s.verified || (o.perCaptcha && s.asked >= o.perCaptcha)) return res(200, wrap({ ErrorCode: "999", ErrorMessage: "請重新驗證", List: null }));
        s.asked += 1;
        const no = String(body?.ListEC_ORDER_NO);
        return res(200, wrap({ ErrorCode: "000", ErrorMessage: "成功", List: [{ EC_ORDER_NO: no, CNT: answers[no] ? 1.0 : 0.0, ORDER_NO: answers[no] ? no : null, ORDERMESSAGE: null }] }));
      }
      if (path === "list.aspx/GetOrderDetail") return res(200, wrap({ ErrorCode: "000", ErrorMessage: "成功", List: answers[String(body?.EC_ORDER_NO)] ?? [] }));
      return res(404, "");
    } finally { active -= 1; }
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, log, get maxActive() { return maxActive; }, get sessions() { return sess; } };
}
// OCR stand-in: the fake picture IS the answer. `wrongFirst` answers are given before the right ones.
function makeOcr(wrongFirst: string[] = []) {
  const state = { made: 0, terminated: 0, solved: 0 };
  const queue = [...wrongFirst];
  const factory = vi.fn(async () => {
    state.made += 1;
    return {
      solve: async (bytes: Uint8Array) => { state.solved += 1; return queue.length ? queue.shift()! : new TextDecoder().decode(bytes); },
      terminate: async () => { state.terminated += 1; },
    };
  });
  return { factory, state };
}

// ── a fake service-role client ─────────────────────────────────────────────────
type Row = Record<string, unknown>;
type Q = { table: string; op: string; filters: unknown[][]; patch: unknown };
type DbCfg = { settings?: Record<string, string>; settingsError?: boolean; rows?: Row[]; daily?: Row | null; dailyError?: boolean; open?: boolean | null; openError?: boolean; selectError?: boolean };
function fakeDb(cfg: DbCfg = {}) {
  const settings: Record<string, string> = { ...(cfg.settings ?? {}) };
  const rows: Row[] = (cfg.rows ?? []).map((r) => ({ ...r }));
  let daily: Row | null = cfg.daily ?? null;
  const queries: Q[] = [];
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const eqs = (q: Q) => q.filters.filter((f) => f[0] === "eq") as [string, string, unknown][];
  const matching = (q: Q) => rows.filter((r) => eqs(q).every(([, col, val]) => r[col] === val));
  const resolve = (q: Q) => {
    if (q.table === "app_settings") {
      if (q.op === "upsert") { const p = q.patch as { key: string; value: string }; settings[p.key] = p.value; return { data: null, error: null }; }
      if (cfg.settingsError) return { data: null, error: { code: "XX" } };
      const keys = (q.filters.find((f) => f[0] === "in")?.[2] ?? []) as string[];
      return { data: keys.filter((k) => k in settings).map((key) => ({ key, value: settings[key] })), error: null };
    }
    if (q.table === "fm_tracking_daily") {
      if (q.op === "upsert") { daily = { ...(q.patch as Row) }; return { data: null, error: null }; }
      return cfg.dailyError ? { data: null, error: { code: "42P01" } } : { data: daily, error: null };
    }
    if (q.table === "parcel_tracking") {
      if (q.op === "select") {
        if (cfg.selectError) return { data: null, error: { code: "XX" } };
        const r = q.filters.find((f) => f[0] === "range") as [string, number, number];
        return { data: matching(q).slice(r[1], r[2] + 1), error: null };
      }
      if (q.op === "update") { for (const r of matching(q)) Object.assign(r, q.patch as Row); return { data: null, error: null }; }
      if (q.op === "delete") { for (const r of matching(q)) rows.splice(rows.indexOf(r), 1); return { data: null, error: null }; }
    }
    return { data: null, error: null };
  };
  const from = (table: string) => {
    const q: Q = { table, op: "select", filters: [], patch: null };
    queries.push(q);
    const ch: Record<string, unknown> = new Proxy({}, {
      get(_t, k: string) {
        if (k === "then") return (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(resolve(q)).then(f, r);
        return (...args: unknown[]) => {
          if (["update", "insert", "delete", "upsert"].includes(k)) { q.op = k; q.patch = args[0] ?? null; }
          else if (k !== "select" && k !== "maybeSingle") q.filters.push([k, ...args]);
          return ch;
        };
      },
    });
    return ch;
  };
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    rpcs.push({ name, args });
    if (name === "fm_check_open_for") return Promise.resolve(cfg.openError ? { data: null, error: { code: "XX" } } : { data: cfg.open ?? false, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  return {
    from, rpc, queries, rpcs, rows, settings, get daily() { return daily; },
    writes: () => queries.filter((q) => q.table === "parcel_tracking" && q.op !== "select"),
    health: () => queries.filter((q) => q.table === "parcel_tracking_health").map((q) => q.patch as Row),
  };
}
const ON = { [FM_SETTING_ENABLED]: "true", fm_pickup_enabled: "true" };
const row = (id: string, tracking_no: string | null, extra: Row = {}): Row => ({
  id, user_id: U1, carrier: "fm", tracking_no, status: "in_transit", terminal: false, arrived_at: null, rec_store: null,
  created_at: "2026-11-10T00:00:00.000Z", last_polled_at: null, pickup_deadline: null, ...extra,
});
const quiet = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
const lines = (l: ReturnType<typeof quiet>) => [...l.log.mock.calls, ...l.warn.mock.calls, ...l.error.mock.calls].map((c) => c.join(" ")).join("\n");
const job = (kind = "manual") => ({ id: "J1", user_id: U1, kind, created_by: "seller" });
const all = (rows: Row[]) => ({ rows, capped: false });
const run = (db: ReturnType<typeof fakeDb>, site: ReturnType<typeof makeSite>, extra: Record<string, unknown> = {}) => {
  const ocr = makeOcr((extra.wrongFirst as string[]) ?? []);
  const logger = quiet();
  return runFmForJob({ serviceSb: db, job: job(), scopeOf: all, fetchImpl: site.fetchImpl, makeOcr: ocr.factory, now: () => NOW, logger, limits: FAST, ...extra })
    .then((out: Record<string, unknown>) => ({ out, ocr, logger }));
};

describe("gate — kill switch, pause, who", () => {
  it("fmGateFrom: only the exact word 'true' runs; a pause in the future stops it", () => {
    expect(fmGateFrom({ enabled: undefined, cooldownUntil: null }, NOW)).toEqual({ run: false, reason: "disabled" });
    expect(fmGateFrom({ enabled: "false", cooldownUntil: null }, NOW).run).toBe(false);
    expect(fmGateFrom({ enabled: "1", cooldownUntil: null }, NOW).run).toBe(false);
    expect(fmGateFrom({ enabled: " TRUE ", cooldownUntil: null }, NOW).run).toBe(true);
    expect(fmGateFrom({ enabled: "true", cooldownUntil: "2026-11-12T04:00:00.000Z" }, NOW)).toEqual({ run: false, reason: "cooldown" });
    expect(fmGateFrom({ enabled: "true", cooldownUntil: "2026-11-12T02:00:00.000Z" }, NOW).run).toBe(true);
  });
  it("no fm_check_enabled row (sql/150 not applied) → off, after ONE small read and nothing else", async () => {
    const db = fakeDb({ rows: [row("a", A)] });
    expect(await readFmGate(db, U1, NOW)).toEqual({ run: false, reason: "disabled" });
    expect(db.queries.map((q) => q.table)).toEqual(["app_settings"]);
    expect(db.rpcs).toEqual([]);
  });
  it("全家 open for everyone → runs without asking the preview list", async () => {
    const db = fakeDb({ settings: ON });
    expect((await readFmGate(db, U1, NOW)).run).toBe(true);
    expect(db.rpcs).toEqual([]);
  });
  it("全家 not open for everyone → only a seller on the preview list (asked with the explicit user id)", async () => {
    const listed = fakeDb({ settings: { [FM_SETTING_ENABLED]: "true", fm_pickup_enabled: "false" }, open: true });
    expect((await readFmGate(listed, U1, NOW)).run).toBe(true);
    expect(listed.rpcs).toEqual([{ name: "fm_check_open_for", args: { p_user_id: U1 } }]);
    const other = fakeDb({ settings: { [FM_SETTING_ENABLED]: "true" }, open: false });
    expect(await readFmGate(other, U1, NOW)).toEqual({ run: false, reason: "not_allowed" });
    const broken = fakeDb({ settings: { [FM_SETTING_ENABLED]: "true" }, openError: true });
    expect(await readFmGate(broken, U1, NOW)).toEqual({ run: false, reason: "access_read_failed" });
  });
  it("a settings read error → does not run", async () => {
    expect(await readFmGate(fakeDb({ settings: ON, settingsError: true }), U1, NOW)).toEqual({ run: false, reason: "settings_read_failed" });
  });
  it("picture settings come from app_settings fm_check_captcha when present", async () => {
    const g = await readFmGate(fakeDb({ settings: { ...ON, fm_check_captcha: '{"threshold":140,"scale":4}' } }), U1, NOW) as unknown as { image: Record<string, unknown> };
    expect(g.image).toMatchObject({ threshold: 140, scale: 4, invert: true });
  });
});

describe("which rows are asked", () => {
  it("only this seller's 全家 rows that are not finished and have an 11-digit 寄件編號 — with explicit filters", async () => {
    const db = fakeDb({ rows: [
      row("a", A), row("b", "L26A1113SG"), row("c", null), row("d", P, { terminal: true, status: "picked_up" }),
      row("e", T, { user_id: U2 }), row("f", "F1234567890", { carrier: "711" }), row("g", R),
    ] });
    const sel = await selectFmRows(db, U1) as { rows: Row[] };
    expect(sel.rows.map((r) => r.id)).toEqual(["a", "g"]);
    const q = db.queries[0];
    expect(q.filters).toEqual(expect.arrayContaining([["eq", "user_id", U1], ["eq", "carrier", "fm"], ["eq", "terminal", false]]));
  });
  it("a select error → nothing runs (never a partial set)", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A)], selectError: true });
    const { out } = await run(db, makeSite());
    expect(out).toMatchObject({ ran: false, reason: "select_failed", total: 0 });
  });
});

describe("a whole job against the fake site", () => {
  it("each parcel gets its answer; the finished one is closed, the void one removed, the unknown one left alone", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A), row("p", P), row("r", R), row("x", X), row("n", N, { status: "at_store", pickup_deadline: "2026-11-20" }), row("t", T, { pickup_deadline: "2026-11-25" })] });
    const site = makeSite();
    const { out, ocr, logger } = await run(db, site);
    expect(out).toMatchObject({ ran: true, total: 6, checked: 6, failed: false, reason: null });
    const by = Object.fromEntries(db.rows.map((r) => [r.id, r]));
    expect(by.a).toMatchObject({ status: "at_store", terminal: false, pickup_deadline: "2026-11-18", status_message: "貨件配達取件店舖", rec_store: "全家取件店", last_polled_at: NOW.toISOString() });
    expect(by.a.arrived_at).toBeTruthy();
    expect(by.p).toMatchObject({ status: "picked_up", terminal: true });
    expect(by.p.picked_up_at).toBeTruthy();
    expect(by.r).toMatchObject({ status: "returned", terminal: true, status_message: "未取退回物流中心", pickup_deadline: "2026-11-02" });
    expect(by.x).toBeUndefined();                                                                        // 40 → removed
    expect(by.n).toMatchObject({ status: "at_store", pickup_deadline: "2026-11-20", last_polled_at: NOW.toISOString() }); // not found → nothing but the check time
    expect(by.t).toMatchObject({ status: "in_transit", pickup_deadline: null });                          // on its way → no "drop off before"
    // every write: by id + this user + carrier fm, and never the tracking number
    for (const w of db.writes()) {
      expect(w.filters).toEqual(expect.arrayContaining([["eq", "user_id", U1], ["eq", "carrier", "fm"]]));
      expect(w.filters.some((f) => f[0] === "eq" && f[1] === "id")).toBe(true);
      if (w.patch) expect(w.patch).not.toHaveProperty("tracking_no");
    }
    // 6 parcels at 5 per captcha → 2 sessions, one request at a time
    expect(site.sessions).toBe(2);
    expect(site.maxActive).toBe(1);
    expect(ocr.state).toMatchObject({ made: 1, terminated: 1 });
    // counters: every request counted, per day
    expect(db.daily).toMatchObject({ day: "2026-11-12", requests: site.log.length, captcha_tries: 2, captcha_hits: 2, parcels: 6 });
    expect(out.requests).toBe(site.log.length);
    // health row: kind fm, counts only
    expect(db.health()).toEqual([expect.objectContaining({ kind: "fm", job_id: "J1", ok: true, queries: 2, updated: 6, errors: 0, retired: 1, requests: site.log.length, sellers: 1 })]);
    // per-session captcha line + the final line
    const text = lines(logger);
    expect(text).toMatch(/\[FM-CHECK\] session user=user-1 captcha=1\/1 parcels=5\/5/);
    expect(text).toMatch(/\[FM-CHECK\] done job=J1 user=user-1 kind=manual checked=6\/6 .*removed=1 .*captcha=2\/2/);
  });

  it("ONE cookie jar from the first request of a session to its last; a new session starts clean", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A), row("p", P), row("r", R), row("x", X), row("n", N), row("t", T)] });
    const site = makeSite();
    await run(db, site);
    const starts = site.log.map((l, i) => (l.path === "index.aspx" ? i : -1)).filter((i) => i >= 0);
    expect(starts.length).toBe(2);
    expect(site.log[starts[0]].cookie).toBe("");
    expect(site.log[starts[1]].cookie).toBe(""); // nothing carried over from session 1
    const first = site.log.slice(starts[0] + 1, starts[1]), second = site.log.slice(starts[1] + 1);
    expect(first.every((l) => l.cookie.includes("ASP.NET_SessionId=S1") && l.cookie.includes("TS01=ts1"))).toBe(true);
    expect(second.every((l) => l.cookie.includes("ASP.NET_SessionId=S2") && l.cookie.includes("TS01=ts2"))).toBe(true);
    expect(first.filter((l) => l.path.startsWith("list.aspx/")).every((l) => l.cookie.includes("cookie_x="))).toBe(true); // cookies set mid-session are kept too
    // the request shapes of the contract
    const chk = first.find((l) => l.path === "index.aspx/ChkVerificationCode")!;
    expect(Object.keys(chk.body!)).toEqual(["P_CODE", "P_VCODE"]);
    expect(String(chk.body!.P_CODE)).toMatch(/^\d{6}$/);
    expect(first.find((l) => l.path === "list.aspx/InquiryOrders")!.body).toEqual({ ListEC_ORDER_NO: A });
    expect(first.find((l) => l.path === "list.aspx/GetOrderDetail")!.body).toEqual({ EC_ORDER_NO: A, RCV_USER_NAME: null, ORDER_NO: A });
    expect(first.find((l) => l.path === "index.aspx/GetVerificationCode")!.body).toEqual({});
    expect(first.find((l) => l.path === "CodeHandler.ashx")!.method).toBe("GET");
  });

  it("a wrong captcha → a new captcha in the SAME session; tries and hits are logged", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A)] });
    const site = makeSite();
    const { out, logger } = await run(db, site, { wrongFirst: ["000001", "12"] });
    expect(out).toMatchObject({ checked: 1, failed: false });
    expect(site.sessions).toBe(1);
    expect(site.log.filter((l) => l.path === "index.aspx/GetVerificationCode").length).toBe(3);
    expect(site.log.filter((l) => l.path === "index.aspx/ChkVerificationCode").length).toBe(2); // "12" was never sent
    expect(lines(logger)).toMatch(/session user=user-1 captcha=1\/3 parcels=1\/1/);
    expect(db.daily).toMatchObject({ captcha_tries: 3, captcha_hits: 1 });
  });

  it("the site answers fewer parcels per captcha than we guessed → the rest is asked in new sessions of that size, and it says so", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A), row("p", P), row("r", R), row("t", T), row("n", N)] });
    const site = makeSite({ perCaptcha: 2 });
    const { out, logger } = await run(db, site);
    expect(out).toMatchObject({ total: 5, checked: 5, failed: false });
    expect(site.sessions).toBe(3); // 2 + 2 + 1
    expect(lines(logger)).toMatch(/the site answered 2 parcel\(s\) per captcha — FM_PARCELS_PER_SESSION is too high/);
    expect(lines(logger)).toMatch(/error=inquiry_shape \(keys=ErrorCode,ErrorMessage,List code=999\)/);
    expect(db.settings[FM_SETTING_COOLDOWN]).toBeUndefined(); // not a failure
  });

  it("an answer in another shape → the session stops with a clear line (keys only); no parcel is touched", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A, { status: "at_store", pickup_deadline: "2026-11-20" })] });
    const site = makeSite({ codeAnswer: { Token: "x", Img: "y" } });
    const { out, logger } = await run(db, site);
    expect(out).toMatchObject({ checked: 0, failed: true });
    expect(lines(logger)).toMatch(/error=code_shape \(keys=Token,Img\)/);
    expect(db.rows[0]).toMatchObject({ status: "at_store", pickup_deadline: "2026-11-20", terminal: false });
  });

  it("an unknown step code → the parcel is 'unknown', one clear line with the code", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A, { status: "at_store", pickup_deadline: "2026-11-20", arrived_at: "2026-11-09T00:00:00.000Z" })] });
    const site = makeSite({ answers: { [A]: steps(A, ["77", "08", "02", "01"]) } });
    const { out, logger } = await run(db, site);
    expect(out.checked).toBe(1);
    expect(db.rows[0]).toMatchObject({ status: "unknown", terminal: false, pickup_deadline: "2026-11-20", arrived_at: "2026-11-09T00:00:00.000Z" });
    expect(lines(logger)).toMatch(/UNKNOWN step code=77/);
  });
});

describe("limits", () => {
  it("the constants the owner agreed", () => {
    expect([FM_DAILY_REQUEST_CAP, FM_PARCELS_PER_JOB, FM_JOB_MAX_MS, FM_BREAKER_FAILURES, FM_BREAKER_COOLDOWN_MS]).toEqual([1500, 60, 8 * 60 * 1000, 3, 4 * 60 * 60 * 1000]);
    expect(fmMaxRequestsPerSession()).toBe(2 + 3 * 4 + 2 * 5);
    expect(underFmCap(1500 - 24)).toBe(true);
    expect(underFmCap(1500 - 23)).toBe(false);
  });
  it("daily cap: a session that could pass it is not started — no request, no OCR", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A)], daily: { requests: 1490, captcha_tries: 9, captcha_hits: 8, parcels: 300 } });
    const site = makeSite();
    const { out, ocr, logger } = await run(db, site);
    expect(out).toMatchObject({ ran: true, total: 1, checked: 0, failed: true, reason: "daily_cap", requests: 0 });
    expect(site.log.length).toBe(0);
    expect(ocr.state.made).toBe(0);
    expect(lines(logger)).toMatch(/daily request cap hit \(1490\/1500\)/);
    expect(db.health()[0]).toMatchObject({ kind: "fm", ok: false, reason: "daily_cap", requests: 0 });
  });
  it("the cap stops a job part-way: sessions before it are kept", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A), row("p", P), row("t", T)], daily: { requests: 0, captcha_tries: 0, captcha_hits: 0, parcels: 0 } });
    const site = makeSite();
    // one parcel per session: a session can send up to 16 requests and really sends 7
    const { out } = await run(db, site, { limits: { ...FAST, perSession: 1, dailyRequestCap: 25 } });
    expect(out).toMatchObject({ reason: "daily_cap", checked: 2, failed: false }); // 7 + 16 ≤ 25, then 14 + 16 > 25
    expect(site.log.length).toBe(14);
  });
  it("a daily counter that cannot be read (sql/150 not applied) → nothing is sent", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A)], dailyError: true });
    const site = makeSite();
    const { out } = await run(db, site);
    expect(out).toMatchObject({ checked: 0, failed: true, reason: "daily_read_failed" });
    expect(site.log.length).toBe(0);
  });
  it("breaker: 3 failed sessions in a row → stop, a 4-hour pause is written, parcels keep their status", async () => {
    const many = Array.from({ length: 20 }, (_, i) => row(`r${i}`, String(16300000100 + i), { status: "at_store", pickup_deadline: "2026-11-20" }));
    const db = fakeDb({ settings: ON, rows: many });
    const site = makeSite({ http: { "index.aspx": 403 } });
    const { out, logger } = await run(db, site);
    expect(out).toMatchObject({ checked: 0, failed: true, reason: "circuit_open" });
    expect(site.log.length).toBe(3); // three tries, then it stops — not twenty
    expect(db.settings[FM_SETTING_COOLDOWN]).toBe(new Date(NOW.getTime() + FM_BREAKER_COOLDOWN_MS).toISOString());
    expect(db.rows.every((r) => r.status === "at_store" && r.pickup_deadline === "2026-11-20" && r.terminal === false)).toBe(true);
    expect(db.rows.filter((r) => r.last_polled_at).length).toBe(15); // the 3 failed groups are stamped so they do not lead the next job
    expect(lines(logger)).toMatch(/CIRCUIT OPEN — 3 failed sessions in a row/);
    expect(lines(logger)).toMatch(/error=index_http_403/);
    expect(db.health()[0]).toMatchObject({ kind: "fm", ok: false, reason: "circuit_open", errors: 3 });
    // the pause now stops the next job before any request
    expect(await readFmGate(db, U1, NOW)).toEqual({ run: false, reason: "cooldown" });
  });
  it("the time limit stops the job between sessions", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A), row("p", P)] });
    const site = makeSite();
    let t = NOW.getTime();
    const stats = await checkFmRows({
      serviceSb: db, rows: db.rows, userId: U1, daily: { day: "2026-11-12", requests: 0, captchaTries: 0, captchaHits: 0, parcels: 0 },
      fetchImpl: site.fetchImpl, makeOcr: makeOcr().factory, now: () => new Date((t += 60_000)), logger: quiet() as unknown as Console,
      limits: { ...FAST, perSession: 1 }, deadlineAt: NOW.getTime() + 150_000,
    });
    expect(stats).toMatchObject({ stopReason: "time_limit", sessions: 1, checked: 1 });
  });
  it("at most FM_PARCELS_PER_JOB parcels in one job", async () => {
    const many = Array.from({ length: 70 }, (_, i) => row(`r${i}`, String(16300000100 + i)));
    const db = fakeDb({ settings: ON, rows: many });
    const { out } = await run(db, makeSite({ answers: {} }));
    expect(out).toMatchObject({ total: 60, checked: 60, reason: "capped" });
  });
});

describe("privacy and isolation", () => {
  it("no log line carries a parcel number or a store name", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A), row("p", P), row("r", R), row("x", X), row("n", N)] });
    const { logger } = await run(db, makeSite());
    const text = lines(logger);
    for (const secret of [A, P, R, X, N, "全家取件店"]) expect(text).not.toContain(secret);
  });
  it("switch off → no request, no row read, no health row", async () => {
    const db = fakeDb({ settings: { fm_pickup_enabled: "true" }, rows: [row("a", A)] });
    const site = makeSite();
    const { out, ocr } = await run(db, site);
    expect(out).toEqual({ ran: false, reason: "disabled", total: 0, checked: 0, failed: false, requests: 0 });
    expect(site.log.length).toBe(0);
    expect(ocr.state.made).toBe(0);
    expect(db.queries.map((q) => q.table)).toEqual(["app_settings"]);
  });
  it("nothing due → no request and no health row", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A)] });
    const site = makeSite();
    const { out } = await run(db, site, { scopeOf: () => ({ rows: [], capped: false }) });
    expect(out).toMatchObject({ ran: false, reason: "nothing_due", total: 0 });
    expect(site.log.length).toBe(0);
    expect(db.health()).toEqual([]);
  });
  it("never throws: a crash inside becomes a failed 全家 part", async () => {
    const db = fakeDb({ settings: ON, rows: [row("a", A)] });
    const out = await runFmForJob({
      serviceSb: db, job: job(), scopeOf: all, now: () => NOW, logger: quiet(), limits: FAST,
      checkImpl: async () => { throw new Error("boom"); },
    });
    expect(out).toEqual({ ran: true, reason: "threw", total: 1, checked: 0, failed: true, requests: 0 });
  });
});
