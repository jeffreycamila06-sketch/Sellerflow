// Parcel Scan, Customer Details and Pickup Status — the Settings tiles that open them, the
// buyer-contact picker (one row of platform buttons + one input), and the manual-entry form.
//
// SAFETY: nothing here presses Save. A saved parcel can reach the parcel checker and the
// 7-11 export, so every Parcel Scan check is type-and-look only: the robot fills the form,
// reads the messages and the Save button's state, then presses Cancel. Pickup Status is
// read-only (it reads where a button would go; it never taps one).
import { expect, type Page } from "@playwright/test";
import { openHub } from "./settings";

export type ParcelTile = "parcelscan" | "customerdetails" | "parceltracking";
export type TileState = "open" | "locked" | "hidden";

// Opens a Settings tile. "locked" = the tile is there but the plan does not include it (the
// robot never taps a locked tile — it opens an upsell); "hidden" = not offered to this account.
export async function openParcelTile(page: Page, tile: ParcelTile): Promise<TileState> {
  await openHub(page);
  const open = page.getByTestId(`tile-${tile}`);
  const locked = page.getByTestId(`tile-${tile}-locked`);
  // The parcel tiles depend on an access list that loads a moment after Settings opens (a paid
  // account first shows nothing or "Soon"), so wait up to 15 s for the open or locked tile
  // before calling it hidden.
  await open.or(locked).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  if (await open.count()) { await open.first().click(); return "open"; }
  if (await locked.count()) return "locked";
  return "hidden";
}

export const CONTACT_PLATFORMS = ["tiktok", "line", "whatsapp", "facebook", "instagram", "other"] as const;
export type ContactPlatform = (typeof CONTACT_PLATFORMS)[number];

// The buyer-contact picker by its testid prefix ("ps-bc" on Parcel Scan, "cd-edit-bc" in the
// Customer Details edit form). present() = the account has the buyer contact feature.
export function contactField(page: Page, prefix: string) {
  const input = page.getByTestId(`${prefix}-input`);
  return {
    present: async (): Promise<boolean> => (await page.getByTestId(`${prefix}-field`).count()) > 0,
    pick: async (p: ContactPlatform): Promise<void> => {
      await page.getByTestId(`${prefix}-pick-${p}`).click();
      await expect(page.getByTestId(`${prefix}-pick-${p}`)).toHaveAttribute("aria-checked", "true");
    },
    input,
    type: async (p: ContactPlatform, value: string): Promise<void> => {
      await page.getByTestId(`${prefix}-pick-${p}`).click();
      await input.fill(value);
    },
    // Pastes text the way a phone does: a real paste event carrying the text (no keyboard, no
    // system clipboard — the app's own paste handler decides what lands in the box).
    paste: async (text: string): Promise<void> => {
      await input.evaluate((el, t) => {
        const d = new DataTransfer(); d.setData("text/plain", t);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: d, bubbles: true, cancelable: true }));
      }, text);
    },
    error: page.getByTestId(`${prefix}-err`),
    maxHint: page.getByTestId(`${prefix}-max`),
    value: (): Promise<string> => input.inputValue(),
  };
}

// Parcel Scan's manual-entry form (no camera, no AI scan). Returns false when the form cannot
// be opened (the pending batch is full — the app disables the button).
export async function openManualEntry(page: Page): Promise<boolean> {
  const btn = page.getByTestId("ps-manual");
  await expect(btn).toBeVisible();
  if (!(await btn.isEnabled())) return false;
  await btn.click();
  await expect(page.getByTestId("ps-confirm")).toBeVisible();
  return true;
}

// Fills the parcel fields with sample values so only the contact decides the Save state.
export async function fillParcelSample(page: Page): Promise<void> {
  await page.getByTestId("ps-name").fill("王小美");
  await page.getByTestId("ps-phone").fill("0912345678");
  await page.getByTestId("ps-store").fill("266402");
  await page.getByTestId("ps-amount").fill("550");
}

// Leaves the manual form WITHOUT saving (Cancel clears it). The form must be gone after.
export async function cancelManualEntry(page: Page): Promise<void> {
  const cancel = page.getByTestId("ps-manual-cancel");
  if (await cancel.count()) await cancel.click();
  await expect(page.getByTestId("ps-confirm")).toHaveCount(0);
}

// How many parcels are in the pending list right now (to prove nothing was added).
export const pendingParcelCount = (page: Page): Promise<number> => page.getByTestId("ps-row").count();

export const saveButton = (page: Page) => page.getByTestId("ps-save");

// Where a Pickup Status button may go. Anything else is wrong (it could open a stranger).
export const ALLOWED_PICKUP_LINKS = [
  "https://wa.me/",
  "https://line.me/R/ti/p/~",
  "https://m.me/",
  "https://www.facebook.com/profile.php?id=",
  "https://www.facebook.com/share/",
  "https://ig.me/m/",
  "https://www.tiktok.com/@",
];
export const linkAllowed = (href: string): boolean => ALLOWED_PICKUP_LINKS.some((p) => href.startsWith(p));
