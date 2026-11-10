// Jeff 2026-11-10 (on 8f5c718d): "This phone uses the new sticker automatically" ONLY when the new sticker is
// saved on this phone (auto-save or Save done). Not saved yet (no printer saved, reads failed) → the "tap Save"
// note. And no native printer read on a WiFi / text phone (it can never auto-save).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { shouldAskSavedPrinter } from "../../adapters/oneStickerPrint";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/propAtlasLoader", () => ({ loadPropAtlas: async () => { throw new Error("no font C"); }, loadCjkRegAtlas: async () => { throw new Error("no font C"); } }));
const note = (devicePath: string, saved: boolean, lang = "en") => {
  const r = render(<TProvider lang={lang as "en"}><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 60, h: 40 })} savedOnDevice={saved} onSave={() => {}} shopName="Maria" devicePath={devicePath as "d520"} qrAllowed onTest={() => {}} /></TProvider>);
  const text = screen.getByTestId("os-device-note").textContent;
  r.unmount();
  return text;
};

describe("the note under the Save button", () => {
  it("phone (picture sticker), saved here → \"This phone uses the new sticker automatically.\"", () => {
    for (const p of ["d520", "tspl", "escpos", "cpcl", "niimbot"]) expect(note(p, true), p).toBe("This phone uses the new sticker automatically.");
  });
  it("phone, NOT saved yet (no printer saved / the reads failed) → the tap-Save note, never \"automatically\"", () => {
    for (const p of ["d520", "tspl", "niimbot"]) expect(note(p, false), p).toBe("This phone keeps today's sticker until you tap Save.");
  });
  it("browser / laptop: not saved → tap Save first; saved → \"This device prints this sticker.\" (unchanged)", () => {
    expect(note("laptop", false)).toBe("On this browser, tap Save to use the new sticker. In the phone app it is used automatically.");
    expect(note("laptop", true)).toBe("This device prints this sticker.");
  });
  it("text / WiFi phone: no note when not saved (their own \"older sticker\" note says it)", () => {
    expect(note("text", false)).toBe("");
    expect(note("wifi", false)).toBe("");
  });
  it("the phone tap-Save note exists in all 8 languages", () => {
    for (const lang of ["fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const t = note("d520", false, lang);
      expect(t, lang).toBeTruthy();
      expect(t, lang).not.toBe("This phone keeps today's sticker until you tap Save.");
    }
  });
});

describe("the one native printer read on open", () => {
  const base = { visible: true, flagsLoaded: true, btBridge: true, printerKnown: false, saved: false };
  it("asked only on a phone that can auto-save (picture sticker); never on a WiFi / text phone, the laptop, or when nothing would come of it", () => {
    for (const p of ["d520", "tspl", "escpos", "cpcl", "niimbot"]) expect(shouldAskSavedPrinter({ ...base, devicePath: p }), p).toBe(true);
    for (const p of ["wifi", "text", "laptop"]) expect(shouldAskSavedPrinter({ ...base, devicePath: p }), p).toBe(false);
    for (const k of ["visible", "flagsLoaded", "btBridge"] as const) expect(shouldAskSavedPrinter({ ...base, devicePath: "d520", [k]: false }), k).toBe(false);
    for (const k of ["printerKnown", "saved"] as const) expect(shouldAskSavedPrinter({ ...base, devicePath: "d520", [k]: true }), k).toBe(false);
  });
  it("RedesignApp asks through that rule, with its own device path", async () => {
    const fs = await import("node:fs");
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("if (printerAsked.current || !shouldAskSavedPrinter({ visible: oneStickerOn, flagsLoaded, btBridge: hasBtBridge(), printerKnown: savedBtPrinter() != null, saved: readSavedOneSticker() != null, devicePath: osDevicePath })) return;");
  });
});
