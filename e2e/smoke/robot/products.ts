// Products: the robot's test product, found by its exact name; removed with the app's own
// Delete button (it confirms the "Delete this product?" question).
//
// The Products screen first shows this phone's saved copy, then the cloud list. A name that is
// "not there" only counts once the cloud list has arrived — otherwise a leftover could be
// missed, or a product reported removed that was never removed.
import { expect, type Locator, type Page } from "@playwright/test";
import { EN } from "./strings";
import { navTo } from "./nav";

export const productCard = (page: Page, name: string): Locator =>
  page.getByText(name, { exact: true }).locator('xpath=ancestor::div[.//button[starts-with(@data-testid,"stock-inc-")]][1]');

// Opens Products fresh (via Live, so the screen loads again) and waits for the app's own
// cloud list answer. false = that answer was not seen.
export async function openProductsLoaded(page: Page): Promise<boolean> {
  await navTo(page, "live");
  const loaded = page
    .waitForResponse((r) => r.url().includes("/rest/v1/products") && r.request().method() === "GET", { timeout: 15_000 })
    .then((r) => r.ok(), () => false);
  await navTo(page, "products");
  await expect(page.getByRole("button", { name: EN.rd_prd_add, exact: true })).toBeVisible();
  const ok = await loaded;
  await page.waitForTimeout(500); // the screen applies the answer
  return ok;
}

// true = gone (removed now, or already not in the loaded list). false = could not confirm.
export async function deleteProductByName(page: Page, name: string): Promise<boolean> {
  if (!(await openProductsLoaded(page))) return false;
  const card = productCard(page, name);
  if (!(await card.count())) return true;                       // not in the loaded list
  page.once("dialog", (d) => { void d.accept(); });
  await card.first().getByRole("button", { name: EN.rd_prd_delete_btn, exact: true }).click();
  try { await page.getByText(name, { exact: true }).first().waitFor({ state: "detached", timeout: 10_000 }); } catch { return false; }
  await page.waitForTimeout(1500);                               // the cloud delete (a failure brings it back)
  return !(await productCard(page, name).count());
}
