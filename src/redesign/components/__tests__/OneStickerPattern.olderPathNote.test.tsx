// Jeff 2026-11-10 (item 3): a phone on the text or WiFi sticker with the new sticker saved showed TWO notes that
// contradict each other — "still prints the older sticker" and "This device prints this sticker". ONE note only: this
// phone keeps printing the older sticker (8 languages). Saved or not, with or without unsaved changes.
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { TProvider } from "../../i18n";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
function mount(devicePath: "text" | "wifi" | "d520", savedOnDevice: boolean, lang: (typeof LANGS)[number] = "en") {
  return render(<TProvider lang={lang}><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 60, h: 40 })} size={{ w: 60, h: 40 }} savedOnDevice={savedOnDevice} onSave={() => {}}
    shopName="" devicePath={devicePath} qrAllowed onTest={() => {}} onChangeSize={() => {}} /></TProvider>);
}
const notes = () => ["os-text-path", "os-wifi-path", "os-device-note"].map((id) => screen.queryByTestId(id)?.textContent ?? "").filter(Boolean);

describe("text / WiFi phone with the new sticker saved: one note", () => {
  it("text phone, saved → only \"still prints the older sticker\"", () => {
    mount("text", true);
    expect(notes()).toEqual(["On this phone this printer still prints the older sticker (older app or text mode). The new sticker is used on the computer and on phones that print pictures."]);
    expect(screen.queryByText("This device prints this sticker.")).toBeNull();
  });
  it("WiFi phone, saved → only \"keeps printing as it does now\"", () => {
    mount("wifi", true);
    expect(notes()).toEqual(["Your WiFi printer keeps printing as it does now. This sticker is for Bluetooth sticker printers and the computer."]);
    expect(screen.queryByText("This device prints this sticker.")).toBeNull();
  });
  it("with an unsaved change too: still one note (never \"used after you tap Save\")", () => {
    for (const path of ["text", "wifi"] as const) {
      const r = mount(path, true);
      fireEvent.click(screen.getByTestId("os-name-w-extra"));
      expect(notes(), path).toHaveLength(1);
      expect(screen.queryByText("Your changes are used after you tap Save."), path).toBeNull();
      r.unmount();
    }
  });
  it("one note in all 8 languages", () => {
    for (const lang of LANGS) for (const path of ["text", "wifi"] as const) {
      const r = mount(path, true, lang);
      expect(notes(), `${path} ${lang}`).toHaveLength(1);
      r.unmount();
    }
  });
  it("a picture-sticker phone is unchanged: saved → \"This phone uses the new sticker automatically.\"", () => {
    mount("d520", true);
    expect(notes()).toEqual(["This phone uses the new sticker automatically."]);
  });
});
