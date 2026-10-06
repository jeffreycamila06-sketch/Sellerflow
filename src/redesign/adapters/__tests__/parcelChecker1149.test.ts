// 1.14.9 — faster PHONE verdicts when the anonymous token GET hangs.
// Field evidence: failed phone attempts were token-GET hangs that ended at our own
// 10 s abort (tokenMs ≈ 10.2–10.6 s; healthy GETs ≈ 0.1 s), then the 15→30→60 s
// ladder made a verdict take ~2 min. Fix (phone half only):
//   · token GET abort 10 s → 5 s, ONE immediate retry on a fetch() timeout/network
//     error only — and only on the first two attempts (tokenRetry from the worker)
//   · token-GET timeout/network ladder 5 → 10 → 20 → 60 → 120 s, from the END of the
//     attempt; every real 7-11 answer, a POST timeout, no-tab, config keep 15→30→60→120 s
//   · no answer → that shop's other rows wait a pass; two shops with no answer → all wait
//   · [PC-BACKOFF] logs the reason kind
// Drives the REAL myship-711.js (vm) and the REAL background.js (shared harness).
import { describe, it, expect, vi } from "vitest";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { bootWorker, PENDING_ROW } from "./parcelCheckerHarness";

const S = 1000;
const DAY_T0 = Date.UTC(2026, 0, 15, 2, 0, 0);   // 10:00 Taipei — outside 01:00–05:00
const WIN_T0 = Date.UTC(2026, 0, 14, 18, 30, 0); // 02:30 Taipei — inside the window

// ── the content script ────────────────────────────────────────────────────────
type Step = "hang" | "neterr" | "page" | "nopage" | "http500" | "badbody";
type PostKind = "ok" | "rejected" | "restricted" | "hang" | "html" | "badjson" | "neterr";
async function phoneCheck(getSteps: Step[], post: PostKind = "ok", tokenRetry = true, anon = true) {
  const src = readFileSync("chrome-extension/myship-711.js", "utf8");
  let listener: ((m: unknown, s: unknown, cb: (r: unknown) => void) => boolean) | null = null;
  const timeouts: number[] = [];
  const req = { get: 0, post: 0 };
  const hang = (signal?: AbortSignal) => new Promise((_res, rej) => {
    const fail = () => rej(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) fail(); else signal?.addEventListener("abort", fail);
  });
  const fetch = vi.fn(async (url: string, init: { signal?: AbortSignal }) => {
    if (/\/cart\/easy\//.test(url)) {
      const step = getSteps[req.get] ?? "page"; req.get += 1;
      if (step === "hang") return hang(init.signal);
      if (step === "neterr") throw new TypeError("Failed to fetch");
      if (step === "http500") return { ok: false, status: 500, redirected: false, text: async () => "", headers: { get: () => "text/html" } };
      if (step === "badbody") return { ok: true, status: 200, redirected: false, text: async () => { throw new TypeError("body stream failed"); }, headers: { get: () => "text/html" } };
      return { ok: true, status: 200, redirected: false, text: async () => (step === "page" ? "var tokenID = 'A:B';" : "<html>no token</html>"), headers: { get: () => "text/html" } };
    }
    req.post += 1;
    if (post === "hang") return hang(init.signal);
    if (post === "html") return { ok: true, status: 200, redirected: false, headers: { get: () => "text/html" }, json: async () => ({}) };
    if (post === "neterr") throw new TypeError("Failed to fetch");
    if (post === "badjson") return { ok: true, status: 200, redirected: false, headers: { get: () => "application/json" }, json: async () => { throw new SyntaxError("Unexpected token <"); } };
    const body = post === "ok" ? { Status: true } : post === "restricted"
      ? { Status: false, Message: "此手機號碼因多次未取紀錄，已被限制使用取貨付款功能，預計2026年10月15日 才能再次使用取貨付款功能" }
      : { Status: false, Message: "門市資料有誤" };
    return { ok: true, status: 200, redirected: false, headers: { get: () => "application/json" }, json: async () => body };
  });
  // the abort timer fires right away (records the requested ms) so a "hang" ends at once
  const sandbox: Record<string, unknown> = {
    window: {}, document: { documentElement: { innerHTML: "" }, getElementById: () => null },
    chrome: { runtime: { onMessage: { addListener: (l: typeof listener) => { listener = l; } } } },
    fetch, AbortController, URLSearchParams, Promise, String, Date, console,
    setTimeout: (fn: () => void, ms: number) => { timeouts.push(ms); return setTimeout(fn, 0); },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  };
  vm.runInNewContext(src, sandbox);
  const res = await new Promise<{ phone_check_status: string; phone_fail_kind: string; phone_reason: string }>((done) => {
    listener!({ type: "PC_CHECK_PHONE", anon, tokenRetry, row: { store_id: "195965", phone: "0912345678", customer_name: "測試" }, config: { cgdmId: "GM1", ordMobile: "0979593026" } }, {}, done as (r: unknown) => void);
  });
  return { res, req, timeouts };
}

