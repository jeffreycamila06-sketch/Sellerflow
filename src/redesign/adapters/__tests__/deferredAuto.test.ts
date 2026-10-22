// Audit Oct 13 item 2 — the held-comment queue + its wiring in RedesignApp.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createDeferredAutoQueue, DEFERRED_AUTO_CAP } from "../deferredAuto";

describe("createDeferredAutoQueue", () => {
  it("keeps arrival order and empties on take", () => {
    const q = createDeferredAutoQueue<string>();
    q.push("a", "A"); q.push("b", "B"); q.push("c", "C");
    expect(q.take()).toEqual(["A", "B", "C"]);
    expect(q.size()).toBe(0);
    expect(q.take()).toEqual([]);
  });
  it("one entry per comment key", () => {
    const q = createDeferredAutoQueue<string>();
    expect(q.push("a", "A")).toBe(true);
    expect(q.push("a", "A again")).toBe(false);
    expect(q.take()).toEqual(["A"]);
  });
  it("capped at 200; an empty key is never held", () => {
    expect(DEFERRED_AUTO_CAP).toBe(200);
    const q = createDeferredAutoQueue<number>();
    for (let i = 0; i < 250; i++) q.push(`k${i}`, i);
    expect(q.size()).toBe(200);
    expect(q.push("", 1)).toBe(false);
  });
  it("reset during loading → cleared, nothing to replay", () => {
    const q = createDeferredAutoQueue<string>();
    q.push("a", "A");
    q.clear();
    expect(q.take()).toEqual([]);
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync(resolve(__dirname, "../../RedesignApp.tsx"), "utf8");
  it("every new-session reset clears the held comments first", () => {
    const resets = src.split("\n").filter((l) => /liveSession\.reset\(\)/.test(l));
    // refreshDashboard reloads the SAME session → keeps them; the four new-session sites clear.
    const clearing = src.match(/deferredAuto\.clear\(\);[^\n]*\n?\s*liveSession\.reset\(\)/g) || [];
    expect(resets.length).toBe(5);
    expect(clearing.length).toBe(4);
    expect(src).toMatch(/const refreshDashboard[\s\S]*?liveSession\.reset\(\);\s+\/\/ reload today/);
  });
  it("a platform change clears them", () => {
    expect(src).toMatch(/if \(next !== sessionPlatformRef\.current\) \{ deferredAuto\.clear\(\); deferredPins\.clear\(\); \}/); // + held pins (Audit Oct 22, 2)
  });
  it("the auto handler holds (not drops) while loading or the order gate is closed", () => {
    expect(src).toMatch(/if \(liveSession\.state === "loading" \|\| !liveSession\.canOrder\(\)\) \{[\s\S]{0,400}deferredAuto\.push\(commentKey\(c\), c\)/);
  });
});
