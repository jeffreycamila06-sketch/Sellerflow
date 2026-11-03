// Round 5 (item 2): LIVE print pattern on a laptop with NO sticker size chosen — the preview is the OLD page
// (origin/main's), no "Not printed on this size" notes, no red lines, one line + a button that opens the size sheet.
// Chosen → the bitmap preview and the normal gates, exactly as round 3/4.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TProvider, buildT, REDESIGN_STRINGS } from "../../i18n";
import PrintPattern, { DEFAULT_PP } from "../PrintPattern";
import { buildSettingsFromRedesign, setStickerSpacingAllowed, setStickerCompactV2 } from "../../adapters/printing";

vi.mock("../../adapters/cjkAtlasLoader", () => ({ loadCjkAtlas: async () => ({}), prefetchCjkAtlas: () => {}, getCjkAtlasSync: () => null }));
vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: async () => { throw new Error("no font C in this test"); }, loadCjkRegAtlas: async () => { throw new Error("no font C in this test"); } }));

const t = buildT("en") as unknown as Record<string, string>;
const big = { ...DEFAULT_PP, buyerNumSize: 3, commentSize: 3, tiktokNameSize: 3 };
const view = (p: Partial<Parameters<typeof PrintPattern>[0]> = {}, pp = big, size = "50x30mm") =>
  render(<TProvider lang="en"><PrintPattern onBack={() => {}} pp={pp} onToggle={() => {}} onStep={() => {}} layoutV2 psSize={size} previewSettings={buildSettingsFromRedesign({ pp, psType: "bt", psOut: "sticker", psSize: size })} shopName="My Shop" {...p} /></TProvider>);

describe("laptop, no size chosen", () => {
  it("the preview is origin/main's page in a frame; no notes, no red lines; the line + Choose size → opens the sheet", async () => {
    setStickerSpacingAllowed(true); setStickerCompactV2(false);
    const onChoose = vi.fn();
    view({ laptopSizeChosen: false, onChooseLaptopSize: onChoose });
    const frame = screen.getByTestId("pp-exact-preview-legacy") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("@page{size:auto;margin:0}");
    expect(frame.getAttribute("data-aspect")).toBe("50 / 30");
    expect(screen.queryByTestId("pp-exact-preview")).toBeNull();
    expect(screen.queryAllByTestId(/^pp-not-printed-/)).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryAllByTestId(/^pp-fit-/)).toHaveLength(0);
    expect(screen.getByTestId("pp-laptop-choose").textContent).toContain(t.rd_pp_lsize_line);
    fireEvent.click(screen.getByTestId("pp-laptop-choose-btn"));
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
  it("size chosen (default) → the bitmap preview, the gates and the red lines as before; no line", async () => {
    setStickerSpacingAllowed(true); setStickerCompactV2(false);
    view({ laptopSizeChosen: true });
    expect(screen.queryByTestId("pp-exact-preview-legacy")).toBeNull();
    expect(screen.getByTestId("pp-exact-preview-browser")).toBeTruthy();
    expect(screen.queryByTestId("pp-laptop-choose")).toBeNull();
    await waitFor(() => expect(screen.queryAllByTestId(/^pp-fit-/).length).toBeGreaterThan(0), { timeout: 8000 });
  }, 10_000);
  it("the two strings exist in all 8 languages", () => {
    for (const l of Object.keys(REDESIGN_STRINGS)) for (const k of ["rd_pp_lsize_line", "rd_pp_lsize_btn"]) expect((REDESIGN_STRINGS as Record<string, Record<string, string>>)[l][k]?.trim(), `${k}/${l}`).toBeTruthy();
  });
});
