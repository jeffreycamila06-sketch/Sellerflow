// SERVER-CAPACITY ALARMS (server/capacityAlarm.js, capacityTexts.js, observability.resolveMemoryLimitMb).
//   A. the memory limit (env → the container's own → the constant)
//   B. the texts: Jeff's words, numbers only
//   C. the level: each change, the lines, readings in a row, no flapping
//   D. one message per change, no repeat, a failed send, the switch, Telegram off
//   E. the unexpected restart: clean vs unclean, the old run still up, no double report, a crash loop
//   F. nothing here can hurt the server; the wiring in server.js
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createCapacityAlarm, stepLevel, newLevelState, wantedMessage, judgeRuns, restartValue, countPollers, createRunStore,
  MEM_WARN_AT, MEM_DANGER_AT, MEM_WARN_CLEAR, MEM_DANGER_CLEAR, MEM_UP_SAMPLES, MEM_DOWN_TO_WARNING_SAMPLES, MEM_DOWN_TO_NORMAL_SAMPLES,
  MEM_RESEND_MS, RUN_DEAD_AFTER_MS, RUN_LOOK_BACK_MS, RESTART_ALARM_GAP_MS, LOOK_BACK_FOR_MS, CLEAN_EXIT_WAIT_MS, CAPACITY_SAMPLE_MS, DB_WORK_LIMIT_MS,
  ALARM_SWITCH_KEY, RUNS_TABLE,
} from "../../../../server/capacityAlarm.js";
import { CAPACITY_TEXTS, livesText, livesTotal } from "../../../../server/capacityTexts.js";
import { alertText, ALERT_TEXTS, createTelegramAlert } from "../../../../server/telegramAlert.js";
import { resolveMemoryLimitMb, MEMORY_LIMIT_MB } from "../../../../server/observability.js";

const MB = 1024 * 1024;
const MIN = 60 * 1000;

describe("A. the memory limit is read, not written down", () => {
  it("env MEMORY_LIMIT_MB wins; else the container's own limit; else the constant", () => {
    expect(resolveMemoryLimitMb({ env: { MEMORY_LIMIT_MB: "2048" }, constrainedBytes: 512 * MB })).toEqual({ limitMb: 2048, source: "env" });
    expect(resolveMemoryLimitMb({ env: {}, constrainedBytes: 512 * MB })).toEqual({ limitMb: 512, source: "container" });
    expect(resolveMemoryLimitMb({ env: {}, constrainedBytes: 2048 * MB })).toEqual({ limitMb: 2048, source: "container" }); // after a plan change: no code change
    expect(resolveMemoryLimitMb({ env: {}, constrainedBytes: 0 })).toEqual({ limitMb: MEMORY_LIMIT_MB, source: "default" });
    expect(resolveMemoryLimitMb()).toEqual({ limitMb: MEMORY_LIMIT_MB, source: "default" });
  });
  it("a value that cannot be a plan size is not believed", () => {
    for (const bad of ["", " ", "abc", "512MB", "-512", "0", "64", "65537", "1e3", "512.5"]) {
      expect(resolveMemoryLimitMb({ env: { MEMORY_LIMIT_MB: bad }, constrainedBytes: 1024 * MB }), bad).toEqual({ limitMb: 1024, source: "container" });
    }
    // the container says "no limit" (0), something tiny, or a whole host's memory → the constant
    for (const bytes of [0, -1, NaN, Infinity, 64 * MB, 64 * 1024 * MB, undefined as unknown as number]) {
      expect(resolveMemoryLimitMb({ env: {}, constrainedBytes: bytes }), String(bytes)).toEqual({ limitMb: MEMORY_LIMIT_MB, source: "default" });
    }
    expect(resolveMemoryLimitMb({ env: { MEMORY_LIMIT_MB: " 4096 " }, constrainedBytes: 0 })).toEqual({ limitMb: 4096, source: "env" });
  });
});

