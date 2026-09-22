// Option E — the Live Source sheet renders every platform with correct gating:
// TikTok/Shopee connectable, Facebook = activation gate (Telegram anchor, never green),
// Instagram = coming-soon, Shopee row hidden when showShopee is false (non-TW market).
// A pick fires its handler (RedesignApp closes the sheet synchronously before connect).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import LiveSourceSheet, { type SourceState } from "../LiveSourceSheet";
import { TELEGRAM_URL } from "../../../lib/telegram";

const base = {
  open: true, onClose: vi.fn(), active: "TikTok" as const,
  tiktok: { name: "@shop_a", connected: false, connecting: false } as SourceState,
  shopee: { name: "Shop A", connected: false, connecting: false } as SourceState,
  onPickTikTok: vi.fn(), onPickShopee: vi.fn(),
};
const view = (over: Partial<Parameters<typeof LiveSourceSheet>[0]> = {}) =>
  render(<TProvider><LiveSourceSheet {...base} showShopee {...over} /></TProvider>);

describe("LiveSourceSheet", () => {
  it("open=false → renders nothing", () => {
    const { container } = render(<TProvider><LiveSourceSheet {...base} showShopee={false} open={false} /></TProvider>);
    expect(container.querySelector("[data-testid=livesource-sheet]")).toBeNull();
  });

  it("shows TikTok, Facebook (Telegram anchor), Instagram; Shopee when showShopee", () => {
    const { getByTestId } = view();
    expect(getByTestId("livesource-tiktok")).toBeTruthy();
    const fb = getByTestId("livesource-facebook") as HTMLAnchorElement;
    expect(fb.tagName).toBe("A");                       // non-connectable — a real anchor
    expect(fb.getAttribute("href")).toBe(TELEGRAM_URL); // to Telegram, never a connect
    expect(getByTestId("livesource-instagram")).toBeTruthy();
    expect(getByTestId("livesource-shopee")).toBeTruthy();
  });

  it("Shopee row HIDDEN when showShopee=false (non-TW market)", () => {
    const { queryByTestId } = view({ showShopee: false });
    expect(queryByTestId("livesource-shopee")).toBeNull();
  });

  it("tapping TikTok / Shopee fires their pick handlers", () => {
    const onPickTikTok = vi.fn(); const onPickShopee = vi.fn();
    const { getByTestId } = view({ onPickTikTok, onPickShopee });
    fireEvent.click(getByTestId("livesource-tiktok"));
    fireEvent.click(getByTestId("livesource-shopee"));
    expect(onPickTikTok).toHaveBeenCalledTimes(1);
    expect(onPickShopee).toHaveBeenCalledTimes(1);
  });

  it("tapping the backdrop closes the sheet", () => {
    const onClose = vi.fn();
    const { getByTestId } = view({ onClose });
    fireEvent.click(getByTestId("livesource-overlay"));
    expect(onClose).toHaveBeenCalled();
  });
});
