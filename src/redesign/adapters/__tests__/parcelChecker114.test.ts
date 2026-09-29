// 1.14.0 spec tests for the parcel-checker worker: multi-emap-tab pick,
// stale-status-after-reload, keepalive cadence (tick-driven, lane-independent),
// evidence-based recency (green only while checks actually resolve) and the
// auto-reload recovery ladder. Drives the REAL background.js via the harness.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootWorker } from "./parcelCheckerHarness";
import { describeWorkerState, WORKER_SILENT_MS } from "../parcelWorkerState";

const MIN = 60 * 1000;

describe("A · one E-Map tab choice per tick (multi-emap-tab test)", () => {
  it("with pcsc (no guid) + unipcsc (guid) + a leftover error.aspx tab, the worker picks the guid-bearing tab and logs the choice", async () => {
    const { sb, calls, status, booted } = bootWorker({ emapTabs: [
      { id: 10, url: "https://emap.pcsc.com.tw/ecmap/default.aspx", guid: false },
      { id: 11, url: "https://emap.unipcsc.com.tw/ecmap/error.aspx", guid: false },
      { id: 12, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true },
    ] });
    await booted;
    await sb.pcTick();
    expect(status().emapTabId).toBe(12);
    expect(status().emapDomain).toBe("emap.unipcsc.com.tw");
    expect(status().emap).toBe("ok");
    // the store check went to THAT tab only — never a blind tabs[0]
    const storeTargets = calls.sendMessage.filter((m) => m.type === "PC_CHECK_STORE").map((m) => m.tabId);
    expect(storeTargets.length).toBeGreaterThan(0);
    expect(new Set(storeTargets)).toEqual(new Set([12]));
    // error.aspx tabs are never probed
    expect(calls.sendMessage.some((m) => m.type === "PC_EMAP_PROBE" && m.tabId === 11)).toBe(false);
    expect(calls.logs.some((l) => /\[PC-EMAP\] using tab 12 https:\/\/emap\.unipcsc\.com\.tw\/ecmap\/default\.aspx guid=true/.test(l))).toBe(true);
  });

  it("sticks to the tab it used last while it still has a guid (no flapping between two live tabs)", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const choose = sb.pcChooseEmap as unknown as (c: unknown[], p: number | null) => { id: number };
    const cands = [{ id: 1, url: "a", guid: true, error: false }, { id: 2, url: "b", guid: true, error: false }];
    expect(choose(cands, null).id).toBe(1);
    expect(choose(cands, 2).id).toBe(2);
    expect(choose(cands, 99).id).toBe(1);
  });

  it("only error.aspx tabs → the pick is flagged and the status reads 'expired' (red) — not 'no_tab'", async () => {
    const { sb, status, booted } = bootWorker({ emapTabs: [{ id: 5, url: "https://emap.unipcsc.com.tw/ecmap/error.aspx", guid: false }] });
    await booted;
    await sb.pcTick();
    expect(status().emap).toBe("expired");
    expect(status().emapSession).toBe("expired");
  });
});

