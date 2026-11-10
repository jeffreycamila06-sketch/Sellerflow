// printer-guardian review of small-fixes-nov10 (2026-11-10): a phone that now prints over WiFi but still has a Niimbot
// saved reaches today's size list (Live print pattern → Change → WiFi tab). The pick must NOT change the saved Niimbot
// sticker size (B3S 70×50 → 60×40 would print the wrong size on the Niimbot later; an unknown Niimbot would even take
// 100×60). The size is kept, as on main, and the message says where to change it (rd_os_nb_size_kept, 8 languages).
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { syncOneStickerSizeFromPrinter, saveOneSticker, readSavedOneSticker, __resetOneStickerState } from "../oneStickerPrint";
import { recommendedSettings } from "../oneSticker";
import { buildT } from "../../i18n";

afterEach(() => { localStorage.clear(); __resetOneStickerState(); });

describe("WiFi pick with a Niimbot still saved", () => {
  for (const [name, saved, pickLabel] of [["B3S", { w: 70, h: 50 }, "60x40mm"], ["an unknown Niimbot", { w: 50, h: 30 }, "100x60mm (Standard)"]] as const) {
    it(`${name}: the saved Niimbot sticker keeps ${saved.w}×${saved.h}`, () => {
      saveOneSticker(recommendedSettings(saved));
      const r = syncOneStickerSizeFromPrinter(pickLabel, { printerName: name === "B3S" ? "B3S-P1" : "NB-UNKNOWN", niimbot: true, devicePath: "wifi" });
      expect(r.status).toBe("kept");
      expect(r.status === "kept" && r.reason).toBe("niimbot");
      expect(readSavedOneSticker()!.size).toEqual(saved);
    });
  }
  it("RedesignApp passes the saved Niimbot to that sync (same call as main) and shows rd_os_nb_size_kept", () => {
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("const sync = syncOneStickerSizeFromPrinter(s, { printerName: savedBtPrinter()?.name ?? null, niimbot: savedIsNiimbot(), devicePath:");
    expect(app).toContain('sync.reason === "niimbot" ? tpl(tApp.rd_os_nb_size_kept, { size })');
  });
  it("the message is in all 8 languages and no longer points to the Live print pattern", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const s = (buildT(lang) as Record<string, string>).rd_os_nb_size_kept;
      expect(s, lang).toContain("{size}");
      expect(s, lang).not.toMatch(/Live print pattern/i);
    }
  });
});

describe("item 1 toast: the QR going off is said when nothing was saved too", () => {
  it("RedesignApp adds the QR note when the pick turned the new sticker QR off (nothing saved)", () => {
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("const newQrOff = markOneStickerQrOffAfterPick(r.saved, r.size, isStickerQrOn());");
    expect(app).toContain("(qrBefore && r.saved && !r.saved.qr) || newQrOff ? `${saidSaved} · ${tApp.rd_os_qr_min_size}` : saidSaved");
  });
});
