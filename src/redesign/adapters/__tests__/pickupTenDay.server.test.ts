// The 10-day rule (Jeff, 2026-11-17) inside the batch loop (server/parcelTrackingRunner.js checkRows):
// when THIS check's answer is still 訂單已成立，尚未至門市寄件 and the parcel was synced 10+ Taipei
// calendar days ago → terminal = true, status + message as answered (it leaves Pickup Status).
// Never from a stored answer; a moving / at-store / finished answer is never removed by this rule.
import { describe, it, expect, vi } from "vitest";
import { checkRows } from "../../../../server/parcelTrackingRunner.js";
import { shouldRetireNotDropped, isNotDroppedMessage, RETIRE_NOT_DROPPED_DAYS } from "../../../../server/pickupRules.js";
import { QUERY_URL, SEARCH_URL } from "../../../../server/parcelTracking.js";

const NOT_DROPPED = "訂單已成立，尚未至門市寄件";
const html = (code: string, msg: string, extra = "") =>
  `var searchResults = [{"paymentNo":"${code}","recStore":"","recDate":"","orderAmount":350,"status":1,"statusMessage":"${msg}","shipStatusDetails":[{"notificationName":"${msg}"}${extra}],"shipType":"C2C","specialType":null}];`;
// Wednesday 2026-11-18 00:00 Taipei
const NOW = new Date("2026-11-17T16:00:00Z");
const synced = (taipeiDay: string, hhmm = "12:00") => new Date(`${taipeiDay}T${hhmm}:00+08:00`).toISOString();

type Upd = { patch: Record<string, unknown>; target: Record<string, unknown> };
function fakeSb() {
  const updates: Upd[] = [];
  const thenable = (v: unknown) => ({ then: (f: (x: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(v).then(f, r) });
  return {
    updates,
    from(table: string) {
      if (table === "parcel_tracking_daily") return {
        select: () => ({ eq: () => ({ maybeSingle: () => thenable({ data: { requests: 0 }, error: null }) }) }),
        upsert: () => thenable({ error: null }),
      };
      if (table === "app_settings") return { upsert: () => thenable({ error: null }) };
      return {
        update(patch: Record<string, unknown>) {
          const target: Record<string, unknown> = {};
          const ch: Record<string, unknown> = {
            eq(c: string, v: unknown) { target[c] = v; return ch; },
            then(f: (x: unknown) => unknown, r?: (e: unknown) => unknown) { updates.push({ patch, target }); return Promise.resolve({ error: null }).then(f, r); },
          };
          return ch;
        },
      };
    },
  };
}
const fetchWith = (body: string) => vi.fn(async (url: string) => {
  if (String(url).includes("/api/Captcha")) return { json: async () => ({ captchaId: "G", image: "x" }) };
  if (!String(url).includes("/PackageDetail")) return { url: SEARCH_URL, text: async () => '<input name="__RequestVerificationToken" type="hidden" value="T">' };
  return { url: QUERY_URL, text: async () => body };
});
const ocr = () => ({ solve: async () => "1234", terminate: async () => {} });
const logs = () => { const lines: string[] = []; const p = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); }; return { lines, log: p, warn: p, error: p }; };
async function check(row: Record<string, unknown>, body: string) {
  const sb = fakeSb();
  const logger = logs();
  const r = await checkRows({
    serviceSb: sb, rows: [{ id: "r1", user_id: "U1", tracking_no: "F12345678901", status: "in_transit", unchanged_polls: 0, ...row }],
    daily: { day: "2026-11-18", requests: 0, sentThisRun: 0 }, fetchImpl: fetchWith(body), ocr: ocr(), now: () => NOW, logger,
    limits: { minGapMs: 0, jitterMs: 0, baseBackoffMs: 0 },
  });
  return { r, patch: sb.updates[0]?.patch, updates: sb.updates, logger };
}

