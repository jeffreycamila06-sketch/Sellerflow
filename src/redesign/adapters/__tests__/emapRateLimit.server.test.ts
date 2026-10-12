// Audit Oct 13 item 12 — the 7-11 E-Map store check: per-seller rate limit (30/min),
// plan-active check, and a RAW log line with status + timing only.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createWindowLimiter, EMAP_CHECK_MAX_PER_MIN } from "../../../../server/rateWindow.js";

const T0 = 1_760_000_000_000;

describe("createWindowLimiter", () => {
  it("30 per minute per seller; the 31st is refused", () => {
    expect(EMAP_CHECK_MAX_PER_MIN).toBe(30);
    const allowed = createWindowLimiter({ max: 30, windowMs: 60_000 });
    for (let i = 0; i < 30; i++) expect(allowed("s1", T0 + i)).toBe(true);
    expect(allowed("s1", T0 + 100)).toBe(false);
  });
  it("sellers are counted apart", () => {
    const allowed = createWindowLimiter({ max: 1, windowMs: 60_000 });
    expect(allowed("a", T0)).toBe(true);
    expect(allowed("b", T0)).toBe(true);
    expect(allowed("a", T0 + 1)).toBe(false);
  });
  it("a new window opens after a minute", () => {
    const allowed = createWindowLimiter({ max: 1, windowMs: 60_000 });
    expect(allowed("a", T0)).toBe(true);
    expect(allowed("a", T0 + 30_000)).toBe(false);
    expect(allowed("a", T0 + 60_001)).toBe(true);
  });
});

describe("server.js wiring (source contract)", () => {
  const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
  const route = src.slice(src.indexOf('app.post("/admin/parcel-emap-check"'), src.indexOf("// ── SHOPMORE pickup-tracking: cron route"));
  it("plan-active check + rate limit before the 7-11 call, 429 with a seller-friendly message", () => {
    expect(route).toContain('app.post("/admin/parcel-emap-check", requireAuth, requirePlanActive, async');
    expect(route.indexOf("emapCheckAllowed(req.sellerId)")).toBeLessThan(route.indexOf("await checkEmapStore(storeId)"));
    expect(route).toMatch(/status\(429\)\.json\(\{ success: false, error: "rate_limited", message: "Too many store checks/);
  });
  it("the RAW line logs status + timing only (no response body)", () => {
    expect(route).toContain("console.log(`[EMAP_CHECK] RAW status=${result.status} ms=${Date.now() - startedAt}`);");
    expect(route).not.toContain("JSON.stringify(String(result.raw)");
  });
});
