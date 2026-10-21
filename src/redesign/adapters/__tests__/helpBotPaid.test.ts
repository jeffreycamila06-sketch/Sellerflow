// Audit Oct 22 (10) — help bot audience = admin, the preview list, or a PAID seller
// (basic/plus/pro/master, not expired) — the same rule on the server and in the app.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isPaidPlanRow } from "../../../../server/helpBot.js";
import { helpBotPaid, helpBotVisible } from "../helpBot";

describe("(10) paid audience — same rule on both sides", () => {
  const now = Date.parse("2026-10-22T00:00:00Z");
  const cases: Array<[Record<string, unknown>, boolean]> = [
    [{ plan: "basic", plan_status: "active", plan_expiry: null }, true],
    [{ plan: "Pro", plan_status: "active", plan_expiry: "2026-12-01T00:00:00Z" }, true],
    [{ plan: "master", plan_status: "pending", plan_expiry: null }, true],
    [{ plan: "plus", plan_status: "expired", plan_expiry: null }, false],
    [{ plan: "pro", plan_status: "active", plan_expiry: "2026-10-21T00:00:00Z" }, false],
    [{ plan: "free", plan_status: "active", plan_expiry: null }, false],
    [{ plan: "trial", plan_status: "active", plan_expiry: null }, false],
    [{ plan: "", plan_status: "active", plan_expiry: null }, false],
  ];
  it("server isPaidPlanRow", () => {
    for (const [row, want] of cases) expect(isPaidPlanRow(row, now), JSON.stringify(row)).toBe(want);
    expect(isPaidPlanRow(null, now)).toBe(false);
  });
  it("client helpBotPaid agrees", () => {
    for (const [row, want] of cases) expect(helpBotPaid(row.plan as string, row.plan_status as string, row.plan_expiry as string, now), JSON.stringify(row)).toBe(want);
  });
  it("helpBotVisible: a paid seller sees it, a free seller does not (switch on, no preview)", () => {
    expect(helpBotVisible(true, helpBotPaid("pro", "active", "", now), false)).toBe(true);
    expect(helpBotVisible(true, helpBotPaid("free", "active", "", now), false)).toBe(false);
    expect(helpBotVisible(true, false, true)).toBe(true); // admin always
  });
  it("wiring: the server checks the plan after admin + preview (fail closed); the app passes the paid check into helpBotVisible", () => {
    const server = readFileSync("server.js", "utf8");
    const allowed = server.slice(server.indexOf("async function helpBotAllowed"), server.indexOf('app.post("/support/ask"'));
    expect(allowed.indexOf('"support_ai_preview"')).toBeLessThan(allowed.indexOf("isPaidPlanRow(prof.data)"));
    expect(allowed).toContain('select("plan, plan_status, plan_expiry").eq("auth_user_id", String(req.authUserId || ""))');
    expect(allowed).toContain("return !prof.error && isPaidPlanRow(prof.data);");
    const route = server.slice(server.indexOf('app.post("/support/ask"'), server.indexOf('"Last checked" changes → needs_recheck'));
    expect(route).toContain("const inFlight = { seller: supportInFlight.get(req.authUserId) || 0, total: supportInFlightTotal };");
    expect(route).toContain("} finally { release(); }");
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain('helpBotVisible(helpBotOn, hasFeature("support_ai_preview") || helpBotPaid(auth.profile?.plan, auth.profile?.planStatus, auth.profile?.planExpiry), isAdmin, ios, helpBotIosOn)');
  });
});
