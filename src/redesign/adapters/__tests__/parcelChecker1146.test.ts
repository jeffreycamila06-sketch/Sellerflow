// 1.14.6 — E-Map store-check resilience: per-row backoff, one row counts once toward
// the recovery ladder, the store half gives up after 5 attempts ('unknown', never the
// phone half), given-up rows are re-queued when the lane recovers and at 05:00 Taipei,
// and the 01:00–05:00 Taipei 7-ELEVEN maintenance window slows everything down without
// counting misses. Drives the REAL background.js via the shared harness.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootWorker, PENDING_ROW } from "./parcelCheckerHarness";

const S = 1000, MIN = 60 * S, H = 60 * MIN;
const DAY_T0 = Date.UTC(2026, 0, 15, 2, 0, 0);    // 10:00 Taipei — outside the window
const WIN_T0 = Date.UTC(2026, 0, 14, 18, 30, 0);  // 02:30 Taipei — inside the window
const row = (id: string, store: string, over: Record<string, unknown> = {}) => ({ ...PENDING_ROW, id, store_id: store, ...over });
const BAD = "111111";
const verdictBy = (bad: Set<string>) => (r?: { store_id?: string }) => (r && bad.has(String(r.store_id)) ? "unknown" : "open");
const storeChecks = (calls: { sendMessage: { type: string; rowId?: string }[] }, id: string) =>
  calls.sendMessage.filter((m) => m.type === "PC_CHECK_STORE" && m.rowId === id).length;
const phoneChecks = (calls: { sendMessage: { type: string; rowId?: string }[] }, id: string) =>
  calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE" && m.rowId === id).length;
const reopens = (calls: { update: unknown[] }) => calls.update.filter((u) => (u as { props: { url?: string } }).props.url);
const verdictBodies = (calls: { fetch: string[]; fetchBodies: string[] }) =>
  calls.fetch.map((u, i) => [u, calls.fetchBodies[i]] as const).filter(([u]) => /admin_parcel_check_verdict/.test(u)).map(([, b]) => JSON.parse(b));
const requeueBodies = (calls: { fetch: string[]; fetchBodies: string[] }) =>
  calls.fetch.map((u, i) => [u, calls.fetchBodies[i]] as const).filter(([u]) => /admin_parcel_check_requeue/.test(u)).map(([, b]) => JSON.parse(b));

async function run(sb: Record<string, (...a: unknown[]) => Promise<unknown>>, clock: { t: number }, untilMs: number, stepMs = 5 * S) {
  while (clock.t < untilMs) { await sb.pcTick(); clock.t += stepMs; }
}

describe("backoff schedule", () => {
  it("15 s → 30 s → 1 min → 2 min (and stays at 2 min)", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const d = sb.pcBackoffDelay as unknown as (n: number) => number;
    expect([1, 2, 3, 4, 5, 9].map(d)).toEqual([15 * S, 30 * S, 60 * S, 2 * MIN, 2 * MIN, 2 * MIN]);
  });

  it("a failing row is retried on that schedule, not every 5 s", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, rows: [row("bad", BAD)], storeVerdict: verdictBy(new Set([BAD])) });
    await booted;
    await run(sb, clock, DAY_T0 + 3 * MIN);
    // attempts at 0, +15 s, +45 s, +1:45 (then +2 min → 3:45, outside this span)
    expect(storeChecks(calls, "bad")).toBe(4);
    expect(calls.logs.filter((l) => /\[PC-BACKOFF\] row=bad store attempt=\d next=/.test(l)).length).toBe(4);
  });
});

describe("rows in backoff are skipped so the rows behind them get checked", () => {
  it("five failing rows in backoff do not starve a sixth good row", async () => {
    const clock = { t: DAY_T0 };
    // phone already settled for the stuck rows (need_phone false) — only their store half is pending
    const bad = ["b1", "b2", "b3", "b4", "b5"].map((id, i) => row(id, `11111${i}`, { need_phone: false }));
    const { sb, calls, booted } = bootWorker({
      now: () => clock.t, rows: [...bad, row("good", "222222")],
      storeVerdict: (r) => (r && String(r.store_id).startsWith("11111") ? "unknown" : "open"),
    });
    await booted;
    await sb.pcTick();                         // tick 1: the first five (PC_LIMIT) are checked and fail
    expect(storeChecks(calls, "good")).toBe(0);
    clock.t += 5 * S;
    await sb.pcTick();                         // tick 2: all five in backoff → skipped, the good row gets its turn
    expect(storeChecks(calls, "good")).toBe(1);
    for (const r of bad) expect(storeChecks(calls, r.id)).toBe(1);
    expect(calls.fetchBodies.some((b) => b === JSON.stringify({ p_limit: 25, p_frozen_capable: true }))).toBe(true); // 1.16.1: + p_frozen_capable
  });
});