describe("B. the texts", () => {
  const lives = { tiktok: 41, facebook: 0, instagram: 0, shopee: 0 };
  it("Jeff's four messages, word for word", () => {
    expect(CAPACITY_TEXTS.mem_warning({ pct: 62, usedMb: 318, limitMb: 512, lives })).toBe(
      "⚠️ SellerFlowLive server\nMemory: 62% (318 MB sa 512 MB)\nNaka-live ngayon: 41 TikTok\nWala pang problema, pero sumisikip na.");
    expect(CAPACITY_TEXTS.mem_danger({ pct: 78, usedMb: 399, limitMb: 512, lives })).toBe(
      "🔴 SellerFlowLive server — DELIKADO\nMemory: 78% (399 MB sa 512 MB)\nNaka-live ngayon: 41 TikTok\nKapag napuno ito, magre-restart ang server at mapuputol ang lahat ng live.\nGawin: itaas ang plan sa Render.");
    expect(CAPACITY_TEXTS.mem_ok({ pct: 41, lives: { tiktok: 19 } })).toBe("✅ SellerFlowLive server — ok na ulit\nMemory: 41%. Naka-live: 19 TikTok.");
    expect(CAPACITY_TEXTS.restart({ lives: 37, times: 1 })).toBe("🔴 SellerFlowLive server — NAG-RESTART\nNaputol: 37 live. Kailangang mag-Connect ulit ang mga seller.");
  });
  it("the restart text adds the last memory reading when it is known, and the count when it died more than once", () => {
    expect(CAPACITY_TEXTS.restart({ lives: 37, times: 1, lastPct: 93 })).toBe(
      "🔴 SellerFlowLive server — NAG-RESTART\nNaputol: 37 live. Kailangang mag-Connect ulit ang mga seller.\nHuling memory bago naputol: 93%.");
    expect(CAPACITY_TEXTS.restart({ lives: 40, times: 3, lastPct: -1 })).toBe(
      "🔴 SellerFlowLive server — NAG-RESTART\nNaputol: 40 live. Kailangang mag-Connect ulit ang mga seller.\nNag-restart nang 3 beses.");
  });
  it("Facebook, Instagram and Shopee lives are named only when there are some; TikTok always", () => {
    expect(livesText({ tiktok: 41, facebook: 3, instagram: 0, shopee: 2 })).toBe("41 TikTok, 3 Facebook, 2 Shopee");
    expect(livesText({ tiktok: 0, facebook: 0, instagram: 1, shopee: 0 })).toBe("0 TikTok, 1 Instagram");
    expect(livesText({ tiktok: 0 })).toBe("0 TikTok");
    expect(livesTotal({ tiktok: 41, facebook: 3, shopee: 2 })).toBe(46);
  });
  it("NUMBERS ONLY: anything that is not a whole number gives no text at all — a name can never ride along", () => {
    const sneaky = ["Maria Santos", "maria@example.com", "41 TikTok\nextra", { toString: () => "x" }, 1.5, -1, NaN, Infinity, null, undefined, "41", [41]];
    for (const bad of sneaky) {
      expect(CAPACITY_TEXTS.mem_warning({ pct: bad as never, usedMb: 318, limitMb: 512, lives }), String(bad)).toBe("");
      expect(CAPACITY_TEXTS.mem_warning({ pct: 62, usedMb: bad as never, limitMb: 512, lives }), String(bad)).toBe("");
      expect(CAPACITY_TEXTS.mem_warning({ pct: 62, usedMb: 318, limitMb: bad as never, lives }), String(bad)).toBe("");
      expect(CAPACITY_TEXTS.mem_danger({ pct: 78, usedMb: 399, limitMb: 512, lives: { tiktok: bad as never } }), String(bad)).toBe("");
      expect(CAPACITY_TEXTS.mem_danger({ pct: 78, usedMb: 399, limitMb: 512, lives: { tiktok: 1, shopee: bad as never } }), String(bad)).toBe("");
      expect(CAPACITY_TEXTS.mem_ok({ pct: bad as never, lives }), String(bad)).toBe("");
      expect(CAPACITY_TEXTS.restart({ lives: bad as never, times: 1 }), String(bad)).toBe("");
      expect(CAPACITY_TEXTS.restart({ lives: 3, times: bad as never }), String(bad)).toBe("");
      // lastPct: undefined and -1 both mean "not known" (that line is left out); anything else odd = no text
      if (bad !== undefined && bad !== -1) expect(CAPACITY_TEXTS.restart({ lives: 3, times: 1, lastPct: bad as never }), String(bad)).toBe("");
    }
    for (const v of [null, undefined, "text", 5, []]) for (const k of Object.keys(CAPACITY_TEXTS) as (keyof typeof CAPACITY_TEXTS)[]) expect(CAPACITY_TEXTS[k](v as never)).toBe("");
    expect(CAPACITY_TEXTS.restart({ lives: 3, times: 0 })).toBe("");
    expect(CAPACITY_TEXTS.mem_warning({ pct: 62, usedMb: 318, limitMb: 0, lives })).toBe("");
  });
  it("every text = fixed words + numbers (with the digits taken out, only 4 shapes exist per message)", () => {
    const shapes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const v = { pct: (i * 7) % 130, usedMb: i * 13, limitMb: 512 + i, lives: { tiktok: i, facebook: i % 3, instagram: 0, shopee: i % 2 } };
      shapes.add(CAPACITY_TEXTS.mem_warning(v).replace(/\d+/g, "#"));
    }
    expect(shapes.size).toBe(4);   // TikTok · +Facebook · +Shopee · +both
    for (const s of shapes) expect(s).toMatch(/^⚠️ SellerFlowLive server\nMemory: #% \(# MB sa # MB\)\nNaka-live ngayon: # TikTok(, # Facebook)?(, # Shopee)?\nWala pang problema, pero sumisikip na\.$/);
  });
  it("the Telegram sender builds them through the same door as every other alert, and the old texts are unchanged", () => {
    expect(alertText("mem_ok", { pct: 41, lives: { tiktok: 19 } })).toBe("✅ SellerFlowLive server — ok na ulit\nMemory: 41%. Naka-live: 19 TikTok.");
    expect(alertText("mem_ok", "free text")).toBe("");
    expect(alertText("mem_warning", undefined)).toBe("");
    expect(alertText("restart", { lives: 2, times: 1, lastPct: 88 })).toContain("Naputol: 2 live.");
    expect(alertText("logged_out", { pct: 1 })).toBe(ALERT_TEXTS.logged_out);
    expect(alertText("new_version", "16b4bb9")).toBe("Server restarted on a new version. 16b4bb9");
    expect(alertText("nope", { pct: 1 })).toBe("");
    for (const k of Object.keys(CAPACITY_TEXTS)) expect(Object.prototype.hasOwnProperty.call(ALERT_TEXTS, k), k).toBe(false);
  });
});

