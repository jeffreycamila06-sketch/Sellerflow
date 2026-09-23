// FACEBOOK LIVE — Phase 1 (F-P1) pure helpers (server.js has no vitest harness; the
// cores live in server/fb*.js, same convention as shopee / sanitize / initialComments).
// Pins: config fail-closed matrix · GRAPH_VERSION single pin · comment mapper OUTPUT
// shape (input names defensive, from-absent case, msgId=comment.id, pageId/liveVideoId
// additive) · token AES round-trip + tamper + 7-day expiry margin. Nothing here touches
// server.js / emitCommentScoped / the feed.
import { describe, it, expect } from "vitest";
import { fbConfig, GRAPH_VERSION } from "../../../../server/fbConfig.js";
import { fbToPayload, parseFbTimeMs } from "../../../../server/fbComment.js";
import { encryptToken, decryptToken, isExpiringSoon, FB_TOKEN_REFRESH_MARGIN_MS } from "../../../../server/fbTokens.js";

describe("fbConfig — FAIL-CLOSED env gate", () => {
  const full = { FB_ENABLED: "true", FB_APP_ID: "app123", FB_APP_SECRET: "sekret", FB_TOKEN_KEY: "tk" };
  it("all present + FB_ENABLED='true' → enabled with values", () => {
    expect(fbConfig(full)).toEqual({ enabled: true, appId: "app123", appSecret: "sekret", tokenKey: "tk" });
  });
  it("FB_ENABLED not the literal 'true' → disabled", () => {
    for (const v of ["false", "1", "TRUE", "yes", "", undefined]) {
      expect(fbConfig({ ...full, FB_ENABLED: v })).toEqual({ enabled: false });
    }
  });
  it("missing ANY secret → disabled (even with the switch on)", () => {
    expect(fbConfig({ ...full, FB_APP_ID: "" }).enabled).toBe(false);
    expect(fbConfig({ ...full, FB_APP_SECRET: "" }).enabled).toBe(false);
    expect(fbConfig({ ...full, FB_TOKEN_KEY: "" }).enabled).toBe(false);
  });
  it("empty env → disabled", () => {
    expect(fbConfig({})).toEqual({ enabled: false });
  });
  it("app_secret / token_key are resolved (server-only fields) but never leak a plaintext default", () => {
    expect(fbConfig({}).appSecret).toBeUndefined();
    expect(fbConfig({}).tokenKey).toBeUndefined();
  });
  it("GRAPH_VERSION is a single pinned vNN.N string (never an unversioned URL)", () => {
    expect(GRAPH_VERSION).toMatch(/^v\d+\.\d+$/);
  });
});