describe("one row counts once toward the recovery ladder", () => {
  it("a single bad id alone never re-opens the E-Map tab (10 minutes)", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, status, booted } = bootWorker({ now: () => clock.t, rows: [row("bad", BAD, { need_phone: false })], storeVerdict: verdictBy(new Set([BAD])) });
    await booted;
    await run(sb, clock, DAY_T0 + 10 * MIN);
    expect(reopens(calls)).toEqual([]);
    expect(["guid_missing", "recovering", "dead"]).not.toContain(status().emap);
    expect((sb.pcRecoveryDue as unknown as (n: number, e: unknown) => boolean)).toBeTruthy();
  });

  it("a bad id alongside rows that succeed never trips it either, and never triggers a re-queue loop", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, rows: [row("bad", BAD), row("good", "222222")], storeVerdict: verdictBy(new Set([BAD])) });
    await booted;
    await run(sb, clock, DAY_T0 + 10 * MIN);
    expect(reopens(calls)).toEqual([]);
    expect(requeueBodies(calls)).toEqual([]);
  });

  it("three DIFFERENT failing ids with no success still trip recovery (a real outage is still caught)", async () => {
    const clock = { t: DAY_T0 };
    const ids = ["x1", "x2", "x3"];
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, rows: ids.map((id, i) => row(id, `33333${i}`, { need_phone: false })), storeVerdict: () => "unknown" });
    await booted;
    await run(sb, clock, DAY_T0 + 3 * MIN);
    expect(reopens(calls).length).toBeGreaterThan(0);
  });

  it("transient misses (timeouts) are still never counted", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, storeTransient: true, rows: ["t1", "t2", "t3"].map((id, i) => row(id, `44444${i}`, { need_phone: false })), storeVerdict: () => "unknown" });
    await booted;
    await run(sb, clock, DAY_T0 + 5 * MIN);
    expect(reopens(calls)).toEqual([]);
  });
});

describe("give-up after 5 failed store attempts", () => {
  it("the 5th failure writes store_full_status 'unknown'; the phone half is never stamped and keeps retrying", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, status, booted } = bootWorker({ now: () => clock.t, rows: [row("bad", BAD)], storeVerdict: verdictBy(new Set([BAD])), phoneVerdict: () => "unknown" });
    await booted;
    await run(sb, clock, DAY_T0 + 6 * MIN);
    const bodies = verdictBodies(calls).filter((b) => b.p_id === "bad");
    expect(bodies.filter((b) => b.p_store_full_status === "unknown").length).toBeGreaterThanOrEqual(1);
    expect(bodies.every((b) => b.p_phone_check_status !== "unknown")).toBe(true);
    const giveUpAt = calls.logs.findIndex((l) => l.includes("[PC-BACKOFF] row=bad store attempt=5 gave up → unknown"));
    expect(giveUpAt).toBeGreaterThan(-1);
    expect(storeChecks(calls, "bad")).toBeGreaterThanOrEqual(5);
    expect(phoneChecks(calls, "bad")).toBeGreaterThan(5);        // still retried after the give-up
    expect(status().lastGiveUpAt).toBeTruthy();
  });

  it("with NO E-Map tab the store half is never attempted, so it never gives up (audit MEDIUM-2)", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, emapTab: false, rows: [row("r1", BAD)] });
    await booted;
    await run(sb, clock, DAY_T0 + 20 * MIN);
    expect(storeChecks(calls, "r1")).toBe(0);
    expect(verdictBodies(calls).some((b) => b.p_store_full_status === "unknown")).toBe(false);
  });

  it("[PC-BACKOFF] lines carry the scan id and attempt only — no phone, name or store id", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t, rows: [row("bad", BAD)], storeVerdict: verdictBy(new Set([BAD])), phoneVerdict: () => "unknown" });
    await booted;
    await run(sb, clock, DAY_T0 + 6 * MIN);
    const lines = calls.logs.filter((l) => l.includes("[PC-BACKOFF]"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l).not.toContain(PENDING_ROW.phone);
      expect(l).not.toContain(PENDING_ROW.customer_name);
      expect(l).not.toContain(BAD);
    }
  });
});

