// LIVE PRINT PATTERN — TikTok / Facebook view (seller screen): four buttons in one row above the
// preview, TikTok when the screen opens, never saved; Printer Test prints the picked view.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TProvider } from "../../i18n";
import OneStickerPattern, { type OneStickerPatternProps } from "../OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { installNodeFallbackDrawer, installSans } from "../../adapters/__tests__/oneSticker.harness";

beforeAll(() => { installSans(); installNodeFallbackDrawer(); });
const mount = (over: Partial<OneStickerPatternProps> = {}, lang = "en") => {
  const onTest = vi.fn(), onTestSample = vi.fn(), onSave = vi.fn();
  const r = render(<TProvider lang={lang as "en"}><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 60, h: 40 })} savedOnDevice={false} onSave={onSave} shopName="Maria Ukay" devicePath="d520" qrAllowed onTest={onTest} {...over} /></TProvider>);
  return { onTest, onTestSample, onSave, unmount: r.unmount };
};
const pressed = (k: string) => screen.getByTestId(`os-view-${k}`).getAttribute("aria-pressed");

describe("TikTok / Facebook view", () => {
  it("four buttons in one row, above the preview: TikTok, Facebook, Instagram, Shopee", () => {
    mount();
    const row = screen.getByTestId("os-view");
    expect(Array.from(row.querySelectorAll("button")).map((b) => b.getAttribute("data-testid"))).toEqual(["os-view-tiktok", "os-view-facebook", "os-view-instagram", "os-view-shopee"]);
    expect(row.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))"); // one row, never wraps
    // above the picture (the picture is either the canvas or its "couldn't load" box)
    const pv = screen.queryByTestId("os-preview") ?? screen.getByTestId("os-preview-failed");
    expect(row.compareDocumentPosition(pv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const b of Array.from(row.querySelectorAll("button"))) expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
  it("Instagram and Shopee are disabled with a small 'Soon' label — in all 8 languages", () => {
    const soon: Record<string, string> = { en: "Soon", fil: "Malapit na", zh: "即将推出", "zh-TW": "即將推出", vi: "Sắp có", th: "เร็ว ๆ นี้", id: "Segera", bg: "Скоро" };
    for (const [lang, word] of Object.entries(soon)) {
      const m = mount({}, lang);
      for (const k of ["instagram", "shopee"]) {
        expect((screen.getByTestId(`os-view-${k}`) as HTMLButtonElement).disabled, `${lang} ${k}`).toBe(true);
        expect(screen.getByTestId(`os-view-${k}-soon`).textContent, `${lang} ${k}`).toBe(word);
      }
      expect(screen.queryByTestId("os-view-tiktok-soon")).toBeNull();
      expect(screen.queryByTestId("os-view-facebook-soon")).toBeNull();
      fireEvent.click(screen.getByTestId("os-view-instagram"));
      expect(pressed("tiktok")).toBe("true");
      m.unmount(); cleanup();
    }
  });
  it("TikTok when the screen opens; the pick is not kept (reopen = TikTok) and nothing is stored or saved", () => {
    const keys = () => JSON.stringify(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)]));
    const before = keys();
    const a = mount();
    expect(pressed("tiktok")).toBe("true");
    expect(pressed("facebook")).toBe("false");
    const saveWas = (screen.getByTestId("os-save") as HTMLButtonElement).disabled;
    fireEvent.click(screen.getByTestId("os-view-facebook"));
    expect(pressed("facebook")).toBe("true");
    expect(pressed("tiktok")).toBe("false");
    expect((screen.getByTestId("os-save") as HTMLButtonElement).disabled).toBe(saveWas); // the view is not a setting
    expect(a.onSave).not.toHaveBeenCalled();
    expect(keys()).toBe(before);
    a.unmount(); cleanup();
    mount();
    expect(pressed("tiktok")).toBe("true");
  });
  it("Printer Test: TikTok view = today's call (three arguments); Facebook view adds the view", () => {
    const { onTest } = mount();
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTest.mock.calls[0].length).toBe(3);
    expect(onTest.mock.calls[0].slice(1)).toEqual(["default", true]);
    fireEvent.click(screen.getByTestId("os-view-facebook"));
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTest.mock.calls[1].slice(1)).toEqual(["default", true, "facebook"]);
    expect(onTest.mock.calls[1][0]).toEqual(onTest.mock.calls[0][0]); // the same settings — the view changes none
    fireEvent.click(screen.getByTestId("os-view-tiktok"));
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTest.mock.calls[2].length).toBe(3);
  });
  it("admin language chips and the long-comment tests are as before in either view", () => {
    const onTestSample = vi.fn();
    const { onTest } = mount({ isAdmin: true, onTestSample });
    fireEvent.click(screen.getByTestId("os-view-facebook"));
    fireEvent.click(screen.getByTestId("os-test-en"));
    expect(onTest.mock.calls[0].length).toBe(3);
    expect(onTest.mock.calls[0][1]).toBe("en");
    fireEvent.click(screen.getByTestId("os-admin-lang-zh"));
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTestSample).toHaveBeenCalledTimes(1);
    expect(onTestSample.mock.calls[0][1]).toMatchObject({ key: "zh", platform: "TikTok" });
    expect(onTest).toHaveBeenCalledTimes(1);
    // while an admin test is picked the view buttons are off (the chip is the sample); clearing it brings the view back
    expect(pressed("facebook")).toBe("false");
    expect((screen.getByTestId("os-view-facebook") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("os-admin-lang-zh"));
    expect(pressed("facebook")).toBe("true");
    fireEvent.click(screen.getByTestId("os-admin-route-today"));
    expect(pressed("facebook")).toBe("false");
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTestSample.mock.calls[1][1]).toMatchObject({ key: "default", platform: "TikTok" }); // as before
  });
});
