// i18n plumbing tests (Step 2) — pure shim/merge logic + the TProvider/useT context.
// No screen strings are converted yet; this only proves the wiring + reuse work.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { normalizeLang, applySupplement, buildT, tpl, REDESIGN_STRINGS, TProvider, useT } from "../index";
import { TRANSLATIONS, type T } from "../../../translations";

describe("normalizeLang — redesign picker code → production Lang", () => {
  it("shims lowercase zh-tw → zh-TW (case-insensitive)", () => {
    expect(normalizeLang("zh-tw")).toBe("zh-TW");
    expect(normalizeLang("ZH-TW")).toBe("zh-TW");
    expect(normalizeLang(" zh-tw ")).toBe("zh-TW");
  });
  it("passes the other 6 languages through", () => {
    for (const c of ["en", "fil", "zh", "vi", "th", "id"]) expect(normalizeLang(c)).toBe(c);
    expect(normalizeLang("EN")).toBe("en");
  });
  it("falls back to en for unknown/empty", () => {
    expect(normalizeLang("")).toBe("en");
    expect(normalizeLang("xx")).toBe("en");
    expect(normalizeLang("klingon")).toBe("en");
  });
});

describe("applySupplement — supplement (new keys) wins over production base", () => {
  it("merges + overrides", () => {
    const base = { a: "prod-a", b: "prod-b" } as unknown as T;
    const out = applySupplement(base, { b: "new-b", c: "new-c" });
    expect(out).toMatchObject({ a: "prod-a", b: "new-b", c: "new-c" });
  });
});

describe("buildT — merged dictionary per language", () => {
  it("reuses production keys verbatim (no duplication)", () => {
    expect(buildT("en").nav_live).toBe(TRANSLATIONS.en.nav_live);
    expect(buildT("zh").nav_live).toBe(TRANSLATIONS.zh.nav_live);
  });
  it("zh-tw resolves to production zh-TW (verified auth key + English fallback elsewhere)", () => {
    expect(buildT("zh-tw").login_title).toBe(TRANSLATIONS["zh-TW"].login_title); // verified Traditional
    expect(buildT("zh-tw").nav_live).toBe(TRANSLATIONS["zh-TW"].nav_live);       // English fallback (matches prod)
  });
  it("layers an injected supplement on top of production keys (supplement wins)", () => {
    const supp = { ...REDESIGN_STRINGS, en: { brand_new_key: "Hi", nav_live: "OVERRIDE" } };
    const t = buildT("en", supp);
    expect(t.brand_new_key).toBe("Hi");        // new redesign key
    expect(t.nav_live).toBe("OVERRIDE");       // supplement wins over production
  });
  it("every new key exists in ALL 7 languages (no blanks in any language)", () => {
    const langs = Object.keys(REDESIGN_STRINGS) as (keyof typeof REDESIGN_STRINGS)[];
    const enKeys = Object.keys(REDESIGN_STRINGS.en);
    for (const lang of langs) {
      for (const k of enKeys) {
        expect(REDESIGN_STRINGS[lang][k], `${String(lang)} missing key ${k}`).toBeTruthy();
      }
    }
  });
});

describe("Legal screen keys (Step 3) — behavior identical for en", () => {
  it("en values exactly match the previously-hardcoded English", () => {
    const t = buildT("en");
    expect(t.lg_pt_title).toBe("Privacy & Terms");
    expect(t.lg_updated).toBe("Last updated Jun 1, 2026");
    expect(t.lg_collect_h).toBe("1. Data we collect");
    expect(t.lg_use_h).toBe("2. How we use it");
    expect(t.lg_rights_h).toBe("3. Your rights");
    expect(t.lg_contact_h).toBe("4. Contact");
    expect(t.lg_contact_pre).toBe("Questions? Reach us on Telegram ");
    expect(t.lg_contact_post).toBe(" or email privacy@sellerflowlive.app.");
    expect(t.lg_collect_p).toContain("public live-stream comments");
  });
  it("zh-tw resolves the new legal keys (native-verified) — non-empty, not falling back blank", () => {
    const t = buildT("zh-tw");
    expect(t.lg_pt_title).toBe("隱私與條款");
    expect(t.lg_collect_h).toBeTruthy();
  });
});

