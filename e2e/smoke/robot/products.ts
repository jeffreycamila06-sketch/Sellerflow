// Products: the robot's test product, found by its exact name; removed with the app's own
// Delete button (it confirms the "Delete this product?" question).
import type { Locator, Page } from "@playwright/test";
import { EN } from "./strings";
import { navTo } from "./nav";

export const productCard = (page: Page, name: string): Locator =>
  page.getByText(name, { exact: true }).locator('xpath=ancestor::div[.//button[starts-with(@data-testid,"stock-inc-")]][1]');

export async function deleteProductByName(page: Page, name: string): Promise<boolean> {
  await navTo(page, "products");
  const card = productCard(page, name);
  if (!(await card.count())) return true;                       // already gone
  page.once("dialog", (d) => { void d.accept(); });
  await card.first().getByRole("button", { name: EN.rd_prd_delete_btn, exact: true }).click();
  try { await page.getByText(name, { exact: true }).first().waitFor({ state: "detached", timeout: 10_000 }); } catch { return false; }
  await page.waitForTimeout(1500);                               // the cloud delete (a failure brings it back)
  return !(await productCard(page, name).count());
}
