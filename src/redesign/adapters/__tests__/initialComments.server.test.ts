// Approach A server core (server/initialComments.js — server.js has no vitest
// harness, so the pure batch logic lives in server/ per the connectionHealth
// pattern). Pins: the initial:true display-only contract on EVERY payload,
// msgId/content dedup, createTime-derived timestamps (a buffered comment really
// happened minutes ago), and the payload shape matching the live chat relay.
import { describe, it, expect } from "vitest";
import { parseCreateTimeMs, dedupInitialChats, initialCommentPayload, buildInitialCommentPayloads, msgIdOf, createTimeOf } from "../../../../server/initialComments.js";

const NOW = 1760000000000;
const CTX = { sellerId: "seller1", sessionId: "sess1", sourceUsername: "shop_tt", roomId: "7638634089886223124", nowMs: NOW };

// ⚠️ Fixture shape = the LEGACY WebcastPushConnection event shape (audit F1):
// simplifyObject FLATTENS the protobuf `common` block to the top level and
// DELETES `common` (data-converter.js:19-24) — so production chat events carry
// TOP-LEVEL msgId/createTime. The raw `common:{...}` shape is covered by the
// dedicated fallback test below (future non-legacy client migration).
const chat = (n: number, over: Record<string, unknown> = {}) => ({
  comment: `mine ${n}`, uniqueId: `buyer${n}`, nickname: `Buyer ${n}`,
  profilePictureUrl: "", msgId: `msg-${n}`, createTime: String(Math.floor(NOW / 1000) - 60 + n),
  ...over,
});

describe("field-shape accessors (audit F1 — legacy top-level AND raw common shapes)", () => {
  it("msgIdOf/createTimeOf read the LEGACY flattened shape (production reality)", () => {
    expect(msgIdOf({ msgId: "m1" })).toBe("m1");
    expect(createTimeOf({ createTime: "1760000000" })).toBe("1760000000");
  });
  it("…and fall back to the raw common.* shape (future non-legacy client)", () => {
    expect(msgIdOf({ common: { msgId: "m2" } })).toBe("m2");
    expect(createTimeOf({ common: { createTime: "1760000001" } })).toBe("1760000001");
    expect(msgIdOf({})).toBe("");
    expect(createTimeOf({})).toBeUndefined();
  });
  it("a raw-shape chat still dedups and gets createTime-derived timestamps end-to-end", () => {
    const raw = { comment: "mine", uniqueId: "b1", nickname: "B1", common: { msgId: "m9", createTime: String(Math.floor(NOW / 1000) - 30) } };
    const out = buildInitialCommentPayloads([raw, { ...raw }], CTX);
    expect(out.length).toBe(1);                                       // msgId dedup via fallback path
    expect(out[0].msgId).toBe("m9");
    expect(new Date(out[0].timestamp).getTime()).toBe(NOW - 30_000);  // createTime honored
  });
});

describe("parseCreateTimeMs", () => {
  it("parses epoch seconds (10-digit) and ms (13-digit) strings; refuses garbage", () => {
    expect(parseCreateTimeMs("1760000000")).toBe(1760000000000);   // seconds → ms
    expect(parseCreateTimeMs("1760000000000")).toBe(1760000000000); // already ms
    expect(parseCreateTimeMs(1760000000)).toBe(1760000000000);      // number ok
    expect(parseCreateTimeMs("0")).toBeNull();
    expect(parseCreateTimeMs("")).toBeNull();
    expect(parseCreateTimeMs(undefined)).toBeNull();
    expect(parseCreateTimeMs("not-a-number")).toBeNull();
    expect(parseCreateTimeMs("1760000000000000000")).toBeNull();    // nano — refuse to guess
  });
});

describe("dedupInitialChats", () => {
  it("dedups by common.msgId, preserves arrival order, drops empty/non-chat entries", () => {
    const out = dedupInitialChats([chat(1), chat(2), chat(1), null, { comment: "" }, "junk", chat(3)]);
    expect(out.map((d: { uniqueId: string }) => d.uniqueId)).toEqual(["buyer1", "buyer2", "buyer3"]);
  });
  it("no msgId → content-key fallback still collapses a double-buffered message", () => {
    const noId = { comment: "mine", uniqueId: "b1", nickname: "B1" };
    expect(dedupInitialChats([noId, { ...noId }]).length).toBe(1);
  });
  it("non-array input → empty (never throws)", () => {
    expect(dedupInitialChats(undefined)).toEqual([]);
  });
});

describe("initialCommentPayload — the display-only contract", () => {
  it("EVERY payload carries initial:true + msgId + the live-relay shape", () => {
    const p = initialCommentPayload(chat(1), CTX);
    expect(p.initial).toBe(true);                       // ⚠️ the contract — client routes on this
    expect(p.msgId).toBe("msg-1");
    expect(p).toMatchObject({
      handle: "buyer1", name: "Buyer 1", comment: "mine 1", platform: "TikTok",
      sellerId: "seller1", sessionId: "sess1", sourceUsername: "shop_tt",
      roomId: "7638634089886223124", isBuy: false, buyerNum: null, buyerData: null,
    });
    expect(typeof p.time).toBe("string");
    expect(typeof p.timestamp).toBe("string");
  });
  it("timestamp derives from the message's own createTime (it happened minutes ago), not relay time", () => {
    const p = initialCommentPayload(chat(0), CTX);      // createTime = NOW/1000 - 60
    expect(new Date(p.timestamp).getTime()).toBe(NOW - 60_000);
  });
  it("unparseable createTime → falls back to nowMs", () => {
    const p = initialCommentPayload(chat(1, { createTime: "garbage" }), CTX);
    expect(new Date(p.timestamp).getTime()).toBe(NOW);
  });
});

describe("buildInitialCommentPayloads (full batch)", () => {
  it("dedup + map in one pass; all flagged initial", () => {
    const out = buildInitialCommentPayloads([chat(1), chat(1), chat(2)], CTX);
    expect(out.length).toBe(2);
    expect(out.every((p: { initial: boolean }) => p.initial === true)).toBe(true);
  });
});
