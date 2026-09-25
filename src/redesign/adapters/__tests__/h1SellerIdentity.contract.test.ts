// H1 (security audit 2026-09-26) — SELLER IDENTITY IS THE AUTH UUID, NEVER THE EMAIL.
// The old key was cleanSellerId(user.email) (strip chars outside [a-z0-9@._-]), which
// let Gmail plus-addressing collide two sellers: a+b@gmail.com → ab@gmail.com = ANOTHER
// seller's room, liveKey and connection-map entries — read their live comment stream,
// kick their lives via the concurrency cap, stop their FB poller. These pins hold the
// fix's two halves in place:
//   KEY  — req.sellerId / socket.data.sellerId = user.id (UUID) → rooms, liveKey, maps,
//          caps all follow automatically.
//   EMIT — every client build (web/APK/iOS + the rollback app.html) filters incoming
//          payloads on its own email.trim().toLowerCase() (sellerIdOf), so payload
//          `sellerId` FIELDS carry the lowercased email via the sellerEmailIds bridge
//          (emailIdOf). Unknown seller → "" (clients treat an empty field as no filter).
// server.js has no vitest harness — these are source-contract pins (b4Phase2 style).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const server = readFileSync("server.js", "utf8");

describe("H1 — the identity KEY is the auth UUID", () => {
  it("requireAuth and the socket handshake key on user.id, and the email key is GONE", () => {
    expect(server).toContain('req.sellerId = String(user.id || "");');
    expect(server).toContain('socket.data.sellerId = String(user.id || "");');
    expect(server).not.toContain("cleanSellerId(user.email)"); // the collision bug
  });

  it("both auth sites register the UUID → email bridge", () => {
    expect(server.match(/rememberSellerEmail\(user\.id, user\.email\)/g)?.length).toBe(2);
  });

  it("a UUID passes cleanSellerId unchanged (rooms/liveKey need no rewrite)", () => {
    // Mirror of the server's keep-class: every UUID char (lowercase hex + dashes)
    // is inside [a-z0-9@._-], so `seller:${cleanSellerId(uuid)}` === `seller:${uuid}`.
    const keep = /\[\^a-z0-9@\._-\]/;
    expect(server).toMatch(keep);
    const uuid = "880a7987-f1b5-4970-82d0-06938cefd4f6";
    expect(uuid.replace(/[^a-z0-9@._-]/g, "")).toBe(uuid);
  });

  it("connection entries keep the UUID key (the concurrency cap matches on entry.sellerId)", () => {
    // The tiktokConnections.set block stores the raw `sellerId` (uuid), NOT emailIdOf.
    const entry = server.slice(server.indexOf("tiktokConnections.set(key, {"), server.indexOf("recentComments: []"));
    expect(entry).toContain("sellerId,");
    expect(entry).not.toContain("emailIdOf");
  });
});

describe("H1 — payload fields still carry the email id (zero client changes)", () => {
  it("the emailIdOf bridge exists and falls back to '' (safe with the client's `if (p.sellerId && …)` guards)", () => {
    expect(server).toContain('return sellerEmailIds.get(String(sellerId || "")) || "";');
  });

  it("the live chat payload emits the email id while the room emit keys on the UUID", () => {
    const start = server.indexOf('avatar: data.profilePictureUrl');
    const chat = server.slice(start, server.indexOf('void emitCommentScoped(sellerId, "TikTok", cleanUsername, payload);', start));
    expect(chat).toContain("sellerId: emailIdOf(sellerId),");
    expect(server).toContain('void emitCommentScoped(sellerId, "TikTok", cleanUsername, payload);'); // room = uuid
  });

  it("platform_status / live_session / join-snapshot / initial-batch emits all use emailIdOf", () => {
    expect(server.match(/sellerId: emailIdOf\(cleanId\)/g)?.length).toBe(2);          // join snapshots (TT + FB)
    expect(server.match(/sellerId: emailIdOf\(sellerId\)/g)?.length).toBeGreaterThanOrEqual(8); // status/started/ended/initial/chat/Shopee/FB
    expect(server).toContain("sellerId: emailIdOf(active.sellerId),");                 // disconnect-path ended
  });

  it("no payload field ships the raw UUID: every `sellerId,` shorthand left is a call arg or map entry, not an emit field", () => {
    // Every remaining emit of a sellerId FIELD goes through emailIdOf.
    const emits = server.match(/\.emit\("(?:platform_status|live_session_started|live_session_ended)",[^;]*?\{[\s\S]*?\}\)/g) || [];
    for (const e of emits) {
      if (e.includes("sellerId")) expect(e).toContain("emailIdOf(");
    }
    expect(emits.length).toBeGreaterThanOrEqual(8);
  });
});
