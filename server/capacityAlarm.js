// SERVER-CAPACITY ALARMS to the Admin's Telegram (Jeff 2026-11-24).
//   ⚠️ WARNING  memory at 60 % of the limit        🔴 DANGER  at 75 %
//   ✅ back to normal                               🔴 NAG-RESTART  the run before this one did not end cleanly
// (The database-connections alarm is sent by the database itself — sql/215.)
//
// ONE MESSAGE PER CHANGE OF LEVEL, never one per reading:
//   • memory is read once a minute (process rss ÷ the memory limit — the limit comes from
//     observability.js resolveMemoryLimitMb: env, else the container's own limit, else its constant);
//   • a level goes UP after 2 readings in a row at or over its line (60 % / 75 %);
//   • DANGER → warning after 10 readings in a row under 70 % (no message for that step);
//   • back to NORMAL after 15 readings in a row under 55 % → the ✅ message;
//   • the message of a level is sent once. The Admin is "told" a level only when Telegram accepted it;
//     while the level is still above what he was told, it is tried again every 15 minutes (a Telegram
//     outage or the switch being off never leaves him with an old picture). ✅ is sent only when he
//     was told about a warning / danger before.
//
// THE UNEXPECTED RESTART — how a clean end and an unclean one are told apart:
//   every run keeps ONE row in public.server_runs (sql/215): a heartbeat once a minute (time, lives,
//   memory %, the level the Admin was told) and, when Render asks the server to stop (SIGTERM: a deploy,
//   Render's restart, the nightly deploy), the time it ended cleanly. A new run looks at the runs before
//   it: a row with NO clean end whose heartbeat stopped more than 150 s ago = that run crashed or was
//   killed (out of memory) → ONE alarm with the lives it was carrying. A row with a clean end → silent.
//   A row with no clean end whose heartbeat is still moving = the old instance is still up (Render starts
//   the new one before it stops the old one) → wait, look again each minute (for 20 minutes, then stop).
//   At most one restart alarm per 15 minutes (a crash loop is summed into the next one).
//
// SWITCH: app_settings.server_alarms_enabled — exactly 'false' = nothing is sent (the readings and the
//   heartbeat go on). Missing row, any other text or a failed read = alarms on.
// OFF ENTIRELY while the Telegram env is not set: no timer, no read, no write.
// NOTHING here is awaited by the server and every error is swallowed: an alarm that cannot be sent, or a
// database that does not answer, never affects comments, orders or anything else. The memory readings do
// not wait for the database either (its part of a reading is given up on after 10 s).
import { randomBytes } from "node:crypto";
import { MEMORY_LIMIT_MB } from "./observability.js";

export const CAPACITY_SAMPLE_MS = 60 * 1000;
export const MEM_WARN_AT = 60;
export const MEM_DANGER_AT = 75;
export const MEM_WARN_CLEAR = 55;
export const MEM_DANGER_CLEAR = 70;
export const MEM_UP_SAMPLES = 2;
export const MEM_DOWN_TO_WARNING_SAMPLES = 10;
export const MEM_DOWN_TO_NORMAL_SAMPLES = 15;
export const MEM_RESEND_MS = 15 * 60 * 1000;
export const RUN_DEAD_AFTER_MS = 150 * 1000;          // 2.5 missed heartbeats
export const RUN_LOOK_BACK_MS = 6 * 60 * 60 * 1000;   // an older unclean end is no longer news
export const RUN_CARRY_MS = 24 * 60 * 60 * 1000;      // "what the Admin was told" survives a restart this long
export const RUN_KEEP_MS = 7 * 24 * 60 * 60 * 1000;   // rows older than this are deleted at start
export const RESTART_ALARM_GAP_MS = 15 * 60 * 1000;
export const LOOK_BACK_FOR_MS = 20 * 60 * 1000;       // a new run looks at the runs before it this long, then stops
export const CLEAN_EXIT_WAIT_MS = 3000;
export const DB_WORK_LIMIT_MS = 10 * 1000;            // the heartbeat + the look back: given up on after this (the next minute tries again)
export const ALARM_SWITCH_KEY = "server_alarms_enabled";
export const ALARM_SWITCH_TTL_MS = 60 * 1000;
export const RUNS_TABLE = "server_runs";
const TAG = "[CAPACITY]";

