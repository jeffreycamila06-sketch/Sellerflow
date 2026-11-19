// @vitest-environment node
// Telegram alerts to the Admin (server/telegramAlert.js, Jeff 2026-11-18). A FAKE Telegram only — no real
// request is ever made by these tests.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { createTelegramAlert, createAlertTestHandler, alertText, ALERT_TEXTS, TELEGRAM_SEND_MS, TELEGRAM_HOST, ALERT_TRIES, ALERT_RETRY_MS, ALERT_KEEP_MS, ALERT_AGAIN, ALERT_QUEUE_MAX } from "../../../../server/telegramAlert.js";

const TOKEN = "123456789:MARKTOKENaaaaBBBBccccDDDDeeee_-1234";
const CHAT = "-1001234567890";
const ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: CHAT };
type Sent = { url: string; method?: string; headers?: Record<string, string>; body: string; signal?: AbortSignal };
type Reply = { status?: number; json?: unknown } | "network" | "hang" | "bad_json";
function fake(rep: Reply | (() => Reply) = { json: { ok: true } }) {
  const sent: Sent[] = [];
  const f = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => {
    sent.push({ url, method: init.method, headers: init.headers, body: String(init.body ?? ""), signal: init.signal });
    const r = typeof rep === "function" ? rep() : rep;
    if (r === "network") throw new TypeError(`fetch failed for https://${TELEGRAM_HOST}/bot${TOKEN}/sendMessage`);
    if (r === "hang") return new Promise((_res, rej) => { init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))); });
    return { status: r === "bad_json" ? 200 : r.status ?? 200, json: async () => { if (r === "bad_json") throw new Error("not json"); return r.json; } };
  });
  return { f, sent };
}
const make = (env: Record<string, string>, rep?: Reply | (() => Reply), sleep?: (ms: number) => Promise<void>) => {
  const logs: string[] = [];
  const sleeps: number[] = [];
  const t = fake(rep);
  const alert = createTelegramAlert({ env, fetchImpl: t.f as never, log: (l: string) => logs.push(l), sleep: sleep ?? (async (ms: number) => { sleeps.push(ms); }) });
  return { alert, logs, sleeps, ...t };
};

describe("T1 one text, one HTTPS POST to api.telegram.org", () => {
  it("POST https://api.telegram.org/bot<token>/sendMessage with the chat id and the fixed text; ONE request", async () => {
    const h = make(ENV);
    expect(await h.alert.send("logged_out")).toEqual({ ok: true });
    expect(h.sent.length).toBe(1);
    const u = new URL(h.sent[0].url);
    expect([u.protocol, u.hostname, u.pathname]).toEqual(["https:", "api.telegram.org", `/bot${TOKEN}/sendMessage`]);
    expect(h.sent[0].method).toBe("POST");
    expect(JSON.parse(h.sent[0].body)).toMatchObject({ chat_id: CHAT, text: "7-11 server logged out. Log in from Admin." });
    expect(h.logs).toEqual([]); // a sent alert logs nothing
  });
  it("the fixed texts, word for word", () => {
    expect(ALERT_TEXTS).toEqual({
      logged_out: "7-11 server logged out. Log in from Admin.",
      logged_in: "7-11 server is logged in again.",
      test: "SellerFlowLive test alert. Alerts are working.",
      took_over: "Lenovo stopped. The server is checking now.",
      took_over_logged_out: "Lenovo stopped. The server is checking now, but it is logged out of 7-11. Log in from Admin.",
      handed_back: "Lenovo is back. The server is a follower again.",
      new_version: "Server restarted on a new version.",
    });
  });
});

describe("T2 messages are fixed texts: no free text can be sent", () => {
  it("an unknown key or a free text sends NOTHING", async () => {
    const h = make(ENV);
    for (const k of ["", "hello 0912345678", "toString", "__proto__", "constructor", "LOGGED_OUT"]) expect(await h.alert.send(k)).toEqual({ ok: false, word: "unknown_text" });
    expect(h.sent.length).toBe(0);
  });
  it("no text holds a digit run that could be a phone / store / tracking number", () => {
    for (const text of Object.values(ALERT_TEXTS)) expect(text).not.toMatch(/\d{4,}/);
  });
});

describe("T3 missing either env = alerts off, nothing sent", () => {
  it("no token / no chat id / neither / blank → off, zero requests, one word", async () => {
    for (const env of [{}, { TELEGRAM_BOT_TOKEN: TOKEN }, { TELEGRAM_CHAT_ID: CHAT }, { TELEGRAM_BOT_TOKEN: "  ", TELEGRAM_CHAT_ID: CHAT }] as Record<string, string>[]) {
      const h = make(env);
      expect(h.alert.enabled()).toBe(false);
      expect(h.alert.stateWord()).toBe("off");
      expect(await h.alert.send("test")).toEqual({ ok: false, word: "off" });
      h.alert.fire("logged_out");
      expect(h.sent.length).toBe(0);
    }
  });
  it("a value that is not a Telegram token / chat id → off with its own word, zero requests", async () => {
    const a = make({ TELEGRAM_BOT_TOKEN: "not a token/../x", TELEGRAM_CHAT_ID: CHAT });
    expect(a.alert.stateWord()).toBe("bad_token_format");
    expect(await a.alert.send("test")).toEqual({ ok: false, word: "bad_token_format" });
    const b = make({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "my chat" });
    expect(b.alert.stateWord()).toBe("bad_chat_format");
    expect(a.sent.length + b.sent.length).toBe(0);
    expect(make(ENV).alert.stateWord()).toBe("on");
    expect(make({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "@sfl_alerts" }).alert.enabled()).toBe(true);
  });
});

