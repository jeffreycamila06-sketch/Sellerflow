// SHOPEE LIVE — Phase 1 pure helpers (server.js has no vitest harness; the cores
// live in server/shopee*.js, same convention as sanitize/initialComments). Pins:
// config fail-closed · sign base-string ORDER (the unverified assumption) ·
// comment mapper OUTPUT shape (input names defensive) · token AES round-trip +
// tamper + expiry. Nothing here touches server.js / emitCommentScoped / the feed.
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { shopeeConfig } from "../../../../server/shopeeConfig.js";
import { baseString, sign, buildSignedUrl, nowUnixSeconds } from "../../../../server/shopeeSign.js";
import { shopeeToPayload, parseShopeeTimeMs } from "../../../../server/shopeeComment.js";
import { encryptToken, decryptToken, isExpiringSoon } from "../../../../server/shopeeTokens.js";

describe("shopeeConfig — FAIL-CLOSED env gate", () => {
  const full = { SHOPEE_ENABLED: "true", SHOPEE_PARTNER_ID: "123", SHOPEE_PARTNER_KEY: "k", SHOPEE_TOKEN_KEY: "t" };
  it("all present + SHOPEE_ENABLED='true' → enabled with values", () => {
    expect(shopeeConfig(full)).toEqual({ enabled: true, partnerId: "123", partnerKey: "k", tokenKey: "t" });
  });
  it("SHOPEE_ENABLED not the literal 'true' → disabled", () => {
    for (const v of ["false", "1", "TRUE", "yes", "", undefined]) {
      expect(shopeeConfig({ ...full, SHOPEE_ENABLED: v })).toEqual({ enabled: false });
    }
  });
  it("missing ANY secret → disabled (even with the switch on)", () => {
    expect(shopeeConfig({ ...full, SHOPEE_PARTNER_ID: "" }).enabled).toBe(false);
    expect(shopeeConfig({ ...full, SHOPEE_PARTNER_KEY: "" }).enabled).toBe(false);
    expect(shopeeConfig({ ...full, SHOPEE_TOKEN_KEY: "" }).enabled).toBe(false);
  });
  it("empty env → disabled", () => {
    expect(shopeeConfig({})).toEqual({ enabled: false });
  });
});

describe("shopeeSign — HMAC-SHA256 (base-string order is the UNVERIFIED pin)", () => {
  const args = { partnerId: "123456", partnerKey: "shhh", path: "/api/v2/livestream/get_latest_comment_list", timestamp: 1700000000 };

  it("PUBLIC base string = partner_id + path + timestamp (exact order)", () => {
    expect(baseString(args)).toBe("123456/api/v2/livestream/get_latest_comment_list1700000000");
  });
  it("SHOP-LEVEL base string appends access_token + shop_id (exact order)", () => {
    expect(baseString({ ...args, accessToken: "AT", shopId: 99 }))
      .toBe("123456/api/v2/livestream/get_latest_comment_list1700000000AT99");
  });
  it("sign = HMAC-SHA256(partner_key, base) hex, 64 chars, deterministic", () => {
    const expected = createHmac("sha256", "shhh").update(baseString(args)).digest("hex");
    expect(sign(args)).toBe(expected);
    expect(sign(args)).toMatch(/^[0-9a-f]{64}$/);
    expect(sign(args)).toBe(sign(args)); // stable
  });
  it("shop-level sign differs from public sign (the appended fields matter)", () => {
    expect(sign({ ...args, accessToken: "AT", shopId: 99 })).not.toBe(sign(args));
  });
  it("buildSignedUrl — public: partner_id+timestamp+sign, NO access_token/shop_id", () => {
    const url = buildSignedUrl({ host: "https://partner.shopeemobile.com/", ...args });
    expect(url.startsWith("https://partner.shopeemobile.com/api/v2/livestream/get_latest_comment_list?")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("partner_id")).toBe("123456");
    expect(qs.get("timestamp")).toBe("1700000000");
    expect(qs.get("sign")).toBe(sign(args));
    expect(qs.get("access_token")).toBeNull();
    expect(qs.get("shop_id")).toBeNull();
  });
  it("buildSignedUrl — shop-level + extra params merged", () => {
    const url = buildSignedUrl({ host: "https://partner.shopeemobile.com", ...args, accessToken: "AT", shopId: 99, extra: { session_id: 555, offset: 0, page_size: 20 } });
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("access_token")).toBe("AT");
    expect(qs.get("shop_id")).toBe("99");
    expect(qs.get("session_id")).toBe("555");
    expect(qs.get("page_size")).toBe("20");
    expect(qs.get("sign")).toBe(sign({ ...args, accessToken: "AT", shopId: 99 }));
  });
  it("nowUnixSeconds returns integer seconds", () => {
    const t = nowUnixSeconds();
    expect(Number.isInteger(t)).toBe(true);
    expect(String(t).length).toBe(10); // ~2001..2286
  });
});

