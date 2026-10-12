// Audit Oct 13 item 1 — a malformed socket message must never crash the server.
// Pure guards live in server/socketSafety.js (server.js has no vitest harness);
// the wiring into server.js is pinned by a source contract below.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  socketPayload, strField, socketToken, safeSocketHandler, safeSocketMiddleware,
} from "../../../../server/socketSafety.js";

const BAD = [null, undefined, 42, "x", [1], { sessionId: { toString: 1 } }, { platform: { toString: 1 } }, { username: { toString: 1 } }];

// The same body shapes as server.js join_live_room / select_account.
function joinBody(seen: string[]) {
  return (p: Record<string, unknown>) => { seen.push(String(strField(p, "sessionId") || "")); };
}
function selectBody(seen: string[]) {
  return (p: Record<string, unknown>) => {
    const ps = String(strField(p, "platform"));
    const plat = ps === "Facebook" ? "Facebook" : ps === "Shopee" ? "Shopee" : ps === "Instagram" ? "Instagram" : "TikTok";
    seen.push(`${plat}:${strField(p, "username")}`);
  };
}

describe("socket payload guards", () => {
  it("socketPayload: non-objects → {}", () => {
    for (const v of [null, undefined, 1, "s", [1]]) expect(socketPayload(v)).toEqual({});
    const o = { a: 1 };
    expect(socketPayload(o)).toBe(o);
  });
  it("strField: only strings come through", () => {
    expect(strField({ a: "x" }, "a")).toBe("x");
    expect(strField({ a: { toString: 1 } }, "a")).toBe("");
    expect(strField({ a: 5 }, "a")).toBe("");
    expect(strField({}, "a")).toBe("");
  });
  it("join_live_room / select_account bodies never throw on malformed payloads", () => {
    const j: string[] = []; const s: string[] = [];
    const join = safeSocketHandler("join_live_room", joinBody(j));
    const sel = safeSocketHandler("select_account", selectBody(s));
    for (const v of BAD) { expect(() => join(v)).not.toThrow(); expect(() => sel(v)).not.toThrow(); }
    expect(j.every((x) => x === "")).toBe(true);
    expect(s.every((x) => x === "TikTok:")).toBe(true);
  });
  it("a throwing body is caught and logged without the payload", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = safeSocketHandler("join_live_room", () => { throw new Error("boom secret"); });
    expect(() => h({ sessionId: "abc-secret" })).not.toThrow();
    expect(warn).toHaveBeenCalledWith("[SOCKET] join_live_room handler failed");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
    warn.mockRestore();
  });
});

describe("io.use middleware guard", () => {
  it("socketToken: object/number token → ''", () => {
    expect(socketToken({ handshake: { auth: { token: {} } } })).toBe("");
    expect(socketToken({ handshake: { auth: { token: 7 } } })).toBe("");
    expect(socketToken({ handshake: {} })).toBe("");
    expect(socketToken(null)).toBe("");
    expect(socketToken({ handshake: { auth: { token: "t" } } })).toBe("t");
  });
  it("token {} → next(Error), no throw", async () => {
    const verify = vi.fn(async (t: unknown) => (typeof t === "string" && t ? { id: "u" } : null));
    const mw = safeSocketMiddleware(async (socket: unknown, next: (e?: Error) => void) => {
      const user = await verify(socketToken(socket));
      if (!user) return next(new Error("unauthorized"));
      next();
    });
    const next = vi.fn();
    await expect(mw({ handshake: { auth: { token: {} } } }, next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
  it("a throwing middleware body → next(Error('unauthorized')), exactly once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mw = safeSocketMiddleware(async () => { throw new TypeError("bad token"); });
    const next = vi.fn();
    await expect(mw({}, next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as Error).message).toBe("unauthorized");
    warn.mockRestore();
  });
});

describe("server.js wiring (source contract)", () => {
  const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
  it("every socket.on handler is wrapped in safeSocketHandler", () => {
    const ons = src.match(/socket\.on\(\s*"[^"]+",[^\n]*/g) || [];
    expect(ons.length).toBeGreaterThanOrEqual(2);
    for (const line of ons) expect(line).toMatch(/socket\.on\(\s*"([^"]+)",\s*safeSocketHandler\("\1",/);
  });
  it("io.use is wrapped and reads the token via socketToken", () => {
    expect(src).toMatch(/io\.use\(safeSocketMiddleware\(async \(socket, next\) => \{\s*\n\s*const token = socketToken\(socket\);/);
  });
  it("verifyToken returns null for non-string input", () => {
    expect(src).toMatch(/async function verifyToken\(token\) \{\s*\n\s*if \(!sb \|\| typeof token !== "string" \|\| !token\) return null;/);
  });
});