describe("B · evidence-based emap state + auto-recovery (evidence recency test)", () => {
  it("green only within 6 min of a resolved store verdict; after that the SAME tab reads 'stale' (no fake green)", async () => {
    let t = 1_000_000_000_000;
    const { sb, calls, status, booted } = bootWorker({ now: () => t, rows: [] });
    await booted;
    // first tick: no pending rows, keepalive fires immediately (lastKeepaliveAt=0) and resolves 'open' → green
    await sb.pcTick();
    expect(status().emap).toBe("ok");
    // 5 min later the keepalive fires again (cadence) → still green
    t += 5 * MIN + 1000;
    await sb.pcTick();
    expect(status().emap).toBe("ok");
    // now silence the tab: its guid vanished (session died) → keepalive fails → recovery ladder
    sb.chrome.tabs.sendMessage = ((_id: number, msg: { type: string }, cb: (r: unknown) => void) => {
      if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, guidFound: false, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
      if (msg.type === "PC_CHECK_STORE") return cb({ ok: true, store_full_status: "unknown", store_reason: "eshopGuid not found on emap page", guidFound: false });
      if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: "x.y.z" }); // valid (non-expiring) token — keep the SFL lane green
      cb({ ok: true });
    }) as never;
    t += 5 * MIN + 1000;
    await sb.pcTick();
    expect(status().emap).toBe("degraded");              // 1.14.4: verdict 5 min old BUT the latest attempt failed → amber now, not green
    t += MIN;
    await sb.pcTick();
    expect(status().emap).toBe("stale");                 // 1.14.2: 3 misses but only a 1-min span — evidence, not a trigger; no recovery yet
    expect(calls.update.filter((u) => (u as { props: { url?: string } }).props.url).length).toBe(0);
    t += MIN + 1000;
    await sb.pcTick();
    expect(status().emap).toBe("recovering");            // ≥3 misses spanning ≥2 min, verdict 7 min old → one GET re-open
    expect(calls.update.filter((u) => (u as { props: { url?: string } }).props.url).length).toBe(1);
  });

  const reopens = (calls: { update: unknown[] }) => calls.update.filter((u) => (u as { props: { url?: string } }).props.url).map((u) => (u as { id: number }).id);
  const noGuid = (sb: Record<string, unknown>, reason = "eshopGuid not found on emap page", transient = false) => {
    (sb.chrome as { tabs: { sendMessage: unknown } }).tabs.sendMessage = ((_id: number, msg: { type: string }, cb: (r: unknown) => void) => {
      if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, guidFound: transient, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
      if (msg.type === "PC_CHECK_STORE") return cb({ ok: true, store_full_status: "unknown", store_reason: reason, guidFound: transient, transient });
      if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: "x.y.z" });
      cb({ ok: true });
    });
  };
  const withGuid = (sb: Record<string, unknown>, verdict = "full") => {
    (sb.chrome as { tabs: { sendMessage: unknown } }).tabs.sendMessage = ((_id: number, msg: { type: string }, cb: (r: unknown) => void) => {
      if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, guidFound: true, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
      if (msg.type === "PC_CHECK_STORE") return cb({ ok: true, store_full_status: verdict, store_reason: "", guidFound: true, transient: false });
      if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: "x.y.z" });
      cb({ ok: true });
    });
  };

  it("CONSERVATIVE LADDER (1.14.2): guid lost → NO recovery until ≥3 definitive misses spanning ≥2 min; then ONE dialog-free GET re-open per 60s cooldown, max 2, then 'dead'; a verdict resets everything", async () => {
    let t = 1_000_000_000_000;
    // cartDetailTab:false — no parked 賣貨便 tab, so 'dead' is final here (the 1.14.3 re-mint has its own suite)
    const { sb, calls, status, booted } = bootWorker({ now: () => t, rows: [], cartDetailTab: false, emapTabs: [{ id: 7, url: "https://emap.unipcsc.com.tw/mobilemap/default.aspx", guid: false }] });
    await booted;
    await sb.pcTick();                                   // miss #1 (probe: no guid) — never a trigger on its own
    expect(reopens(calls)).toEqual([]);
    expect(status().emap).toBe("stale");
    t += 5 * 1000; await sb.pcTick();                    // miss #2, 5s later
    t += 5 * 1000; await sb.pcTick();                    // miss #3, 10s span → still < 2 min → no recovery
    expect(reopens(calls)).toEqual([]);
    expect(status().emap).toBe("stale");
    t += 2 * MIN; await sb.pcTick();                     // ≥3 misses AND ≥2 min span → recovery #1 (GET re-navigation, NOT tabs.reload)
    expect(reopens(calls)).toEqual([7]);
    expect(calls.reload).toEqual([]);
    expect((calls.update.find((u) => (u as { props: { url?: string } }).props.url) as { props: { url: string } }).props.url).toBe("https://emap.unipcsc.com.tw/mobilemap/default.aspx");
    expect(status().emap).toBe("recovering");
    expect(calls.logs.some((l) => /^\[PC-EMAP\] recover reason="probe: eshopGuid not found" misses=\d+ lastVerdictAgo=nevers attempt=1\/2 tab=7 via=GET/.test(l))).toBe(true);
    await sb.pcTick();                                   // within cooldown → nothing
    expect(reopens(calls)).toEqual([7]);
    t += 61 * 1000; await sb.pcTick();                   // cooldown over, still no guid → recovery #2
    expect(reopens(calls)).toEqual([7, 7]);
    t += 61 * 1000; await sb.pcTick();                   // 2 re-opens didn't help → real expiry, red, NO loop
    expect(status().emap).toBe("dead");
    t += 10 * MIN; await sb.pcTick();
    expect(reopens(calls)).toEqual([7, 7]);              // no recovery spam past the cap
    // the owner re-opens via 選擇門市 → guid + verdict → green, ladder fully reset
    withGuid(sb as never);
    t += 5 * MIN + 1000; await sb.pcTick();
    expect(status().emap).toBe("ok");
    // reset proven: break it again → a fresh ladder (needs 3 misses / 2 min again, then re-open #1 fires)
    noGuid(sb as never);
    t += 5 * MIN + 1000; await sb.pcTick();
    t += 5 * 1000; await sb.pcTick();
    t += 5 * 1000; await sb.pcTick();
    expect(reopens(calls)).toEqual([7, 7]);              // 3 misses but < 2 min → not yet
    t += 2 * MIN; await sb.pcTick();
    expect(reopens(calls)).toEqual([7, 7, 7]);
    expect(status().emap).toBe("recovering");
  });

  it("1.14.4 DISPLAY: verdict 1 min ago + latest attempt guid-missing → amber 'degraded' immediately (no green inside the window after a real failure); a timeout does NOT degrade; the next verdict restores green", async () => {
    let t = 1_000_000_000_000;
    const { sb, calls, status, booted } = bootWorker({ now: () => t, rows: [] });
    await booted;
    await sb.pcTick();
    expect(status().emap).toBe("ok");
    noGuid(sb as never);
    t += MIN; await sb.pcTick();                         // one definitive miss (probe: no guid) 1 min after the verdict
    expect(status().emap).toBe("degraded");
    expect(reopens(calls)).toEqual([]);                  // display-only: the ladder is untouched (1 miss, guarded)
    withGuid(sb as never);
    t += 5 * MIN; await sb.pcTick();                     // keepalive due → verdict → green again
    expect(status().emap).toBe("ok");
    noGuid(sb as never, "/ecmap/byIDData.aspx timeout (10s)", true);
    t += 5 * MIN + 1000; await sb.pcTick();              // transient only → stays green (verdict 5 min old, no definitive miss)
    expect(status().emap).toBe("ok");
  });

  it("LADDER GUARD: a real verdict in the last 5 min blocks recovery even with many misses", async () => {
    let t = 1_000_000_000_000;
    const { sb, calls, status, booted } = bootWorker({ now: () => t, rows: [] });
    await booted;
    await sb.pcTick();                                   // keepalive verdict → green
    expect(status().emap).toBe("ok");
    noGuid(sb as never);
    for (let i = 0; i < 12; i++) { t += 20 * 1000; await sb.pcTick(); } // 12 misses over 4 min — but the verdict is < 5 min old
    expect(reopens(calls)).toEqual([]);
    expect(status().emap).toBe("degraded");              // 1.14.4: the badge is amber (latest attempts failed), even though the ladder is still guarded
    t += 3 * MIN; await sb.pcTick();                     // 7 min since the verdict → guard lapsed, green window over → recovery allowed
    expect(reopens(calls)).toEqual([3]);
  });

  it("LADDER GUARD: byIDData timeouts / network errors are TRANSIENT — they never count as misses, so no recovery ever fires on them", async () => {
    let t = 1_000_000_000_000;
    const { sb, calls, status, booted } = bootWorker({ now: () => t, rows: [] });
    await booted;
    await sb.pcTick();
    expect(status().emap).toBe("ok");
    noGuid(sb as never, "/mobilemap/byIDData.aspx timeout (10s) · /ecmap/byIDData.aspx timeout (10s)", true);
    for (let i = 0; i < 6; i++) { t += 5 * MIN + 1000; await sb.pcTick(); } // 30 min of keepalive timeouts
    expect(reopens(calls)).toEqual([]);
    expect(status().emap).toBe("stale");                 // honest amber, never a re-open, never red
  });

  it("pure derive: the state table (1.14.2)", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const d = sb.pcDeriveEmap as unknown as (now: number, e: Record<string, unknown>) => string;
    const now = 20 * MIN;
    const base = { present: true, error: false, guid: true, lastVerdictAt: now - MIN, misses: 0, firstMissAt: 0, reloadAt: 0, reloads: 0 };
    expect(d(now, { ...base, present: false })).toBe("no_tab");
    expect(d(now, { ...base, error: true })).toBe("expired");
    expect(d(now, base)).toBe("ok");
    expect(d(now, { ...base, lastVerdictAt: now - 7 * MIN })).toBe("stale");
    // 1.14.4: the window covers IDLE only — a definitive miss AFTER the verdict = amber 'degraded' at once
    expect(d(now, { ...base, lastMissAt: now - 10_000, misses: 1, firstMissAt: now - 10_000 })).toBe("degraded");
    expect(d(now, { ...base, lastMissAt: now - 2 * MIN, misses: 1, firstMissAt: now - 2 * MIN })).toBe("ok");   // miss BEFORE the verdict → green
    expect(d(now, { ...base, lastVerdictAt: now - 7 * MIN, misses: 2, firstMissAt: now - 3 * MIN })).toBe("stale");        // < 3 misses
    expect(d(now, { ...base, lastVerdictAt: now - 7 * MIN, misses: 3, firstMissAt: now - MIN })).toBe("stale");            // < 2 min span
    expect(d(now, { ...base, lastVerdictAt: now - 4 * MIN, misses: 5, firstMissAt: now - 3 * MIN })).toBe("ok");           // verdict 4 min ago: still green AND recovery-guarded, whatever the misses
    expect(d(now, { ...base, lastVerdictAt: now - 5.5 * MIN, misses: 5, firstMissAt: now - 3 * MIN })).toBe("ok");         // 5.5 min: green (RECENT 6) — the 5-min guard has lapsed but 'ok' wins
    expect(d(now, { ...base, lastVerdictAt: now - 7 * MIN, misses: 3, firstMissAt: now - 3 * MIN })).toBe("guid_missing"); // due
    expect(d(now, { ...base, lastVerdictAt: 0, misses: 3, firstMissAt: now - 3 * MIN, reloadAt: now - 10_000, reloads: 1 })).toBe("recovering");
    expect(d(now, { ...base, lastVerdictAt: 0, misses: 4, firstMissAt: now - 6 * MIN, reloadAt: now - 2 * MIN, reloads: 2 })).toBe("dead");
    // pcRecoveryDue on its own: the 5-min verdict guard must hold even when every other condition is met
    const due = sb.pcRecoveryDue as unknown as (now: number, e: Record<string, unknown>) => boolean;
    const armed = { lastVerdictAt: 0, misses: 5, firstMissAt: now - 3 * MIN, reloadAt: 0, reloads: 0 };
    expect(due(now, armed)).toBe(true);
    expect(due(now, { ...armed, lastVerdictAt: now - 4 * MIN })).toBe(false);      // verdict 4 min ago → guarded
    expect(due(now, { ...armed, lastVerdictAt: now - 5 * MIN - 1 })).toBe(true);   // just past 5 min → allowed
    expect(due(now, { ...armed, misses: 2 })).toBe(false);
    expect(due(now, { ...armed, firstMissAt: now - MIN })).toBe(false);
    expect(due(now, { ...armed, reloads: 2 })).toBe(false);
    expect(due(now, { ...armed, reloadAt: now - 30_000, reloads: 1 })).toBe(false);
  });
});

