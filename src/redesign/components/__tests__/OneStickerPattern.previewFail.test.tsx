// The preview never shows a device-font picture as the sticker: if ANY face the picture needs did not
// load, the screen shows "Preview couldn't load — try again" and no notes (never "Everything fits").
// Changing a setting after a failure tries again by itself.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
const ctl = vi.hoisted(() => ({ missing: new Set<number | string>() }));
vi.mock("../../adapters/oneStickerFonts", async (orig) => {
  const m = await orig<typeof import("../../adapters/oneStickerFonts")>();
  return { ...m, loadSansFace: (k: Parameters<typeof m.loadSansFace>[0]) => (ctl.missing.has(k) ? Promise.reject(new Error("chunk failed")) : m.loadSansFace(k)) };
});
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { TProvider } from "../../i18n";

const mount = () => render(<TProvider lang="en"><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 60, h: 40 })} savedOnDevice={false} onSave={() => {}} shopName="Maria" devicePath="laptop" qrAllowed onTest={() => {}} /></TProvider>);

describe("preview load failure", () => {
  beforeEach(() => { ctl.missing.clear(); });

  it("one weight missing (the others loaded) → the failed state, no notes; Try again loads both", async () => {
    ctl.missing.add(700); // the date's weight — every sticker needs it
    mount();
    expect((await screen.findByTestId("os-preview-failed")).textContent).toContain("Preview couldn't load — try again");
    expect(screen.queryByTestId("os-preview")).toBeNull();
    expect(screen.queryByTestId("os-notes")).toBeNull();
    expect(screen.queryByTestId("os-note-ok")).toBeNull(); // never "Everything fits" on device fonts
    ctl.missing.clear();
    fireEvent.click(screen.getByTestId("os-preview-retry"));
    expect(await screen.findByTestId("os-preview")).toBeTruthy();
    expect(screen.queryByTestId("os-preview-failed")).toBeNull();
    expect(await screen.findByTestId("os-notes")).toBeTruthy();
  });

  it("a part's own weight missing (Extra) fails it too", async () => {
    ctl.missing.add(900);
    mount();
    // make sure a part prints Extra so 900 is needed
    fireEvent.click(await screen.findByTestId("os-comment-w-extra"));
    expect(await screen.findByTestId("os-preview-failed")).toBeTruthy();
    expect(screen.queryByTestId("os-notes")).toBeNull();
  });

  it("after a failure, changing a setting retries by itself (no Try again tap)", async () => {
    ctl.missing.add(700);
    mount();
    await screen.findByTestId("os-preview-failed");
    ctl.missing.clear();
    fireEvent.click(screen.getByTestId("os-comment-plus"));
    expect(await screen.findByTestId("os-preview")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("os-preview-failed")).toBeNull());
    expect(await screen.findByTestId("os-notes")).toBeTruthy();
  });

  it("still failing after a setting change → still the failed state (the retry really ran)", async () => {
    ctl.missing.add(700);
    mount();
    await screen.findByTestId("os-preview-failed");
    fireEvent.click(screen.getByTestId("os-comment-plus"));
    await waitFor(() => expect(screen.getByTestId("os-preview-failed")).toBeTruthy());
    expect(screen.queryByTestId("os-notes")).toBeNull();
  });
});
