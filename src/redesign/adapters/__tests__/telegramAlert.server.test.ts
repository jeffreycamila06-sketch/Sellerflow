// @vitest-environment node
// Telegram alerts to the Admin (server/telegramAlert.js, Jeff 2026-11-18). A FAKE Telegram only — no real
// request is ever made by these tests.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createTelegramAlert, createAlertTestHandler, ALERT_TEXTS, TELEGRAM_SEND_MS, TELEGRAM_HOST, ALERT_TRIES, ALERT_RETRY_MS, ALERT_QUEUE_MAX } from "../../../../server/telegramAlert.js";

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
  it("the three fixed texts, word for word", () => {
    expect(ALERT_TEXTS).toEqual({
      logged_out: "7-11 server logged out. Log in from Admin.",
      logged_in: "7-11 server is logged in again.",
      test: "SellerFlowLive test alert. Alerts are working.",
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

describe("T5 8 s limit", () => {
  it("a Telegram that never answers is cut at 8 s → word timeout", async () => {
    expect(TELEGRAM_SEND_MS).toBe(8000);
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
    for (const s of h.sent) expect(JSON.parse(s.body).text).toBe(ALERT_TEXTS.logged_out);
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
    expect(h.sent.map((s) => JSON.parse(s.body).text)).toEqual([ALERT_TEXTS.logged_out, ALERT_TEXTS.logged_out, ALERT_TEXTS.logged_out, ALERT_TEXTS.logged_in]);
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
