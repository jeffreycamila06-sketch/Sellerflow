// Loader contract: one shared in-flight promise, cached after resolve, sync
// getter for already-resident reads. (Failure-retry semantics are exercised at
// the router level in printing.cjkSplit.test.ts; here the REAL chunk loads —
// which also proves the dynamic import path itself resolves in this repo.)
import { describe, it, expect } from "vitest";
import { loadCjkAtlas, getCjkAtlasSync, prefetchCjkAtlas } from "../cjkAtlasLoader";

describe("cjkAtlasLoader", () => {
  it("loads the real code-split atlas once, caches it, and exposes the sync getter", async () => {
    const p1 = loadCjkAtlas();
    const p2 = loadCjkAtlas();
    expect(p1).toBe(p2); // shared in-flight promise (a racing print awaits the prefetch)
    const atlas = await p1;
    expect(atlas.cjk?.w).toBe(24);
    expect(Object.keys(atlas.cjk?.glyphs ?? {}).length).toBeGreaterThan(20000); // full Big5 coverage
    expect(getCjkAtlasSync()).toBe(atlas); // resident after resolve
    prefetchCjkAtlas(); // idempotent no-op once loaded
    expect(await loadCjkAtlas()).toBe(atlas);
  });
});
