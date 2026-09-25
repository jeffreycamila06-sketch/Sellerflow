// Live print pattern — the CENTER shop name is the seller's REAL Shop name (Settings →
// Basic Information), in the preview AND on paper. RedesignApp derives ONE value,
// printShopName = profile.storeName (trimmed) || "SellerFlowLive", and hands it to the
// preview + every print path. The small "SellerFlowLive" brand top-left is unchanged.
// These tests follow the real payload builders (bitmap raster + classic text TSPL +
// ESC/POS slip), not just the preview.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import PrintPattern, { DEFAULT_PP } from "../PrintPattern";
import { buildNativeStickerPayload, buildSlipPayload, DEF_SETTINGS } from "../../adapters/printing";
import { stickerDrawOps, emitTextTspl } from "../../adapters/stickerRaster";
import { buildTestBuyer } from "../../adapters/printerBridge";

const SHOP = "Budgetukay2";
const noop = () => {};

describe("preview shows the seller's real Shop name", () => {
  it("renders the passed shop name in the center; the SellerFlowLive brand stays top-left", () => {
    render(<TProvider><PrintPattern onBack={noop} pp={DEFAULT_PP} shopName={SHOP} onToggle={noop} onStep={noop} /></TProvider>);
    expect(screen.getByTestId("pp-preview-shop").textContent).toBe(SHOP);
    expect(screen.getByText("SellerFlowLive")).toBeTruthy();
    expect(screen.queryByText("Maria's Live Shop")).toBeNull();
  });
  it("the row label reads 'Comment / Price'", () => {
    render(<TProvider><PrintPattern onBack={noop} pp={DEFAULT_PP} shopName={SHOP} onToggle={noop} onStep={noop} /></TProvider>);
    expect(screen.getByText("Comment / Price")).toBeTruthy();
    expect(screen.queryByText("Comment (center)")).toBeNull();
  });
});

describe("the PRINTED slip carries the real Shop name on every device path", () => {
  const payload = buildNativeStickerPayload(buildTestBuyer(), "NT$", SHOP, DEF_SETTINGS);

  it("native sticker payload (BT/LAN, Android + iOS) carries it", () => {
    expect(payload.storeName).toBe(SHOP);
  });
  it("bitmap sticker: the shop name is drawn in the body, the brand stays top-left", () => {
    const { ops } = stickerDrawOps(payload, payload.labelWidthMm, payload.labelHeightMm);
    const texts = ops.filter((o) => o.k === "txt" || o.k === "cjk") as { s: string; x: number; y: number }[];
    const brand = texts.find((o) => o.s === "SellerFlowLive")!;
    expect(brand).toMatchObject({ x: 16, y: 10 });
    const shop = texts.find((o) => o.s === SHOP)!;
    expect(shop).toBeTruthy();
    expect(shop.y).toBeGreaterThan(brand.y);
  });
  it("classic text TSPL sticker prints it", () => {
    const bytes = emitTextTspl(payload, payload.labelWidthMm, payload.labelHeightMm, (s) => [...s].map((c) => c.charCodeAt(0)));
    expect(new TextDecoder("latin1").decode(bytes)).toContain(`"${SHOP}"`);
  });
  it("ESC/POS slip payload carries it", () => {
    expect(buildSlipPayload(buildTestBuyer(), "NT$", SHOP, DEF_SETTINGS).storeName).toBe(SHOP);
  });
});

describe("RedesignApp wires ONE value into the preview and every print path", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("printShopName = the profile's Shop name (trimmed), blank → SellerFlowLive", () => {
    expect(app).toContain('const printShopName = auth.profile?.profile.storeName?.trim() || "SellerFlowLive";');
  });
  it("live orders/reprints, the Printer Test, Print screen and the pattern preview all use it", () => {
    expect(app).toContain("storeName: printShopName,");                 // printCfgRef → printSlip / reprint
    expect(app).toContain("const storeName = printShopName;");          // Printer Test
    expect(app).toContain("shopName={printShopName}");                   // Live print pattern preview
    expect(app.match(/storeName=\{printShopName\}/g)?.length).toBe(2);   // Print screen + the other print consumer
    expect(app).not.toContain('profile.storeName || "SellerFlowLive"'); // no stray second derivation
  });
});