describe("shouldRetireNotDropped (pure)", () => {
  const u = (over: Record<string, unknown> = {}) => ({ status: "in_transit", terminal: false, returning_soon: false, status_message: NOT_DROPPED, ...over });
  it("10 Taipei calendar days: synced the 8th 23:59 → retired on the 18th at 00:00; the 9th 00:00 → kept", () => {
    expect(RETIRE_NOT_DROPPED_DAYS).toBe(10);
    expect(shouldRetireNotDropped(u(), synced("2026-11-08", "23:59"), NOW)).toBe(true);
    expect(shouldRetireNotDropped(u(), synced("2026-11-09", "00:00"), NOW)).toBe(false);
  });
  it("only the not-dropped answer, only in transit, never returning soon / finished", () => {
    const old = synced("2026-10-01");
    expect(shouldRetireNotDropped(u({ status_message: "寄件門市已收件" }), old, NOW)).toBe(false);
    expect(shouldRetireNotDropped(u({ status: "at_store" }), old, NOW)).toBe(false);
    expect(shouldRetireNotDropped(u({ returning_soon: true }), old, NOW)).toBe(false);
    expect(shouldRetireNotDropped(u({ terminal: true }), old, NOW)).toBe(false);
    expect(shouldRetireNotDropped(u({ status: "not_found" }), old, NOW)).toBe(false);
    expect(shouldRetireNotDropped(u(), null, NOW)).toBe(false); // unknown age → kept
    expect(isNotDroppedMessage(NOT_DROPPED)).toBe(true);
    expect(isNotDroppedMessage("訂單已成立")).toBe(false);
  });
});

describe("checkRows: the 10-day rule on the answer just received", () => {
  it("fresh not-dropped answer + synced 10 days ago → terminal, status and message as answered", async () => {
    const { r, patch, logger } = await check({ created_at: synced("2026-11-08") }, html("F12345678901", NOT_DROPPED));
    expect(patch).toMatchObject({ status: "in_transit", status_message: NOT_DROPPED, terminal: true, last_polled_at: NOW.toISOString() });
    expect(r.retired).toBe(1);
    expect(r.notDropped).toBe(1);
    const all = logger.lines.join("\n");
    expect(all).toContain("1 parcel(s) left Pickup Status (still not dropped off, synced 10+ days ago)");
    expect(all).not.toContain("F12345678901");
    expect(all).not.toContain(NOT_DROPPED);
  });
  it("same answer, synced 9 days ago → stays (terminal false)", async () => {
    const { r, patch } = await check({ created_at: synced("2026-11-09") }, html("F12345678901", NOT_DROPPED));
    expect(patch).toMatchObject({ status: "in_transit", terminal: false });
    expect(r.retired).toBe(0);
  });
  it("the STORED answer is ignored: stored not-dropped, fresh answer moving → normal update, kept", async () => {
    const { patch } = await check({ created_at: synced("2026-10-01"), status_message: NOT_DROPPED }, html("F12345678901", "寄件門市已收件"));
    expect(patch).toMatchObject({ status: "in_transit", status_message: "寄件門市已收件", terminal: false });
  });
  it("stored not-dropped, fresh answer at a store → kept (and arrives)", async () => {
    const { patch } = await check({ created_at: synced("2026-10-01"), status_message: NOT_DROPPED }, html("F12345678901", "包裹配達取件門市"));
    expect(patch).toMatchObject({ status: "at_store", terminal: false });
  });
  it("a failed check never removes a parcel: old stored not-dropped + an empty answer → only the check time is written", async () => {
    const { updates } = await check({ created_at: synced("2026-10-01"), status_message: NOT_DROPPED }, "var searchResults = [];");
    expect(updates.length).toBe(1);
    expect(updates[0].patch).toEqual({ last_polled_at: NOW.toISOString() });
  });
  it("the update is scoped by id AND user_id", async () => {
    const { updates } = await check({ created_at: synced("2026-11-01") }, html("F12345678901", NOT_DROPPED));
    expect(updates[0].target).toEqual({ id: "r1", user_id: "U1" });
  });
});
