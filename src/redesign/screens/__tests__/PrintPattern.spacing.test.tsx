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
    const v = view({ spacingAllowed: true, imagePath: true, onSpacing, spacingChoiceVisible: true }); // the row as it was (visible)
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
    expect(v.getByTestId("pp-approx").textContent).toBe("Approximate — Simple print is on, so the layout may differ"); // Build 10b wording
    expect(v.queryByTestId("pp-fit-warning")).toBeNull();
  });
  // Nov 3 (item 14): the warning is RED, sits under the control that causes it, appears on the tap (measured,
  // no print), says what will happen, and the print still follows the chosen size.
  it("comment 3× on 60x40: a red line under the Comment control saying what happens", async () => {
    const pp = { ...DEFAULT_PP, commentSize: 3 };
    const v = view({ spacingAllowed: true, imagePath: true, pp, previewSettings: settings(pp) });
    const line = await v.findByTestId("pp-fit-comment");
    expect(line.textContent).toMatch(/^Too big — (other lines get pushed off the sticker|the name or comment will be cut on this sticker)\. It still prints at this size\.$/);
    expect(line.getAttribute("role")).toBe("alert");
    expect(line.style.color).toBe("var(--danger)");
    expect(v.queryByTestId("pp-fit-tiktokName")).toBeNull(); // only the control that causes it
    expect(v.queryByTestId("pp-fit-warning")).toBeNull();    // no second, general box
  });
  it("name 2× on 70x50: a red line under the TikTok name control (the name pushes the lines below off)", async () => {
    const pp = { ...DEFAULT_PP, tiktokNameSize: 2 };
    const v = view({ spacingAllowed: true, imagePath: true, pp, previewSettings: settings(pp, "70x50mm") });
    expect((await v.findByTestId("pp-fit-tiktokName")).textContent).toContain("Too big — other lines get pushed off the sticker");
    expect(v.queryByTestId("pp-fit-comment")).toBeNull();
  });
  it("without spacing allowed / image path the line still shows (any seller, any printer)", async () => {
    const pp = { ...DEFAULT_PP, commentSize: 3 };
    const v = view({ pp, previewSettings: settings(pp), appShell: true });
    expect(await v.findByTestId("pp-fit-comment")).toBeTruthy();
  });
});
