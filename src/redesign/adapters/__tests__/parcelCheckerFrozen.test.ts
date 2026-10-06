// 1.16.0 — the FROZEN (冷凍) store check, worker side (the REAL background.js via the harness).
// Pins: switch off (no frozen flag on rows) = today's behaviour exactly (no frozen request, no
// tab opened, the verdict body unchanged); a frozen row is asked ONLY in a frozen tab and never
// the normal question; the normal check never uses a frozen tab; the frozen tab opens by itself
// from the 7-11 picker (throttled, max 2 per episode, then a 30-min pause) and closes after
// 10 min idle; ≥ 3 s between frozen requests; E0014 = back off, never a give-up; a give-up
// writes 'unknown' (never OK); the maintenance window; no session value / full address logged.
import { describe, it, expect } from "vitest";
import { bootWorker, PENDING_ROW, type EmapTab } from "./parcelCheckerHarness";

const NORMAL: EmapTab = { id: 3, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true };
const FROZEN: EmapTab = { id: 40, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true };
const frozenRow = (over: Record<string, unknown> = {}) => ({ ...PENDING_ROW, id: "frz-1", store_id: "968551", need_phone: false, need_store: true, frozen: true, ...over });
const MIN = 60 * 1000;
const verdictBodies = (calls: { fetch: string[]; fetchBodies: string[] }) =>
  calls.fetch.map((u, i) => (/admin_parcel_check_verdict/.test(u) ? JSON.parse(calls.fetchBodies[i]) : null)).filter(Boolean) as Record<string, unknown>[];
const sent = (calls: { sendMessage: { type: string; tabId: number; rowId?: string }[] }, type: string) => calls.sendMessage.filter((m) => m.type === type);

describe("switch off (rows carry no frozen flag) → exactly today's behaviour", () => {
  it("normal store check on the normal tab; no frozen request; no tab opened; verdict body has no p_store_layer", async () => {
    const { sb, calls, booted } = bootWorker({ emapTabs: [NORMAL], rows: [{ ...PENDING_ROW, temp_layer: "冷凍" }] }); // even a 冷凍 parcel: no flag → normal
    await booted; await sb.pcTick();
    expect(sent(calls, "PC_CHECK_STORE").map((m) => m.tabId)).toEqual([3]);
    expect(sent(calls, "PC_CHECK_STORE_FROZEN")).toHaveLength(0);
    expect(calls.created).toHaveLength(0);
    const body = verdictBodies(calls)[0];
    expect(Object.keys(body)).toEqual(["p_id", "p_expected_phone", "p_expected_store", "p_store_full_status", "p_phone_check_status", "p_phone_check_message", "p_phone_restricted_until"]);
  });
});

describe("frozen rows go to the frozen tab only", () => {
  it("frozen row + frozen tab → PC_CHECK_STORE_FROZEN on the frozen tab, never the normal question; verdict carries p_store_layer 冷凍", async () => {
    const { sb, calls, booted } = bootWorker({ emapTabs: [NORMAL, FROZEN], rows: [frozenRow()], frozenReply: () => ({ status: "frozen_unavailable" }) });
    await booted; await sb.pcTick();
    expect(sent(calls, "PC_CHECK_STORE_FROZEN").map((m) => [m.tabId, m.rowId])).toEqual([[40, "frz-1"]]);
    expect(sent(calls, "PC_CHECK_STORE").some((m) => m.rowId === "frz-1")).toBe(false);
    expect(verdictBodies(calls)[0]).toMatchObject({ p_id: "frz-1", p_store_full_status: "frozen_unavailable", p_store_layer: "冷凍", p_expected_store: "968551" });
  });
  it("a normal row in the same batch still gets the normal question on the normal tab (body unchanged)", async () => {
    const { sb, calls, booted } = bootWorker({ emapTabs: [NORMAL, FROZEN], rows: [frozenRow(), { ...PENDING_ROW, need_phone: false }] });
    await booted; await sb.pcTick();
    expect(sent(calls, "PC_CHECK_STORE").map((m) => [m.tabId, m.rowId])).toEqual([[3, "row-1"]]);
    const bodies = verdictBodies(calls);
    expect(bodies.find((b) => b.p_id === "row-1")).not.toHaveProperty("p_store_layer");
    expect(bodies.find((b) => b.p_id === "frz-1")).toMatchObject({ p_store_layer: "冷凍" });
  });
  it("the normal check NEVER uses a frozen tab — with only a frozen tab, the normal store half waits", async () => {
    const { sb, calls, status, booted } = bootWorker({ emapTabs: [FROZEN], rows: [{ ...PENDING_ROW, need_phone: false }] });
    await booted; await sb.pcTick();
    expect(sent(calls, "PC_CHECK_STORE")).toHaveLength(0);
    expect(status().emapTabId ?? null).toBe(null);
  });
  it("only a clean frozen answer is written; anything else leaves the half unwritten until the give-up writes 'unknown' (never OK)", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    let next = 500; // each replacement frozen tab lands (and also answers uncleanly)
    const { sb, calls, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL, FROZEN], rows: [frozenRow()], frozenReply: () => ({ status: "unknown", reason: "frozen check: not a clean answer for 968551 (13 chars)" }),
      onCreate: () => ({ id: next++, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true }) });
    await booted;
    for (let i = 0; i < 12; i++) { await sb.pcTick(); t += 3 * MIN; }
    const bodies = verdictBodies(calls);
    expect(bodies.every((b) => b.p_store_full_status === "unknown")).toBe(true);
    expect(bodies.length).toBeGreaterThanOrEqual(1);          // the give-up
    expect(bodies[0]).toMatchObject({ p_store_layer: "冷凍" });
    expect(bodies.some((b) => b.p_store_full_status === "open")).toBe(false);
  });
});

