// BULGARIAN (bg, 2026-09-26) — the 8th language, redesign-only: it lives
// entirely in the RAW supplement (translations.ts untouched, "import only").
// Pins the four things that would silently break a Bulgarian seller:
// coverage, interpolation parity, the production-base English fallback, and
// the picker entry. NOTE the deliberate literals: brand/feature names
// (TikTok, 1-Click, Miners, AIMO…), NT$ business prices, and the
// state-equality identifiers stay English in bg exactly like the other langs.
import { describe, it, expect } from "vitest";
import { REDESIGN_STRINGS, buildT, normalizeLang } from "../index";
import { LANGS } from "../../data";

const phOf = (s: string) => (s.match(/\{(\w+)\}/g) || []).sort();

describe("Bulgarian (bg) — coverage + safety", () => {
  it("every key has a non-blank bg value (same count as en)", () => {
    const en = REDESIGN_STRINGS.en, bg = REDESIGN_STRINGS.bg;
    expect(Object.keys(bg).length).toBe(Object.keys(en).length);
    for (const k of Object.keys(en)) {
      expect(bg[k], `blank bg for ${k}`).toBeTruthy();
      expect(String(bg[k]).trim().length).toBeGreaterThan(0);
    }
  });

  it("every {placeholder} in en exists identically in bg (no broken interpolations)", () => {
    const en = REDESIGN_STRINGS.en, bg = REDESIGN_STRINGS.bg;
    for (const k of Object.keys(en)) {
      expect(phOf(bg[k]), `placeholder drift in ${k}`).toEqual(phOf(en[k]));
    }
  });

  it("bg actually translates (not an en copy): spot checks", () => {
    const bg = REDESIGN_STRINGS.bg;
    expect(bg.rd_ord_title).toBe("Поръчки");
    expect(bg.rd_nav_live).toBe("Лайв");
    expect(bg.rd_set_language).toBe("Език");
    // deliberate English-in-all-langs stays English in bg too:
    expect(bg.rd_sup_g5_body).toBe(REDESIGN_STRINGS.en.rd_sup_g5_body);
  });

  it("buildT('bg'): rd_* keys are Bulgarian; production-only keys fall back to ENGLISH (never undefined)", () => {
    const t = buildT("bg");
    expect(t.rd_ord_title).toBe("Поръчки");
    // the 4 production keys the redesign uses (Landing + AuthBrandPanel):
    for (const k of ["lp_login", "lp_feat_capture_t", "lp_feat_print_t", "lp_feat_orders_t"] as const) {
      expect(t[k], `production key ${k} must not be blank in bg`).toBeTruthy();
      expect(t[k]).toBe(buildT("en")[k]); // English fallback, by design
    }
  });

  it("the picker has the bg entry and normalizeLang round-trips it", () => {
    const entry = LANGS.find((l) => l.code === "bg");
    expect(entry).toBeTruthy();
    expect(entry!.label).toBe("Български");
    expect(normalizeLang("bg")).toBe("bg");
  });

  it("the 7 existing languages are byte-untouched by the bg addition (spot check)", () => {
    expect(REDESIGN_STRINGS.en.rd_ord_title).toBe("Orders");
    expect(REDESIGN_STRINGS["zh-TW"].rd_ord_title).toBe("訂單");
    expect(REDESIGN_STRINGS.fil.rd_nav_live).toBeTruthy();
  });
});