describe("content script — token GET: 5 s abort + ONE immediate retry (timeout/network only)", () => {
  it("healthy: exactly 1 GET + 1 POST (no extra 7-11 traffic)", async () => {
    const { res, req, timeouts } = await phoneCheck(["page"]);
    expect(res.phone_check_status).toBe("ok");
    expect(req).toEqual({ get: 1, post: 1 });
    expect(timeouts[0]).toBe(5000);   // token GET abort
    expect(timeouts[1]).toBe(10000);  // POST abort unchanged
  });
  it("first GET hangs → retried at once → verdict in the SAME attempt (2 GET + 1 POST)", async () => {
    const { res, req } = await phoneCheck(["hang", "page"]);
    expect(res.phone_check_status).toBe("ok");
    expect(req).toEqual({ get: 2, post: 1 });
  });
  it("network error then OK → same (retry once)", async () => {
    const { res, req } = await phoneCheck(["neterr", "page"]);
    expect(res.phone_check_status).toBe("ok");
    expect(req).toEqual({ get: 2, post: 1 });
  });
  it("both GETs hang → unknown, kind=timeout, NEVER a third GET, no POST", async () => {
    const { res, req } = await phoneCheck(["hang", "hang", "page"]);
    expect(res.phone_check_status).toBe("unknown");
    expect(res.phone_fail_kind).toBe("timeout");
    expect(res.phone_reason).toBe("token GET timeout (5s ×2)");
    expect(req).toEqual({ get: 2, post: 0 });
  });
  it("two network errors → kind=network", async () => {
    const { res, req } = await phoneCheck(["neterr", "neterr"]);
    expect(res.phone_fail_kind).toBe("network");
    expect(req.get).toBe(2);
  });
  it("a real answer is NEVER retried: HTTP 500 → 1 GET, kind=http; page without token → 1 GET, kind=html", async () => {
    const a = await phoneCheck(["http500", "page"]);
    expect(a.res.phone_fail_kind).toBe("http");
    expect(a.req).toEqual({ get: 1, post: 0 });
    const b = await phoneCheck(["nopage", "page"]);
    expect(b.res.phone_fail_kind).toBe("html");
    expect(b.req).toEqual({ get: 1, post: 0 });
  });
  it("7-11 rejection → kind=rejected (1 GET + 1 POST, no retry); restricted wording still 'restricted'", async () => {
    const r = await phoneCheck(["page"], "rejected");
    expect(r.res.phone_check_status).toBe("unknown");
    expect(r.res.phone_fail_kind).toBe("rejected");
    expect(r.req).toEqual({ get: 1, post: 1 });
    expect((await phoneCheck(["page"], "restricted")).res.phone_check_status).toBe("restricted");
    expect((await phoneCheck(["page"], "html")).res.phone_fail_kind).toBe("html");
  });
  it("the POST (the real validation hit) is never retried — a POST hang is 1 POST, kind=post_timeout (slow ladder)", async () => {
    const r = await phoneCheck(["page"], "hang");
    expect(r.res.phone_fail_kind).toBe("post_timeout");
    expect(r.req).toEqual({ get: 1, post: 1 });
    expect((await phoneCheck(["page"], "neterr")).res.phone_fail_kind).toBe("post_network");
  });
  it("AUDIT #1: an answer that can't be read is a bad answer, never 'network' — bad JSON → bad_json; GET body failure → html, no retry", async () => {
    const j = await phoneCheck(["page"], "badjson");
    expect(j.res.phone_fail_kind).toBe("bad_json");
    const b = await phoneCheck(["badbody", "page"]);
    expect(b.res.phone_fail_kind).toBe("html");
    expect(b.req).toEqual({ get: 1, post: 0 });
  });
  it("AUDIT #5: no immediate retry when the worker says so (tokenRetry false, or absent e.g. the health probe)", async () => {
    const r = await phoneCheck(["hang", "page"], "ok", false);
    expect(r.res.phone_fail_kind).toBe("timeout");
    expect(r.res.phone_reason).toBe("token GET timeout (5s ×1)");
    expect(r.req).toEqual({ get: 1, post: 0 });
  });
  it("the legacy logged-in lane is unchanged (10 s, no retry)", () => {
    const ms = readFileSync("chrome-extension/myship-711.js", "utf8");
    expect(ms).toContain('const r = await fetchWithTimeout(path, { method: "GET" });');
    expect(ms).toContain("const TIMEOUT_MS = 10000;");
  });
});

