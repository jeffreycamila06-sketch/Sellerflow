// 2026-11-22 — the word "Beta" is gone from every Shopee text a seller sees: the Live tile badge, the Settings →
// Channels Shopee box chip, and the lock / days-left lines. The rules behind them (beta row, 30 days, Admin turns it
// on) are unchanged; the admin card keeps its own "Shopee Beta" label (Admin screen only).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider, buildT } from "../i18n";
import ChannelsGrid from "../components/ChannelsGrid";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
// "Beta" as it was written in each language (the old rd_sh_beta values + the words inside the lock texts).
const BETA = /\bbeta\b|測試版|测试版|เบต้า|Бета/i;
const SELLER_PREFIXES = ["rd_sh_", "rd_shp_", "rd_ls_", "rd_cg_", "rd_ss_", "rd_lpk_"];

describe("no Beta in seller-facing Shopee texts (8 languages)", () => {
  it("the three reworded lines: same meaning, no Beta, {n} kept", () => {
    const en = buildT("en");
    expect(en.rd_sh_lock_ended).toBe("Shopee access ended — contact Admin");
    expect(en.rd_sh_lock_beta_only).toBe("Shopee only on your plan — upgrade to use TikTok/Facebook");
    expect(en.rd_sh_days_left).toBe("Shopee access · {n} days left");
    for (const lang of LANGS) {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const k of ["rd_sh_lock_ended", "rd_sh_lock_beta_only", "rd_sh_days_left"]) {
        expect(t[k], `${lang} ${k}`).toBeTruthy();
        expect(t[k], `${lang} ${k}`).not.toMatch(BETA);
      }
      expect(t.rd_sh_days_left, `${lang} rd_sh_days_left`).toContain("{n}");
      expect(t.rd_sh_lock_beta_only, `${lang}`).toContain("TikTok/Facebook");
    }
  });
  it("the badge word is gone (rd_sh_beta) and no Shopee / Live picker / Channels text says Beta", () => {
    for (const lang of LANGS) {
      const t = buildT(lang) as unknown as Record<string, string>;
      expect("rd_sh_beta" in t, lang).toBe(false);
      const hits = Object.keys(t).filter((k) => SELLER_PREFIXES.some((p) => k.startsWith(p)) && BETA.test(String(t[k])));
      expect(hits, lang).toEqual([]);
    }
  });
  it("the Admin screen's Shopee Beta row is gone (2026-11-23): its three texts are no longer in the app", () => {
    const en = buildT("en") as unknown as Record<string, string>;
    for (const k of ["rd_adm_shopee_beta", "rd_adm_shopee_beta_start", "rd_adm_shopee_beta_remove"]) expect(k in en, k).toBe(false);
  });
});

describe("no Beta badge on screen", () => {
  it("Settings → Channels: the Shopee box shows no Beta chip, on a phone or a laptop", () => {
    render(<TProvider lang="en"><ChannelsGrid input={{ tiktokNames: [], facebookName: null, instagram: { open: false, name: null }, shopee: { state: "open", name: "Shopee shop ·6789" } }} onOpen={() => {}} /></TProvider>);
    expect(document.querySelector(".sfl-cg-beta")).toBeNull();
    expect(screen.getByTestId("cg-shopee").textContent).not.toMatch(/beta/i);
    const css = readFileSync("src/redesign/redesign.css", "utf8");
    expect(css).not.toContain("sfl-cg-beta");
  });
  it("the Live tile has no badge in the source (lpk-beta) and no rd_sh_beta anywhere in the app", () => {
    const dash = readFileSync("src/redesign/screens/Dashboard.tsx", "utf8");
    expect(dash).not.toContain("lpk-beta");
    for (const f of ["src/redesign/screens/Dashboard.tsx", "src/redesign/components/ChannelsGrid.tsx", "src/redesign/RedesignApp.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toContain("rd_sh_beta");
    }
  });
});
