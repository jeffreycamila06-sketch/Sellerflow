// Printer setup guide modal (2026-07-23). Two variants: "wifi" (receipt printer,
// mentions IP) and "bt" (Bluetooth sticker printer — NO IP anywhere). Pins:
// title/steps render per kind; OK → onOk (reveal setup screen); ✕ → onClose (no
// proceed); BT guide has no IP-address content; all new keys filled in 7 langs.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PrinterGuideModal from "../PrinterGuideModal";
import { TProvider, buildT } from "../../i18n";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"];
const t = buildT("en") as unknown as Record<string, string>;

const renderGuide = (kind: "wifi" | "bt", over: { onOk?: () => void; onClose?: () => void } = {}) =>
  render(
    <TProvider lang="en">
      <PrinterGuideModal kind={kind} onOk={over.onOk ?? (() => {})} onClose={over.onClose ?? (() => {})} />
    </TProvider>,
  );

describe("PrinterGuideModal", () => {
  it("WiFi guide shows the WiFi title + 4 steps", () => {
    renderGuide("wifi");
    expect(screen.getByText(t.rd_wg_title)).toBeTruthy();
    for (const s of [t.rd_wg_1, t.rd_wg_2, t.rd_wg_3, t.rd_wg_4]) expect(screen.getByText(s)).toBeTruthy();
  });

  it("BT guide shows the BT title + 4 steps and NO IP address anywhere", () => {
    renderGuide("bt");
    expect(screen.getByText(t.rd_bg_title)).toBeTruthy();
    for (const s of [t.rd_bg_1, t.rd_bg_2, t.rd_bg_3, t.rd_bg_4]) expect(screen.getByText(s)).toBeTruthy();
    // The BT guide must be Bluetooth-specific — no IP/port language leaking in.
    expect(screen.queryByText(/IP address|9100|WiFi|Wi-Fi/i)).toBeNull();
    expect(screen.getByTestId("printer-guide-bt")).toBeTruthy();
  });

  it("OK button calls onOk (reveals the setup screen)", () => {
    const onOk = vi.fn();
    renderGuide("wifi", { onOk });
    fireEvent.click(screen.getByTestId("printer-guide-ok"));
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("✕ calls onClose (dismiss without proceeding), not onOk", () => {
    const onOk = vi.fn(), onClose = vi.fn();
    renderGuide("bt", { onOk, onClose });
    fireEvent.click(screen.getByTestId("printer-guide-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it("OK is an INTERNAL button (in-app nav), not an anchor", () => {
    renderGuide("wifi");
    const ok = screen.getByTestId("printer-guide-ok");
    expect(ok.tagName).toBe("BUTTON");
    expect(ok.getAttribute("href")).toBeNull();
  });

  it("every new key is filled in all 7 languages", () => {
    const keys = ["rd_pg_ok", "rd_wg_title", "rd_wg_1", "rd_wg_2", "rd_wg_3", "rd_wg_4", "rd_bg_title", "rd_bg_1", "rd_bg_2", "rd_bg_3", "rd_bg_4", "rd_ps_bt_none"];
    for (const lang of LANGS) {
      const tt = buildT(lang) as unknown as Record<string, string>;
      for (const k of keys) expect(tt[k] && tt[k].trim().length, `${k}/${lang}`).toBeTruthy();
      if (lang !== "en") expect(tt.rd_bg_title).not.toBe(t.rd_bg_title);
    }
  });
});