// ── the worker ────────────────────────────────────────────────────────────────
const phoneRow = (id: string) => ({ ...PENDING_ROW, id, need_store: false, need_phone: true });
const phoneChecks = (calls: { sendMessage: { type: string; rowId?: string }[] }, id?: string) =>
  calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE" && (!id || m.rowId === id)).length;
const phoneVerdicts = (calls: { fetch: string[]; fetchBodies: string[] }) =>
  calls.fetch.map((u, i) => [u, calls.fetchBodies[i]] as const)
    .filter(([u]) => /admin_parcel_check_verdict/.test(u)).map(([, b]) => JSON.parse(b))
    .filter((b) => b.p_phone_check_status);

describe("ladder", () => {
  it("token timeout/network: 5 → 10 → 20 → 60 → 120 s (capped at the old max); everything else keeps 15 → 30 → 60 → 120 s", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const d = sb.pcPhoneBackoffDelay as unknown as (n: number, k: string) => number;
    for (const k of ["timeout", "network"]) expect([1, 2, 3, 4, 5, 9].map((n) => d(n, k))).toEqual([5 * S, 10 * S, 20 * S, 60 * S, 120 * S, 120 * S]);
    for (const k of ["rejected", "html", "redirect", "http", "bad_json", "post_timeout", "post_network", "config", "no_tab", "other", ""]) {
      expect([1, 2, 3, 4, 7].map((n) => d(n, k)), k).toEqual([15 * S, 30 * S, 60 * S, 120 * S, 120 * S]);
    }
    // the store ladder is untouched
    expect([1, 2, 3, 4].map(sb.pcBackoffDelay as unknown as (n: number) => number)).toEqual([15 * S, 30 * S, 60 * S, 120 * S]);
  });
});

