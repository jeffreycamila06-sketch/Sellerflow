// ALL SCRIPTS: the kana / full-width font chunk never holds a print longer than 8 s.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../oneStickerFonts", async (orig) => {
  const m = await orig<typeof import("../oneStickerFonts")>();
  return { ...m, loadSansFace: (k: Parameters<typeof m.loadSansFace>[0]) => (k === "cjkx" ? new Promise(() => {}) : m.loadSansFace(k)) };
});
import { ensureAllScriptsFonts, setStickerAllScripts, ALL_SCRIPTS_FONT_TIMEOUT_MS, __resetKanaStuck } from "../oneStickerScripts";

afterEach(() => { setStickerAllScripts(false); vi.useRealTimers(); __resetKanaStuck(); });
describe("all-scripts font wait", () => {
  it("a kana font that never arrives → the print goes on after 8 s (the device font draws them)", async () => {
    vi.useFakeTimers();
    setStickerAllScripts(true);
    let done = false;
    void ensureAllScriptsFonts({ buyer: { name: "田中さん", orders: [{ item: "ワンピース" }] } } as never).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(ALL_SCRIPTS_FONT_TIMEOUT_MS - 10);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
    expect(ALL_SCRIPTS_FONT_TIMEOUT_MS).toBe(8000);
  });
  it("10 kana prints with a hung font → ONE 8 s wait in total (the rest go on at once)", async () => {
    vi.useFakeTimers();
    setStickerAllScripts(true);
    const pay = { buyer: { name: "田中さん", orders: [{ item: "ワンピース" }] } } as never;
    const t0 = Date.now();
    let done = 0;
    for (let i = 0; i < 10; i++) {
      const p = ensureAllScriptsFonts(pay).then(() => { done++; });
      // first print: the 8 s wait; the rest: one 0 ms tick (a font already in memory would answer in it)
      await vi.advanceTimersByTimeAsync(i === 0 ? ALL_SCRIPTS_FONT_TIMEOUT_MS : 0);
      await p;
    }
    expect(done).toBe(10);
    expect(Date.now() - t0).toBe(ALL_SCRIPTS_FONT_TIMEOUT_MS); // fake clock: exactly one 8 s wait
  });
});
