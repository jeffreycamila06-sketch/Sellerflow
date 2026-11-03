// Round 4 — Printer settings on a LAPTOP (no native printer): ONE "Sticker size" card (item 4), the six laptop sizes,
// the "previous layout until you choose" note while no laptop size is chosen (item 5).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PrinterSettings from "../PrinterSettings";
import { TProvider, buildT } from "../../i18n";
import { DEF_SETTINGS } from "../../adapters/printing";

vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: async () => ({}), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: async () => { throw new Error("no font C in this test"); }, loadCjkRegAtlas: async () => { throw new Error("no font C in this test"); } }));

const t = buildT("en") as unknown as Record<string, string>;
const noop = () => {};
const view = (p: { laptopSizeChosen?: boolean; psSizeOpen?: boolean } = {}) => render(
  <TProvider lang="en">
    <PrinterSettings onBack={noop} psType="bt" psOut="sticker" onSetPsOut={noop} psSize="60x40mm" psSizeOpen={p.psSizeOpen ?? false}
      onTogglePsSize={noop} onPickPsSize={noop} settings={{ ...DEF_SETTINGS, stickerSize: "60x40" }} laptopSizeChosen={p.laptopSizeChosen} />
  </TProvider>,
);

describe("Printer settings on a laptop", () => {
  it("item 4: exactly ONE 'Sticker size' card (the laptop card); the Bluetooth size card is not rendered", () => {
    view();
    expect(screen.getAllByText(t.rd_ps_sticker_size)).toHaveLength(1);
    expect(screen.getByTestId("ps-laptop")).toBeTruthy();
    expect(screen.getByTestId("ps-laptop").contains(screen.getByTestId("ps-size"))).toBe(true);
    expect(screen.queryByTestId("ps-size-fixed")).toBeNull();
  });
  it("the laptop picker lists the six laptop sizes, 50×30 included", () => {
    view({ psSizeOpen: true });
    const names = Array.from(screen.getByTestId("ps-laptop").querySelectorAll("button")).map((b) => b.textContent?.trim()).filter((s) => /^\d+x\d+mm/.test(s || "") && !s?.endsWith("▾"));
    expect(names).toEqual(["100x60mm (Standard)", "80x60mm", "80x50mm", "70x50mm", "60x40mm", "50x30mm"]);
  });
  it("item 5: no laptop size chosen → the 'previous layout' note; chosen (or the default) → no note", () => {
    const { unmount } = view({ laptopSizeChosen: false });
    expect(screen.getByTestId("ps-laptop-old-note").textContent).toBe(t.rd_ps_lsize_old_note);
    unmount();
    view({ laptopSizeChosen: true });
    expect(screen.queryByTestId("ps-laptop-old-note")).toBeNull();
    screen.getByTestId("ps-laptop").remove();
    view();
    expect(screen.queryByTestId("ps-laptop-old-note")).toBeNull();
  });
});
