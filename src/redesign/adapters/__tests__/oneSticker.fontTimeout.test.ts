// ALL SCRIPTS: the kana / full-width font chunk never holds a print longer than 8 s.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../oneStickerFonts", async (orig) => {
  const m = await orig<typeof import("../oneStickerFonts")>();
  return { ...m, loadSansFace: (k: Parameters<typeof m.loadSansFace>[0]) => (k === "cjkx" ? new Promise(() => {}) : m.loadSansFace(k)) };
});
import { ensureAllScriptsFonts, setStickerAllScripts, ALL_SCRIPTS_FONT_TIMEOUT_MS } from "../oneStickerScripts";

afterEach(() => { setStickerAllScripts(false); vi.useRealTimers(); });
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
});
