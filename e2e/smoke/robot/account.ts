// Which account is the app signed in to? Read from the app's own saved session (the same
// storage the app uses: localStorage "sf_supabase_auth"). Lower-cased. "" = not signed in.
import type { Page } from "@playwright/test";
import { secrets } from "./config";

export async function signedInEmail(page: Page): Promise<string> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("sf_supabase_auth");
      const s = raw ? JSON.parse(raw) : null;
      const e = s && s.user && typeof s.user.email === "string" ? s.user.email : "";
      return e.trim().toLowerCase();
    } catch { return ""; }
  });
}

// The guard every test runs before it touches anything (throws = the test stops).
export async function assertRobotAccount(page: Page): Promise<void> {
  const who = await signedInEmail(page);
  if (!who || who !== secrets().email.toLowerCase()) {
    throw new Error("SAFETY STOP: the app is not signed in to the robot's test account. Nothing was touched.");
  }
}