describe("C. the level", () => {
  const run = (pcts: number[], from = newLevelState()) => pcts.reduce((s, p) => stepLevel(s, p), from);
  const rep = (p: number, n: number) => Array(n).fill(p);
  it("the numbers", () => {
    expect([MEM_WARN_AT, MEM_DANGER_AT, MEM_WARN_CLEAR, MEM_DANGER_CLEAR]).toEqual([60, 75, 55, 70]);
    expect([MEM_UP_SAMPLES, MEM_DOWN_TO_WARNING_SAMPLES, MEM_DOWN_TO_NORMAL_SAMPLES]).toEqual([2, 10, 15]);
    expect(CAPACITY_SAMPLE_MS).toBe(60000);
  });
  it("warning: 2 readings in a row at 60 % or more; one is not enough; 59 % never", () => {
    expect(run(rep(59, 500)).level).toBe("normal");
    expect(run([60]).level).toBe("normal");
    expect(run([60, 60]).level).toBe("warning");
    expect(run([62, 59, 62, 59, 62, 59, 62]).level).toBe("normal");   // never two in a row
    expect(run([62, 59, 62, 62]).level).toBe("warning");
  });
  it("danger: 2 in a row at 75 % or more — from warning, or straight from normal", () => {
    expect(run([62, 62, 74, 74, 74]).level).toBe("warning");
    expect(run([62, 62, 75]).level).toBe("warning");
    expect(run([62, 62, 75, 75]).level).toBe("danger");
    expect(run([80, 80]).level).toBe("danger");                        // both readings reached danger
    expect(run([62, 80]).level).toBe("warning");                       // the lowest level both reached
    expect(run([62, 80, 80]).level).toBe("warning");                   // … then danger needs its own 2 in a row
    expect(run([62, 80, 80, 80]).level).toBe("danger");
  });
  it("down from danger: 10 readings in a row under 70 % → warning; any reading at 70 % or more starts the count again", () => {
    const danger = run([80, 80]);
    expect(run(rep(69, 9), danger).level).toBe("danger");
    expect(run(rep(69, 10), danger).level).toBe("warning");
    expect(run([...rep(69, 9), 70, ...rep(69, 9)], danger).level).toBe("danger");
    expect(run([...rep(69, 9), 70, ...rep(69, 10)], danger).level).toBe("warning");
    expect(run(rep(72, 500), danger).level).toBe("danger");            // between the lines: it stays
  });
  it("back to normal: 15 readings in a row under 55 %", () => {
    const warning = run([62, 62]);
    expect(run(rep(54, 14), warning).level).toBe("warning");
    expect(run(rep(54, 15), warning).level).toBe("normal");
    expect(run(rep(55, 500), warning).level).toBe("warning");          // 55–59 %: neither up nor back
    expect(run([...rep(54, 14), 56, ...rep(54, 14)], warning).level).toBe("warning");
    const danger = run([80, 80]);
    expect(run(rep(30, 14), danger).level).toBe("danger");             // all far below: straight to normal, at 15
    expect(run(rep(30, 15), danger).level).toBe("normal");
    expect(run([65, ...rep(30, 9)], danger).level).toBe("warning");    // one reading only under 70 %: warning at 10
  });
  it("NO FLAPPING: a reading that swings around a line changes the level at most once", () => {
    const changes = (pcts: number[]) => { let s = newLevelState(), n = 0; for (const p of pcts) { const b = s.level; s = stepLevel(s, p); if (s.level !== b) n++; } return n; };
    expect(changes(Array.from({ length: 600 }, (_, i) => (i % 2 ? 61 : 59)))).toBe(0);
    expect(changes(Array.from({ length: 600 }, (_, i) => 58 + (i % 4)))).toBe(1);           // 58,59,60,61 → up once, never back
    expect(changes(Array.from({ length: 600 }, (_, i) => 73 + (i % 4)))).toBe(2);           // 73..76 around the danger line: up to warning, up to danger, never back
    expect(changes(Array.from({ length: 600 }, (_, i) => 50 + (i % 12)))).toBe(1);          // 50..61: up once, then never 15 calm in a row
  });
  it("a reading that is not a number changes nothing; told is carried through", () => {
    const s = run([62, 62]);
    expect(stepLevel(s, NaN)).toEqual(s);
    expect(stepLevel(s, undefined as never)).toEqual(s);
    expect(run([62, 62], newLevelState("danger")).told).toBe("danger");
    expect(newLevelState("nonsense" as never).told).toBe("normal");
  });
  it("which message a state asks for", () => {
    const w = (level: string, told: string) => wantedMessage({ ...newLevelState(told), level });
    expect([w("normal", "normal"), w("warning", "normal"), w("danger", "normal")]).toEqual(["", "mem_warning", "mem_danger"]);
    expect([w("normal", "warning"), w("warning", "warning"), w("danger", "warning")]).toEqual(["mem_ok", "", "mem_danger"]);
    expect([w("normal", "danger"), w("warning", "danger"), w("danger", "danger")]).toEqual(["mem_ok", "", ""]);   // danger → warning: silent
  });
});

// ── the runtime, with a hand-moved clock, a fake Telegram and a fake table ──────
type RunRow = { run_id: string; started_at: string; heartbeat_at: string; lives: number; mem_pct: number; told_level: string; commit?: string | null; ended_clean_at?: string | null; alarmed_at?: string | null };
const T0 = Date.parse("2026-11-24T04:00:00Z");
function world(o: { rows?: RunRow[]; enabled?: boolean; silenced?: boolean; table?: boolean; limitMb?: number } = {}) {
  const w = {
    now: T0, rssMb: 100, lives: { tiktok: 41, facebook: 0, instagram: 0, shopee: 0 } as Record<string, number> | (() => never),
    rows: (o.rows || []).map((r) => ({ ended_clean_at: null, alarmed_at: null, commit: null, ...r })) as RunRow[],
    sent: [] as { kind: string; value: unknown; text: string }[], fired: [] as { kind: string; value: unknown; text: string }[],
    deliverAnswers: [] as (boolean | "throw" | "hang")[], calls: [] as string[], logs: [] as string[],
    silenced: o.silenced === true, table: o.table !== false, storeFails: false,
  };
  const alert = {
    enabled: () => o.enabled !== false,
    deliver: vi.fn(async (kind: string, value: unknown) => {
      const a = w.deliverAnswers.shift();
      if (a === "throw") throw new Error("telegram exploded");
      if (a === "hang") return new Promise(() => {});
      const text = alertText(kind, value);
      if (a === false) return { ok: false, word: "http_500" };
      w.sent.push({ kind, value, text });
      return { ok: true };
    }),
    fire: vi.fn((kind: string, value: unknown) => { w.fired.push({ kind, value, text: alertText(kind, value) }); }),
  };
  const guard = <T,>(name: string, fallback: T, fn: () => T) => { w.calls.push(name); if (w.storeFails || !w.table) return fallback; return fn(); };
  const store = {
    begin: async (row: RunRow) => guard("begin", false, () => { w.rows.push({ ended_clean_at: null, alarmed_at: null, ...row }); return true; }),
    beat: async (id: string, patch: Partial<RunRow>) => guard("beat", false, () => { Object.assign(w.rows.find((r) => r.run_id === id)!, patch); return true; }),
    markClean: async (id: string, iso: string) => guard("markClean", false, () => { Object.assign(w.rows.find((r) => r.run_id === id)!, { ended_clean_at: iso, heartbeat_at: iso }); return true; }),
    recent: async (since: string) => guard("recent", null, () => w.rows.filter((r) => r.heartbeat_at >= since).map((r) => ({ ...r }))),
    claim: async (ids: string[], iso: string) => guard("claim", null, () => { const got = w.rows.filter((r) => ids.includes(r.run_id) && !r.alarmed_at && !r.ended_clean_at); for (const r of got) r.alarmed_at = iso; return got.map((r) => ({ ...r })); }),
    purge: async () => guard("purge", false, () => true),
    silenced: async () => { w.calls.push("silenced"); return w.silenced; },
  };
  const alarm = createCapacityAlarm({
    alert, store, limitMb: o.limitMb ?? 512, runId: "aaaaaaaaaaaaaaaa", commit: "16b4bb9",
    memory: () => ({ rss: w.rssMb * MB }), lives: () => (typeof w.lives === "function" ? w.lives() : w.lives),
    now: () => w.now, log: (l: string) => w.logs.push(l),
    setTimer: (() => ({ unref() {} })) as never, clearTimer: (() => {}) as never,
  });
  // one reading a minute later, at this memory percent (of 512 MB unless told otherwise)
  const read = async (pct: number, n = 1) => {
    for (let i = 0; i < n; i++) {
      w.now += MIN;
      w.rssMb = Math.round(((o.limitMb ?? 512) * pct) / 100);
      await alarm.tick();
      await Promise.race([alarm._settled(), new Promise((r) => setTimeout(r, 5))]);
    }
  };
  return { w, alarm, alert, store, read };
}
const kinds = (w: { sent: { kind: string }[] }) => w.sent.map((s) => s.kind);
const iso = (ms: number) => new Date(ms).toISOString();
const oldRun = (over: Partial<RunRow> = {}): RunRow => ({ run_id: "bbbbbbbbbbbbbbbb", started_at: iso(T0 - 6 * 60 * MIN), heartbeat_at: iso(T0 - 5 * MIN), lives: 37, mem_pct: 93, told_level: "normal", ...over });

