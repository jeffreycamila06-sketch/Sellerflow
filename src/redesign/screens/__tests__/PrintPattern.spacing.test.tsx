// Sticker spacing in Live print pattern: Normal/Compact choice (allowlist only), the exact image
// preview when this device prints images, otherwise the mock marked approximate; fit warning.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import PrintPattern, { DEFAULT_PP } from "../PrintPattern";
import { buildSettingsFromRedesign } from "../../adapters/printing";

const settings = (pp = DEFAULT_PP, size = "60x40mm") => buildSettingsFromRedesign({ pp, psType: "bt", psOut: "sticker", psSize: size });
const view = (props: Partial<Parameters<typeof PrintPattern>[0]> = {}) =>
  render(<TProvider lang="en"><PrintPattern onBack={() => {}} pp={DEFAULT_PP} onToggle={() => {}} onStep={() => {}} layoutV2 previewSettings={settings()} shopName="My Shop" {...props} /></TProvider>);

describe("PrintPattern — sticker spacing", () => {
  it("not allowed: no spacing row, no approximate label, no warning (today's screen)", () => {
    const v = view({ imagePath: true });
    expect(v.queryByTestId("pp-spacing")).toBeNull();
    expect(v.queryByTestId("pp-approx")).toBeNull();
    expect(v.queryByTestId("pp-fit-warning")).toBeNull();
    expect(v.queryByTestId("pp-exact-preview")).toBeNull();
  });
  it("allowed + image path: exact preview, Normal selected by default, Compact pick reported", () => {
    const onSpacing = vi.fn();
    const v = view({ spacingAllowed: true, imagePath: true, onSpacing });
    expect(v.getByTestId("pp-exact-preview")).toBeTruthy();
    expect(v.queryByTestId("pp-approx")).toBeNull();
    expect(v.getByTestId("pp-spacing-normal").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(v.getByTestId("pp-spacing-compact"));
    expect(onSpacing).toHaveBeenCalledWith("compact");
    expect(v.queryByTestId("pp-fit-warning")).toBeNull(); // default pattern → silent
  });
  it("allowed, text mode / web: the mock, labelled approximate, no warning", () => {
    const v = view({ spacingAllowed: true, imagePath: false });
    expect(v.queryByTestId("pp-exact-preview")).toBeNull();
    expect(v.getByTestId("pp-approx").textContent).toBe("Approximate — your printer prints in text mode (the layout may differ)");
    expect(v.queryByTestId("pp-fit-warning")).toBeNull();
  });
  it("comment 3× on 60x40: the warning says which scale will print", () => {
    const pp = { ...DEFAULT_PP, commentSize: 3 };
    const v = view({ spacingAllowed: true, imagePath: true, pp, previewSettings: settings(pp) });
    expect(v.getByTestId("pp-fit-warning").textContent).toContain("it will print at 2×");
  });
  it("name 2× on 70x50: the warning says part of the name/comment will not print", () => {
    const pp = { ...DEFAULT_PP, tiktokNameSize: 2 };
    const v = view({ spacingAllowed: true, imagePath: true, pp, previewSettings: settings(pp, "70x50mm") });
    expect(v.getByTestId("pp-fit-warning").textContent).toContain("part of the name or comment will not print");
  });
});