describe("re-queue after the E-Map lane recovers", () => {
  it("bad → ok calls admin_parcel_check_requeue for the last 6 h and resets backoff", async () => {
    const clock = { t: DAY_T0 };
    const boot = bootWorker({ now: () => clock.t, rows: [row("r1", "555555", { need_phone: false })],
      emapTabs: [{ id: 3, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: false }] });
    const { sb, calls, status, booted, emapTabs } = boot;
    await booted;
    await run(sb, clock, DAY_T0 + 3 * MIN);         // session lost → probe misses → recovery attempt(s)
    expect(reopens(calls).length).toBeGreaterThan(0);             // the ladder re-opened the tab
    expect(requeueBodies(calls)).toEqual([]);                     // nothing re-queued while still broken
    emapTabs[0].guid = true;                         // the re-opened tab has a live session again
    await run(sb, clock, clock.t + 2 * MIN);
    expect(status().emap).toBe("ok");
    const rq = requeueBodies(calls);
    expect(rq.length).toBe(1);
    expect(Date.parse(rq[0].p_since)).toBeGreaterThan(clock.t - 6 * H - 5 * MIN);
    expect(Date.parse(rq[0].p_since)).toBeLessThan(clock.t - 6 * H + 5 * MIN);
    expect(calls.logs.some((l) => /\[PC-BACKOFF\] requeue after recovery: 2 row\(s\) back in the queue, backoff reset/.test(l))).toBe(true);
  });

  it("a failed requeue (sql/66 not applied) is retried once a minute, not every tick", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted, emapTabs } = bootWorker({ now: () => clock.t, requeueOk: false, rows: [row("r1", "555555", { need_phone: false })],
      emapTabs: [{ id: 3, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: false }] });
    await booted;
    await run(sb, clock, DAY_T0 + 3 * MIN);
    emapTabs[0].guid = true;
    const before = requeueBodies(calls).length;
    await run(sb, clock, clock.t + 2 * MIN);
    const n = requeueBodies(calls).length - before;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);                 // ~2 min of 5 s ticks → one try a minute
  });
});

