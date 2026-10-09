// Moving around the app the way a seller does: the bottom menu and the Settings tiles.
import type { Page } from "@playwright/test";
import { EN } from "./strings";

// Bottom menu (".sfl-nav"): Live, Sales, Orders, Products, Settings. Admin is never touched.
export async function navTo(page: Page, label: "live" | "sales" | "orders" | "products" | "settings"): Promise<void> {
  const nav = page.locator(".sfl-nav").first();
  if (label === "sales") { await page.locator('[data-testid="nav-sales"]').first().click(); return; }
  const text = { live: EN.rd_nav_live, orders: EN.rd_nav_orders, products: EN.rd_nav_products, settings: EN.rd_nav_settings }[label];
  await nav.getByRole("button", { name: text, exact: true }).first().click();
}

// A tile on the Settings menu, by its English words.
export async function openSettingsTile(page: Page, text: string): Promise<void> {
  await navTo(page, "settings");
  await page.getByRole("button", { name: text }).first().click();
}

export const tpl = (s: string, vars: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (_m, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
