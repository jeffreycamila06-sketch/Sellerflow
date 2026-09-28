// Sales tab range math — each pill maps to the right sales_report RPC args, and
// the cache key distinguishes custom/session windows. Pure; no network.
import { describe, it, expect } from "vitest";
import { rpcArgsFor, rangeKey, SALES_TAB_TOP } from "../salesTab";

const B = { sessionStart: "2026-09-20", today: "2026-09-28", from: "2026-08-01", to: "2026-08-31" };

describe("Sales tab range → RPC args", () => {
  it("today / 7d / 2months are named periods (top=50)", () => {
    expect(rpcArgsFor("today", B)).toEqual({ p_period: "today", p_top: SALES_TAB_TOP });
    expect(rpcArgsFor("7d", B)).toEqual({ p_period: "7d", p_top: SALES_TAB_TOP });
    expect(rpcArgsFor("2months", B)).toEqual({ p_period: "2months", p_top: SALES_TAB_TOP });
  });
  it("this session = a Taipei date range [windowStart .. today]", () => {
    expect(rpcArgsFor("session", B)).toEqual({ p_period: "range", p_from: "2026-09-20", p_to: "2026-09-28", p_top: 50 });
  });
  it("session with no window start falls back to today (a 1-day session)", () => {
    expect(rpcArgsFor("session", { ...B, sessionStart: "" })).toEqual({ p_period: "range", p_from: "2026-09-28", p_to: "2026-09-28", p_top: 50 });
  });
  it("custom = the two pickers", () => {
    expect(rpcArgsFor("custom", B)).toEqual({ p_period: "range", p_from: "2026-08-01", p_to: "2026-08-31", p_top: 50 });
  });
  it("cache keys distinguish session/custom windows + roll with the Taipei day", () => {
    expect(rangeKey("session", B)).toBe("session:2026-09-20:2026-09-28");
    expect(rangeKey("custom", B)).toBe("custom:2026-08-01:2026-08-31");
    expect(rangeKey("today", B)).toBe("today:2026-09-28");
    expect(rangeKey("2months", B)).toBe("2months:2026-09-28");
    expect(rangeKey("custom", { ...B, to: "2026-09-01" })).not.toBe(rangeKey("custom", B)); // different window = different key
  });
});