describe("maintenance window 01:00–05:00 Asia/Taipei", () => {
  it("boundaries are computed in Taipei time (UTC+8), not UTC or the laptop zone", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const inAt = sb.pcInMaintenanceAt as unknown as (n: number) => boolean;
    const hour = sb.pcTaipeiHour as unknown as (n: number) => number;
    expect(hour(Date.UTC(2026, 0, 14, 17, 0, 0))).toBe(1);
    expect(inAt(Date.UTC(2026, 0, 14, 16, 59, 59))).toBe(false);  // 00:59:59 Taipei
    expect(inAt(Date.UTC(2026, 0, 14, 17, 0, 0))).toBe(true);     // 01:00:00
    expect(inAt(Date.UTC(2026, 0, 14, 20, 59, 59))).toBe(true);   // 04:59:59
    expect(inAt(Date.UTC(2026, 0, 14, 21, 0, 0))).toBe(false);    // 05:00:00
    expect(inAt(Date.UTC(2026, 0, 15, 1, 0, 0))).toBe(false);     // 01:00 UTC = 09:00 Taipei
  });

  it("inside the window: misses uncounted, slow 10-min retry, no give-up, no tab re-open; phone also slow", async () => {
    const clock = { t: WIN_T0 };
    const { sb, calls, status, booted } = bootWorker({ now: () => clock.t, maintenance: true, rows: [row("bad", BAD)],
      storeVerdict: verdictBy(new Set([BAD])), phoneVerdict: () => "unknown" });
    await booted;
    await run(sb, clock, WIN_T0 + 25 * MIN);
    expect(storeChecks(calls, "bad")).toBe(3);        // 0, +10, +20 min
    expect(phoneChecks(calls, "bad")).toBe(3);
    expect(verdictBodies(calls).filter((b) => b.p_store_full_status === "unknown")).toEqual([]);
    expect(reopens(calls)).toEqual([]);
    expect(status().lastStoreMissAt).toBeNull();      // nothing counted toward the ladder
    expect(status().inMaintenanceWindow).toBe(true);
    const mirror = calls.fetch.map((u, i) => [u, calls.fetchBodies[i]] as const).filter(([u]) => /admin_set_parcel_worker_state/.test(u)).map(([, b]) => JSON.parse(b).p_state);
    expect(mirror.at(-1)).toMatchObject({ inMaintenanceWindow: true, lastGiveUpAt: null });
  });

  it("inside the window a failing keepalive / session probe is not counted either (no tab re-open)", async () => {
    const clock = { t: WIN_T0 };
    const { sb, calls, status, booted } = bootWorker({ now: () => clock.t, maintenance: true, rows: [],
      emapTabs: [{ id: 3, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: false }] });
    await booted;
    await run(sb, clock, WIN_T0 + 20 * MIN);
    expect(status().lastStoreMissAt).toBeNull();
    expect(reopens(calls)).toEqual([]);
  });

  it("at 05:00 the first tick re-queues and resumes normal pacing", async () => {
    const clock = { t: Date.UTC(2026, 0, 14, 20, 50, 0) }; // 04:50 Taipei
    const { sb, calls, status, booted } = bootWorker({ now: () => clock.t, maintenance: true, rows: [row("bad", BAD)], storeVerdict: verdictBy(new Set([BAD])) });
    await booted;
    await sb.pcTick();                                 // attempt in the window → next in 10 min (05:00)
    expect(storeChecks(calls, "bad")).toBe(1);
    clock.t = Date.UTC(2026, 0, 14, 21, 0, 5);          // 05:00:05 Taipei
    await sb.pcTick();
    expect(status().inMaintenanceWindow).toBe(false);
    expect(requeueBodies(calls).length).toBe(1);
    expect(calls.logs.some((l) => l.includes("[PC-BACKOFF] requeue after maintenance_end"))).toBe(true);
    clock.t += 5 * S;
    await sb.pcTick();                                 // backoff was reset → checked again right away
    expect(storeChecks(calls, "bad")).toBeGreaterThanOrEqual(2);
    clock.t += 15 * S;
    await sb.pcTick();
    expect(calls.logs.some((l) => /\[PC-BACKOFF\] row=bad store attempt=\d next=(15|30)s/.test(l))).toBe(true); // normal pacing again
  });

  it("with the window turned off in the popup config, 02:30 is treated like any other time", async () => {
    const clock = { t: WIN_T0 };
    const { sb, status, booted } = bootWorker({ now: () => clock.t, maintenance: false, rows: [] });
    await booted;
    await sb.pcTick();
    expect(status().inMaintenanceWindow).toBe(false);
  });
});

describe("store cache: hourly recheck rows", () => {
  it("a need_store row that already holds 'full' is checked, not skipped", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t,
      rows: [row("full1", "666666", { need_store: true, need_phone: false, store_full_status: "full" })], storeVerdict: () => "full" });
    await booted;
    await sb.pcTick();
    expect(storeChecks(calls, "full1")).toBe(1);
    expect(verdictBodies(calls).find((b) => b.p_id === "full1")).toMatchObject({ p_store_full_status: "full", p_phone_check_status: null });
  });

  it("after a give-up, a row the queue keeps returning (unanswered full-store recheck) is retried every 2 min, not every 5 s", async () => {
    const clock = { t: DAY_T0 };
    const { sb, calls, booted } = bootWorker({ now: () => clock.t,
      rows: [row("full2", "777777", { need_store: true, need_phone: false, store_full_status: "full" })], storeVerdict: () => "unknown" });
    await booted;
    await run(sb, clock, DAY_T0 + 4 * MIN);          // 5 attempts → give up at ~3:45
    const atGiveUp = storeChecks(calls, "full2");
    expect(atGiveUp).toBe(5);
    await run(sb, clock, clock.t + 5 * MIN);
    expect(storeChecks(calls, "full2") - atGiveUp).toBeLessThanOrEqual(3); // ~every 2 min, not ~60 times
  });
});