describe("D. one message per change of level", () => {
  it("normal → warning → danger → back to normal: three messages in all, with the numbers of their moment", async () => {
    const { w, alarm, read } = world();
    await alarm.start();
    await read(40, 30);
    expect(kinds(w)).toEqual([]);
    await read(62);
    expect(kinds(w)).toEqual([]);                    // one reading is not a level
    await read(62);
    expect(w.sent.map((s) => s.text)).toEqual(["⚠️ SellerFlowLive server\nMemory: 62% (317 MB sa 512 MB)\nNaka-live ngayon: 41 TikTok\nWala pang problema, pero sumisikip na."]);
    await read(66, 120);                             // two hours at warning
    expect(kinds(w)).toEqual(["mem_warning"]);       // never again
    w.lives = { tiktok: 44, facebook: 2, instagram: 0, shopee: 1 };
    await read(78, 2);
    expect(kinds(w)).toEqual(["mem_warning", "mem_danger"]);
    expect(w.sent[1].text).toBe("🔴 SellerFlowLive server — DELIKADO\nMemory: 78% (399 MB sa 512 MB)\nNaka-live ngayon: 44 TikTok, 2 Facebook, 1 Shopee\nKapag napuno ito, magre-restart ang server at mapuputol ang lahat ng live.\nGawin: itaas ang plan sa Render.");
    await read(80, 200);
    expect(kinds(w)).toEqual(["mem_warning", "mem_danger"]);
    await read(65, 60);                              // down to warning: no message
    expect(alarm.state().level).toBe("warning");
    expect(kinds(w)).toEqual(["mem_warning", "mem_danger"]);
    await read(80, 60);                              // up to danger again: he was never told it got better → no message
    expect(alarm.state().level).toBe("danger");
    expect(kinds(w)).toEqual(["mem_warning", "mem_danger"]);
    w.lives = { tiktok: 19 };
    await read(41, 14);
    expect(kinds(w)).toEqual(["mem_warning", "mem_danger"]);
    await read(41);
    expect(kinds(w)).toEqual(["mem_warning", "mem_danger", "mem_ok"]);
    expect(w.sent[2].text).toBe("✅ SellerFlowLive server — ok na ulit\nMemory: 41%. Naka-live: 19 TikTok.");
    await read(41, 300);
    expect(w.sent).toHaveLength(3);
  });
  it("the limit in the message is the one given, so a bigger plan changes the numbers by itself", async () => {
    const { w, alarm, read } = world({ limitMb: 2048 });
    await alarm.start();
    await read(62, 2);
    expect(w.sent[0].text).toContain("Memory: 62% (1270 MB sa 2048 MB)");
    // 400 MB is 78 % of 512 but 20 % of 2048
    const big = world({ limitMb: 2048 });
    big.alarm.start();
    big.w.rssMb = 400;
    for (let i = 0; i < 30; i++) { big.w.now += MIN; await big.alarm.tick(); }
    expect(big.w.sent).toEqual([]);
  });
  it("a send Telegram refused: he was NOT told — tried again 15 minutes later, not sooner, and not once it is calm", async () => {
    const { w, alarm, alert, read } = world();
    await alarm.start();
    w.deliverAnswers.push(false);
    await read(62, 2);
    expect(alert.deliver).toHaveBeenCalledTimes(1);
    expect(alarm.state()).toMatchObject({ level: "warning", told: "normal" });
    await read(63, 14);
    expect(alert.deliver).toHaveBeenCalledTimes(1);          // 14 minutes later: not yet
    await read(63);
    expect(alert.deliver).toHaveBeenCalledTimes(2);          // 15 minutes after the first try
    expect(kinds(w)).toEqual(["mem_warning"]);
    expect(alarm.state().told).toBe("warning");
    expect(MEM_RESEND_MS).toBe(15 * MIN);
    // a warning that never got through, then calm: no late warning at 40 %, and no "ok" for a warning he never saw
    const b = world();
    await b.alarm.start();
    b.w.deliverAnswers.push(false);
    await b.read(62, 2);
    await b.read(40, 40);
    expect(b.alert.deliver).toHaveBeenCalledTimes(1);
    expect(b.w.sent).toEqual([]);
    expect(b.alarm.state()).toMatchObject({ level: "normal", told: "normal" });
  });
  it("a retry never says 'sumisikip' on a calm reading: the level is still warning, the reading is under 55 % → not sent now", async () => {
    const { w, alarm, alert, read } = world();
    await alarm.start();
    w.deliverAnswers.push(false);
    await read(62, 2);                                       // warning, Telegram refused
    await read(57, 16);                                      // 55–59 %: the level stays warning; the retry is due
    expect(alert.deliver).toHaveBeenCalledTimes(2);          // … and at 57 % it still holds → sent
    expect(w.sent.map((s) => s.text)).toEqual(["⚠️ SellerFlowLive server\nMemory: 57% (292 MB sa 512 MB)\nNaka-live ngayon: 41 TikTok\nWala pang problema, pero sumisikip na."]);
    const b = world();
    await b.alarm.start();
    b.w.deliverAnswers.push(false);
    await b.read(62, 2);
    await b.read(57, 14);
    await b.read(50, 3);                                     // the retry is due, the level is still warning, but 50 % is calm
    expect(b.alarm.state().level).toBe("warning");
    expect(b.alert.deliver).toHaveBeenCalledTimes(1);
    await b.read(57);                                        // it holds again → now
    expect(b.alert.deliver).toHaveBeenCalledTimes(2);
  });
  it("the switch: 'false' = nothing is sent, the readings go on; back on → he gets the level that still holds", async () => {
    const { w, alarm, alert, read } = world({ silenced: true });
    await alarm.start();
    await read(80, 3);
    expect(alarm.state().level).toBe("danger");
    expect(alert.deliver).not.toHaveBeenCalled();
    expect(w.logs.some((l) => l.includes("mem_danger not sent (switch off)"))).toBe(true);
    expect(w.rows.find((r) => r.run_id === "aaaaaaaaaaaaaaaa")!.mem_pct).toBe(80);   // the heartbeat goes on
    w.silenced = false;
    await read(80, 16);
    expect(kinds(w)).toEqual(["mem_danger"]);
  });
  it("Telegram env not set: nothing starts — no timer, no reading, no database call", async () => {
    const timers: unknown[] = [];
    const calls: string[] = [];
    const store = new Proxy({}, { get: (_t, name: string) => async () => { calls.push(name); return null; } }) as never;
    const memory = vi.fn(() => ({ rss: 500 * MB }));
    const logs: string[] = [];
    const alarm = createCapacityAlarm({ alert: createTelegramAlert({ env: {}, fetchImpl: (() => { throw new Error("no"); }) as never, log: () => {} }), store, memory, log: (l: string) => logs.push(l), setTimer: ((fn: unknown) => { timers.push(fn); return {}; }) as never });
    await alarm.start();
    await alarm.tick();
    expect([timers.length, calls.length, memory.mock.calls.length]).toEqual([0, 0, 0]);
    expect(logs).toEqual(["[CAPACITY] alarms_off"]);
    expect(await alarm.markCleanExit()).toBe(false);
    for (const a of [null, {}, { enabled: () => { throw new Error("x"); } }, { enabled: () => "yes" }]) {
      const x = createCapacityAlarm({ alert: a as never, store, memory });
      await x.start();
      await x.tick();
    }
    expect(calls).toEqual([]);
  });
  it("start() twice starts one timer", async () => {
    let n = 0;
    const { alarm } = world();
    const a = createCapacityAlarm({ alert: { enabled: () => true, deliver: async () => ({ ok: true }), fire: () => {} } as never, store: null, setTimer: (() => { n++; return {}; }) as never, memory: () => ({ rss: 1 }), log: () => {} });
    await a.start(); await a.start();
    expect(n).toBe(1);
    void alarm;
  });
});