export const LEVELS = ["normal", "warning", "danger"];
const rank = (level) => Math.max(0, LEVELS.indexOf(level));
const isLevel = (x) => LEVELS.includes(x);

/** PURE — a fresh level state. `told` = the level the Admin was last told (carried over a restart). */
export function newLevelState(told = "normal") {
  return { level: "normal", told: isLevel(told) ? told : "normal", dir: "", n: 0, edge: "" };
}

// where one reading points, seen from the current level (the two lines of a level are 5 points apart)
function target(level, pct) {
  if (level === "normal") return pct >= MEM_DANGER_AT ? "danger" : pct >= MEM_WARN_AT ? "warning" : "normal";
  if (level === "warning") return pct >= MEM_DANGER_AT ? "danger" : pct < MEM_WARN_CLEAR ? "normal" : "warning";
  return pct < MEM_WARN_CLEAR ? "normal" : pct < MEM_DANGER_CLEAR ? "warning" : "danger";
}

/**
 * PURE — one reading. → the next state (the same `told`).
 * Up: MEM_UP_SAMPLES readings in a row above the level → the LOWEST level they all reached.
 * Down: readings in a row below the level → warning after 10 (when not all were under 55 %), normal after 15.
 */
export function stepLevel(state, pct) {
  const s = { ...state };
  const p = Number(pct);
  if (!Number.isFinite(p)) return s;                       // a reading that is not a number changes nothing
  const t = target(s.level, p);
  if (t === s.level) { s.dir = ""; s.n = 0; s.edge = ""; return s; }
  const dir = rank(t) > rank(s.level) ? "up" : "down";
  if (s.dir !== dir) { s.dir = dir; s.n = 0; s.edge = t; }
  s.n += 1;
  // up: the lowest level every reading reached; down: the highest level any reading still pointed at
  s.edge = dir === "up" ? (rank(t) < rank(s.edge) ? t : s.edge) : (rank(t) > rank(s.edge) ? t : s.edge);
  const need = dir === "up" ? MEM_UP_SAMPLES : s.edge === "normal" ? MEM_DOWN_TO_NORMAL_SAMPLES : MEM_DOWN_TO_WARNING_SAMPLES;
  if (s.n >= need) { s.level = s.edge; s.dir = ""; s.n = 0; s.edge = ""; }
  return s;
}

/** PURE — the message this state asks for: "mem_warning" | "mem_danger" | "mem_ok" | "" (nothing). */
export function wantedMessage(state) {
  if (rank(state.level) > rank(state.told)) return state.level === "danger" ? "mem_danger" : "mem_warning";
  if (state.level === "normal" && state.told !== "normal") return "mem_ok";
  return "";                                               // danger → warning: no message
}
const toldAfter = (kind) => (kind === "mem_danger" ? "danger" : kind === "mem_warning" ? "warning" : "normal");

/**
 * PURE — what the runs before this one say. rows: server_runs rows (any order); me = { runId, startedAt }.
 * → { dead: [rows that ended uncleanly and were not reported], waiting: n (no clean end, heartbeat still fresh),
 *     lastAlarmAt: ms of the newest restart alarm any run sent (0 = none) }
 */
export function judgeRuns(rows, me, nowMs) {
  const out = { dead: [], waiting: 0, lastAlarmAt: 0 };
  const mine = Date.parse(me?.startedAt || "");
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || r.run_id === me?.runId) continue;
    const alarmed = Date.parse(r.alarmed_at || "");
    if (Number.isFinite(alarmed)) out.lastAlarmAt = Math.max(out.lastAlarmAt, alarmed);
    const started = Date.parse(r.started_at || "");
    const beat = Date.parse(r.heartbeat_at || "");
    if (!Number.isFinite(started) || !Number.isFinite(beat)) continue;
    if (Number.isFinite(mine) && started >= mine) continue;          // only the runs BEFORE this one
    if (r.ended_clean_at || r.alarmed_at) continue;                  // ended cleanly, or already reported
    if (nowMs - beat > RUN_LOOK_BACK_MS) continue;                   // too old to be news
    if (nowMs - beat > RUN_DEAD_AFTER_MS) out.dead.push(r);
    else out.waiting += 1;
  }
  out.dead.sort((a, b) => Date.parse(b.heartbeat_at) - Date.parse(a.heartbeat_at));   // newest first
  return out;
}