describe("sql/66 admin_parcel_check_requeue (contract)", () => {
  const sql = readFileSync("sql/66_parcel_check_requeue.sql", "utf8");
  it("admin-only, store half only, 'unknown' rows, not exported, never older than 6 hours", () => {
    expect(sql).toContain("if not public.is_admin() then raise exception 'forbidden'; end if;");
    expect(sql).toContain("set store_full_status = null, store_full_at = null");
    const requeue = sql.slice(sql.indexOf("function public.admin_parcel_check_requeue("), sql.indexOf("$$;", sql.indexOf("function public.admin_parcel_check_requeue(")));
    expect(requeue).not.toMatch(/phone_check_status\s*=/);         // the requeue never touches the phone half
    expect(sql).toContain("where store_full_status = 'unknown'");
    expect(sql).toContain("and status <> 'exported'");
    expect(sql).toContain("greatest(coalesce(p_since, now() - interval '6 hours'), now() - interval '6 hours')");
    expect(sql).toContain("revoke all on function public.admin_parcel_check_requeue(timestamptz) from public, anon;");
  });

  const fnSrc = (name: string) => { const i = sql.indexOf(`function public.${name}(`); return sql.slice(i, sql.indexOf("$$;", i)); };
  const pending = fnSrc("admin_parcel_checks_pending");
  const verdict = fnSrc("admin_parcel_check_verdict");

  it("phone 'ok' reuse is 6 h; store cache reuse is 1 h for full and 10 min for open", () => {
    expect(pending).toContain("v_ok_ttl constant interval := interval '6 hours';");
    expect(pending).toContain("v_store_full_ttl constant interval := interval '1 hour';");
    expect(pending).toContain("v_store_open_ttl constant interval := interval '10 minutes';");
    expect(pending).toMatch(/\(c\.status = 'full' and c\.checked_at > now\(\) - v_store_full_ttl\)\s*or \(c\.status = 'open' and c\.checked_at > now\(\) - v_store_open_ttl\)/);
    expect(pending).toContain("(ps.store_full_status is null or ps.store_full_at is null or ps.store_full_at < c.checked_at)");
    // the store step runs after the phone step and before the queue is read
    expect(pending.indexOf("from phone_check_cache c")).toBeLessThan(pending.indexOf("from store_check_cache c"));
    expect(pending.indexOf("from store_check_cache c")).toBeLessThan(pending.indexOf("return query"));
  });

  it("one live recheck per 'full' store per hour (the oldest row), need_store=true", () => {
    expect(pending).toContain("select distinct on (ps.store_id) ps.id");
    expect(pending).toContain("order by ps.store_id, ps.created_at asc");
    expect(pending).toContain("and ps.store_full_at < now() - v_store_full_ttl");
    expect(pending).toContain("and (c.checked_at is null or c.checked_at < now() - v_store_full_ttl)");
    expect(pending).toContain("(ps.store_full_status is null or r.id is not null) as need_store");
    expect(pending).toContain("(ps.phone_check_status is null) as need_phone");
  });

  it("every open/full verdict upserts the cache and appends the log; 'unknown' does neither and never overwrites open/full", () => {
    expect(verdict).toContain("if p_store_full_status in ('open','full') and coalesce(v_store, '') <> '' then");
    expect(verdict).toContain("on conflict (store_id) do update set status = excluded.status, checked_at = excluded.checked_at;");
    expect(verdict).toContain("insert into store_check_log(store_id, status, checked_at) values (v_store, p_store_full_status, now());");
    expect(verdict).toContain("when p_store_full_status = 'unknown' and store_full_status in ('open','full')");
    expect(sql).toMatch(/store_check_cache \([\s\S]*?check \(status in \('open','full'\)\)/);
  });

  it("a seller's Recheck clears that store's cache entry; the 'unknown' requeue does not", () => {
    const trig = fnSrc("parcel_scans_recheck_clears_store_cache");
    expect(trig).toContain("if old.store_full_status in ('open','full') and new.store_full_status is null");
    expect(trig).toContain("new.store_id is not distinct from old.store_id");
    expect(trig).toContain("delete from public.store_check_cache where store_id = new.store_id;");
    expect(sql).toMatch(/after update of store_full_status on public\.parcel_scans\s+for each row execute function public\.parcel_scans_recheck_clears_store_cache\(\)/);
  });

  it("sellers never read the cache or the log", () => {
    expect(sql).toContain("revoke all on public.store_check_cache from anon, authenticated;");
    expect(sql).toContain("revoke all on public.store_check_log   from anon, authenticated;");
    expect(sql).toContain("alter table public.store_check_cache enable row level security;");
    expect(sql).toContain("alter table public.store_check_log   enable row level security;");
  });
});
