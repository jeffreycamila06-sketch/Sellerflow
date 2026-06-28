// AuthBrandPanel — purely visual brand panel for the web auth split-screen. Proves it
// uses the REAL logo asset (/icon-192.png, not a glyph), the reused tagline keys, and the
// 3 reused feature checkmark titles. No auth/state.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthBrandPanel from "../AuthBrandPanel";
import { TProvider } from "../../i18n";

const renderPanel = () =>
  render(
    <TProvider lang="en">
      <AuthBrandPanel />
    </TProvider>,
  );

describe("AuthBrandPanel", () => {
  it("uses the real bag logo asset (/icon-192.png, not an icon glyph)", () => {
    renderPanel();
    const img = screen.getByAltText("SellerFlowLive") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/icon-192.png");
  });

  it("shows the wordmark + reused tagline", () => {
    renderPanel();
    expect(screen.getByText("SellerFlowLive")).toBeTruthy();
    expect(screen.getByText("Stop typing.")).toBeTruthy();   // rd_lp_hero_l1
    expect(screen.getByText("Start selling.")).toBeTruthy(); // rd_lp_hero_l2
  });

  it("shows the 3 reused feature checkmarks", () => {
    renderPanel();
    expect(screen.getByText("Live Comment Capture")).toBeTruthy(); // lp_feat_capture_t
    expect(screen.getByText("1-Click Print")).toBeTruthy();        // lp_feat_print_t
    expect(screen.getByText("Order Management")).toBeTruthy();      // lp_feat_orders_t
  });
});
