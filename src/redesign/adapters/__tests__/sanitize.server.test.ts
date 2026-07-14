// #3 PRINTING INJECTION - server-side control-char neutralizer (server.js has no
// vitest harness; the pure core lives in server/sanitize.js, same convention as
// connectionHealth/initialComments). Pins: control bytes -> space (the break-out
// is neutralized), CJK/emoji byte-identical, ONLY comment/name/handle touched,
// idempotent, and the length cap never splits a surrogate pair (Jeff check #2).
import { describe, it, expect } from "vitest";
import {
  sanitizeCommentText, sanitizeCommentPayload, COMMENT_MAX, NAME_MAX,
} from "../../../../server/sanitize.js";

// All control chars via fromCharCode so this source file stays pure ASCII.
const LF = String.fromCharCode(0x0a);
const CR = String.fromCharCode(0x0d);
const TAB = String.fromCharCode(0x09);
const ESC = String.fromCharCode(0x1b);
const GS = String.fromCharCode(0x1d);
const NUL = String.fromCharCode(0x00);
const DEL = String.fromCharCode(0x7f);
const EMOJI = String.fromCodePoint(0x1f600); // grinning face — a surrogate PAIR

describe("sanitizeCommentText - control bytes neutralized", () => {
  it("the TSPL break-out payload: a newline can no longer end the TEXT value", () => {
    // "A" + LF + "PRINT 9" would, raw, become a second TSPL command line.
    expect(sanitizeCommentText("A" + LF + "PRINT 9", COMMENT_MAX)).toBe("A PRINT 9");
    expect(sanitizeCommentText("A" + LF + "PRINT 9", COMMENT_MAX)).not.toContain(LF);
  });
  it("every control byte -> space (CR/LF/ESC/GS/NUL/TAB/DEL)", () => {
    for (const ch of [CR, LF, ESC, GS, NUL, TAB, DEL]) {
      expect(sanitizeCommentText("x" + ch + "y", COMMENT_MAX)).toBe("x y");
    }
  });
  it("CJK / emoji / ASCII are BYTE-IDENTICAL (never touched)", () => {
    expect(sanitizeCommentText("陳小美", NAME_MAX)).toBe("陳小美");
    expect(sanitizeCommentText("北部還有嗎", COMMENT_MAX)).toBe("北部還有嗎");
    expect(sanitizeCommentText("Ann " + EMOJI + " store", NAME_MAX)).toBe("Ann " + EMOJI + " store");
    expect(sanitizeCommentText("mine red lipstick 2pcs", COMMENT_MAX)).toBe("mine red lipstick 2pcs");
  });
  it("idempotent: sanitize(sanitize(x)) === sanitize(x)", () => {
    const once = sanitizeCommentText("a" + LF + ESC + "b", COMMENT_MAX);
    expect(sanitizeCommentText(once, COMMENT_MAX)).toBe(once);
  });
  it('non-string / null input -> "" (defensive)', () => {
    expect(sanitizeCommentText(null, NAME_MAX)).toBe("");
    expect(sanitizeCommentText(undefined, NAME_MAX)).toBe("");
    expect(sanitizeCommentText(12345 as unknown as string, NAME_MAX)).toBe("12345");
  });
});

describe("length cap - surrogate-safe (Jeff check #2: never split an emoji)", () => {
  it("a cap landing mid-emoji drops the emoji WHOLE (no lone surrogate)", () => {
    // "aaa" + emoji (a surrogate PAIR, 2 UTF-16 units). Cap at 4 would land between
    // the high and low surrogate - the slice must back off and drop the pair.
    const out = sanitizeCommentText("aaa" + EMOJI, 4); // length 5
    expect(out).toBe("aaa");           // emoji dropped whole, not half
    const lastCode = out.charCodeAt(out.length - 1);
    expect(lastCode < 0xd800 || lastCode > 0xdbff).toBe(true); // no lone high surrogate
  });
  it("a cap on a clean boundary keeps the emoji intact", () => {
    expect(sanitizeCommentText("aa" + EMOJI, 4)).toBe("aa" + EMOJI); // length 4 exactly
  });
  it("no cap fires for normal-length values (byte-identical)", () => {
    const normal = "北部還有嗎 mine 2pcs";
    expect(sanitizeCommentText(normal, COMMENT_MAX)).toBe(normal);
  });
});

describe("sanitizeCommentPayload - only buyer-text fields, new object", () => {
  it("strips comment/name/handle; leaves msgId/avatar/timestamps/others untouched", () => {
    const payload = {
      comment: "buy" + LF + "PRINT", name: "Ann" + ESC, handle: "ann" + GS,
      msgId: "7662059167541889808", avatar: "https://cdn/x.webp", platform: "TikTok",
      sessionId: "s1", time: "9:41:00 PM", timestamp: "2026-07-15T13:41:00.000Z",
      isBuy: false, buyerNum: null,
    };
    const out = sanitizeCommentPayload(payload) as typeof payload;
    expect(out.comment).toBe("buy PRINT");
    expect(out.name).toBe("Ann ");
    expect(out.handle).toBe("ann ");
    expect(out.msgId).toBe("7662059167541889808"); // NEVER stripped (dedup identity)
    expect(out.avatar).toBe("https://cdn/x.webp");
    expect(out.timestamp).toBe("2026-07-15T13:41:00.000Z");
    expect(out).not.toBe(payload); // new object - the server-internal ring is untouched
  });
  it("a clean payload passes through with identical buyer text", () => {
    const payload = { comment: "北部還有嗎", name: "陳小美", handle: "chenxiaomei", msgId: "M1" };
    const out = sanitizeCommentPayload(payload) as typeof payload;
    expect(out.comment).toBe("北部還有嗎");
    expect(out.name).toBe("陳小美");
    expect(out.handle).toBe("chenxiaomei");
  });
  it("non-object input returns as-is (defensive)", () => {
    expect(sanitizeCommentPayload(null)).toBeNull();
    expect(sanitizeCommentPayload(undefined)).toBeUndefined();
  });
});