describe("7-11 busy (E0014) → back off, never a give-up, never OK", () => {
  it("frozen tab: 20 busy answers in a row → no verdict written at all, 1-min back-off", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const { sb, calls, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL, FROZEN], rows: [frozenRow()], frozenReply: () => ({ status: "unknown", busy: true, transient: true }) });
    await booted;
    for (let i = 0; i < 20; i++) { await sb.pcTick(); t += 61 * 1000; }
    expect(sent(calls, "PC_CHECK_STORE_FROZEN").length).toBeGreaterThanOrEqual(15);
    expect(verdictBodies(calls)).toHaveLength(0);
    expect(calls.logs.some((l) => /\[PC-FROZEN\] row=frz-1 7-11 busy \(E0014\), next=60s/.test(l))).toBe(true);
  });
});

describe("E0014 on the NORMAL tab too", () => {
  it("20 busy answers → no give-up, no verdict, no miss counted (the E-Map stays not-dead)", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const { sb, calls, booted } = bootWorker({ now: () => t, storeBusy: true, emapTabs: [NORMAL], rows: [{ ...PENDING_ROW, need_phone: false }] });
    await booted;
    for (let i = 0; i < 20; i++) { await sb.pcTick(); t += 61 * 1000; }
    expect(sent(calls, "PC_CHECK_STORE").filter((m) => m.rowId === "row-1").length).toBeGreaterThanOrEqual(15);
    expect(verdictBodies(calls)).toHaveLength(0);
    expect(calls.logs.some((l) => /gave up/.test(l))).toBe(false);
    expect(calls.logs.some((l) => /\[PC-BACKOFF\] row=row-1 store busy \(E0014\), next=60s/.test(l))).toBe(true);
  });
});

describe("≥ 3 s between frozen requests, one at a time", () => {
  it("two frozen rows in one pass → the second waits out the 3 s gap (2 s + 1 s), after the 2 s row gap", async () => {
    const t = Date.parse("2026-10-06T06:00:00Z"); // frozen clock: elapsed time never covers the gap
    const { sb, calls, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL, FROZEN], rows: [frozenRow(), frozenRow({ id: "frz-2", store_id: "167765" })] });
    await booted; await sb.pcTick();
    expect(sent(calls, "PC_CHECK_STORE_FROZEN").map((m) => m.rowId)).toEqual(["frz-1", "frz-2"]);
    const i1 = calls.sleeps.indexOf(1000);
    expect(i1).toBeGreaterThan(0);
    expect(calls.sleeps[i1 - 1]).toBe(2000); // the 3 s gap = 2000 + 1000 (chunked)
  });
});

