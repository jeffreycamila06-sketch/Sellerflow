// Jeff 2026-11-10 (item 4): rd_os_sync_niimbot and rd_ps_custom_need_saved are gone — every language and every
// reference (a Niimbot and a device with nothing saved now pick the size in Printer settings' one size list).
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { buildT } from "../index";

const KEYS = ["rd_os_sync_niimbot", "rd_ps_custom_need_saved"];
describe("removed keys", () => {
  it("not in the i18n table, in no language", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const t = buildT(lang) as Record<string, unknown>;
      for (const k of KEYS) expect(t[k], `${lang} ${k}`).toBeUndefined();
    }
  });
  it("no reference left in the app code", () => {
    for (const f of ["src/redesign/RedesignApp.tsx", "src/redesign/screens/PrinterSettings.tsx", "src/redesign/i18n/index.tsx"]) {
      const src = fs.readFileSync(f, "utf8");
      for (const k of KEYS) expect(src.includes(k), `${f} ${k}`).toBe(false);
    }
  });
});