describe("E. the unexpected restart", () => {
  it("judgeRuns: clean end = silent · no clean end + heartbeat stopped = died · heartbeat still moving = wait", () => {
    const me = { runId: "aaaaaaaaaaaaaaaa", startedAt: iso(T0) };
    const j = (rows: Partial<RunRow>[], at = T0 + MIN) => judgeRuns(rows.map((r) => oldRun(r)), me, at);
    expect(j([{ ended_clean_at: iso(T0 - MIN) }])).toMatchObject({ dead: [], waiting: 0 });
    expect(j([{}]).dead.map((r: RunRow) => r.run_id)).toEqual(["bbbbbbbbbbbbbbbb"]);
    expect(j([{ heartbeat_at: iso(T0 + 30000) }])).toMatchObject({ dead: [], waiting: 1 });
    expect(j([{ heartbeat_at: iso(T0 + MIN - RUN_DEAD_AFTER_MS) }])).toMatchObject({ dead: [], waiting: 1 });       // exactly 150 s: not yet
    expect(j([{ heartbeat_at: iso(T0 + MIN - RUN_DEAD_AFTER_MS - 1) }]).dead).toHaveLength(1);
    expect(j([{ alarmed_at: iso(T0 - MIN) }])).toMatchObject({ dead: [], waiting: 0, lastAlarmAt: T0 - MIN });        // already reported
    expect(j([{ heartbeat_at: iso(T0 + MIN - RUN_LOOK_BACK_MS - 1) }])).toMatchObject({ dead: [], waiting: 0 });      // more than 6 h ago: no longer news
    expect(j([{ started_at: iso(T0 + 1) }])).toMatchObject({ dead: [], waiting: 0 });                                 // a run that started AFTER this one
    expect(j([{ run_id: "aaaaaaaaaaaaaaaa" }])).toMatchObject({ dead: [], waiting: 0 });                              // itself
    expect(judgeRuns(null as never, me, T0)).toEqual({ dead: [], waiting: 0, lastAlarmAt: 0 });
    expect(judgeRuns([null, {}, { run_id: "x", started_at: "junk", heartbeat_at: "junk" }] as never, me, T0).dead).toEqual([]);
    expect(RUN_DEAD_AFTER_MS).toBe(150000);
  });
  it("restartValue: the lives of every run that died, the last memory reading of the newest", () => {
    expect(restartValue([oldRun({ lives: 37, mem_pct: 93 })])).toEqual({ lives: 37, times: 1, lastPct: 93 });
    expect(restartValue([oldRun({ lives: 2, mem_pct: 30 }), oldRun({ lives: 37, mem_pct: 93 })])).toEqual({ lives: 39, times: 2, lastPct: 30 });
    expect(restartValue([oldRun({ lives: -5 as never, mem_pct: "x" as never })])).toEqual({ lives: 0, times: 1, lastPct: -1 });
  });
  it("the run before ended CLEANLY (deploy, Render's restart, SIGTERM) → silent", async () => {
    const { w, alarm, alert, read } = world({ rows: [oldRun({ ended_clean_at: iso(T0 - 20000), heartbeat_at: iso(T0 - 20000) })] });
    await alarm.start();
    await read(30, 30);
    expect(alert.fire).not.toHaveBeenCalled();
    expect(w.sent).toEqual([]);
  });
  it("the run before did NOT end cleanly and its heartbeat stopped → ONE alarm with the lives it carried", async () => {
    const { w, alarm, alert, read } = world({ rows: [oldRun()] });   // last heartbeat 5 minutes before this start
    await alarm.start();
    await alarm.tick();
    expect(w.fired.map((f) => f.text)).toEqual(["🔴 SellerFlowLive server — NAG-RESTART\nNaputol: 37 live. Kailangang mag-Connect ulit ang mga seller.\nHuling memory bago naputol: 93%."]);
    await read(30, 40);
    expect(alert.fire).toHaveBeenCalledTimes(1);                      // never again for that run
    expect(w.rows.find((r) => r.run_id === "bbbbbbbbbbbbbbbb")!.alarmed_at).toBeTruthy();
  });
  it("a crash seconds ago: nothing at the first look (it could be the old instance still up) — the alarm comes once its heartbeat is 150 s old", async () => {
    const { w, alarm, alert, read } = world({ rows: [oldRun({ heartbeat_at: iso(T0 - 20000) })] });
    await alarm.start();
    await alarm.tick();
    expect(alert.fire).not.toHaveBeenCalled();
    await read(30, 2);                                                 // 2 minutes after the start: 140 s old
    expect(alert.fire).not.toHaveBeenCalled();
    await read(30);                                                    // 200 s old
    expect(w.fired).toHaveLength(1);
    expect(w.fired[0].value).toEqual({ lives: 37, times: 1, lastPct: 93 });
  });
  it("the old instance is still up while the new one starts (Render's zero-downtime deploy), then stops cleanly → silent", async () => {
    const { w, alarm, alert, read } = world({ rows: [oldRun({ heartbeat_at: iso(T0 - 5000) })] });
    await alarm.start();
    const old = w.rows[0];
    for (let i = 0; i < 4; i++) { await read(30); old.heartbeat_at = iso(w.now - 5000); }   // it keeps beating for 4 minutes
    expect(alert.fire).not.toHaveBeenCalled();
    old.ended_clean_at = iso(w.now);                                   // SIGTERM arrives: it says so
    await read(30, 30);
    expect(alert.fire).not.toHaveBeenCalled();
  });
  it("…but if that old instance then dies WITHOUT saying so, the alarm comes", async () => {
    const { w, alarm, read } = world({ rows: [oldRun({ heartbeat_at: iso(T0 - 5000), lives: 12, mem_pct: 61 })] });
    await alarm.start();
    const old = w.rows[0];
    for (let i = 0; i < 3; i++) { await read(30); old.heartbeat_at = iso(w.now - 5000); }
    await read(30, 3);
    expect(w.fired.map((f) => f.value)).toEqual([{ lives: 12, times: 1, lastPct: 61 }]);
  });
  it("two runs never report one death twice; an unreadable table reports nothing", async () => {
    const a = world({ rows: [oldRun()] });
    a.store.claim = async () => [];                                    // another run got there first
    await a.alarm.start();
    await a.alarm.tick();
    expect(a.alert.fire).not.toHaveBeenCalled();
    const b = world({ rows: [oldRun()] });
    b.store.claim = async () => null;                                  // the database did not answer
    await b.alarm.start();
    await b.alarm.tick();
    expect(b.alert.fire).not.toHaveBeenCalled();
  });
  it("a crash loop is one alarm per 15 minutes, with the deaths summed", async () => {
    const { w, alarm, alert, read } = world({ rows: [
      oldRun({ run_id: "c1c1c1c1c1c1c1c1", started_at: iso(T0 - 40 * MIN), heartbeat_at: iso(T0 - 30 * MIN), lives: 30, mem_pct: 95, alarmed_at: iso(T0 - 5 * MIN) }),  // reported 5 minutes ago
      oldRun({ run_id: "c2c2c2c2c2c2c2c2", started_at: iso(T0 - 29 * MIN), heartbeat_at: iso(T0 - 20 * MIN), lives: 4, mem_pct: 88 }),
      oldRun({ run_id: "c3c3c3c3c3c3c3c3", started_at: iso(T0 - 19 * MIN), heartbeat_at: iso(T0 - 10 * MIN), lives: 1, mem_pct: 91 }),
    ] });
    await alarm.start();
    await alarm.tick();
    expect(alert.fire).not.toHaveBeenCalled();                         // 5 minutes after the last alarm: wait
    await read(30, 9);
    expect(alert.fire).not.toHaveBeenCalled();
    await read(30, 2);                                                 // 15 minutes after it
    expect(w.fired.map((f) => f.value)).toEqual([{ lives: 5, times: 2, lastPct: 91 }]);
    expect(w.fired[0].text).toBe("🔴 SellerFlowLive server — NAG-RESTART\nNaputol: 5 live. Kailangang mag-Connect ulit ang mga seller.\nNag-restart nang 2 beses.\nHuling memory bago naputol: 91%.");
    expect(RESTART_ALARM_GAP_MS).toBe(15 * MIN);
  });
  it("an old unclean end (more than 6 hours ago) is not news; the switch off = the death is noted, nothing is sent", async () => {
    const a = world({ rows: [oldRun({ heartbeat_at: iso(T0 - 7 * 60 * MIN) })] });
    await a.alarm.start();
    await a.read(30, 5);
    expect(a.alert.fire).not.toHaveBeenCalled();
    const b = world({ rows: [oldRun()], silenced: true });
    await b.alarm.start();
    await b.alarm.tick();
    expect(b.alert.fire).not.toHaveBeenCalled();
    b.w.silenced = false;
    await b.read(30, 30);
    expect(b.alert.fire).not.toHaveBeenCalled();                       // not sent late either
  });
  it("this run: one row at the start, a heartbeat every reading (time, lives, memory %, what the Admin was told), and it stops looking back after 20 minutes", async () => {
    const { w, alarm, read } = world();
    await alarm.start();
    await alarm.tick();
    expect(w.rows).toHaveLength(1);
    expect(w.rows[0]).toMatchObject({ run_id: "aaaaaaaaaaaaaaaa", started_at: iso(T0), lives: 41, told_level: "normal", commit: "16b4bb9", ended_clean_at: null, alarmed_at: null });
    w.lives = { tiktok: 40, facebook: 3, instagram: 1, shopee: 2 };
    await read(62, 2);
    expect(w.rows[0]).toMatchObject({ heartbeat_at: iso(w.now), lives: 46, mem_pct: 62 });
    await read(62);
    expect(w.rows[0].told_level).toBe("warning");                      // written once Telegram took it
    expect(Object.keys(w.rows[0]).sort()).toEqual(["alarmed_at", "commit", "ended_clean_at", "heartbeat_at", "lives", "mem_pct", "run_id", "started_at", "told_level"]);
    w.calls.length = 0;
    await read(62, 18);
    expect(w.calls.filter((c) => c === "recent").length).toBeGreaterThan(0);
    w.calls.length = 0;
    await read(62, 30);                                                // more than 20 minutes after the start
    expect(w.calls.filter((c) => c === "recent")).toEqual([]);
    expect(w.calls.filter((c) => c === "beat")).toHaveLength(30);
    expect(LOOK_BACK_FOR_MS).toBe(20 * MIN);
  });
  it("what the Admin was told survives a restart: a warning, then a clean restart → the ✅ comes 15 calm minutes after the new start", async () => {
    const { w, alarm, read } = world({ rows: [oldRun({ told_level: "warning", ended_clean_at: iso(T0 - 20000), heartbeat_at: iso(T0 - 20000) })] });
    await alarm.start();
    expect(alarm.state()).toMatchObject({ level: "warning", told: "warning" });   // it starts AT the level he was told
    await read(30, 14);
    expect(w.sent).toEqual([]);                                                  // no ✅ the moment it starts
    await read(30, 1);
    expect(w.sent.map((s) => s.text)).toEqual(["✅ SellerFlowLive server — ok na ulit\nMemory: 30%. Naka-live: 41 TikTok."]);
    // nothing to carry: nothing is sent
    const b = world({ rows: [oldRun({ told_level: "normal", ended_clean_at: iso(T0 - 20000) })] });
    await b.alarm.start();
    await b.read(30, 40);
    expect(b.w.sent).toEqual([]);
  });
  it("SIGTERM: the clean end is written; a database that hangs is not waited for longer than 3 seconds", async () => {
    const { w, alarm } = world();
    await alarm.start();
    await alarm.tick();
    expect(await alarm.markCleanExit()).toBe(true);
    expect(w.rows[0].ended_clean_at).toBe(iso(w.now));
    w.calls.length = 0;
    await alarm.tick();                                                // after it: no more heartbeats
    expect(w.calls.filter((c) => c === "beat")).toEqual([]);
    vi.useFakeTimers();
    try {
      const b = world();
      await b.alarm.start();
      await b.alarm.tick();
      b.store.markClean = () => new Promise(() => {});
      const p = b.alarm.markCleanExit();
      let done: boolean | "pending" = "pending";
      void p.then((v) => { done = v; });
      await vi.advanceTimersByTimeAsync(CLEAN_EXIT_WAIT_MS - 1);
      expect(done).toBe("pending");
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toBe(false);
      const c = world();
      await c.alarm.start();
      await c.alarm.tick();
      c.store.markClean = () => { throw new Error("x"); };
      expect(await c.alarm.markCleanExit()).toBe(false);
      expect(CLEAN_EXIT_WAIT_MS).toBe(3000);
    } finally { vi.useRealTimers(); }
  });
  it("sql/215 not applied (no table): one log line, the memory alarms work, the restart alarm is off; it starts by itself once the table is there", async () => {
    const { w, alarm, alert, read } = world({ table: false });
    await alarm.start();
    await read(62, 3);
    expect(kinds(w)).toEqual(["mem_warning"]);
    expect(w.logs.filter((l) => l.includes("runs table not ready"))).toHaveLength(1);
    expect(alert.fire).not.toHaveBeenCalled();
    expect(await createCapacityAlarm({ alert: alert as never, store: null }).markCleanExit()).toBe(false);
    w.table = true;
    await read(62);
    expect(w.rows.map((r) => r.run_id)).toEqual(["aaaaaaaaaaaaaaaa"]);
    expect(w.logs.some((l) => l.includes("runs table ready"))).toBe(true);
  });
});