const count = (n, max) => (Number.isInteger(n) && n >= 0 ? Math.min(n, max) : 0);

/** PURE — the numbers of the restart alarm for these dead runs (newest first). */
export function restartValue(dead) {
  const rows = Array.isArray(dead) ? dead : [];
  const lives = rows.reduce((sum, r) => sum + count(Number(r?.lives), 100000), 0);
  const pct = Number(rows[0]?.mem_pct);
  return { lives: Math.min(lives, 1000000), times: Math.min(rows.length, 1000), lastPct: Number.isInteger(pct) && pct >= 0 && pct <= 999 ? pct : -1 };
}

/**
 * The database side (service-role client). Every method resolves, never throws:
 *   null / false / [] = the database did not answer or the table is not there (sql/215 not applied).
 */
export function createRunStore(sb) {
  const runs = () => sb.from(RUNS_TABLE);
  return {
    async begin(row) {
      try { const r = await runs().insert(row); return !r.error; } catch { return false; }
    },
    async beat(runId, patch) {
      try { const r = await runs().update(patch).eq("run_id", runId); return !r.error; } catch { return false; }
    },
    async markClean(runId, nowIso) {
      try { const r = await runs().update({ ended_clean_at: nowIso, heartbeat_at: nowIso }).eq("run_id", runId); return !r.error; } catch { return false; }
    },
    async recent(sinceIso) {
      try {
        const r = await runs().select("run_id, started_at, heartbeat_at, lives, mem_pct, told_level, ended_clean_at, alarmed_at")
          .gte("heartbeat_at", sinceIso).order("started_at", { ascending: false }).limit(200);
        return r.error ? null : (r.data || []);
      } catch { return null; }
    },
    // marks them reported — only the rows THIS call changed come back (two runs never report one death twice)
    async claim(runIds, nowIso) {
      try {
        const r = await runs().update({ alarmed_at: nowIso }).in("run_id", runIds).is("alarmed_at", null).is("ended_clean_at", null)
          .select("run_id, heartbeat_at, lives, mem_pct");
        return r.error ? null : (r.data || []);
      } catch { return null; }
    },
    async purge(beforeIso) {
      try { const r = await runs().delete().lt("heartbeat_at", beforeIso); return !r.error; } catch { return false; }
    },
    /** true only when the switch row says exactly 'false' */
    async silenced() {
      try {
        const r = await sb.from("app_settings").select("value").eq("key", ALARM_SWITCH_KEY).maybeSingle();
        return !r.error && !!r.data && String(r.data.value).trim() === "false";
      } catch { return false; }
    },
  };
}

const unref = (t) => { if (t && typeof t.unref === "function") t.unref(); return t; };
const safeInt = (n, max) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(max, Math.round(Number(n)))) : 0);

/**
 * opts: alert (createTelegramAlert), store (createRunStore, or null when there is no service-role client),
 *       limitMb, memory () → { rss } (process.memoryUsage), lives () → { tiktok, facebook, instagram, shopee },
 *       runId (default: 16 random hex characters), commit (7 characters or ""), now () → ms, log,
 *       setTimer / clearTimer (tests), sampleMs.
 * start() — once, from server.listen. markCleanExit() — from the SIGTERM handler; resolves when the clean
 * end is written (or after 3 s). tick() — one reading (the timer calls it; tests call it by hand).
 * @param {Record<string, any>} [opts]
 */
