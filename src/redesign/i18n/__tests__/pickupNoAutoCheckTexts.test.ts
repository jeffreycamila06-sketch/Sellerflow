// Pickup Status (2026-11-17): no check runs at Sync any more. The three texts that said new parcels
// are checked automatically keep only their true part, in all 8 languages — no new claims.
import { describe, it, expect } from "vitest";
import { buildT } from "../index";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
// "automatic(ally)" / "within a few minutes" in each language of the old texts
const AUTO = /automatic|awtomatiko|自动|自動|tự động|อัตโนมัติ|otomatis|автоматично|few minutes|ilang minuto|几分钟|幾分鐘|vài phút|ไม่กี่นาที|beberapa menit|няколко минути/i;
const KEYS = ["rd_pt_check_note", "rd_pt_sync_s4", "rd_pt_empty_s3"] as const;

describe("Pickup Status texts: no claim that new parcels are checked automatically", () => {
  it("English, exactly", () => {
    const t = buildT("en");
    expect(t.rd_pt_check_note).toBe("You can check again 12 hours after your last check.");
    expect(t.rd_pt_sync_s4).toBe("Usernames appear right away under In transit.");
    expect(t.rd_pt_empty_s3).toBe("Your parcels appear here.");
  });
  for (const lang of LANGS) {
    it(`${lang}: no automatic-check claim, nothing empty; s4 names the In transit tab`, () => {
      const t = buildT(lang);
      for (const k of KEYS) {
        expect(t[k], `${lang}.${k}`).toBeTruthy();
        expect(t[k], `${lang}.${k}`).not.toMatch(AUTO);
      }
      expect(t.rd_pt_sync_s4).toContain(t.rd_pt_tab_transit);
      expect(t.rd_pt_sync_s4).not.toContain(t.rd_pt_card_waiting);
    });
  }
});
