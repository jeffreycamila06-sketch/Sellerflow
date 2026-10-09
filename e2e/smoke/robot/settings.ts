// The Settings menu (hub) and the General Settings screen — most screens are reached from here.
import { expect, type Page } from "@playwright/test";
import { EN } from "./strings";
import { navTo } from "./nav";

// Settings hub (bottom menu → Settings). Its own line under the title tells it apart from
// General Settings, which also has the header "Settings".
export async function openHub(page: Page): Promise<void> {
  await navTo(page, "settings");
  await expect(page.getByText(EN.rd_sh_sub, { exact: true }).first()).toBeVisible();
}
export async function openGeneral(page: Page): Promise<void> {
  await openHub(page);
  await page.getByRole("button", { name: EN.rd_sh_general }).first().click();
  await expect(page.getByTestId("ls-header")).toBeVisible();
}
// The "Live session" group in General Settings (collapsed by default).
export async function openLiveSessionGroup(page: Page): Promise<void> {
  if (!(await page.getByTestId("ls-body").isVisible().catch(() => false))) await page.getByTestId("ls-header").click();
  await expect(page.getByTestId("ls-body")).toBeVisible();
}
// General Settings → Channels → "TikTok Live" / "Facebook Live".
export async function openChannel(page: Page, which: "tiktok" | "facebook"): Promise<void> {
  await openGeneral(page);
  await page.getByRole("button").filter({ hasText: which === "tiktok" ? EN.rd_ch_tiktok_live : EN.rd_ch_facebook_live }).first().click();
}
