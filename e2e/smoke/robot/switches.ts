// The app reads its on/off switches (app_settings) once when it opens. The robot only WATCHES
// that answer — it never reads or changes the settings itself. true / false = the switch's
// value; null = the answer was not seen (or did not include that switch).
import type { Page } from "@playwright/test";

export function watchSwitch(page: Page, key: string): Promise<boolean | null> {
  return page
    .waitForResponse((r) => r.url().includes("/rest/v1/app_settings") && r.url().includes(key) && r.request().method() === "GET", { timeout: 30_000 })
    .then(async (r) => {
      const rows = (await r.json().catch(() => null)) as Array<{ key?: string; value?: unknown }> | null;
      if (!Array.isArray(rows)) return null;
      const row = rows.find((x) => x && x.key === key);
      return row ? row.value === "true" : false; // the app treats a missing row as OFF
    })
    .catch(() => null);
}