describe("C · keepalive cadence (tick-driven, independent of SFL token / RPC)", () => {
  it("pure cadence: fires only when idle for the store half AND 5 min elapsed", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const due = sb.pcKeepaliveDue as unknown as (now: number, last: number, busy: boolean) => boolean;
    expect(due(5 * MIN, 0, false)).toBe(true);
    expect(due(5 * MIN - 1, 0, false)).toBe(false);
    expect(due(5 * MIN, 0, true)).toBe(false);   // pending store rows keep the session warm themselves
    expect(due(10 * MIN, 5 * MIN, false)).toBe(true);
    expect(due(9 * MIN, 5 * MIN, false)).toBe(false);
  });

  it("over a simulated 30-minute idle gap the keepalive posts byIDData on store 198002 exactly every 5 min — and it runs even when the pending RPC / SFL token are dead", async () => {
    let t = 1_000_000_000_000;
    const { sb, calls, booted } = bootWorker({ now: () => t, rows: [] });
    await booted;
    // kill the SFL tab (no token → the multi lane returns before its RPC) — keepalive must not care
    const tabs = (sb.chrome as unknown as { tabs: { query: (q: { url: string[] }, cb: (t: unknown[]) => void) => void } }).tabs;
    const origQuery = tabs.query;
    tabs.query = (q, cb) => (/sellerflow/.test(q.url[0]) ? cb([]) : origQuery(q, cb));
    for (let i = 0; i < 6 * 6; i++) { await sb.pcTick(); t += 50 * 1000; } // 36 ticks × 50s = 30 min
    const stores = calls.sendMessage.filter((m) => m.type === "PC_CHECK_STORE");
    expect(stores.length).toBe(6);                           // t=0,5,10,15,20,25 min
    const logs = calls.logs.filter((l) => /\[PC-KEEPALIVE\] tab=3 store=198002 verdict=open/.test(l));
    expect(logs.length).toBe(6);
    expect(calls.fetch.some((u) => /admin_parcel_checks_pending/.test(u))).toBe(false); // RPC never ran — keepalive still did
  });

  it("while a pending row needs the store half, the keepalive stays quiet (that row's own check keeps the session warm)", async () => {
    let t = 1_000_000_000_000;
    const { sb, calls, booted } = bootWorker({ now: () => t });
    await booted;
    for (let i = 0; i < 12; i++) { await sb.pcTick(); t += 60 * 1000; }
    expect(calls.logs.some((l) => /\[PC-KEEPALIVE\]/.test(l))).toBe(false);
    expect(calls.sendMessage.filter((m) => m.type === "PC_CHECK_STORE").length).toBe(12); // one real store check per tick
  });
});

