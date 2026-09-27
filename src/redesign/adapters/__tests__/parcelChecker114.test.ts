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
    const { sb, status, booted } = bootWorker({ now: () => t, rows: [] });
    await booted;
    // first tick: no pending rows, keepalive fires immediately (lastKeepaliveAt=0) and resolves 'open' → green
    await sb.pcTick();
    expect(status().emap).toBe("ok");
    // 5 min later the keepalive fires again (cadence) → still green
    t += 5 * MIN + 1000;
    await sb.pcTick();
    expect(status().emap).toBe("ok");
    // now silence the tab: its guid vanished (session died) → keepalive fails → recovery ladder
    sb.chrome.tabs.sendMessage = ((id: number, msg: { type: string }, cb: (r: unknown) => void) => {
      if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, guidFound: false, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
      if (msg.type === "PC_CHECK_STORE") return cb({ ok: true, store_full_status: "unknown", store_reason: "eshopGuid not found on emap page", guidFound: false });
      if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: (sb as unknown as { fakeJwt?: () => string }).fakeJwt?.() });
      cb({ ok: true });
    }) as never;
    t += 5 * MIN + 1000;
    await sb.pcTick();
    expect(["recovering", "guid_missing"]).toContain(status().emap);
  });

  it("guid lost → ONE auto-reload per cooldown (max 2), then 'dead' (red, re-open via 選擇門市); a verdict resets the ladder", async () => {
    let t = 1_000_000_000_000;
    const { sb, calls, status, booted } = bootWorker({ now: () => t, rows: [], emapTabs: [{ id: 7, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: false }] });
    await booted;
    await sb.pcTick();                                   // probe: no guid → reload #1
    expect(calls.reload).toEqual([7]);
    expect(status().emap).toBe("recovering");
    await sb.pcTick();                                   // within cooldown → no second reload yet
    expect(calls.reload).toEqual([7]);
    t += 61 * 1000;
    await sb.pcTick();                                   // cooldown over, still no guid → reload #2
    expect(calls.reload).toEqual([7, 7]);
    t += 61 * 1000;
    await sb.pcTick();                                   // 2 reloads didn't help → real expiry
    expect(status().emap).toBe("dead");
    expect(calls.reload).toEqual([7, 7]);                // no reload spam past the cap
    // the tab comes back (owner re-opened via 選擇門市) → guid + verdict → green, ladder reset
    const tabs = (sb.chrome as unknown as { tabs: { query: (q: { url: string[] }, cb: (t: unknown[]) => void) => void } }).tabs;
    tabs.query = (q, cb) => cb(/emap/.test(q.url[0]) ? [{ id: 7, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", discarded: false, frozen: false }] : [{ id: 1, url: q.url[0].replace("*", "x"), discarded: false, frozen: false }]);
    sb.chrome.tabs.sendMessage = ((id: number, msg: { type: string }, cb: (r: unknown) => void) => {
      if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, guidFound: true, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
      if (msg.type === "PC_CHECK_STORE") return cb({ ok: true, store_full_status: "full", store_reason: "", guidFound: true });
      if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: "x.y.z" });
      cb({ ok: true });
    }) as never;
    t += 5 * MIN + 1000;
    await sb.pcTick();
    expect(status().emap).toBe("ok");
    // ladder reset: break it again → the auto-reload fires again (it would NOT if reloads were still 2 = 'dead')
    sb.chrome.tabs.sendMessage = ((id: number, msg: { type: string }, cb: (r: unknown) => void) => {
      if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, guidFound: false, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx" });
      if (msg.type === "PC_CHECK_STORE") return cb({ ok: true, store_full_status: "unknown", store_reason: "eshopGuid not found on emap page", guidFound: false });
      if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: "x.y.z" });
      cb({ ok: true });
    }) as never;
    t += 5 * MIN + 1000;
    await sb.pcTick();
    expect(calls.reload).toEqual([7, 7, 7]);
    expect(status().emap).toBe("recovering");
  });

  it("pure derive: the state table", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const d = sb.pcDeriveEmap as unknown as (now: number, e: Record<string, unknown>) => string;
    const now = 10 * MIN;
    const base = { present: true, error: false, guid: true, lastVerdictAt: now - MIN, lastFailAt: 0, reloadAt: 0, reloads: 0 };
    expect(d(now, { ...base, present: false })).toBe("no_tab");
    expect(d(now, { ...base, error: true })).toBe("expired");
    expect(d(now, base)).toBe("ok");
    expect(d(now, { ...base, lastVerdictAt: now - 7 * MIN })).toBe("stale");
    expect(d(now, { ...base, lastFailAt: now })).toBe("guid_missing");                       // latest attempt failed
    expect(d(now, { ...base, guid: false, reloadAt: now - 10_000, reloads: 1 })).toBe("recovering");
    expect(d(now, { ...base, guid: false, reloadAt: now - 10_000, reloads: 2 })).toBe("dead");
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