describe("the frozen tab opens by itself and closes when idle", () => {
  it("frozen row + no frozen tab → opens the 7-11 picker in the background (active:false); waits 1 min before another open", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const { sb, calls, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL], rows: [frozenRow()] });
    await booted; await sb.pcTick();
    expect(calls.created).toEqual([{ url: "https://myship2.7-11.com.tw/Home/FreezeStoreLookup/?customType=Receiver&eshopid=8Q7", active: false }]);
    t += 30 * 1000; await sb.pcTick();
    expect(calls.created).toHaveLength(1);
    expect(sent(calls, "PC_CHECK_STORE").some((m) => m.rowId === "frz-1")).toBe(false); // never the normal question for a frozen row (the normal keepalive still runs)
  });
  it("once the opened tab lands on a frozen page, the row is checked there", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const { sb, calls, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL], rows: [frozenRow()], onCreate: () => ({ id: 77, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true }) });
    await booted; await sb.pcTick(); t += 5000; await sb.pcTick();
    expect(sent(calls, "PC_CHECK_STORE_FROZEN").map((m) => m.tabId)).toContain(77);
  });
  it("max 2 opens per episode, then a 30-min pause (no endless tab spam)", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const { sb, calls, status, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL], rows: [frozenRow()] }); // the tab never lands
    await booted;
    for (let i = 0; i < 10; i++) { await sb.pcTick(); t += 2 * MIN; }
    expect(calls.created).toHaveLength(2);
    expect(status().frozen).toBe("dead");
    t += 30 * MIN; await sb.pcTick();
    expect(calls.created).toHaveLength(3); // a fresh episode after the pause
  });
  it("the tab WE opened is closed after 10 min with no frozen row waiting", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const rows: unknown[] = [frozenRow()]; // the pending fake reads this array on every call
    const { sb, calls, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL], rows, onCreate: () => ({ id: 77, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true }) });
    await booted; await sb.pcTick();
    expect(calls.created).toHaveLength(1);
    rows.length = 0;
    t += 11 * MIN; await sb.pcTick();
    expect(calls.removed).toContain(77);
  });
  it("never opens during the 01:00–05:00 Taipei maintenance window", async () => {
    const t = Date.parse("2026-10-06T18:30:00Z"); // 02:30 Taipei
    const { sb, calls, booted } = bootWorker({ now: () => t, maintenance: true, emapTabs: [NORMAL], rows: [frozenRow()] });
    await booted; await sb.pcTick();
    expect(calls.created).toHaveLength(0);
    expect(sent(calls, "PC_CHECK_STORE_FROZEN")).toHaveLength(0);
  });
});

describe("logs", () => {
  it("never the picker address, a query string or a session value", async () => {
    const { sb, calls, booted } = bootWorker({ emapTabs: [NORMAL], rows: [frozenRow()] });
    await booted; await sb.pcTick();
    const all = calls.logs.join("\n");
    expect(all).toContain("[PC-FROZEN] opening the 7-11 frozen picker (attempt 1/2)");
    for (const bad of ["FreezeStoreLookup", "customType=", "eshopid=8Q7", "eshopGuid"]) expect(all.includes(bad), bad).toBe(false);
  });
});

describe("review fix 1 — the tab we opened is kept while it lands, and a stale frozen tab is never re-picked", () => {
  it("the opened tab lands one pass late → still closed after 10 min idle (reviewer's reproduction)", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const rows: unknown[] = [frozenRow()];
    const { sb, calls, booted, emapTabs } = bootWorker({ now: () => t, emapTabs: [NORMAL], rows });
    await booted;
    await sb.pcTick();                                   // opens tab 901 (still on the 7-11 picker)
    expect(calls.created).toHaveLength(1);
    t += 5000; await sb.pcTick();                        // one pass BEFORE it lands
    emapTabs.push({ id: 901, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true });
    await sb.pcTick(); await sb.pcTick();                // the frozen check runs on 901
    expect(sent(calls, "PC_CHECK_STORE_FROZEN").map((m) => m.tabId)).toContain(901);
    rows.length = 0;
    for (let i = 0; i < 5; i++) { t += 4 * MIN; await sb.pcTick(); }
    expect(calls.removed).toContain(901);
  });
  it("zero passes before landing → also closed (unchanged)", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const rows: unknown[] = [frozenRow()];
    const { sb, calls, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL], rows, onCreate: () => ({ id: 901, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true }) });
    await booted; await sb.pcTick(); await sb.pcTick();
    rows.length = 0;
    for (let i = 0; i < 5; i++) { t += 4 * MIN; await sb.pcTick(); }
    expect(calls.removed).toContain(901);
  });
  it("a frozen tab dropped after 2 unclean answers is never picked again — the fresh one is used", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const STALE: EmapTab = { id: 40, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true };
    const FRESH: EmapTab = { id: 41, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true, frozen: true };
    const { sb, calls, booted } = bootWorker({
      now: () => t, emapTabs: [NORMAL, STALE, FRESH], rows: [frozenRow()],
      frozenReply: (_row, tabId) => (tabId === 40 ? { status: "unknown", reason: "frozen session bounced to error.aspx" } : { status: "frozen_unavailable" }),
    });
    await booted;
    for (let i = 0; i < 6; i++) { await sb.pcTick(); t += MIN; }
    const tabs = sent(calls, "PC_CHECK_STORE_FROZEN").map((m) => m.tabId);
    expect(tabs.slice(0, 2)).toEqual([40, 40]);          // two unclean answers on the stale tab
    expect(tabs.slice(2).every((id) => id === 41)).toBe(true); // never 40 again
    expect(tabs).toContain(41);
    expect(verdictBodies(calls).some((b) => b.p_store_full_status === "frozen_unavailable")).toBe(true);
  });
});