describe("shopeeToPayload — OUTPUT shape pinned; INPUT names defensive", () => {
  // sessionId = the connecting BROWSER session; shopSessionId = the Shopee live session.
  // (This used to pass the Shopee session AS sessionId and assert sessionId: 555 — the bug.)
  const ctx = { sellerId: "s1", sessionId: "sf-browser-A", shopSessionId: 555, shopUsername: "myshop", nowMs: Date.parse("2026-09-16T00:00:00Z") };

  it("full raw → exact internal comment shape (platform Shopee)", () => {
    const p = shopeeToPayload({ username: "maria", nickname: "Maria", comment: "mine red", avatar: "http://a", comment_id: 42, create_time: 1700000000 }, ctx);
    expect(p).toMatchObject({
      handle: "maria", name: "Maria", comment: "mine red", avatar: "http://a",
      platform: "Shopee", sellerId: "s1", sessionId: "sf-browser-A", sourceUsername: "myshop",
      roomId: "555", shopeeSessionId: "555", isBuy: false, buyerNum: null, buyerData: null, msgId: "42",
    });
    expect(p.sessionId).not.toBe("555"); // the Shopee live session never rides in sessionId
    expect(typeof p.time).toBe("string");
    expect(p.timestamp).toBe(new Date(1700000000 * 1000).toISOString()); // from create_time (seconds)
  });
  it("defensive fallbacks: nickname-only, content/message, id as comment_id, missing avatar", () => {
    const p = shopeeToPayload({ nickname: "OnlyNick", content: "hello", id: "c9" }, ctx);
    expect(p.handle).toBe("OnlyNick"); // username missing → nickname
    expect(p.name).toBe("OnlyNick");
    expect(p.comment).toBe("hello");   // content → comment
    expect(p.avatar).toBe("");
    expect(p.msgId).toBe("c9");        // id → comment_id
  });
  it("no create time → uses nowMs; no ids → handle 'unknown', msgId ''", () => {
    const p = shopeeToPayload({ comment: "x" }, ctx);
    expect(p.timestamp).toBe(new Date(ctx.nowMs).toISOString());
    expect(p.handle).toBe("unknown");
    expect(p.name).toBe("Unknown");
    expect(p.msgId).toBe("");
  });
  it("NO sanitize here (control bytes pass through — stripped later at emitCommentScoped)", () => {
    const withLF = shopeeToPayload({ username: "u", comment: "a\nPRINT 9" }, ctx);
    expect(withLF.comment).toBe("a\nPRINT 9"); // untouched — the choke-point sanitizes
  });
  it("garbage raw (null/non-object) → safe empty-ish payload, never throws", () => {
    expect(() => shopeeToPayload(null, ctx)).not.toThrow();
    const p = shopeeToPayload(undefined, ctx);
    expect(p.platform).toBe("Shopee");
    expect(p.comment).toBe("");
  });
  it("parseShopeeTimeMs: seconds→ms, ms→ms, garbage→null", () => {
    expect(parseShopeeTimeMs(1700000000)).toBe(1700000000000);
    expect(parseShopeeTimeMs(1700000000000)).toBe(1700000000000);
    expect(parseShopeeTimeMs(0)).toBeNull();
    expect(parseShopeeTimeMs("x")).toBeNull();
  });
});

describe("shopeeTokens — AES-256-GCM round-trip + tamper + expiry", () => {
  const KEY = "any-length-secret-string";
  it("encrypt → decrypt round-trips the exact token", () => {
    const enc = encryptToken("shpat_abc123", KEY);
    expect(enc).not.toBe("shpat_abc123");       // ciphertext, not plaintext
    expect(decryptToken(enc, KEY)).toBe("shpat_abc123");
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
  it("isExpiringSoon: within margin true, far future false, missing/invalid true", () => {
    const now = Date.parse("2026-09-16T00:00:00Z");
    expect(isExpiringSoon(new Date(now + 5 * 60 * 1000).toISOString(), now)).toBe(true);  // 5 min < 10 min margin
    expect(isExpiringSoon(new Date(now + 60 * 60 * 1000).toISOString(), now)).toBe(false); // 1 h
    expect(isExpiringSoon(null, now)).toBe(true);
    expect(isExpiringSoon("garbage", now)).toBe(true);
  });
});
