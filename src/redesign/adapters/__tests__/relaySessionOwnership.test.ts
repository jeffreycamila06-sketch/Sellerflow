// B3 fix — live-relay session ownership read at RELAY time (not the creation
// closure). Two layers, per the sacred-zone convention:
//   1. Unit tests on the pure decision core (server/connectionHealth.js
//      relaySessionId) — the ownership/fallback matrix.
//   2. CONTRACT pins on server.js source (b4Phase2.contract.test.ts pattern —
//      server.js has no test harness) so the wiring cannot silently drift:
//      the chat payload stamps relaySessionId(entry, closure); the reuse
//      branch's entry.sessionId update (the thing that makes "last Connect
//      tap wins" true) stays in place and keeps its non-empty guard; the ring
//      re-emit still rewrites to the requester (M1 — unchanged lane).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { relaySessionId } from "../../../../server/connectionHealth.js";

const serverSrc = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");

describe("relaySessionId (pure ownership read)", () => {
  it("entry present → the entry's CURRENT sessionId wins (last Connect tap owns the flow)", () => {
    expect(relaySessionId({ sessionId: "device-B" }, "device-A-closure")).toBe("device-B");
  });

  it("entry absent → closure fallback (defensive only — the owning guard proves the entry exists in-tick)", () => {
    expect(relaySessionId(undefined, "device-A-closure")).toBe("device-A-closure");
    expect(relaySessionId(null, "device-A-closure")).toBe("device-A-closure");
  });

  it("entry with EMPTY sessionId → closure fallback (an empty stamp would pass every client's filter = delivered to ALL devices = double-order risk)", () => {
    expect(relaySessionId({ sessionId: "" }, "device-A-closure")).toBe("device-A-closure");
  });

  it("both empty → empty string, never undefined (payload shape stable)", () => {
    expect(relaySessionId(undefined, "")).toBe("");
    expect(relaySessionId({ sessionId: "" }, undefined as unknown as string)).toBe("");
  });
});

describe("server.js wiring contract (source pins)", () => {
  it("the chat-relay payload stamps ownership via relaySessionId(entry, closure)", () => {
    expect(serverSrc).toContain("sessionId: relaySessionId(tiktokConnections.get(key), sessionId)");
    // and the OLD bare closure stamp is gone from the chat payload: the only
    // payload-position `sessionId,` shorthand lines left are connect-time
    // emits (status/session_started/initial batch), where closure == entry by
    // construction. Pin the chat handler region specifically:
    const chatHandler = serverSrc.slice(serverSrc.indexOf('tiktokConnection.on("chat", (data)'));
    const chatBlock = chatHandler.slice(0, chatHandler.indexOf("startTikTokHealthTimer"));
    expect(chatBlock).toContain("relaySessionId(");
    expect(chatBlock).not.toMatch(/\n\s+sessionId,\n/); // no bare closure stamp inside the live-chat relay
  });

  it("relaySessionId is imported from the vitest-covered connectionHealth core", () => {
    expect(serverSrc).toMatch(/import \{[^}]*relaySessionId[^}]*\} from "\.\/server\/connectionHealth\.js"/);
  });

  it("the reuse branch still updates entry.sessionId with a non-empty guard (last tap wins; empty can never clobber)", () => {
    expect(serverSrc).toContain("existing.sessionId = sessionId || existing.sessionId");
  });

  it("the reuse ring re-emit still rewrites to the REQUESTER (M1) — the Earlier-comments lane is untouched by this fix", () => {
    expect(serverSrc).toContain("reuseReEmitPayload(p, sessionId)");
  });

  it("the terminal path reads the entry too (already relay-time; must stay that way)", () => {
    expect(serverSrc).toContain("sessionId: active.sessionId");
  });
});