describe("review fix 3 — pc_status.frozen is written only when it changes", () => {
  it("10 quiet passes → one write; a change → one more", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const rows: unknown[] = [];
    const { sb, booted } = bootWorker({ now: () => t, emapTabs: [NORMAL], rows });
    await booted;
    const patches: Record<string, unknown>[] = [];
    const real = sb.pcStatus;
    (sb as unknown as Record<string, unknown>).pcStatus = (p: Record<string, unknown>) => { patches.push(p); return real(p); };
    for (let i = 0; i < 10; i++) { await sb.pcTick(); t += 5000; }
    expect(patches.filter((p) => "frozen" in p)).toEqual([{ frozen: "off" }]);
    rows.push(frozenRow());                         // frozen work → the lane opens a tab
    await sb.pcTick(); t += 5000; await sb.pcTick();
    expect(patches.filter((p) => "frozen" in p)).toEqual([{ frozen: "off" }, { frozen: "opening" }]);
  });
});

describe("review question 4 — the E-Map health check and the legacy lane skip frozen tabs", () => {
  const pinned = (calls: { update: unknown[] }, id: number) => calls.update.some((u) => (u as { id: number; props: { autoDiscardable?: boolean } }).id === id && (u as { props: { autoDiscardable?: boolean } }).props.autoDiscardable === false);
  it("multi-seller: with the frozen tab listed FIRST, the health check heals / pins the NORMAL tab", async () => {
    const { sb, calls, booted } = bootWorker({ emapTabs: [FROZEN, NORMAL], rows: [] });
    await booted;
    await sb.pcTick();                                   // learns that tab 40 is frozen
    calls.update.length = 0; calls.sendMessage.length = 0;
    await sb.pcTick();
    expect(pinned(calls, 3)).toBe(true);
    expect(calls.sendMessage.some((m) => m.type === "PC_PING" && m.tabId === 3)).toBe(true);
    expect(calls.sendMessage.some((m) => m.type === "PC_PING" && m.tabId === 40)).toBe(false);
  });
  it("legacy lane (multi-seller off): the normal question goes to the normal tab, never the frozen one — even on the first pass", async () => {
    const { sb, calls, booted } = bootWorker({ multiSeller: false, emapTabs: [FROZEN, NORMAL], legacyRows: [{ id: "L1", phone: "0912345678", store_id: "195965", customer_name: "測試" }] });
    await booted; await sb.pcTick();
    const store = sent(calls, "PC_CHECK_STORE").filter((m) => m.rowId === "L1");
    expect(store.map((m) => m.tabId)).toEqual([3]);
  });
  it("no frozen tab → the health check behaves exactly as before (first E-Map tab)", async () => {
    const OTHER: EmapTab = { id: 5, url: "https://emap.pcsc.com.tw/ecmap/default.aspx", guid: true };
    const { sb, calls, booted } = bootWorker({ emapTabs: [OTHER, NORMAL], rows: [] });
    await booted; await sb.pcTick();
    expect(calls.sendMessage.find((m) => m.type === "PC_PING" && (m.tabId === 5 || m.tabId === 3))?.tabId).toBe(5);
  });
});
