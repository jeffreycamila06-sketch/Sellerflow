// G1 OWNING GUARD (source contract — server.js has no vitest harness; same
// convention as b4Phase2 / freshVerify contract tests). The chat handler must
// drop events from an orphaned (non-owning) connection BEFORE it relays or
// stamps liveness — otherwise a failed-disconnect old connection double-relays
// the same comment with a fresh commentKey → a DUPLICATE order (money path).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");

// The chat handler region: from its registration to the health-timer start after it.
const chat = server.slice(
  server.indexOf('tiktokConnection.on("chat", (data)'),
  server.indexOf("startTikTokHealthTimer(key, tiktokConnection)"),
);

describe("G1 — chat-handler owning guard", () => {
  it("the owning guard is present in the chat handler", () => {
    expect(chat).toMatch(/tiktokConnections\.get\(key\)\?\.connection !== tiktokConnection\)\s*return;/);
  });

  it("the guard runs BEFORE touchTikTokConnection and BEFORE the relay (drops orphan events first)", () => {
    const iGuard = chat.indexOf("tiktokConnections.get(key)?.connection !== tiktokConnection");
    const iTouch = chat.indexOf('touchTikTokConnection(key, tiktokConnection, "chat")');
    const iRelay = chat.indexOf("emitCommentScoped(sellerId");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iTouch).toBeGreaterThan(iGuard);   // liveness not stamped for an orphan
    expect(iRelay).toBeGreaterThan(iGuard);   // comment not relayed for an orphan
  });
});
