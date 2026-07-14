// G1 OWNING GUARD — the chat handler must drop events from an orphaned
// (non-owning) connection BEFORE it relays or stamps liveness; otherwise a
// failed-disconnect old connection double-relays the same comment with a fresh
// commentKey → a DUPLICATE order (money path). For Facebook (no msgId → no DB
// unique-index backstop) this guard is the ONLY protection, so the predicate is
// now a PURE helper (isOwningConnection) with direct unit tests + a source
// contract pinning the guard's placement (server.js has no vitest harness).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isOwningConnection } from "../../../../server/connectionHealth.js";

describe("isOwningConnection — pure ownership predicate", () => {
  const conn = { id: "live" };       // the current connection instance
  const other = { id: "orphan" };    // a superseded old connection instance
  it("CURRENT: map points to this connection → true (legit comment relays)", () => {
    const map = new Map([["k", { connection: conn }]]);
    expect(isOwningConnection(map, "k", conn)).toBe(true);
  });
  it("ORPHAN: map points to a DIFFERENT connection → false (old one is silenced)", () => {
    const map = new Map([["k", { connection: conn }]]);
    expect(isOwningConnection(map, "k", other)).toBe(false);
  });
  it("REMOVED: no entry for the key (undefined) → false (dropped, no crash)", () => {
    const map = new Map();
    expect(isOwningConnection(map, "k", conn)).toBe(false);
  });
  it("entry present but connection field missing → false", () => {
    const map = new Map([["k", {}]]);
    expect(isOwningConnection(map, "k", conn)).toBe(false);
  });
});

const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
// The chat handler region: from its registration to the health-timer start after it.
const chat = server.slice(
  server.indexOf('tiktokConnection.on("chat", (data)'),
  server.indexOf("startTikTokHealthTimer(key, tiktokConnection)"),
);

describe("G1 — chat-handler owning guard (source contract)", () => {
  it("the guard uses the shared isOwningConnection helper and early-returns", () => {
    expect(chat).toMatch(/if \(!isOwningConnection\(tiktokConnections, key, tiktokConnection\)\) return;/);
  });
  it("the guard runs BEFORE touchTikTokConnection and BEFORE the relay (drops orphan events first)", () => {
    const iGuard = chat.indexOf("!isOwningConnection(tiktokConnections, key, tiktokConnection)");
    const iTouch = chat.indexOf('touchTikTokConnection(key, tiktokConnection, "chat")');
    const iRelay = chat.indexOf("emitCommentScoped(sellerId");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iTouch).toBeGreaterThan(iGuard);   // liveness not stamped for an orphan
    expect(iRelay).toBeGreaterThan(iGuard);   // comment not relayed for an orphan
  });
  it("the reuse-ring write shares the SAME helper (one source of truth — no inline predicate left)", () => {
    // both guard sites go through isOwningConnection; the old inline
    // `.connection === tiktokConnection` / `!== tiktokConnection` is gone.
    expect((chat.match(/isOwningConnection\(tiktokConnections, key, tiktokConnection\)/g) || []).length).toBe(2);
    expect(chat).not.toMatch(/\.connection (===|!==) tiktokConnection/);
  });
});
