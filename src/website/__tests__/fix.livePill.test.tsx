// Fix (b): the red "LIVE" tag was grey text on red (1.05 : 1 on a light shop, 1.75 : 1 on a dark one) because
// the rule for the grey line under it also matched the tag. It must read at 4.5 : 1 or better in every look.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ShopApp from "../ShopApp";
import { V2_CSS } from "../v2/styles";
import { DEMO_SHOP } from "./fixtures";
import type { Shop } from "../shopApi";

const lum = (h: string) => { const n = parseInt(h.slice(1), 16); const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (rgb: string) => "#" + (rgb.match(/\d+/g) || []).slice(0, 3).map((v) => Number(v).toString(16).padStart(2, "0")).join("");

describe("the LIVE tag is readable", () => {
  it("the style sheet: the tag's own colour rule beats the grey line's rule", () => {
    const grey = V2_CSS.indexOf(".sfl-v2 .v-live .v-tx span{color:var(--s-mut)");
    const tag = V2_CSS.indexOf(".sfl-v2 .v-live .v-tx .v-pill{color:#fff}");
    expect(grey).toBeGreaterThan(-1);
    expect(tag).toBeGreaterThan(grey); // later AND more specific (4 classes vs 3 classes + a tag)
    expect(V2_CSS).toContain(".sfl-v2 .v-live .v-pill{background:#e11d48;color:#fff;");
    expect(contrast("#ffffff", "#e11d48")).toBeGreaterThanOrEqual(4.5);
  });
  const looks: [string, Shop][] = [
    ["a shop with no look (Pop)", DEMO_SHOP],
    ["a dark shop (Bold)", { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, theme: "bold" } }],
    ["Brand store, light", { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, look: { layout: "brand", top1: "#1f4fa8", top2: "#8b5cf6", btn: "#111111", sale: "#dc2626", dark: false, font: "modern", corners: "sharp" } } }],
    ["Marketplace, dark", { ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, look: { layout: "market", top1: "#0b0b0f", top2: "#4c1d95", btn: "#d7ff3e", sale: "#fb7185", dark: true, font: "modern", corners: "sharp" } } }],
  ];
  for (const [name, shop] of looks) {
    it(`${name}: white on red in the page itself, 4.5 : 1 or better`, () => {
      const { unmount } = render(<ShopApp preview={shop} nowMs={Date.parse("2026-11-16T08:00:00Z")} />);
      const pill = screen.getByTestId("shop-live").querySelector(".v-pill") as HTMLElement;
      const cs = getComputedStyle(pill);
      expect(hex(cs.color)).toBe("#ffffff");
      expect(contrast(hex(cs.color), hex(cs.backgroundColor))).toBeGreaterThanOrEqual(4.5);
      unmount();
    });
  }
});
