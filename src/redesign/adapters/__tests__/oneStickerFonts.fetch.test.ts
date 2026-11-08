// The app FETCHES the Sans outline files (sansOutlines.*.json). A load that failed is asked again on the
// next try — a failed dynamic import() is remembered by the browser for the whole session (checked in
// Chromium 153: an aborted chunk was never requested again), so "Try again" and the next print could
// never get the font back that way.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import data700 from "../sansOutlines.700.json";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
const fresh = async () => { vi.resetModules(); const m = await import("../oneStickerFonts"); m.__setFaceFetch(true); return m; };

describe("Sans outlines are fetched (a failed load can be tried again)", () => {
  it("first fetch fails → the load fails; the next load asks AGAIN and gets the face", async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => data700 });
    vi.stubGlobal("fetch", f);
    const m = await fresh();
    await expect(m.loadSansFace(700)).rejects.toThrow("Failed to fetch");
    const face = await m.loadSansFace(700);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[0][0])).toMatch(/sansOutlines\.700\.json/);
    expect(face.upm).toBe(1000);
    expect(m.getSansFace(700)).toBe(face);
    await m.loadSansFace(700);
    expect(f, "loaded once → never fetched again").toHaveBeenCalledTimes(2);
  });
  it("an HTTP error is a failure too (and is tried again)", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => data700 });
    vi.stubGlobal("fetch", f);
    const m = await fresh();
    await expect(m.loadSansFace(700)).rejects.toThrow("HTTP 503");
    expect((await m.loadSansFace(700)).upm).toBe(1000);
  });
  it("the .json data and the .ts module are the same face (tests read the module, the app fetches the file)", async () => {
    for (const k of ["400", "700", "900", "cjkx"]) {
      const json = JSON.parse(fs.readFileSync(path.join(__dirname, `../sansOutlines.${k}.json`), "utf8"));
      const mod = await import(`../sansOutlines.${k}.ts`);
      expect(mod.SANS_FACE, k).toEqual(json);
    }
  });
  it("the app path is fetch; dynamic import() of the outlines exists only in test builds", () => {
    const src = fs.readFileSync(path.join(__dirname, "../oneStickerFonts.ts"), "utf8");
    expect(src).toMatch(/if \(import\.meta\.env\.MODE === "test" && !fetchFaces\) \{/);
    expect(src).toMatch(/\n {2}return fetchFace\(FACE_URL\[k\]\)\.then/);
    for (const k of ["400", "700", "900", "cjkx"]) expect(src).toContain(`./sansOutlines.${k}.json?url`);
  });
});