export function createCapacityAlarm({
  alert = null, store = null, limitMb = MEMORY_LIMIT_MB, memory = () => process.memoryUsage(), lives = () => ({ tiktok: 0 }),
  runId = randomBytes(8).toString("hex"), commit = "", now = () => Date.now(), log = console.log,
  setTimer = setInterval, clearTimer = clearInterval, sampleMs = CAPACITY_SAMPLE_MS,
} = {}) {
  const say = (line) => { try { log(`${TAG} ${line}`); } catch { /* a log never stops anything */ } };
  const on = () => { try { return !!alert && typeof alert.enabled === "function" && alert.enabled() === true; } catch { return false; } };
  const iso = (ms) => new Date(ms).toISOString();
  const limit = Number(limitMb) > 0 ? Number(limitMb) : MEMORY_LIMIT_MB;

  let state = newLevelState();
  let timer = null, started = false, stopped = false, dbBusy = false, dbDone = Promise.resolve();
  let startedAt = 0, runReady = false, runSaid = false, carried = false;
  let sending = "", lastTry = { kind: "", at: 0 }, sendDone = Promise.resolve();
  let quiet = { at: -Infinity, value: false };

  function reading() {
    let rss = 0;
    try { rss = Number(memory()?.rss) || 0; } catch { rss = 0; }
    const usedMb = safeInt(rss / (1024 * 1024), 1000000);
    return { usedMb, pct: safeInt((usedMb / limit) * 100, 999), limitMb: safeInt(limit, 1000000) };
  }
  function liveCounts() {
    let raw = null;
    try { raw = lives(); } catch { raw = null; }
    const o = raw && typeof raw === "object" ? raw : {};
    return { tiktok: safeInt(o.tiktok, 100000), facebook: safeInt(o.facebook, 100000), instagram: safeInt(o.instagram, 100000), shopee: safeInt(o.shopee, 100000) };
  }
  const total = (l) => l.tiktok + l.facebook + l.instagram + l.shopee;

  async function silenced() {
    if (!store) return false;
    const t = now();
    if (t - quiet.at < ALARM_SWITCH_TTL_MS) return quiet.value;
    let v = false;
    try { v = (await store.silenced()) === true; } catch { v = false; }
    quiet = { at: t, value: v };
    return v;
  }

  // the level message: one at a time, tried again every 15 minutes while the Admin's picture is older than the level
  function memoryMessage(r, l) {
    const kind = wantedMessage(state);
    if (!kind || sending) return;
    // a warning / danger goes out only while this reading still holds it (a late retry never says "sumisikip" at 40 %)
    if (kind === "mem_warning" && r.pct < MEM_WARN_CLEAR) return;
    if (kind === "mem_danger" && r.pct < MEM_DANGER_CLEAR) return;
    const t = now();
    if (lastTry.kind === kind && t - lastTry.at < MEM_RESEND_MS) return;
    lastTry = { kind, at: t };
    sending = kind;
    sendDone = (async () => {
      try {
        if (await silenced()) { say(`${kind} not sent (switch off)`); return; }
        const res = await alert.deliver(kind, kind === "mem_ok" ? { pct: r.pct, lives: l } : { pct: r.pct, usedMb: r.usedMb, limitMb: r.limitMb, lives: l });
        if (res && res.ok === true) {
          // what he was told is THIS message's level; if the level moved on meanwhile, the next reading asks again
          state = { ...state, told: toldAfter(kind) };
          say(`${kind} sent pct=${r.pct}`);
        } else say(`${kind} not sent`);
      } catch { say(`${kind} not sent`); }
      finally { sending = ""; }
    })();
  }

  async function beginRun(r, l) {
    if (!store || runReady) return;
    const ok = await store.begin({
      run_id: runId, started_at: iso(startedAt), heartbeat_at: iso(now()), lives: total(l), mem_pct: r.pct,
      told_level: state.told, commit: commit || null,
    });
    if (ok) { runReady = true; if (runSaid) say("runs table ready"); return; }
    if (!runSaid) { runSaid = true; say("runs table not ready (restart alarm off until sql/215)"); }
  }

  // the runs before this one: carry over what the Admin was told (once), report an unclean end
  async function lookBack() {
    if (!store || !runReady) return;
    const t = now();
    if (t - startedAt > LOOK_BACK_FOR_MS) return;
    const rows = await store.recent(iso(t - RUN_CARRY_MS));
    if (!rows) return;
    if (!carried) {
      carried = true;
      const before = rows.filter((x) => x && x.run_id !== runId && Date.parse(x.started_at || "") < startedAt)
        .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
      if (before && isLevel(before.told_level) && rank(before.told_level) > rank(state.told)) {
        // this run starts AT the level he was told: the ✅ then needs its 15 calm readings like any other time
        state = { ...newLevelState(before.told_level), level: before.told_level };
        say(`carried told=${before.told_level}`);
      }
    }
    const j = judgeRuns(rows, { runId, startedAt: iso(startedAt) }, t);
    if (j.dead.length === 0) return;
    if (j.lastAlarmAt && t - j.lastAlarmAt < RESTART_ALARM_GAP_MS) return;      // the next look sums them
    const mine = await store.claim(j.dead.map((x) => x.run_id), iso(t));
    if (!mine || mine.length === 0) return;                                     // another run reported them
    const claimed = j.dead.filter((x) => mine.some((m) => m.run_id === x.run_id));
    const value = restartValue(claimed);
    if (await silenced()) { say(`restart not sent (switch off) times=${value.times}`); return; }
    say(`restart alarm times=${value.times} lives=${value.lives} last_pct=${value.lastPct}`);
    try { alert.fire("restart", value); } catch { /* an alarm never stops the server */ }
  }

  // the database part of a reading (this run's row, the look back). One at a time, and never longer than 10 s:
  // a database that does not answer holds back only this — the memory readings and their messages go on.
  function databaseWork(r, l) {
    if (!store || dbBusy) return;
    dbBusy = true;
    const work = (async () => {
      try {
        if (!runReady) await beginRun(r, l);
        else await store.beat(runId, { heartbeat_at: iso(now()), lives: total(l), mem_pct: r.pct, told_level: state.told });
        await lookBack();
      } catch { /* never */ }
    })();
    dbDone = Promise.race([work, new Promise((resolve) => { unref(setTimeout(resolve, DB_WORK_LIMIT_MS)); })])
      .then(() => { dbBusy = false; }, () => { dbBusy = false; });
  }

  async function tick() {
    if (stopped || !on()) return;
    try {
      const r = reading();
      const l = liveCounts();
      state = stepLevel(state, r.pct);
      memoryMessage(r, l);
      databaseWork(r, l);
    } catch { /* never */ }
    await dbDone;                       // resolves within DB_WORK_LIMIT_MS; the timer does not wait for it
  }

  return {
    tick,
    state: () => ({ ...state }),
    _settled: () => sendDone,          // tests: the level message that is on its way has finished
    /** Once. Returns the first reading's promise (always resolves) — the server does not wait for it. */
    start() {
      if (started) return Promise.resolve();
      started = true;
      if (!on()) { say("alarms_off"); return Promise.resolve(); }
      startedAt = now();
      say(`on limit=${safeInt(limit, 1000000)}MB warn=${MEM_WARN_AT}% danger=${MEM_DANGER_AT}%`);
      try { if (store) void store.purge(iso(startedAt - RUN_KEEP_MS)).catch(() => {}); } catch { /* nothing */ }
      try { timer = unref(setTimer(() => { void tick().catch(() => {}); }, sampleMs)); } catch { timer = null; }
      return tick().catch(() => {});
    },
    /** SIGTERM: write the clean end. Resolves true / false, within CLEAN_EXIT_WAIT_MS, never rejects. */
    markCleanExit() {
      stopped = true;
      try { if (timer) clearTimer(timer); } catch { /* nothing */ }
      if (!store || !runReady) return Promise.resolve(false);
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v === true); } };
        unref(setTimeout(() => finish(false), CLEAN_EXIT_WAIT_MS));
        try { store.markClean(runId, iso(now())).then(finish, () => finish(false)); } catch { finish(false); }
      });
    },
  };
}

/** The lives of the Facebook / Instagram / Shopee readers: entries of a runtime's poller map that are not stopped. */
export function countPollers(runtime) {
  try {
    const m = runtime && runtime._pollers;
    if (!(m instanceof Map)) return 0;
    let n = 0;
    for (const e of m.values()) if (e && e.stopped !== true) n += 1;
    return n;
  } catch { return 0; }
}
