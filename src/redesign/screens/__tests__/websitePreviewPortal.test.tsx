// Seller Website hotfix 2 — the preview is drawn ON TOP OF THE WHOLE APP. On main it sat inside the
// app's animated screen container (.sfl-anim-screen fades + slides every child; the app's styles
// reached the shop) and under the bottom bar: see-through, overlapping, bottom bar on top.
// Now: a portal to document.body, opaque, above everything, with its own Close bar.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import WebsiteEditor from "../WebsiteEditor";
import type { EditorApi } from "../../adapters/websiteEditorApi";
import { DEFAULT_SETTINGS } from "../../adapters/websiteEditor";

const SITE = { subdomain: "budgetukay", draft: { name: "BudgetUkay" }, published: { name: "BudgetUkay" }, publishedAt: "2026-11-14T02:00:00Z", settings: DEFAULT_SETTINGS, customDomain: null };
const api = (): EditorApi => ({ load: vi.fn(async () => SITE), save: vi.fn(async () => ({ ok: true as const })), publish: vi.fn(async () => ({ ok: true as const, at: "2026-11-15T00:00:00Z" })),
  subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => [{ id: 1, name: "Dress", price: 200, stock: 3, photos: [] }]) });

// The app wraps every screen like this (RedesignApp: data-redesign → .sfl-scroll.sfl-anim-screen; bottom bar = .sfl-nav)
function inAppShell() {
  return render(
    <div data-redesign="" className="sfl-stage">
      <div className="sfl-phone">
        <div className="sfl-scroll sfl-anim-screen" data-testid="screen-box">
          <TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={vi.fn()} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api()} /></TProvider>
        </div>
        <div className="sfl-nav" data-testid="app-bottom-bar" style={{ position: "fixed", bottom: 0, zIndex: 40 }} />
      </div>
    </div>,
  );
}

describe("Preview on top of the whole app", () => {
  it("is a direct child of document.body — not inside the animated screen box or [data-redesign]", async () => {
    inAppShell();
    fireEvent.click(await screen.findByTestId("wed-preview"));
    const sheet = await screen.findByTestId("wed-preview-sheet");
    expect(sheet.parentElement).toBe(document.body);
    expect(screen.getByTestId("screen-box").contains(sheet)).toBe(false);
    expect(sheet.closest("[data-redesign]")).toBeNull();
    expect(sheet.closest(".sfl-anim-screen")).toBeNull();
    expect(await within(sheet).findByTestId("shop-name")).toHaveTextContent("BudgetUkay");
  });

  it("is opaque, full screen, above the bottom bar, with a visible Close in its own bar", async () => {
    inAppShell();
    fireEvent.click(await screen.findByTestId("wed-preview"));
    const sheet = await screen.findByTestId("wed-preview-sheet");
    expect(sheet.style.position).toBe("fixed");
    expect(sheet.style.inset).toBe("0px");
    expect(sheet.style.opacity).toBe("1");
    expect(sheet.style.background).toMatch(/245, 245, 247|#F5F5F7/i);
    expect(Number(sheet.style.zIndex)).toBeGreaterThan(Number(screen.getByTestId("app-bottom-bar").style.zIndex));
    expect(Number(sheet.style.zIndex)).toBeGreaterThanOrEqual(5000);
    const close = within(sheet).getByTestId("wed-preview-close");
    expect(close).toHaveTextContent("Close preview");
    expect(within(sheet).getByTestId("wed-preview-body").contains(close)).toBe(false); // never covered by the shop
  });

  it("Close and Escape remove it from the page; the page can scroll again afterwards", async () => {
    inAppShell();
    fireEvent.click(await screen.findByTestId("wed-preview"));
    await screen.findByTestId("wed-preview-sheet");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.click(screen.getByTestId("wed-preview-close"));
    expect(screen.queryByTestId("wed-preview-sheet")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    fireEvent.click(screen.getByTestId("wed-preview"));
    await screen.findByTestId("wed-preview-sheet");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("wed-preview-sheet")).toBeNull();
    expect(document.body.childElementCount).toBe(1); // only the render container
  });

  it("source: the sheet goes through createPortal(…, document.body)", () => {
    const src = readFileSync("src/redesign/screens/WebsiteEditor.tsx", "utf8");
    expect(src).toMatch(/createPortal\(\s*<div data-testid="wed-preview-sheet"[\s\S]*?document\.body,\s*\)/);
  });
});