describe("en values are byte-exact for the shipped English (no en drift)", () => {
  const t = buildT("en");
  it("matches the previously-hardcoded English across screens (spot-check)", () => {
    // Wave 1
    expect(t.rd_sup_title).toBe("Support");
    expect(t.rd_sub_renew_tg).toBe("Renew via Telegram");
    expect(t.rd_del_confirm_btn).toBe("Delete my account");
    expect(t.rd_cap_near_title).toBe("You're almost there!");
    // Wave 2
    expect(t.rd_ord_loading).toBe("Loading today’s orders…");
    expect(t.rd_cus_archive).toBe("Comment archive");
    expect(t.rd_prd_status_will).toBe("Status will be: ");
    expect(t.rd_min_sub).toBe('Buyers who claimed "mine"');
    expect(t.rd_sal_rev_platform).toBe("Revenue by platform");
    expect(t.rd_cd_foot_post).toBe(". Export access is logged.");
    expect(t.rd_export).toBe("⬇ Export");
    // Wave 3 (Dashboard)
    expect(t.rd_dash_session).toBe("Session");
    expect(t.rd_dash_waiting).toBe("Waiting for live comments…");
    expect(t.rd_dash_1click).toBe("1-Click");
    // Wave 4 (settings)
    expect(t.rd_set_save_changes).toBe("Save changes");
    expect(t.rd_auto_codes_title).toBe("Code → product");
    expect(t.rd_pp_save_settings).toBe("Save settings");
    expect(t.rd_ps_test_print).toBe("Test Print");
    expect(t.rd_back).toBe("‹ Back");
    // Wave 5
    expect(t.rd_cm_connect_x).toBe("Connect {tab}");
    expect(t.rd_pr_print_all).toBe("🖨 Print all ({n})");
    expect(t.rd_ship_sub).toBe("Today's shipments · 7-ELEVEN MyShip export");
    // Wave 6 (Admin)
    expect(t.rd_adm_title).toBe("Admin panel");
    expect(t.rd_adm_confirm).toBe("Admin action:\n{label}\nTarget: {email}\n\nContinue?");
    expect(t.rd_adm_act_delete).toBe("DELETE seller profile");
    // Wave 7 (auth)
    expect(t.rd_login_hero_title).toBe("Turn every live comment into a paid order.");
    expect(t.rd_su_have_account).toBe("Already have an account?");
    expect(t.rd_terms).toBe("Terms");
  });
  it("tpl interpolates placeholders in en (matches the old template output)", () => {
    expect(tpl(t.rd_cap_near_msg, { left: 5, cap: 100 })).toBe("Only 5 of your 100 free orders left. Upgrade for unlimited orders.");
    expect(tpl(t.rd_pr_print_all, { n: 7 })).toBe("🖨 Print all (7)");
    expect(tpl(t.rd_adm_act_setplan, { plan: "Pro" })).toBe("Set plan → Pro");
  });
});

function Probe() { const t = useT(); return <span>{t.nav_live}</span>; }

describe("TProvider / useT context", () => {
  it("provides the merged t to descendants for the given lang", () => {
    render(<TProvider lang="zh"><Probe /></TProvider>);
    expect(screen.getByText(TRANSLATIONS.zh.nav_live)).toBeTruthy();
  });
  it("applies the zh-tw shim through the provider", () => {
    render(<TProvider lang="zh-tw"><Probe /></TProvider>);
    expect(screen.getByText(TRANSLATIONS["zh-TW"].nav_live)).toBeTruthy();
  });
});
