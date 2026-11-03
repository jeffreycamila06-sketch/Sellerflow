// Round 4 (item 5): the one-time laptop "Choose your sticker size" sheet — size list, the live preview (browser path,
// the picked size), Test print (a framed laptop page), "Use this size" / "Later" / tap outside, 8 languages.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TProvider, REDESIGN_STRINGS } from "../../i18n";
import LaptopSizeSheet from "../LaptopSizeSheet";
import { LAPTOP_SIZES, LAPTOP_SIZE_SHEET_SEEN_KEY, laptopSizeSheetSeen, markLaptopSizeSheetSeen, sizeKeyOf } from "../../adapters/laptopSize";
import { DEF_SETTINGS, __resetWebPrintQueue, __webPrintIdle } from "../../adapters/printing";

vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: async () => ({}), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: async () => { throw new Error("no font C in this test"); }, loadCjkRegAtlas: async () => { throw new Error("no font C in this test"); } }));

const view = (over: Partial<Parameters<typeof LaptopSizeSheet>[0]> = {}) => {
  const p = { psSize: "60x40mm", onPick: vi.fn(), settings: { ...DEF_SETTINGS, stickerSize: "60x40" }, cur: "NT$", storeName: "My Shop", onChoose: vi.fn(), onLater: vi.fn(), ...over };
  render(<TProvider lang="en"><LaptopSizeSheet {...p} /></TProvider>);
  return p;
};
beforeEach(() => { localStorage.clear(); __resetWebPrintQueue(); });
afterEach(() => { cleanup(); __resetWebPrintQueue(); document.querySelectorAll("iframe").forEach((f) => f.remove()); });

describe("LaptopSizeSheet", () => {
  it("lists the six laptop sizes (50×30 included), marks the picked one, pick → onPick", () => {
    const p = view();
    expect(LAPTOP_SIZES).toEqual(["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm", "50x30mm"]);
    const list = screen.getByTestId("laptop-size-list");
    expect(list.querySelectorAll("button")).toHaveLength(6);
    expect(screen.getByTestId("laptop-size-60x40").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("laptop-size-50x30").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByTestId("laptop-size-50x30"));
    expect(p.onPick).toHaveBeenCalledWith("50x30mm");
  });
  it("the preview is the laptop print page's bitmap (browser path) at the picked size", () => {
    view({ psSize: "50x30mm" });
    const frame = screen.getByTestId("pp-exact-preview-browser");
    expect(frame.getAttribute("data-aspect")).toBe("50 / 30");
    expect(screen.getByTestId("pp-exact-preview").getAttribute("data-path")).toBe("browser");
  });
  it("Test print queues a laptop page (the bitmap image, framed) at the picked size — no choice made", async () => {
    const p = view({ psSize: "50x30mm" });
    fireEvent.click(screen.getByTestId("laptop-size-test"));
    await __webPrintIdle();
    const html = document.querySelector("iframe")?.contentDocument?.documentElement.outerHTML || "";
    expect(html).toContain("@page{size:50mm 30mm;margin:0}");
    expect(html).toMatch(/data:image\/bmp;base64,/);
    expect(p.onChoose).not.toHaveBeenCalled();
  });
  it("Use this size → onChoose; Later → onLater; a tap outside the sheet → onLater; the seen flag helpers", () => {
    const p = view();
    fireEvent.click(screen.getByTestId("laptop-size-use"));
    expect(p.onChoose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("laptop-size-later"));
    expect(p.onLater).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("laptop-size-sheet"));
    expect(p.onLater).toHaveBeenCalledTimes(2);
    expect(p.onChoose).toHaveBeenCalledTimes(1);
    expect(laptopSizeSheetSeen()).toBe(false);
    markLaptopSizeSheetSeen();
    expect(localStorage.getItem(LAPTOP_SIZE_SHEET_SEEN_KEY)).toBe("1");
    expect(laptopSizeSheetSeen()).toBe(true);
    expect(sizeKeyOf("100x60mm (Standard)")).toBe("100x60");
  });
  it("every string in all 8 languages, none blank", () => {
    const langs = Object.keys(REDESIGN_STRINGS);
    expect(langs).toHaveLength(8);
    for (const k of ["rd_ps_lsize_title", "rd_ps_lsize_intro", "rd_ps_lsize_use", "rd_ps_lsize_later", "rd_ps_lsize_old_note"]) {
      for (const l of langs) expect((REDESIGN_STRINGS as Record<string, Record<string, string>>)[l][k]?.trim(), `${k}/${l}`).toBeTruthy();
    }
  });
});