describe("D · stale-status-after-reload + myship evidence", () => {
  it("myship goes green from a resolved phone verdict and 'stale' 6 min after the last one; the popup keys are written by ONE writer", async () => {
    let t = 1_000_000_000_000;
    let phone = "ok";
    const { sb, status, booted } = bootWorker({ now: () => t, phoneVerdict: () => phone });
    await booted;
    await sb.pcTick();
    expect(status().myship).toBe("ok");
    expect(typeof status().lastPhoneVerdictAt).toBe("number");
    // the myship tab still pings fine but NOTHING resolves any more (row checks + the
    // 5-min sender probe all come back 'unknown') → a ping-based badge would stay green
    phone = "unknown";
    t += 7 * MIN;
    await sb.pcTick();
    expect(status().myship).toBe("stale");
    expect(status().sfl).toBe("connected");
    // a real verdict brings it straight back
    phone = "restricted";
    t += 5 * MIN + 1000;
    await sb.pcTick();
    expect(status().myship).toBe("ok");
  });

  it("legacy ping-based badge writes are gone: the lanes never write 'emap'/'myship' themselves", () => {
    const src = readFileSync("chrome-extension/background.js", "utf8");
    // the only place that writes the per-tab keys is pcRefreshTabStatus (plus the boot reset)
    const writers = src.split("\n").filter((l) => /pcStatus\(\{[^}]*\b(myship|emap):/.test(l));
    expect(writers.length).toBe(1);
    expect(src).toMatch(/async function pcRefreshTabStatus[\s\S]*?await pcStatus\(\{\s*emap: emapState, myship: myshipState/);
  });
});

describe("F · Admin card view of the mirrored worker state", () => {
  it("describes green / warn / bad / silent from the blob", () => {
    const now = 10 * MIN;
    const ok = describeWorkerState({ v: "1.14.0", at: now - 30_000, sfl: "connected", myship: "ok", emap: "ok", emapDomain: "emap.unipcsc.com.tw", lastStoreVerdictAt: now - 60_000, lastPhoneVerdictAt: now - 90_000 }, now);
    expect(ok?.level).toBe("ok");
    expect(ok?.text).toContain("emap ok (store 1m ago · emap.unipcsc.com.tw)");
    // 1.14.4: the card applies the same rule — verdict 1 min ago but a later definitive miss → amber 'degraded'
    const deg = describeWorkerState({ v: "1.14.4", at: now - 30_000, sfl: "connected", myship: "ok", emap: "ok", lastStoreVerdictAt: now - 60_000, lastStoreMissAt: now - 20_000, lastPhoneVerdictAt: now - 90_000 }, now);
    expect(deg?.level).toBe("warn");
    expect(deg?.text).toContain("emap degraded (store 1m ago, last check FAILED 0m ago)");
    const older = describeWorkerState({ at: now - 30_000, sfl: "connected", myship: "ok", emap: "ok", lastStoreVerdictAt: now - 60_000, lastStoreMissAt: now - 5 * MIN }, now);
    expect(older?.level).toBe("ok"); // the miss predates the verdict → green
    expect(describeWorkerState({ at: now - 30_000, sfl: "connected", myship: "ok", emap: "stale" }, now)?.level).toBe("warn");
    expect(describeWorkerState({ at: now - 30_000, sfl: "connected", myship: "ok", emap: "dead" }, now)?.level).toBe("bad");
    expect(describeWorkerState({ at: now - 30_000, sfl: "connected", myship: "no_tab", emap: "ok" }, now)?.level).toBe("bad");
    const silent = describeWorkerState({ v: "1.14.0", at: now - WORKER_SILENT_MS - 1, sfl: "connected", myship: "ok", emap: "ok" }, now);
    expect(silent?.level).toBe("bad");
    expect(silent?.text).toMatch(/SILENT/);
    expect(describeWorkerState(null, now)).toBeNull();
    expect(describeWorkerState({}, now)).toBeNull();
  });

  it("the worker mirrors its state through the admin RPC (display-only, best-effort)", async () => {
    const { sb, calls, booted } = bootWorker();
    await booted;
    await sb.pcTick();
    const i = calls.fetch.findIndex((u) => /admin_set_parcel_worker_state/.test(u));
    expect(i).toBeGreaterThanOrEqual(0);
    const body = JSON.parse(calls.fetchBodies[i]);
    expect(body.p_state.emap).toBe("ok");
    expect(body.p_state.sfl).toBe("connected");
    expect(typeof body.p_state.at).toBe("number");
  });
});