// SIMULATION: one pending row encoded at T0, the worker loop (pass, then the next
// pass 5 s after it finishes). An outcome is resolved per attempt WITH the worker's
// tokenRetry flag, so request counts and durations follow the real retry gating
// (per-attempt costs proven by the content-script suite above).
type Outcome = "ok" | "retry_ok" | "timeout" | "rejected" | "old_timeout";
function attemptOf(o: Outcome, tokenRetry: boolean) {
  switch (o) {
    case "ok": return { status: "ok", kind: "", durMs: 200, requests: 2 };                    // GET + POST
    case "retry_ok": return tokenRetry
      ? { status: "ok", kind: "", durMs: 5200, requests: 3 }                                  // hung GET, retry GET + POST
      : { status: "unknown", kind: "timeout", durMs: 5000, requests: 1 };
    case "timeout": return tokenRetry
      ? { status: "unknown", kind: "timeout", durMs: 10000, requests: 2 }                     // 2 hung GETs
      : { status: "unknown", kind: "timeout", durMs: 5000, requests: 1 };
    case "rejected": return { status: "unknown", kind: "rejected", durMs: 200, requests: 2 };
    case "old_timeout": return { status: "unknown", kind: "", durMs: 10000, requests: 1 };    // 1.14.8 shape: 1 GET, 10 s, slow ladder
  }
}
async function simulate(outcomes: Outcome[], t0 = DAY_T0, maintenance = false) {
  const clock = { t: t0 };
  const starts: number[] = []; const retries: boolean[] = []; let requests = 0; let i = 0;
  const { sb, calls, booted } = bootWorker({
    now: () => clock.t, rows: [phoneRow("r1")], maintenance,
    phoneReply: (row, msg) => {
      if (row?.id !== "r1") return { status: "ok" }; // the sender health-check probe, not our row
      const a = attemptOf(outcomes[Math.min(i, outcomes.length - 1)], msg?.tokenRetry === true); i += 1;
      starts.push(clock.t - t0); retries.push(msg?.tokenRetry === true); requests += a.requests; clock.t += a.durMs;
      return { status: a.status, kind: a.kind };
    },
  });
  await booted;
  for (let n = 0; n < 400 && phoneVerdicts(calls).length === 0; n++) { await sb.pcTick(); clock.t += 5 * S; }
  const done = phoneVerdicts(calls).length > 0;
  return { verdictS: done ? Math.round((clock.t - 5 * S - t0) / S) : NaN, attempts: starts.map((x) => Math.round(x / S)), retries, requests, logs: calls.logs };
}

describe("simulated verdict times (encode at 0 s)", () => {
  it("(a) first token GET times out, the immediate retry works → ~5 s, 1 attempt, 3 requests", async () => {
    const r = await simulate(["retry_ok"]);
    expect(r.attempts).toEqual([0]);
    expect(r.verdictS).toBe(5);
    expect(r.requests).toBe(3);
  });
  it("(b) 3 token-GET timeouts in a row (attempt 1: 2 hangs; attempt 2: 1 hang then the retry works) → ~20 s", async () => {
    const r = await simulate(["timeout", "retry_ok"]);
    expect(r.attempts).toEqual([0, 15]);
    expect(r.verdictS).toBe(20);
    expect(r.requests).toBe(5);
  });
  it("(b') sustained stall: 3 whole attempts time out, then 7-11 answers → ~60 s, 7 requests; the 3rd attempt gets NO retry", async () => {
    const r = await simulate(["timeout", "timeout", "timeout", "ok"]);
    expect(r.attempts).toEqual([0, 15, 35, 60]);   // waits 5 / 10 / 20 s counted from each attempt's END
    expect(r.retries).toEqual([true, true, false, false]);
    expect(r.verdictS).toBe(60);
    expect(r.requests).toBe(7);
  });
  it("(c) 7-11 rejection → the slow ladder (0, 15, 45, ~105 s), 1 GET + 1 POST each, never retried in-attempt", async () => {
    const r = await simulate(["rejected", "rejected", "rejected", "ok"]);
    expect(r.attempts.slice(0, 3)).toEqual([0, 15, 45]);
    expect(r.attempts[3]).toBeGreaterThanOrEqual(105);
    expect(r.requests).toBe(8);
    expect(r.logs.filter((l) => /\[PC-BACKOFF\] row=r1 phone attempt=\d reason=rejected/.test(l)).length).toBe(3);
  });
  it("1.14.8 for comparison: the same stall (1 GET per attempt, 10 s abort, slow ladder) took ≥ 105 s", async () => {
    const old = await simulate(["old_timeout", "old_timeout", "old_timeout", "ok"]);
    expect(old.verdictS).toBeGreaterThanOrEqual(105);
  });
  it("AUDIT #5: a stall that never ends settles at ONE GET per ~125 s (no more than 1.14.8's 2-min cadence)", async () => {
    const r = await simulate(Array(20).fill("timeout") as Outcome[]);
    expect(Number.isNaN(r.verdictS)).toBe(true);              // never a verdict (phone never given up / never 'unknown')
    const gaps = r.attempts.slice(1).map((x, k) => x - r.attempts[k]);
    expect(gaps.slice(0, 5)).toEqual([15, 20, 25, 65, 125]);  // then steady
    expect(gaps.slice(5).every((g) => g >= 125)).toBe(true);
    expect(r.retries.slice(2).every((x) => x === false)).toBe(true);
  });
  it("healthy: one attempt, 2 requests, verdict in the first pass", async () => {
    const r = await simulate(["ok"]);
    expect(r.attempts).toEqual([0]);
    expect(r.requests).toBe(2);
  });
});

