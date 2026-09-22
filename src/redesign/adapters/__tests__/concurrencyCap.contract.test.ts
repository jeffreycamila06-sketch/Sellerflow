// Contract pins for the concurrency-cap WIRING in server.js (no vitest harness there).
// Guards: the cap runs ONLY on the new-account branch of connectTikTok, reserves the
// slot BEFORE any await (TOCTOU), reuses the existing teardown, and touches NOTHING in
// the Parcel Scan / encode path (a taga-encode is never counted or blocked).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
// Body of `async function connectTikTok(...) { ... }` up to the next top-level function.
function connectTikTokBody(): string {
  const start = server.indexOf("async function connectTikTok(");
  const after = server.slice(start);
  const next = after.indexOf("\napp.get(\"/test-comment\"");
  return next < 0 ? after : after.slice(0, next);
}

describe("concurrency-cap wiring — connectTikTok only, encode untouched", () => {
  const body = connectTikTokBody();

  it("the cap lives INSIDE connectTikTok, gated on isNewKey", () => {
    expect(body).toContain("const isNewKey = !existing;");
    expect(body).toContain("if (isNewKey) {");
    expect(body).toContain("capDecision({ realFresh, reservedCount, max: concurrencyCap(meta.plan, meta.role) })");
  });

  it("RESERVES the slot BEFORE the awaited kick teardown (TOCTOU: reserve precedes await)", () => {
    const reserveIdx = body.indexOf("liveConnectReservations.set(key,");
    const kickAwaitIdx = body.indexOf("await disconnectTikTokConnection(victimKey");
    expect(reserveIdx).toBeGreaterThan(-1);
    expect(kickAwaitIdx).toBeGreaterThan(-1);
    expect(reserveIdx).toBeLessThan(kickAwaitIdx); // reserve first, then await
  });

  it("kick REUSES the existing clean teardown + emits a terminal gray (no new teardown path)", () => {
    expect(body).toContain("await disconnectTikTokConnection(victimKey, { manual: true })");
    expect(body).toContain('reason: "live_session_ended"');
  });

  it("the reservation is released in the finally (success OR failure)", () => {
    expect(server).toContain("liveConnectReservations.delete(key); // release the concurrency reservation");
  });

  it("counts from tiktokConnections (TikTok-only) — Facebook markers are NOT counted", () => {
    // The snapshot iterates tiktokConnections, never facebookConnections.
    expect(body).toContain("for (const [k, e] of tiktokConnections)");
    expect(body).not.toContain("facebookConnections");
  });

  it("EXACTLY one cap-decision call site (no stray enforcement elsewhere in server.js)", () => {
    expect((server.match(/capDecision\(/g) || []).length).toBe(1);
  });

  it("Parcel Scan / encode path is NOT touched — no concurrency symbol near a parcel route", () => {
    // The concurrency cap must never appear in any parcel handler.
    const parcelIdx = server.indexOf("/admin/parcel-scan");
    if (parcelIdx >= 0) {
      const parcelRegion = server.slice(parcelIdx, parcelIdx + 2000);
      expect(parcelRegion).not.toContain("concurrencyCap");
      expect(parcelRegion).not.toContain("liveConnectReservations");
    }
    // And the parcel-tracking poll endpoint likewise.
    const pollIdx = server.indexOf("/admin/parcel-tracking-poll");
    if (pollIdx >= 0) {
      const pollRegion = server.slice(pollIdx, pollIdx + 2000);
      expect(pollRegion).not.toContain("concurrencyCap");
    }
  });
});
