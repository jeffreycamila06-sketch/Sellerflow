// PIN-TO-PRINT Phase 2 — behavioral tests for the pure relay core
// (server/pinRelay.js) + source-contract pins for the server.js wiring
// (no vitest harness there; b4Phase2 style).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pinChatOf, buildPinPayload, pinAlreadySeen, PIN_SEEN_CAP } from "../../../../server/pinRelay.js";

const rawPin = {
  // legacy-simplified WebcastRoomPinMessage: TOP-level common flattened (the
  // pin event's own msgId), nested chatMessage NOT simplified (raw proto).
  msgId: "pin-event-own-id",
  pinTime: "1790000000",
  chatMessage: {
    common: { msgId: "7411111111111111111", createTime: "1790000001" },
    user: { uniqueId: "ann_buyer", nickname: "Ann 安", profilePicture: { url: ["https://cdn/x.webp"] } },
    content: "mine! red dress M",
  },
};

describe("pinChatOf — dual-shape extraction of the pinned comment", () => {
  it("raw nested shape: msgId from chatMessage.common, user fields, content", () => {
    const c = pinChatOf(rawPin)!;
    expect(c).toEqual({
      msgId: "7411111111111111111", comment: "mine! red dress M",
      handle: "ann_buyer", name: "Ann 安", avatar: "https://cdn/x.webp",
    });
  });
  it("simplified nested shape (future-proof): top-level msgId/uniqueId/comment win", () => {
    const c = pinChatOf({ chatMessage: { msgId: "m1", uniqueId: "bee", nickname: "", comment: "mine" } })!;
    expect(c.msgId).toBe("m1"); expect(c.handle).toBe("bee");
    expect(c.name).toBe("bee"); // blank nickname → handle
  });
  it("NEVER actionable without msgId + text + handle (an expire/empty event orders nothing)", () => {
    expect(pinChatOf(null)).toBeNull();
    expect(pinChatOf({})).toBeNull();                                   // no chatMessage at all
    expect(pinChatOf({ chatMessage: {} })).toBeNull();
    expect(pinChatOf({ chatMessage: { common: {}, user: { uniqueId: "x" }, content: "hi" } })).toBeNull(); // no msgId
    expect(pinChatOf({ chatMessage: { common: { msgId: "m" }, user: {}, content: "hi" } })).toBeNull();    // no handle
    expect(pinChatOf({ chatMessage: { common: { msgId: "m" }, user: { uniqueId: "x" }, content: "   " } })).toBeNull(); // blank text
  });
});

describe("buildPinPayload — the platform_pin payload mirrors the chat relay shape", () => {
  it("carries pinned:true + comment fields + relay ctx", () => {
    const p = buildPinPayload(pinChatOf(rawPin)!, { sellerId: "a@b.com", sessionId: "s1", sourceUsername: "myshop", roomId: "r1" });
    expect(p).toMatchObject({
      pinned: true, platform: "TikTok", handle: "ann_buyer", name: "Ann 安",
      comment: "mine! red dress M", msgId: "7411111111111111111",
      sellerId: "a@b.com", sessionId: "s1", sourceUsername: "myshop", roomId: "r1",
      isBuy: false, buyerNum: null, buyerData: null,
    });
    expect(typeof p.time).toBe("string");
    expect(typeof p.timestamp).toBe("string");
  });
});

describe("pinAlreadySeen — per-connection dedup (pin/expire/re-pin = one relay)", () => {
  it("first sight relays, repeats don't; bounded at PIN_SEEN_CAP", () => {
    const entry: Record<string, unknown> = {};
    expect(pinAlreadySeen(entry, "m1")).toBe(false);
    expect(pinAlreadySeen(entry, "m1")).toBe(true);   // expire / re-pin
    expect(pinAlreadySeen(entry, "m2")).toBe(false);
    for (let i = 0; i < PIN_SEEN_CAP + 10; i++) pinAlreadySeen(entry, `bulk-${i}`);
    expect((entry.pinSeenMsgIds as Set<string>).size).toBeLessThanOrEqual(PIN_SEEN_CAP);
  });
});

describe("server.js [PIN-RELAY] wiring — source-contract pins", () => {
  const server = readFileSync("server.js", "utf8");
  const start = server.indexOf("PIN-TO-PRINT Phase 2 relay");
  const relay = server.slice(start, server.indexOf("[PIN-RELAY] failed", start));

  it("gate ORDER is load-bearing: live-phase → owning guard → validity → dedup → sanitize → emit", () => {
    const seq = [
      "if (!pinProbeConnected) return;",
      "if (!isOwningConnection(tiktokConnections, key, tiktokConnection)) return;",
      "const chat = pinChatOf(obj);",
      "pinAlreadySeen(entry, chat.msgId)",
      "sanitizeCommentPayload(buildPinPayload(chat",
      'emit("platform_pin"',
    ];
    let at = 0;
    for (const step of seq) {
      const i = relay.indexOf(step, at);
      expect(i, `missing/misordered: ${step}`).toBeGreaterThan(-1);
      at = i;
    }
  });

  it("NEVER the comment relay (the F4 double-order trap): no emitCommentScoped, no feed re-entry", () => {
    expect(relay).not.toContain("emitCommentScoped("); // the call form — the design comment MENTIONS the name to ban it
    expect(relay).not.toContain('emit("chat"');
  });

  it("payload sellerId = email id, room key = UUID; username carried for client scoping", () => {
    expect(relay).toContain("sellerId: emailIdOf(sellerId)");
    expect(relay).toContain("io.to(sellerRoom(sellerId))");
    expect(relay).toContain("username: cleanUsername");
  });

  it("best-effort by contract: relay failure never touches the connection", () => {
    expect(server.slice(start, start + 3000)).toContain("connection unaffected");
  });
});
