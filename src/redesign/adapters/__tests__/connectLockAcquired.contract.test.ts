// Audit Oct 22 (7) — connectTikTok (server.js, no runtime harness): the per-key connect lock and
// the concurrency reservation are released ONLY by the call that acquired them. Before: a
// double tap's second call was 429'd ("already starting") and its `finally` deleted the FIRST
// tap's lock + reservation (same key) → a third tap during the first connect slipped through.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const server = readFileSync("server.js", "utf8");
const fn = server.slice(server.indexOf("async function connectTikTok("), server.indexOf("// M5 (security audit 2026-09-26)"));

describe("connectTikTok lock ownership", () => {
  it("declares `acquired`, sets it right after taking the lock, and checks the 429 BEFORE taking it", () => {
    expect(fn).toContain("let acquired = false;");
    const has = fn.indexOf("if (tiktokConnectLocks.has(key)) {");
    const add = fn.indexOf("tiktokConnectLocks.add(key);");
    const set = fn.indexOf("acquired = true;");
    expect(has).toBeGreaterThan(-1);
    expect(add).toBeGreaterThan(has);           // 429 for a tap that finds the lock held…
    expect(set).toBe(fn.indexOf("\n", add) + 1 + fn.slice(fn.indexOf("\n", add) + 1).search(/\S/)); // …and acquired = true is the very next statement
    expect(fn.slice(has, add)).toContain("status(429)");
  });
  it("the finally releases the lock + reservation only when acquired (never the first tap's)", () => {
    const fin = fn.slice(fn.lastIndexOf("} finally {"));
    expect(fin).toContain("if (acquired) tiktokConnectLocks.delete(key);");
    expect(fin).toContain("if (acquired) liveConnectReservations.delete(key);");
    expect(fin).not.toMatch(/if \(key\) tiktokConnectLocks\.delete/);
  });
  it("double tap model: the refused tap must not free the first tap's lock (old finally did)", async () => {
    // A small model of the control flow (the real function has no harness). Tap A takes the lock
    // and awaits its connect; tap B arrives → 429. OLD finally: B deletes A's lock → tap C starts a
    // SECOND connection. NEW finally: B leaves it → C is 429'd too; A releases when done.
    const model = (fixed: boolean) => {
      const locks = new Set<string>(); let release = () => {};
      const connect = async () => {
        let acquired = false;
        try {
          if (locks.has("k")) return "429";
          locks.add("k"); acquired = true;
          await new Promise<void>((r) => { release = r; });
          return "ok";
        } finally { if (fixed ? acquired : true) locks.delete("k"); }
      };
      return { connect, locks, done: () => release() };
    };
    const good = model(true);
    const a = good.connect();
    expect(await good.connect()).toBe("429");
    expect(good.locks.has("k")).toBe(true);
    expect(await good.connect()).toBe("429");
    good.done(); expect(await a).toBe("ok"); expect(good.locks.size).toBe(0);
    const old = model(false);
    void old.connect();
    expect(await old.connect()).toBe("429");
    expect(old.locks.has("k")).toBe(false);      // the bug: B freed A's lock…
    const c = old.connect(); old.done();           // …so C connects while A is still connecting
    expect(await c).toBe("ok");
  });
});
