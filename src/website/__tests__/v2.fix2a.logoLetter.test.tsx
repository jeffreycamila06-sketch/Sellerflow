// Seller Website v2 — preview difference 2a: the round shop logo LETTER in the header (no logo picture
// uploaded) is drawn in the THEME's colour — Boutique green #2f4a3a, Bold lime #d7ff3e, Pop orange — like
// the preview, unless the seller picked their own shop colour (then that colour). An uploaded logo picture
// is shown as the seller made it. (The old pictures showed an orange "B" on Boutique / Bold because the
// screenshot harness gave the demo shop an uploaded orange logo picture; docs/design/seller-website-v2/fix-2ab.)
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import ShopApp from "../ShopApp";
import type { Shop } from "../shopApi";
import { DEMO_SHOP } from "./fixtures";

const shopOf = (theme: string, extra: Partial<Shop["shop"]> = {}): Shop => ({ ...DEMO_SHOP, shop: { ...DEMO_SHOP.shop, lang: "en", logo: undefined, color: undefined, theme, ...extra } });
const css = readFileSync("src/website/v2/styles.ts", "utf8");
const themeAcc = (cls: string) => (css.match(new RegExp(`\\.sfl-v2\\.${cls}\\{[^}]*--s-acc:(#[0-9a-f]{6})`, "i")) || [])[1];

describe("header logo letter", () => {
  it("the letter's circle is painted with the shop's accent variable", () => {
    expect(css).toMatch(/\.sfl-v2 \.v-logo i\{[^}]*background:var\(--s-acc\)[^}]*color:var\(--s-on\)/);
    expect([themeAcc("t-pop"), themeAcc("t-bou"), themeAcc("t-bold")]).toEqual(["#ee4d2d", "#2f4a3a", "#d7ff3e"]); // = the preview's
  });
  for (const [theme, cls] of [["boutique", "t-bou"], ["bold", "t-bold"], ["pop", "t-pop"]] as const) {
    it(`${theme}, no colour picked: the letter, in the theme's colour (nothing overrides it)`, () => {
      render(<ShopApp preview={shopOf(theme)} />);
      const root = screen.getByTestId("shop-root");
      expect(root.className).toContain(cls);
      expect(root.style.getPropertyValue("--s-acc")).toBe("");
      const logo = screen.getAllByTestId("shop-logo")[0];
      expect(within(logo).queryByRole("img")).toBeNull();
      const letter = logo.querySelector("i")!;
      expect(letter.textContent).toBe("B");
      expect(letter.getAttribute("style")).toBeNull();
    });
  }
  it("Boutique / Bold with the seller's own colour: that colour (and readable text on it)", () => {
    const { unmount } = render(<ShopApp preview={shopOf("boutique", { color: "#7C3AED" })} />);
    expect(screen.getByTestId("shop-root").style.getPropertyValue("--s-acc")).toBe("#7C3AED");
    expect(screen.getByTestId("shop-root").style.getPropertyValue("--s-on")).toBe("#ffffff");
    unmount();
    render(<ShopApp preview={shopOf("bold", { color: "#FDE68A" })} />);
    expect(screen.getByTestId("shop-root").style.getPropertyValue("--s-acc")).toBe("#FDE68A");
    expect(screen.getByTestId("shop-root").style.getPropertyValue("--s-on")).toBe("#0e0f12");
  });
  it("an uploaded logo picture is shown instead of the letter", () => {
    render(<ShopApp preview={shopOf("boutique", { logo: "u1/site-logo-1.jpg" })} />);
    const logo = screen.getAllByTestId("shop-logo")[0];
    expect(logo.querySelector("img")).not.toBeNull();
    expect(logo.querySelector("i")).toBeNull();
  });
});