describe("F. it can never hurt the server", () => {
  it("Telegram throws, hangs or refuses; the database fails; memory or the live counters throw — tick() always resolves, nothing escapes", async () => {
    const { w, alarm, alert, read } = world({ rows: [oldRun()] });
    await alarm.start();
    w.deliverAnswers.push("throw");
    await expect(read(80, 2)).resolves.toBeUndefined();
    expect(alarm.state().told).toBe("normal");
    w.storeFails = true;
    await expect(read(80, 5)).resolves.toBeUndefined();
    w.lives = () => { throw new Error("map gone"); };
    await expect(read(80, 16)).resolves.toBeUndefined();
    expect(w.sent.at(-1)!.text).toContain("Naka-live ngayon: 0 TikTok");   // counters broken → 0, the alarm still goes
    alert.fire.mockImplementation(() => { throw new Error("fire exploded"); });
    w.storeFails = false;
    await expect(read(80, 3)).resolves.toBeUndefined();
    const broken = createCapacityAlarm({ alert: { enabled: () => true, deliver: async () => ({ ok: true }), fire: () => {} } as never, store: null, memory: () => { throw new Error("no memory"); }, lives: () => null as never, log: () => { throw new Error("log gone"); }, setTimer: (() => { throw new Error("no timers"); }) as never });
    await expect(broken.start()).resolves.toBeUndefined();
    await expect(broken.tick()).resolves.toBeUndefined();
    await expect(broken.markCleanExit()).resolves.toBe(false);
  });
  it("a message that hangs holds only itself: readings and heartbeats go on, and no second message is started", async () => {
    const { w, alarm, alert, read } = world();
    await alarm.start();
    w.deliverAnswers.push("hang");
    await read(80, 40);
    expect(alert.deliver).toHaveBeenCalledTimes(1);
    expect(w.rows[0].mem_pct).toBe(80);
    expect(w.calls.filter((c) => c === "beat").length).toBeGreaterThanOrEqual(39);
  });
  it("two ticks at once: one row, one database round at a time", async () => {
    const { w, alarm } = world();
    await alarm.start();
    w.calls.length = 0;
    await Promise.all([alarm.tick(), alarm.tick(), alarm.tick()]);
    expect(w.rows).toHaveLength(1);
    expect(w.calls.filter((c) => c === "beat")).toHaveLength(1);
  });
  it("a database that never answers holds back only the heartbeat: the readings go on and the alarm still goes out; after 10 s it is tried again", async () => {
    vi.useFakeTimers();
    try {
      const { w, alarm, alert, store } = world();
      await alarm.start();
      store.beat = () => { w.calls.push("beat"); return new Promise(() => {}); };   // hangs for ever
      w.calls.length = 0;
      for (let i = 0; i < 3; i++) { w.now += MIN; w.rssMb = 410; void alarm.tick(); await vi.advanceTimersByTimeAsync(0); }   // 80 %
      expect(alarm.state().level).toBe("danger");
      expect(alert.deliver).toHaveBeenCalledTimes(1);
      expect(w.sent.map((s) => s.kind)).toEqual(["mem_danger"]);
      expect(w.calls.filter((c) => c === "beat")).toHaveLength(1);       // the hung one; no pile of requests behind it
      await vi.advanceTimersByTimeAsync(DB_WORK_LIMIT_MS);
      w.now += MIN; void alarm.tick(); await vi.advanceTimersByTimeAsync(0);
      expect(w.calls.filter((c) => c === "beat")).toHaveLength(2);       // given up on after 10 s, then the next minute tries again
      expect(DB_WORK_LIMIT_MS).toBe(10000);
    } finally { vi.useRealTimers(); }
  });
  it("countPollers: the lives of a reader = its entries that are not stopped; anything odd = 0", () => {
    expect(countPollers({ _pollers: new Map<string, unknown>([["a", {}], ["b", { stopped: true }], ["c", { stopped: false }], ["d", null]]) })).toBe(2);
    for (const bad of [null, undefined, {}, { _pollers: null }, { _pollers: [1, 2] }, { _pollers: { values: () => { throw new Error("x"); } } }]) expect(countPollers(bad as never)).toBe(0);
  });
  it("the store: every method answers, never throws, and touches only server_runs and the one switch row", async () => {
    const tables: string[] = [];
    const sb = { from: (t: string) => { tables.push(t); throw new Error("db down"); } };
    const s = createRunStore(sb as never);
    expect(await s.begin({})).toBe(false);
    expect(await s.beat("x", {})).toBe(false);
    expect(await s.markClean("x", "t")).toBe(false);
    expect(await s.recent("t")).toBe(null);
    expect(await s.claim(["x"], "t")).toBe(null);
    expect(await s.purge("t")).toBe(false);
    expect(await s.silenced()).toBe(false);                            // unreadable switch = alarms on
    expect([...new Set(tables)].sort()).toEqual(["app_settings", RUNS_TABLE]);
    const answer = (value: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }) }) }) }) });
    expect(await createRunStore(answer("false") as never).silenced()).toBe(true);
    for (const v of ["true", "FALSE", "off", "0", "", undefined]) expect(await createRunStore(answer(v) as never).silenced(), String(v)).toBe(false);
    expect(await createRunStore(answer("false", { message: "x" }) as never).silenced()).toBe(false);
    expect(ALARM_SWITCH_KEY).toBe("server_alarms_enabled");
  });
  it("server.js: started after listen, the clean end is written on SIGTERM before the exit, the limit is resolved (no 512 written in the alarm)", () => {
    const src = readFileSync("server.js", "utf8");
    expect(src).toContain('server.once("listening", () => { try { void capacityAlarm.start(); } catch { /* an alarm never stops the server */ } });');
    expect(src.split("capacityAlarm.start(").length - 1).toBe(1);
    expect(src).not.toMatch(/await\s+capacityAlarm/);
    const sig = src.slice(src.indexOf('process.on("SIGTERM"'));
    expect(sig.indexOf("capacityAlarm.markCleanExit()")).toBeGreaterThan(0);
    expect(sig).toContain("server.close(() => { cleanEnd.then(() => { clearTimeout(forceExit); process.exit(0); }); });");
    expect(sig.indexOf("const forceExit = setTimeout(() => process.exit(0), 5000);")).toBeGreaterThan(sig.indexOf("capacityAlarm.markCleanExit()"));   // the 5 s stop still bounds it
    expect(src).toContain("limitMb: MEMORY_LIMIT.limitMb,");
    expect(src).toContain('constrainedBytes: typeof process.constrainedMemory === "function" ? process.constrainedMemory() : 0,');
    expect(src).toContain("tiktok: tiktokConnections.size,");
    for (const f of ["server/capacityAlarm.js", "server/capacityTexts.js"]) expect(readFileSync(f, "utf8").replace(/\/\/.*$/gm, ""), f).not.toMatch(/\b512\b/);
    // the alarm reads; it never reaches into comment delivery, orders or printing
    const alarmSrc = readFileSync("server/capacityAlarm.js", "utf8");
    expect(alarmSrc.match(/^import .*$/gm)).toEqual(['import { randomBytes } from "node:crypto";', 'import { MEMORY_LIMIT_MB } from "./observability.js";']);
  });
});
