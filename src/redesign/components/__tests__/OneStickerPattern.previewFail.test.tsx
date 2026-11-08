// The preview never stays blank: a font that can't load shows "Preview couldn't load — try again".
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const ctl = vi.hoisted(() => ({ fail: true }));
vi.mock("../../adapters/oneStickerPrint", async (orig) => {
  const m = await orig<typeof import("../../adapters/oneStickerPrint")>();
  return { ...m, oneStickerFonts: (...a: Parameters<typeof m.oneStickerFonts>) => (ctl.fail ? Promise.reject(new Error("chunk failed")) : m.oneStickerFonts(...a)) };
});
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { TProvider } from "../../i18n";

describe("preview load failure", () => {
  it("shows a short message and Try again; Try again loads it", async () => {
    render(<TProvider lang="en"><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 60, h: 40 })} savedOnDevice={false} onSave={() => {}} shopName="Maria" devicePath="laptop" qrAllowed onTest={() => {}} /></TProvider>);
    expect((await screen.findByTestId("os-preview-failed")).textContent).toContain("Preview couldn't load — try again");
    ctl.fail = false;
    fireEvent.click(screen.getByTestId("os-preview-retry"));
    expect(await screen.findByTestId("os-preview")).toBeTruthy();
    expect(screen.queryByTestId("os-preview-failed")).toBeNull();
  });
});