describe("safety rules", () => {
  const rowGm = (id: string, gm: string) => ({ ...phoneRow(id), gm_id: gm });
  it("no answer → that SHOP's other rows wait a pass (not charged a backoff); they go on the very next pass", async () => {
    const clock = { t: DAY_T0 };
    let first = true;
    const { sb, calls, booted } = bootWorker({
      now: () => clock.t, rows: [rowGm("a", "GM1"), rowGm("b", "GM1"), rowGm("c", "GM1")],
      phoneReply: (r) => { if (r?.id === "a" && first) { first = false; return { status: "unknown", kind: "timeout" }; } return { status: "ok" }; },
    });
    await booted;
    await sb.pcTick();
    expect([phoneChecks(calls, "a"), phoneChecks(calls, "b"), phoneChecks(calls, "c")]).toEqual([1, 0, 0]);
    clock.t += 5 * S; await sb.pcTick();
    expect([phoneChecks(calls, "b"), phoneChecks(calls, "c")]).toEqual([1, 1]);
  });
  it("AUDIT #3: one stuck shop does NOT hold up other sellers in the same pass", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({
      now: () => clock.t, rows: [rowGm("a", "GM1"), rowGm("x", "GM2"), rowGm("y", "GM3")],
      phoneReply: (r) => (r?.id === "a" ? { status: "unknown", kind: "timeout" } : { status: "ok" }),
    });
    await booted;
    await sb.pcTick();
    expect([phoneChecks(calls, "a"), phoneChecks(calls, "x"), phoneChecks(calls, "y")]).toEqual([1, 1, 1]);
  });
  it("two DIFFERENT shops with no answer in one pass → 7-11 looks stalled → every remaining phone half waits", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({
      now: () => clock.t, rows: [rowGm("a", "GM1"), rowGm("b", "GM2"), rowGm("c", "GM3")],
      phoneReply: (r) => (r?.id === "c" ? { status: "ok" } : { status: "unknown", kind: "timeout" }),
    });
    await booted;
    await sb.pcTick();
    expect([phoneChecks(calls, "a"), phoneChecks(calls, "b"), phoneChecks(calls, "c")]).toEqual([1, 1, 0]);
  });
  it("a REJECTION does not pause anything (only no-answer does)", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({
      now: () => clock.t, rows: [phoneRow("a"), phoneRow("b")],
      phoneReply: (r) => (r?.id === "a" ? { status: "unknown", kind: "rejected" } : { status: "ok" }),
    });
    await booted;
    await sb.pcTick();
    expect([phoneChecks(calls, "a"), phoneChecks(calls, "b")]).toEqual([1, 1]);
  });
  it("a POST timeout pauses the shop's rows but keeps the SLOW ladder (7-11 may have processed it)", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({
      now: () => clock.t, rows: [rowGm("a", "GM1"), rowGm("b", "GM1")],
      phoneReply: (r) => (r?.id === "a" ? { status: "unknown", kind: "post_timeout" } : { status: "ok" }),
    });
    await booted;
    await sb.pcTick();
    expect(phoneChecks(calls, "b")).toBe(0);
    expect(calls.logs.some((l) => /\[PC-BACKOFF\] row=a phone attempt=1 reason=post_timeout .* next=15s/.test(l))).toBe(true);
  });
  it("healthy multi-row queue: exactly ONE phone check per row (no extra traffic, no double-check)", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, rows: [phoneRow("a"), phoneRow("b"), phoneRow("c")], phoneReply: () => ({ status: "ok" }) });
    await booted;
    await sb.pcTick();
    expect([phoneChecks(calls, "a"), phoneChecks(calls, "b"), phoneChecks(calls, "c")]).toEqual([1, 1, 1]);
  });
  it("myship tab not answering (null) → slow ladder, reason=no_tab", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, rows: [phoneRow("r1")], phoneReply: (r) => (r?.id === "r1" ? null : { status: "ok" }) });
    await booted;
    await sb.pcTick();
    expect(calls.logs.some((l) => /\[PC-BACKOFF\] row=r1 phone attempt=1 reason=no_tab \(myship tab not responding\) next=15s/.test(l))).toBe(true);
  });
  it("[PC-BACKOFF] names the reason kind + the human reason on every failed attempt", async () => {
    const r = await simulate(["timeout", "ok"]);
    expect(r.logs.some((l) => /\[PC-BACKOFF\] row=r1 phone attempt=1 reason=timeout \(sim timeout\) next=5s/.test(l))).toBe(true);
  });
  it("maintenance window (01:00–05:00 Taipei) unchanged: a timeout waits 10 min, is not counted, and gets NO immediate retry", async () => {
    const clock = { t: WIN_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, rows: [phoneRow("r1")], maintenance: true, phoneReply: () => ({ status: "unknown", kind: "timeout" }) });
    await booted;
    await sb.pcTick();
    expect(calls.logs.some((l) => /\[PC-BACKOFF\] row=r1 phone attempt=0 reason=timeout .* maintenance next=600s/.test(l))).toBe(true);
    expect(calls.sendMessage.find((m) => m.type === "PC_CHECK_PHONE" && m.rowId === "r1")?.tokenRetry).toBe(false);
  });
  it("the phone half is still never given up and never stamped 'unknown' (audit M1)", () => {
    const bg = readFileSync("chrome-extension/background.js", "utf8");
    expect(bg).toContain('pResp.phone_check_status === "ok" || pResp.phone_check_status === "restricted"');
  });
  it("store / E-Map timing untouched", () => {
    const bg = readFileSync("chrome-extension/background.js", "utf8");
    expect(bg).toContain("const PC_BACKOFF_MS = [15 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000];");
    expect(bg).toContain("b.storeNextAt = now + pcBackoffDelay(b.storeFails);");
    // 1.16.0: frozen rows are routed to the frozen tab; for every normal row (isFrozen false) the condition is unchanged
    expect(bg).toContain("const doStore = !isFrozen && Boolean(row.need_store) && Boolean(emapTabId) && !busy && (!bo || now >= bo.storeNextAt);"); // 1.16.1: + the global E0014 pause
    expect(bg).toContain("const PC_STORE_GIVE_UP = 5;");
    expect(bg).toContain("const PC_POLL_MS = 5000;");
    expect(bg).toContain("const PC_ROW_GAP_MS = 2000;");
  });
});