describe("fbToPayload — OUTPUT shape pinned; INPUT names defensive; from may be ABSENT", () => {
  const ctx = { sellerId: "s1", sessionId: 555, pageId: "PAGE9", liveVideoId: "LV42", pageUsername: "mypage", nowMs: Date.parse("2026-09-16T00:00:00Z") };

  it("full Graph comment → exact internal comment shape (platform Facebook)", () => {
    const p = fbToPayload({ id: "LV42_c1", from: { name: "Maria", id: "u77" }, message: "mine red", created_time: "2026-09-16T00:00:00+0000" }, ctx);
    expect(p).toMatchObject({
      handle: "Maria", name: "Maria", comment: "mine red",
      platform: "Facebook", sellerId: "s1", sessionId: 555, sourceUsername: "mypage",
      roomId: "LV42", isBuy: false, buyerNum: null, buyerData: null,
      msgId: "LV42_c1", pageId: "PAGE9", liveVideoId: "LV42",
    });
    expect(p.avatar).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/u77/picture`); // versioned URL for from.id
    expect(typeof p.time).toBe("string");
    expect(p.timestamp).toBe(new Date(Date.parse("2026-09-16T00:00:00+0000")).toISOString());
  });

  it("msgId = comment.id (stable), NOT a timestamp", () => {
    expect(fbToPayload({ id: "LV42_abc" }, ctx).msgId).toBe("LV42_abc");
  });

  it("DEFENSIVE: `from` ABSENT (permission-gated) → anonymous handle/name, no throw, empty avatar", () => {
    let p;
    expect(() => { p = fbToPayload({ id: "LV42_c2", message: "hi" }, ctx); }).not.toThrow();
    expect(p.handle).toBe("unknown");
    expect(p.name).toBe("Unknown");
    expect(p.avatar).toBe(""); // no from.id → no picture URL
    expect(p.comment).toBe("hi");
    expect(p.msgId).toBe("LV42_c2");
  });

  it("from.id but no from.name → handle falls back to id; name 'Unknown'; avatar from id", () => {
    const p = fbToPayload({ id: "x", from: { id: "u9" }, message: "y" }, ctx);
    expect(p.handle).toBe("u9");
    expect(p.name).toBe("Unknown");
    expect(p.avatar).toBe(`https://graph.facebook.com/${GRAPH_VERSION}/u9/picture`);
  });

  it("expanded from.picture.data.url is used verbatim over the constructed URL", () => {
    const p = fbToPayload({ id: "x", from: { id: "u9", picture: { data: { url: "http://cdn/pic.jpg" } } } }, ctx);
    expect(p.avatar).toBe("http://cdn/pic.jpg");
  });

  it("additive pageId/liveVideoId are String-coerced; null when absent from ctx", () => {
    const p = fbToPayload({ id: "x" }, { sellerId: "s", sessionId: 1 });
    expect(p.pageId).toBeNull();
    expect(p.liveVideoId).toBeNull();
    expect(p.roomId).toBe(""); // no live video → empty room
  });

  it("no create time → uses nowMs; no id → msgId ''", () => {
    const p = fbToPayload({ message: "x" }, ctx);
    expect(p.timestamp).toBe(new Date(ctx.nowMs).toISOString());
    expect(p.msgId).toBe("");
    expect(p.handle).toBe("unknown");
  });

  it("NO sanitize here (control bytes pass through — stripped later at emitCommentScoped)", () => {
    const p = fbToPayload({ id: "x", from: { name: "u" }, message: "a\nPRINT 9" }, ctx);
    expect(p.comment).toBe("a\nPRINT 9"); // untouched — the choke-point sanitizes
  });

  it("garbage raw (null/non-object) → safe empty-ish payload, never throws", () => {
    expect(() => fbToPayload(null, ctx)).not.toThrow();
    const p = fbToPayload(undefined, ctx);
    expect(p.platform).toBe("Facebook");
    expect(p.comment).toBe("");
    expect(p.handle).toBe("unknown");
  });

  it("parseFbTimeMs: ISO string→ms, seconds→ms, ms→ms, garbage→null", () => {
    expect(parseFbTimeMs("2026-09-16T00:00:00+0000")).toBe(Date.parse("2026-09-16T00:00:00+0000"));
    expect(parseFbTimeMs(1700000000)).toBe(1700000000000);
    expect(parseFbTimeMs(1700000000000)).toBe(1700000000000);
    expect(parseFbTimeMs(0)).toBeNull();
    expect(parseFbTimeMs("not-a-date")).toBeNull();
    expect(parseFbTimeMs("")).toBeNull();
    expect(parseFbTimeMs(null)).toBeNull();
  });
});

describe("fbTokens — AES-256-GCM round-trip + tamper + 7-day expiry margin", () => {
  const KEY = "any-length-secret-string";
  it("encrypt → decrypt round-trips the exact token", () => {
    const enc = encryptToken("EAAB_pagetoken_123", KEY);
    expect(enc).not.toBe("EAAB_pagetoken_123");    // ciphertext, not plaintext
    expect(decryptToken(enc, KEY)).toBe("EAAB_pagetoken_123");
  });
  it("empty input → '' both ways", () => {
    expect(encryptToken("", KEY)).toBe("");
    expect(decryptToken("", KEY)).toBe("");
  });
  it("random IV → different ciphertext each call, both decrypt", () => {
    const a = encryptToken("tok", KEY);
    const b = encryptToken("tok", KEY);
    expect(a).not.toBe(b);
    expect(decryptToken(a, KEY)).toBe("tok");
    expect(decryptToken(b, KEY)).toBe("tok");
  });
  it("wrong key → null (GCM auth fail, no throw)", () => {
    const enc = encryptToken("tok", KEY);
    expect(decryptToken(enc, "different-key")).toBeNull();
  });
  it("malformed ciphertext → null", () => {
    expect(decryptToken("not-base64-or-too-short", KEY)).toBeNull();
  });
  it("missing key throws (programming error — caller gates on fbConfig)", () => {
    expect(() => encryptToken("tok", "")).toThrow();
    expect(() => decryptToken("x", "")).toThrow();
  });
  it("margin is 7 days (long-lived ~60d page token)", () => {
    expect(FB_TOKEN_REFRESH_MARGIN_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it("isExpiringSoon: within 7d true, far future false, missing/invalid true", () => {
    const now = Date.parse("2026-09-16T00:00:00Z");
    expect(isExpiringSoon(new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe(true);  // 3 days < 7-day margin
    expect(isExpiringSoon(new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe(false); // 30 days
    expect(isExpiringSoon(null, now)).toBe(true);
    expect(isExpiringSoon("garbage", now)).toBe(true);
  });
});