describe("T4 a failed send: one word in the log, never a throw", () => {
  const cases: [string, Reply, string][] = [
    ["HTTP 401", { status: 401, json: { ok: false } }, "http_401"], ["HTTP 429", { status: 429, json: {} }, "http_429"],
    ["200 but ok:false", { json: { ok: false, description: `chat ${CHAT} not found` } }, "not_ok"], ["200 not JSON", "bad_json", "not_ok"],
    ["network error", "network", "network"],
  ];
  for (const [name, rep, word] of cases) {
    it(`${name} → { ok: false, word: "${word}" } and ONE log line with that word only`, async () => {
      const h = make(ENV, rep);
      expect(await h.alert.send("logged_out")).toEqual({ ok: false, word });
      expect(h.logs).toEqual([`[TG_ALERT] send failed ${word}`]);
      expect(h.sent.length).toBe(1); // no retry
    });
  }
});

describe("T5 the 20 s limit of ONE send (the test button)", () => {
  it("a Telegram that never answers is cut at 20 s → word timeout", async () => {
    expect(TELEGRAM_SEND_MS).toBe(20000);
    vi.useFakeTimers();
    try {
      const h = make(ENV, "hang");
      const p = h.alert.send("test");
      await vi.advanceTimersByTimeAsync(TELEGRAM_SEND_MS - 1);
      expect(h.sent[0].signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).toEqual({ ok: false, word: "timeout" });
      expect(h.logs).toEqual(["[TG_ALERT] send failed timeout"]);
    } finally { vi.useRealTimers(); }
  });
  it("ONE request line in the module; the button's limit is TELEGRAM_SEND_MS, an alert's try is kept ALERT_KEEP_MS", () => {
    const code = readFileSync("server/telegramAlert.js", "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code.split("fetchImpl(").length - 1).toBe(1);
    expect(code.split("ctl.abort()").length - 1).toBe(1);
    expect(code).toContain("const timer = setTimeout(req.stop, TELEGRAM_SEND_MS);");
    expect(code).toContain("setTimeout(() => { gaveUp = true; req.stop(); }, ALERT_KEEP_MS)");
    expect(code.split("req.stop").length - 1).toBe(2);       // the button's limit, and an alert's "next try is due"
    expect(code).toContain("export const ALERT_KEEP_MS = TELEGRAM_SEND_MS + ALERT_RETRY_MS;");
    expect([TELEGRAM_SEND_MS, ALERT_RETRY_MS, ALERT_KEEP_MS]).toEqual([20000, 60000, 80000]);
    expect(code).not.toMatch(/\b8000\b/);
  });
  it("a send that got its answer (sent or failed) leaves no 20 s timer behind", async () => {
    vi.useFakeTimers();
    try {
      for (const rep of [{ json: { ok: true } }, { status: 502, json: {} }, "network", "bad_json"] as Reply[]) {
        const h = make(ENV, rep);
        await h.alert.send("test");
        expect(vi.getTimerCount(), JSON.stringify(rep)).toBe(0);
        expect(h.sent[0].signal?.aborted).toBe(false);
      }
    } finally { vi.useRealTimers(); }
  });
});

// A Telegram that DELIVERS the message when the request arrives, and answers "ok" only `answerMs` later
// (a request that was cut before that gets no answer). `delivered` = how many copies reached the chat.
function slowTelegram(answerMs: number | ((n: number) => number)) {
  const state = { delivered: 0, requests: 0 };
  const f = vi.fn((_url: string, init: { signal?: AbortSignal }) => new Promise((res, rej) => {
    state.requests += 1;
    state.delivered += 1;
    const ms = typeof answerMs === "function" ? answerMs(state.requests) : answerMs;
    const t = setTimeout(() => res({ status: 200, json: async () => ({ ok: true }) }), ms);
    init.signal?.addEventListener("abort", () => { clearTimeout(t); rej(Object.assign(new Error("aborted"), { name: "AbortError" })); });
  }));
  return { f, state };
}
describe("T11 a slow Telegram (Nov 19 2026: delivered, but the answer came after the old 8 s limit)", () => {
  const handlerAnswer = async (alert: ReturnType<typeof createTelegramAlert>) => {
    const res = { code: 200, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    const p = createAlertTestHandler({ alert, allowed: () => true })({ authUserId: "u" }, res);
    return { p, res };
  };
  for (const answerMs of [8001, 9000, 15000, 19999]) {
    it(`the test button: Telegram answers after ${answerMs} ms → the panel is told "sent", one request`, async () => {
      vi.useFakeTimers();
      try {
        const t = slowTelegram(answerMs);
        const logs: string[] = [];
        const alert = createTelegramAlert({ env: ENV, fetchImpl: t.f as never, log: (l: string) => logs.push(l) });
        const { p, res } = await handlerAnswer(alert);
        await vi.advanceTimersByTimeAsync(answerMs);
        await p;
        expect(res.body).toEqual({ sent: true });
        expect([t.state.requests, t.state.delivered, logs.length]).toEqual([1, 1, 0]);
      } finally { vi.useRealTimers(); }
    });
  }
  it("the test button: no answer inside 20 s → \"not sent\" + the word timeout (ONE try, never a second request)", async () => {
    vi.useFakeTimers();
    try {
      const t = slowTelegram(20001);
      const alert = createTelegramAlert({ env: ENV, fetchImpl: t.f as never, log: () => {} });
      const { p, res } = await handlerAnswer(alert);
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await p;
      expect(res.body).toEqual({ sent: false, reason: "timeout" });
      expect(t.state.requests).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it("a real alert answered after 9 s (or 15 s): ONE copy, no second try — with the 8 s limit this was a second copy a minute later", async () => {
    for (const answerMs of [9000, 15000]) {
      vi.useFakeTimers();
      try {
        const t = slowTelegram(answerMs);
        const alert = createTelegramAlert({ env: ENV, fetchImpl: t.f as never, log: () => {} });
        const p = alert.deliver("new_version", "16b4bb9");
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(await p).toEqual({ ok: true });
        expect([t.state.requests, t.state.delivered]).toEqual([1, 1]);
      } finally { vi.useRealTimers(); }
    }
  });
  it("a truly failed send is still tried again (nothing was delivered → no copy is lost, none doubled)", async () => {
    const h = make(ENV, (() => { let i = 0; return () => (i++ === 0 ? "network" : { json: { ok: true } }) as Reply; })());
    expect(await h.alert.deliver("logged_out")).toEqual({ ok: true });
    expect([h.sent.length, h.sleeps]).toEqual([2, [ALERT_RETRY_MS]]);
    expect(h.sent.map((x) => JSON.parse(x.body).text)).toEqual([ALERT_TEXTS.logged_out, ALERT_TEXTS.logged_out + ALERT_AGAIN]);
  });
});

describe("T6 the token (and the chat id) never reach a log line or an answer", () => {
  it("every failure kind: logs and results hold neither", async () => {
    for (const rep of [{ status: 401, json: { description: TOKEN } }, { json: { ok: false, description: TOKEN } }, "network", "bad_json"] as Reply[]) {
      const h = make(ENV, rep);
      const r = await h.alert.send("test");
      const all = `${h.logs.join("\n")}\n${JSON.stringify(r)}\n${h.alert.stateWord()}`;
      expect(all).not.toContain(TOKEN); expect(all).not.toContain("MARKTOKEN"); expect(all).not.toContain(CHAT);
    }
  });
});

describe("T7 fire(): never awaited, never throws, never slows the caller", () => {
  it("returns at once while Telegram hangs; a fetch that throws synchronously is swallowed", async () => {
    const h = make(ENV, "hang");
    const t0 = Date.now();
    expect(h.alert.fire("logged_out")).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(50);
    const boom = createTelegramAlert({ env: ENV, fetchImpl: (() => { throw new Error("sync"); }) as never, log: () => {} });
    expect(() => boom.fire("logged_in")).not.toThrow();
    expect(await boom.send("logged_in")).toEqual({ ok: false, word: "network" });
  });
});

describe("T8 the Admin test route", () => {
  const res = () => ({ code: 200, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } });
  it("sent → { sent: true }; failed → { sent: false, reason: word }; alerts off → reason off", async () => {
    const ok = res(); await createAlertTestHandler({ alert: make(ENV).alert, allowed: () => true })({ authUserId: "u" }, ok);
    expect([ok.code, ok.body]).toEqual([200, { sent: true }]);
    const bad = res(); await createAlertTestHandler({ alert: make(ENV, { status: 403, json: {} }).alert, allowed: () => true })({ authUserId: "u" }, bad);
    expect([bad.code, bad.body]).toEqual([200, { sent: false, reason: "http_403" }]);
    const off = res(); await createAlertTestHandler({ alert: make({}).alert, allowed: () => true })({ authUserId: "u" }, off);
    expect(off.body).toEqual({ sent: false, reason: "off" });
  });
  it("it sends the TEST text only, and the limiter answers 429 without sending", async () => {
    const h = make(ENV);
    await createAlertTestHandler({ alert: h.alert, allowed: () => true })({ authUserId: "u", body: { text: "hello", kind: "logged_out" } }, res());
    expect(JSON.parse(h.sent[0].body).text).toBe(ALERT_TEXTS.test);
    const limited = res(); await createAlertTestHandler({ alert: h.alert, allowed: () => false })({ authUserId: "u" }, limited);
    expect([limited.code, limited.body]).toEqual([429, { sent: false, reason: "rate_limited" }]);
    expect(h.sent.length).toBe(1);
  });
});

describe("T9 server.js wiring", () => {
  const src = readFileSync("server.js", "utf8");
  it("the route is Admin only, limited; the login module's state change fires the alert (never awaited)", () => {
    expect(src).toContain('app.post("/admin/pc711/alert-test", requireAuth, requireAdmin, pc711Json, createAlertTestHandler({ alert: adminAlert, allowed: adminAlertTestAllowed }));');
    expect(src).toContain("const adminAlertTestAllowed = createWindowLimiter({ max: 5, windowMs: 10 * 60 * 1000 });");
    expect(src).toContain("const adminAlert = createTelegramAlert({ env: process.env });");
    expect(src).toContain("onState: (change) => adminAlert.fire(change) });");
    expect(src).toContain("console.log(`[TG_ALERT] ${adminAlert.stateWord()}`);");
  });
  it("the token is read in ONE place and never passed to a log", () => {
    const mod = readFileSync("server/telegramAlert.js", "utf8");
    expect(src).not.toMatch(/env\??\.TELEGRAM_BOT_TOKEN|env\[/); // server.js never reads the token itself
    expect(mod.split("TELEGRAM_BOT_TOKEN").length - 1).toBe(2); // the header comment + the one read
    for (const line of mod.split("\n").filter((l) => /\bsay\(|\blog\(/.test(l))) expect(line).not.toMatch(/token|chat\b|url|\be\b\.message/i);
  });
});

// Jeff 2026-11-18: a lost alert must not be lost — up to 3 tries, 1 minute apart, for every alert kind.
describe("T10 an alert is tried up to 3 times, 1 minute apart; the test button is ONE try", () => {
  const seq = (...r: Reply[]) => { let i = 0; return () => r[Math.min(i++, r.length - 1)]; };
  const OK: Reply = { json: { ok: true } };
  it("the numbers: 3 tries, 60 s apart", () => {
    expect([ALERT_TRIES, ALERT_RETRY_MS]).toEqual([3, 60_000]);
  });
  it("two failed tries then a sent one: 3 requests, 2 waits of 1 minute, ONE log word per failed try", async () => {
    const h = make(ENV, seq("network", { status: 502, json: {} }, OK));
    expect(await h.alert.deliver("logged_out")).toEqual({ ok: true });
    expect(h.sent.length).toBe(3);
    expect(h.sleeps).toEqual([ALERT_RETRY_MS, ALERT_RETRY_MS]);
    expect(h.logs).toEqual(["[TG_ALERT] send failed network", "[TG_ALERT] send failed http_502"]);
    expect(h.sent.map((x) => JSON.parse(x.body).text)).toEqual([ALERT_TEXTS.logged_out, `${ALERT_TEXTS.logged_out} (sent again)`, `${ALERT_TEXTS.logged_out} (sent again)`]);
  });
  it("sent at the first try: 1 request, no wait", async () => {
    const h = make(ENV);
    expect(await h.alert.deliver("logged_in")).toEqual({ ok: true });
    expect([h.sent.length, h.sleeps.length, h.logs.length]).toEqual([1, 0, 0]);
  });
  it("all tries fail: exactly 3 requests, 3 log lines, 2 waits — then it stops", async () => {
    const h = make(ENV, "network");
    expect(await h.alert.deliver("logged_out")).toEqual({ ok: false, word: "network" });
    expect([h.sent.length, h.sleeps.length]).toEqual([ALERT_TRIES, ALERT_TRIES - 1]);
    expect(h.logs).toEqual(Array(ALERT_TRIES).fill("[TG_ALERT] send failed network"));
  });
  it("alerts off (or a text that is not ours): nothing sent, no wait, no retry", async () => {
    const off = make({});
    expect(await off.alert.deliver("logged_out")).toEqual({ ok: false, word: "off" });
    off.alert.fire("logged_in");
    await Promise.resolve();
    expect([off.sent.length, off.sleeps.length]).toEqual([0, 0]);
    const on = make(ENV);
    expect(await on.alert.deliver("hello")).toEqual({ ok: false, word: "unknown_text" });
    expect([on.sent.length, on.sleeps.length]).toEqual([0, 0]);
  });
  it("fire() uses the retries and is never awaited: it returns at once while the 1-minute wait is still running", async () => {
    let release = () => {};
    const waits: number[] = [];
    const h = make(ENV, seq("network", OK), (ms) => new Promise<void>((res) => { waits.push(ms); release = res; }));
    const t0 = Date.now();
    expect(h.alert.fire("logged_out")).toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(50);
    await vi.waitFor(() => expect(waits).toEqual([ALERT_RETRY_MS]));
    expect(h.sent.length).toBe(1); // the 2nd try waits for the minute
    release();
    await vi.waitFor(() => expect(h.sent.length).toBe(2));
  });
  it("alerts go out in the order they happened: the 2nd alert waits for the 1st alert's retries", async () => {
    const h = make(ENV, seq("network", "network", OK, OK));
    const a = h.alert.deliver("logged_out");
    const b = h.alert.deliver("logged_in");
    await Promise.all([a, b]);
    // the 2nd alert's own first try carries no "(sent again)"
    expect(h.sent.map((s) => JSON.parse(s.body).text)).toEqual([ALERT_TEXTS.logged_out, ALERT_TEXTS.logged_out + ALERT_AGAIN, ALERT_TEXTS.logged_out + ALERT_AGAIN, ALERT_TEXTS.logged_in]);
  });
  it("the test button stays ONE try that answers at once (no retry, no wait), also when it fails", async () => {
    const h = make(ENV, "network");
    expect(await h.alert.send("test")).toEqual({ ok: false, word: "network" });
    const res = { code: 200, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    await createAlertTestHandler({ alert: h.alert, allowed: () => true })({ authUserId: "u" }, res);
    expect(res.body).toEqual({ sent: false, reason: "network" });
    expect([h.sent.length, h.sleeps.length]).toEqual([2, 0]);
  });
  it("at most 20 alerts wait for their turn; one more is dropped with one log word", async () => {
    let release = () => {};
    const h = make(ENV, "network", () => new Promise<void>((res) => { release = res; }));
    const all = Array.from({ length: ALERT_QUEUE_MAX + 1 }, () => h.alert.deliver("logged_out"));
    expect(await all[ALERT_QUEUE_MAX]).toEqual({ ok: false, word: "queue_full" });
    expect(h.logs).toContain("[TG_ALERT] send failed queue_full");
    release();
  });
  it("the token never reaches a log line across the retries", async () => {
    const h = make(ENV, seq({ status: 401, json: { description: TOKEN } }, "network", "bad_json"));
    await h.alert.deliver("logged_out");
    expect(h.logs.length).toBe(3);
    expect(h.logs.join("\n")).not.toMatch(/MARKTOKEN|-100123/);
  });
});

// ── T12 — an alert Telegram DELIVERED is not sent again; one that failed still gets its 3 tries ──
// A scripted Telegram on a clock that only the test moves. Request n gets plan n (the last plan repeats):
//   after  — when Telegram's answer arrives, ms after the request (default 0);
//   reply  — "ok" | "never" (no answer at all) | "network" (the connection broke) | "bad_json" |
//            { status } (an error answer) | "not_ok" (200 with ok:false);
//   delivered — Telegram put the message in the chat (default: only when it answers "ok").
type Plan = { after?: number; reply: "ok" | "never" | "network" | "bad_json" | "not_ok" | { status: number }; delivered?: boolean };
function scripted(script: Plan[]) {
  const sent: Array<{ at: number; text: string; signal?: AbortSignal; cutAt: number | null }> = [];
  const chat: string[] = [];   // the copies in the Admin's chat, in order
  const t0 = Date.now();
  const f = vi.fn((_url: string, init: { body?: string; signal?: AbortSignal }) => new Promise((res, rej) => {
    const plan = script[Math.min(sent.length, script.length - 1)];
    const me = { at: Date.now() - t0, text: String(JSON.parse(String(init.body)).text), signal: init.signal, cutAt: null as number | null };
    sent.push(me);
    if (plan.delivered ?? plan.reply === "ok") chat.push(me.text);
    init.signal?.addEventListener("abort", () => { me.cutAt = Date.now() - t0; rej(Object.assign(new Error("aborted"), { name: "AbortError" })); });
    if (plan.reply === "never") return;
    setTimeout(() => {
      if (init.signal?.aborted) return;
      const r = plan.reply;
      if (r === "network") return rej(new TypeError(`fetch failed for https://${TELEGRAM_HOST}/bot${TOKEN}/sendMessage`));
      if (r === "ok") return res({ status: 200, json: async () => ({ ok: true }) });
      if (r === "bad_json") return res({ status: 200, json: async () => { throw new Error(`not json ${TOKEN}`); } });
      if (r === "not_ok") return res({ status: 200, json: async () => ({ ok: false, description: TOKEN }) });
      if (typeof r !== "object") return;
      return res({ status: r.status, json: async () => ({ ok: false, description: `${TOKEN} ${CHAT}` }) });
    }, plan.after ?? 0);
  }));
  return { f, sent, chat };
}
function begin(script: Plan[]) {
  const t = scripted(script);
  const logs: string[] = [];
  const alert = createTelegramAlert({ env: ENV, fetchImpl: t.f as never, log: (l: string) => logs.push(l) });   // the real 1-minute wait (on the test clock)
  return { ...t, logs, alert, texts: () => t.sent.map((x) => x.text), times: () => t.sent.map((x) => x.at) };
}
const move = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const HOUR = 60 * 60 * 1000;
const BASE = ALERT_TEXTS.logged_out;
const AGAIN = `${BASE} (sent again)`;
const LOG_LINE = /^\[TG_ALERT\] (send failed (timeout|network|not_ok|http_\d{3}|queue_full)|no answer yet try=[123], still waiting|late ok try=[123] after=\d{1,2}s)$/;

describe("T12 no second copy of a delivered alert (the request is kept until the next try is due)", () => {
  beforeEach(() => { vi.useFakeTimers(); });   // the clock moves only when a test moves it
  afterEach(() => { vi.useRealTimers(); });

  it("the two numbers: a try is kept 80 s (20 s + the minute); the 2nd and 3rd try end with \" (sent again)\"", () => {
    expect(ALERT_KEEP_MS).toBe(80_000);
    expect(ALERT_AGAIN).toBe(" (sent again)");
  });

  describe("slow but delivered → ONE copy", () => {
    for (const ms of [20_001, 25_000, 45_000, 79_999]) {
      it(`Telegram answers "ok" after ${ms} ms: one request, one copy, the alert reports sent`, async () => {
        const h = begin([{ after: ms, reply: "ok" }]);
        const p = h.alert.deliver("logged_out");
        await move(TELEGRAM_SEND_MS);
        expect(h.sent.length).toBe(1);                         // 20 s passed: NOT sent again
        expect(h.sent[0].signal?.aborted).toBe(false);         // … and the request is still open
        expect(h.logs).toEqual(["[TG_ALERT] no answer yet try=1, still waiting"]);
        await move(ms - TELEGRAM_SEND_MS);
        expect(await p).toEqual({ ok: true });
        await move(HOUR);
        expect(h.chat).toEqual([BASE]);                        // ONE copy in the chat, without "(sent again)"
        expect(h.sent.length).toBe(1);
        expect(h.sent[0].cutAt).toBeNull();                    // never cut
        expect(h.logs).toEqual(["[TG_ALERT] no answer yet try=1, still waiting", `[TG_ALERT] late ok try=1 after=${Math.round(ms / 1000)}s`]);
        expect(vi.getTimerCount()).toBe(0);
      });
    }
    it("an answer inside 20 s: one request, one copy, and no log line at all", async () => {
      const h = begin([{ after: 9000, reply: "ok" }]);
      const p = h.alert.deliver("logged_out");
      await move(9000);
      expect(await p).toEqual({ ok: true });
      await move(HOUR);
      expect([h.sent.length, h.chat, h.logs, vi.getTimerCount()]).toEqual([1, [BASE], [], 0]);
    });
    it("the first send after a restart is slow (25 s), the version alert: ONE copy (was 2 with a cut at 20 s)", async () => {
      const h = begin([{ after: 25_000, reply: "ok" }, { after: 300, reply: "ok" }]);
      const p = h.alert.deliver("new_version", "16b4bb9");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect(h.chat).toEqual(["Server restarted on a new version. 16b4bb9"]);
    });
    it("a slow 2nd try is kept too: nothing back, then \"ok\" after 30 s → 2 sends, no 3rd", async () => {
      const h = begin([{ reply: "never" }, { after: 30_000, reply: "ok" }]);
      const p = h.alert.deliver("logged_out");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect([h.times(), h.texts(), h.chat]).toEqual([[0, ALERT_KEEP_MS], [BASE, AGAIN], [AGAIN]]);
    });
    it("a late \"ok\" on the 3rd try still counts as sent", async () => {
      const h = begin([{ reply: "never" }, { reply: "never" }, { after: 70_000, reply: "ok" }]);
      const p = h.alert.deliver("logged_out");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect([h.sent.length, h.chat]).toEqual([3, [AGAIN]]);
    });
  });

  describe("nothing comes back at all → sent again when the next try is due, marked", () => {
    it("3 sends at 0 s, 80 s and 160 s; each request is ended exactly when the next try is due; then it stops", async () => {
      const h = begin([{ reply: "never" }]);
      const p = h.alert.deliver("logged_out");
      await move(ALERT_KEEP_MS - 1);
      expect(h.sent.length).toBe(1);                           // 79.999 s: still the one request
      await move(1);
      expect(h.sent.length).toBe(2);                           // 80 s: the 2nd try, at once
      await move(HOUR);
      expect(await p).toEqual({ ok: false, word: "timeout" });
      expect(h.times()).toEqual([0, ALERT_KEEP_MS, 2 * ALERT_KEEP_MS]);
      expect(h.sent.map((x) => x.cutAt)).toEqual([ALERT_KEEP_MS, 2 * ALERT_KEEP_MS, 3 * ALERT_KEEP_MS]);
      expect(h.texts()).toEqual([BASE, AGAIN, AGAIN]);         // the 1st try as it always was; 2nd and 3rd marked
      expect(h.logs).toEqual([1, 2, 3].flatMap((n) => [`[TG_ALERT] no answer yet try=${n}, still waiting`, "[TG_ALERT] send failed timeout"]));
      expect(vi.getTimerCount()).toBe(0);
    });
    it("the case that cannot be excluded: delivered, and its answer never arrives → a 2nd copy, and it SAYS so", async () => {
      const h = begin([{ reply: "never", delivered: true }, { after: 300, reply: "ok" }]);
      const p = h.alert.deliver("logged_out");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect(h.chat).toEqual([BASE, AGAIN]);
    });
    it("an answer that comes just after the next try was due is too late (the request was ended at 80 s)", async () => {
      const h = begin([{ after: ALERT_KEEP_MS + 1, reply: "ok", delivered: true }, { after: 300, reply: "ok" }]);
      const p = h.alert.deliver("logged_out");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect([h.times(), h.sent[0].cutAt, h.chat]).toEqual([[0, ALERT_KEEP_MS], ALERT_KEEP_MS, [BASE, AGAIN]]);
    });
  });

  describe("an error answer or a broken connection → tried again a minute later", () => {
    const failures: Array<[string, Plan["reply"], string]> = [
      ["Telegram answers 502", { status: 502 }, "http_502"],
      ["Telegram answers 429", { status: 429 }, "http_429"],
      ["Telegram answers 200 with ok:false", "not_ok", "not_ok"],
      ["an answer that is not JSON", "bad_json", "not_ok"],
      ["the connection broke", "network", "network"],
    ];
    for (const [name, reply, word] of failures) {
      it(`${name}: the 2nd try goes out 1 minute after it, with "(sent again)"`, async () => {
        const h = begin([{ after: 500, reply }, { after: 500, reply: "ok" }]);
        const p = h.alert.deliver("logged_out");
        await move(500 + ALERT_RETRY_MS - 1);
        expect(h.sent.length).toBe(1);
        await move(1);
        expect(h.sent.length).toBe(2);
        await move(HOUR);
        expect(await p).toEqual({ ok: true });
        expect([h.times(), h.texts(), h.chat]).toEqual([[0, 500 + ALERT_RETRY_MS], [BASE, AGAIN], [AGAIN]]);
        expect(h.logs).toEqual([`[TG_ALERT] send failed ${word}`]);
        expect(vi.getTimerCount()).toBe(0);
      });
    }
    it("an error answer that arrives late (after 30 s) ends that try at once: the next try 1 minute after the answer", async () => {
      const h = begin([{ after: 30_000, reply: { status: 502 } }, { reply: "ok" }]);
      const p = h.alert.deliver("logged_out");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect(h.times()).toEqual([0, 30_000 + ALERT_RETRY_MS]);
      expect(h.sent[0].cutAt).toBeNull();
      expect(h.logs).toEqual(["[TG_ALERT] no answer yet try=1, still waiting", "[TG_ALERT] send failed http_502"]);
    });
    it("a truly failed alert gets all 3 tries: error, nothing back, then \"ok\" on the 3rd → delivered once", async () => {
      const h = begin([{ reply: { status: 500 } }, { reply: "never" }, { after: 200, reply: "ok" }]);
      const p = h.alert.deliver("logged_out");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect(h.times()).toEqual([0, ALERT_RETRY_MS, ALERT_RETRY_MS + ALERT_KEEP_MS]);
      expect([h.texts(), h.chat]).toEqual([[BASE, AGAIN, AGAIN], [AGAIN]]);
    });
  });

  describe("never more than 3 sends", () => {
    const always: Array<[string, Plan[], string]> = [
      ["nothing ever comes back", [{ reply: "never" }], "timeout"],
      ["every answer is an error", [{ after: 100, reply: { status: 502 } }], "http_502"],
      ["the connection breaks every time", [{ reply: "network" }], "network"],
      ["late errors (50 s) every time", [{ after: 50_000, reply: { status: 500 } }], "http_500"],
      ["error, nothing back, connection broke", [{ reply: { status: 401 } }, { reply: "never" }, { reply: "network" }], "network"],
    ];
    for (const [name, script, word] of always) {
      it(`${name}: exactly 3 sends, then the alert is given up — also an hour later`, async () => {
        const h = begin(script);
        const p = h.alert.deliver("logged_out");
        await move(HOUR);
        expect(await p).toEqual({ ok: false, word });
        expect(h.sent.length).toBe(ALERT_TRIES);
        expect(h.texts()).toEqual([BASE, AGAIN, AGAIN]);
        await move(HOUR);
        expect(h.sent.length).toBe(ALERT_TRIES);
        expect(vi.getTimerCount()).toBe(0);
      });
    }
    it("one request at a time: a try is never sent while the one before it is still open", async () => {
      const h = begin([{ reply: "never" }]);
      const open = () => h.sent.filter((x) => x.cutAt === null).length;
      void h.alert.deliver("logged_out");
      for (let t = 0; t < 4 * ALERT_KEEP_MS; t += 5000) { await move(5000); expect(open()).toBeLessThanOrEqual(1); }
      expect(h.sent.length).toBe(3);
    });
  });

  describe("the first try and the test button stay as they are", () => {
    it("every fixed text, first try: exactly the text, no \"(sent again)\"", async () => {
      for (const kind of Object.keys(ALERT_TEXTS)) {
        const value = kind === "new_version" ? "16b4bb9" : undefined;
        const h = begin([{ reply: "ok" }]);
        const p = h.alert.deliver(kind, value);
        await move(1);
        expect(await p).toEqual({ ok: true });
        expect(h.texts()).toEqual([alertText(kind, value)]);
        expect(h.texts()[0]).not.toContain("sent again");
      }
    });
    it("the version alert's 2nd try: the fixed text, the 7 characters, then \"(sent again)\"", async () => {
      const h = begin([{ reply: "network" }, { reply: "ok" }]);
      const p = h.alert.deliver("new_version", "16b4bb9");
      await move(HOUR);
      expect(await p).toEqual({ ok: true });
      expect(h.texts()).toEqual(["Server restarted on a new version. 16b4bb9", "Server restarted on a new version. 16b4bb9 (sent again)"]);
    });
    it("a value of the wrong shape still sends NOTHING (the mark cannot carry free text)", async () => {
      const h = begin([{ reply: "ok" }]);
      for (const v of ["16b4bb9 (sent again)", "hello", undefined]) expect(await h.alert.deliver("new_version", v as never)).toEqual({ ok: false, word: "unknown_text" });
      expect(await h.alert.deliver("logged_out (sent again)")).toEqual({ ok: false, word: "unknown_text" });
      expect(h.sent.length).toBe(0);
    });
    it("the test button: the test text only, pressed 4 times in a row → never \"(sent again)\"", async () => {
      const h = begin([{ reply: { status: 502 } }]);
      for (let i = 0; i < 4; i++) { const p = h.alert.send("test"); await move(1); expect(await p).toEqual({ ok: false, word: "http_502" }); }
      expect(h.texts()).toEqual(Array(4).fill(ALERT_TEXTS.test));
    });
    it("the test button is still ONE try cut at 20 s: an answer after 25 s → \"not sent\", one request, no 2nd try", async () => {
      const h = begin([{ after: 25_000, reply: "ok" }]);
      const res = { code: 200, body: null as unknown, status(c: number) { this.code = c; return this; }, json(b: unknown) { this.body = b; return this; } };
      const p = createAlertTestHandler({ alert: h.alert, allowed: () => true })({ authUserId: "u" }, res);
      await move(TELEGRAM_SEND_MS - 1);
      expect(res.body).toBeNull();
      await move(1);
      await p;
      expect(res.body).toEqual({ sent: false, reason: "timeout" });
      await move(HOUR);
      expect([h.sent.length, h.sent[0].cutAt, h.texts()]).toEqual([1, TELEGRAM_SEND_MS, [ALERT_TEXTS.test]]);
      expect(h.logs).toEqual(["[TG_ALERT] send failed timeout"]);
    });
  });

  describe("the checker is never awaited", () => {
    it("fire() returns at once (nothing to await) while Telegram stays silent through all 3 tries", async () => {
      const h = begin([{ reply: "never" }]);
      const t0 = Date.now();
      const out = h.alert.fire("took_over");
      expect(out).toBeUndefined();
      expect(Date.now()).toBe(t0);                             // the clock did not have to move
      expect(h.sent.length).toBe(0);                           // not even the request was waited for
      // a checker pass that fires an alert finishes without the clock moving, the alert still open:
      const pass = async () => { h.alert.fire("handed_back"); return "pass done"; };
      expect(await pass()).toBe("pass done");
      expect(Date.now()).toBe(t0);
      await move(HOUR);
      expect(h.sent.length).toBe(2 * ALERT_TRIES);             // both alerts ran their tries by themselves
    });
    it("deliver() hands back a promise at once; the alert is still trying when the caller has moved on", async () => {
      const h = begin([{ after: 45_000, reply: "ok" }]);
      let done = false;
      const p = h.alert.deliver("took_over").then((r) => { done = true; return r; });
      await move(44_999);
      expect(done).toBe(false);
      await move(1);
      expect(await p).toEqual({ ok: true });
    });
    it("fire() never throws: a fetch that throws at once, a log that throws", async () => {
      const boom = createTelegramAlert({ env: ENV, fetchImpl: (() => { throw new Error(`sync ${TOKEN}`); }) as never, log: () => { throw new Error("log broke"); } });
      expect(() => boom.fire("logged_out")).not.toThrow();
      await move(HOUR);
      expect(vi.getTimerCount()).toBe(0);
    });
    it("the three callers do not await it (source)", () => {
      const strip = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(strip("server.js")).toContain("onState: (change) => adminAlert.fire(change) });");
      expect(strip("server/versionAlert.js")).toContain("try { alert.fire(VERSION_ALERT, commit); } catch");
      const backup = strip("server/pc711Backup.js");
      expect(backup).toContain("alert.deliver(kind) : Promise.resolve(null);");
      expect(backup).toContain("void Promise.resolve(send).catch(() => null).then(() => db.alertDone(kind))");
      expect(backup).not.toMatch(/await\s+alert\.|await\s+flushAlerts|await\s+send\b/);
      expect(strip("server/versionAlert.js")).not.toMatch(/await\s+alert\./);
    });
  });

  describe("alerts stay in order", () => {
    it("the next alert waits for the kept request of the one before it — and starts with its own first try", async () => {
      const h = begin([{ after: 30_000, reply: "ok" }, { after: 100, reply: "ok" }]);
      const a = h.alert.deliver("logged_out");
      const b = h.alert.deliver("logged_in");
      await move(29_999);
      expect(h.sent.length).toBe(1);
      await move(1);
      expect(h.sent.length).toBe(2);
      await move(HOUR);
      expect([await a, await b]).toEqual([{ ok: true }, { ok: true }]);
      expect([h.times(), h.chat]).toEqual([[0, 30_000], [ALERT_TEXTS.logged_out, ALERT_TEXTS.logged_in]]);
    });
  });

  describe("the token is never logged", () => {
    it("every line this module can write: fixed words and small numbers only — no token, no chat id, no text of an answer", async () => {
      const scripts: Plan[][] = [
        [{ after: 25_000, reply: "ok" }],                                                   // slow, then late ok
        [{ reply: "never" }],                                                               // nothing back ×3
        [{ after: 100, reply: { status: 401 } }, { reply: "network" }, { reply: "bad_json" }],  // answers / errors that CONTAIN the token
        [{ after: 30_000, reply: "not_ok" }, { reply: "never" }, { after: 60_000, reply: "ok" }],
      ];
      const lines: string[] = [];
      const results: unknown[] = [];
      for (const script of scripts) {
        const h = begin(script);
        const p = h.alert.deliver("logged_out");
        await move(HOUR);
        results.push(await p);
        lines.push(...h.logs);
      }
      expect(lines.length).toBeGreaterThanOrEqual(14);
      for (const l of lines) expect(l).toMatch(LOG_LINE);
      const all = `${lines.join("\n")}\n${JSON.stringify(results)}`;
      expect(all).not.toContain(TOKEN); expect(all).not.toContain("MARKTOKEN"); expect(all).not.toContain(CHAT);
      expect(all).not.toMatch(/api\.telegram|sendMessage|bot\d/);
    });
    it("the token is only ever in the request's address — never in a body, and the body holds the chat id and the fixed text", async () => {
      const bodies: string[] = [];
      const urls: string[] = [];
      const f = vi.fn(async (url: string, init: { body?: string }) => { urls.push(url); bodies.push(String(init.body)); return { status: 502, json: async () => ({}) }; });
      const alert = createTelegramAlert({ env: ENV, fetchImpl: f as never, log: () => {} });
      const p = alert.deliver("logged_out");
      await move(HOUR);
      await p;
      expect(urls).toEqual(Array(3).fill(`https://api.telegram.org/bot${TOKEN}/sendMessage`));
      for (const b of bodies) expect(b).not.toContain(TOKEN);
      expect(bodies.map((b) => JSON.parse(b))).toEqual([BASE, AGAIN, AGAIN].map((text) => ({ chat_id: CHAT, text, disable_web_page_preview: true })));
    });
  });
});

