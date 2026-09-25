// [PIN-PROBE] Phase 1 (2026-09-26) — source-contract pins for the LOG-ONLY
// WebcastRoomPinMessage probe in server.js (no vitest harness there; b4Phase2
// style). The probe is SHADOW-FIRST (the 2026-07-14 wire-shape rule): it must
// observe and log, and can never emit, relay, or touch connection state.
// Phase 2 (relay + client toggle, Option A: pin = 1-Click) replaces it later.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const server = readFileSync("server.js", "utf8");
const probeStart = server.indexOf("// [PIN-PROBE] Phase 1");
const connectAt = server.indexOf("state = await tiktokConnection.connect()");
// The probe block: comment header → the post-connect phase flip.
const flipAt = server.indexOf("pinProbeConnected = true;", probeStart);
const probe = server.slice(probeStart, server.indexOf("\n", flipAt));

describe("[PIN-PROBE] Phase 1 — log-only pin observation", () => {
  it("exists and hooks the legacy wrapper's decodedData firehose, filtered to pin messages", () => {
    expect(probeStart).toBeGreaterThan(-1);
    expect(probe).toContain('tiktokConnection.on("decodedData", (msgType, obj) => {');
    expect(probe).toContain('if (msgType !== "WebcastRoomPinMessage") return;');
    expect(probe).toContain("[PIN-PROBE]");
  });

  it("is attached BEFORE connect() so pre-connect buffer pins are captured (phase=initial)", () => {
    expect(connectAt).toBeGreaterThan(-1);
    expect(probeStart).toBeLessThan(connectAt);
    // and the phase flag flips to live-phase right after connect resolves
    expect(flipAt).toBeGreaterThan(connectAt);
    expect(probe).toContain('phase=${pinProbeConnected ? "live" : "initial"}');
  });

  it("is LOG-ONLY: no socket emit, no comment relay, no status emit inside the probe", () => {
    expect(probe).not.toContain("io.to(");
    expect(probe).not.toContain("emitCommentScoped");
    expect(probe).not.toContain("emitTikTokStatus");
    expect(probe).not.toContain("touchTikTokConnection"); // never a liveness signal
  });

  it("can never break the connection: guarded log, bounded raw dump, owning-tagged", () => {
    expect(probe).toContain("} catch { /* the probe must never affect the connection */ }");
    expect(probe).toContain(".slice(0, 800)");
    // owning is TAGGED (data), not used to drop — orphan re-delivery is itself probe data
    expect(probe).toContain("const owning = isOwningConnection(tiktokConnections, key, tiktokConnection);");
  });

  it("[PIN-PROBE-DIAG] counts EVERY type BEFORE the pin filter, bounded + throttled + log-only", () => {
    const diagStart = server.indexOf("// [PIN-PROBE-DIAG]");
    expect(diagStart).toBeGreaterThan(-1);
    const filterAt = server.indexOf('if (msgType !== "WebcastRoomPinMessage") return;');
    // the counter runs ABOVE the filter return — it must see all types, incl. pins
    expect(server.indexOf("pinDiag.counts.set", diagStart)).toBeLessThan(filterAt);
    const diag = server.slice(diagStart, filterAt);
    expect(diag).toContain("[PIN-PROBE-DIAG]");
    expect(diag).toContain(">= 60000");                 // at most one line per 60s
    expect(diag).toContain(".slice(0, 800)");           // bounded line
    expect(diag).toContain("pinDiag.counts.size < 50"); // bounded map (overflow → __other__)
    expect(diag).toContain("} catch { /* the diag must never affect the connection */ }");
    expect(diag).not.toContain("io.to(");
    expect(diag).not.toContain("emitCommentScoped");
    expect(diag).not.toContain("setInterval");          // piggybacked, no timer to leak
  });

  it("the library really maps WebcastRoomPinMessage (probe target exists upstream)", () => {
    const events = readFileSync("node_modules/tiktok-live-connector/dist/types/events.js", "utf8");
    expect(events).toContain("'WebcastRoomPinMessage': WebcastEvent.ROOM_PIN");
    // and the legacy wrapper does NOT emit it as a named event (why we need decodedData)
    const legacy = readFileSync("node_modules/tiktok-live-connector/dist/lib/_legacy/legacy-client.js", "utf8");
    expect(legacy).not.toContain("RoomPin");
    expect(legacy).toContain("DECODED_DATA");
  });
});
