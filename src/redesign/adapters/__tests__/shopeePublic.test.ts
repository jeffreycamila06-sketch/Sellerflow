// Shopee Live for every seller (sql/206) — the app's rules, without a screen.
//   OFF (the switch is 'false', no preview key, not an admin) = MAIN: what a seller sees is compared, case by
//   case, with main's own three lines (copied below from main 8a237c68).
//   ON: the Shopee box for every seller in a TW / PH market; an active beta row keeps today's rules; an ended
//   row locks nothing.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { shopeeBetaAccess, shopeeBetaLocks, shopeePublicVisible, shopeeSellerView, freeCapAppliesTo, type ShopeeBetaRow } from "../shopeeBeta";
import { shopeeLinkFailOf, shopeeLinkErrKey, SHOPEE_LINK_ERR_KEY, isShopeeLimitFail, type ShopeeLinkFail } from "../shopeeLink";
import { parseSwitches, SWITCHES_OFF, FEATURE_SWITCH_KEYS } from "../featureSwitches";
import { FEATURE_KEYS } from "../featureAccess";
import { buildT } from "../../i18n";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-23T04:00:00Z");
const ROWS: Record<string, ShopeeBetaRow | null> = {
  none: null,
  active: { expiresAt: new Date(NOW + 12 * DAY).toISOString(), shopeeUid: "1" },
  ended: { expiresAt: new Date(NOW - 2 * DAY).toISOString(), shopeeUid: "1" },
};
const acc = (isAdmin: boolean, row: keyof typeof ROWS) => shopeeBetaAccess({ isAdmin, row: ROWS[row], now: NOW });

describe("who has it", () => {
  it("the switch, OR the preview key, OR an admin — nothing else", () => {
    for (const isAdmin of [false, true]) for (const previewKey of [false, true]) for (const switchOn of [false, true]) {
      expect(shopeePublicVisible({ isAdmin, previewKey, switchOn })).toBe(isAdmin || previewKey || switchOn);
    }
    expect(shopeePublicVisible({ isAdmin: false, previewKey: false, switchOn: false })).toBe(false);
  });
  it("the switch is app_settings 'shopee_public_enabled', on only for the exact word 'true'; the preview key is 'shopee_public'", () => {
    expect(FEATURE_SWITCH_KEYS.shopeePublic).toBe("shopee_public_enabled");
    expect(SWITCHES_OFF.shopeePublic).toBe(false);
    expect(parseSwitches([{ key: "shopee_public_enabled", value: "true" }]).shopeePublic).toBe(true);
    for (const v of ["false", "TRUE", " true", "1", "yes", "", null]) expect(parseSwitches([{ key: "shopee_public_enabled", value: v }]).shopeePublic, String(v)).toBe(false);
    expect(parseSwitches([{ key: "shopee_account_enforce", value: "true" }]).shopeePublic).toBe(false);
    expect(parseSwitches([]).shopeePublic).toBe(false);
    expect(FEATURE_KEYS).toContain("shopee_public");
  });
});

describe("OFF = MAIN — every seller, case by case", () => {
  for (const isAdmin of [false, true]) for (const row of ["none", "active", "ended"] as const) for (const paidActive of [false, true]) for (const marketOk of [false, true]) {
    it(`admin=${isAdmin} · beta row ${row} · paid plan ${paidActive} · TW/PH market ${marketOk}`, () => {
      const access = acc(isAdmin, row);
      // main 8a237c68, RedesignApp.tsx lines 302–303 and the Live tile's days line (line 3056)
      const mainLinkOn = access.allowed && marketOk;
      const mainLocks = shopeeBetaLocks({ isAdmin, access, paidActive });
      const mainDays = access.daysLeft;
      const v = shopeeSellerView({ isAdmin, access, paidActive, marketOk, publicOn: false });
      expect(v.linkOn).toBe(mainLinkOn);
      expect(v.locks).toEqual(mainLocks);
      expect(v.daysLeft).toBe(mainDays);
    });
  }
  it("so: no beta row → no Shopee box; an ended row → 'Shopee access ended'; an active row on a free plan → TikTok / Facebook / Instagram locked", () => {
    expect(shopeeSellerView({ isAdmin: false, access: acc(false, "none"), paidActive: true, marketOk: true, publicOn: false })).toEqual({ linkOn: false, locks: {}, daysLeft: null });
    expect(shopeeSellerView({ isAdmin: false, access: acc(false, "ended"), paidActive: true, marketOk: true, publicOn: false })).toEqual({ linkOn: false, locks: { Shopee: "rd_sh_lock_ended" }, daysLeft: 0 });
    expect(shopeeSellerView({ isAdmin: false, access: acc(false, "active"), paidActive: false, marketOk: true, publicOn: false })).toEqual({ linkOn: true, locks: { TikTok: "rd_sh_lock_beta_only", Facebook: "rd_sh_lock_beta_only", Instagram: "rd_sh_lock_beta_only" }, daysLeft: 12 });
  });
});

describe("ON", () => {
  const on = (row: keyof typeof ROWS, paidActive: boolean, marketOk = true, isAdmin = false) => shopeeSellerView({ isAdmin, access: acc(isAdmin, row), paidActive, marketOk, publicOn: true });
  it("no beta row: the Shopee box, nothing locked, no days line — paid plan, free plan and expired plan alike", () => {
    expect(on("none", true)).toEqual({ linkOn: true, locks: {}, daysLeft: null });
    expect(on("none", false)).toEqual({ linkOn: true, locks: {}, daysLeft: null });
  });
  it("an ACTIVE beta row keeps today's rules until it ends: the days line; on a free / expired plan TikTok, Facebook and Instagram stay locked", () => {
    expect(on("active", true)).toEqual({ linkOn: true, locks: {}, daysLeft: 12 });
    expect(on("active", false)).toEqual({ linkOn: true, locks: { TikTok: "rd_sh_lock_beta_only", Facebook: "rd_sh_lock_beta_only", Instagram: "rd_sh_lock_beta_only" }, daysLeft: 12 });
    // = exactly what the same seller has with it OFF
    for (const paid of [false, true]) expect(on("active", paid)).toEqual(shopeeSellerView({ isAdmin: false, access: acc(false, "active"), paidActive: paid, marketOk: true, publicOn: false }));
  });
  it("an ENDED beta row: no 'Shopee access ended' lock, no '0 days left' — the seller follows the plan like everyone else", () => {
    for (const paid of [false, true]) {
      const v = on("ended", paid);
      expect(v).toEqual({ linkOn: true, locks: {}, daysLeft: null });
      expect(JSON.stringify(v)).not.toContain("rd_sh_lock_ended");
    }
  });
  it("the market rule is unchanged: outside Taiwan / the Philippines there is no Shopee box", () => {
    for (const row of ["none", "active", "ended"] as const) expect(on(row, true, false).linkOn).toBe(false);
  });
  it("an admin: always the box, never a lock, no days line (as before)", () => {
    for (const row of ["none", "active", "ended"] as const) expect(on(row, false, true, true)).toEqual({ linkOn: true, locks: {}, daysLeft: null });
  });
  it("the free order limit is not changed: a Shopee order is outside it only while a beta row is ACTIVE", () => {
    expect(freeCapAppliesTo("Shopee", false)).toBe(true);     // no row / ended row: counted like a TikTok order
    expect(freeCapAppliesTo("Shopee", true)).toBe(false);
    expect(freeCapAppliesTo("TikTok", true)).toBe(true);
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain("const shopeeBetaRowActive = shopeeBetaAccess({ isAdmin: false, row: shopeeBetaRow }).allowed;");
    expect(app.match(/freeCapAppliesTo\(platform, shopeeBetaRowActive\)/g)).toHaveLength(2);
  });
});

describe("the connect answers", () => {
  // main 8a237c68's shopeeLinkFailOf, word for word
  const mainFailOf = (status: number, code: unknown): string => {
    const c = String(code || "");
    if (c === "bad_link" || c === "not_own" || c === "ended" || c === "no_beta") return c;
    if (status === 409 && (c === "shop_limit" || c === "shop_locked" || c === "not_covered")) return c;
    if (status === 403) return "no_beta";
    if (status === 410) return "ended";
    if (status === 400) return "bad_link";
    return "unreachable";
  };
  const CODES = ["", "bad_link", "not_own", "ended", "no_beta", "shop_limit", "shop_locked", "not_covered", "shopee_off", "blocked", "unreachable", "try_again", "plan_expired", "no_profile", "x"];
  it("every answer main's server can send reads as on main (15 codes × 9 statuses); only 403 plan_expired / no_profile are new", () => {
    for (const status of [200, 400, 401, 403, 409, 410, 429, 502, 503]) for (const code of CODES) {
      const isNew = status === 403 && (code === "plan_expired" || code === "no_profile");
      expect(shopeeLinkFailOf(status, code), `${status} ${code}`).toBe(isNew ? code : mainFailOf(status, code));
    }
  });
  it("the two new answers show the texts a TikTok connect shows; they never open the Plan full popup", () => {
    expect(SHOPEE_LINK_ERR_KEY.plan_expired).toBe("rd_cm_plan_ended");
    expect(SHOPEE_LINK_ERR_KEY.no_profile).toBe("rd_cm_conn_try_again");
    expect(isShopeeLimitFail("plan_expired")).toBe(false);
    expect(isShopeeLimitFail("no_profile")).toBe(false);
    const connect = readFileSync("src/redesign/adapters/connect.ts", "utf8");
    expect(connect).toContain('if ((r.error || "").includes("plan_expired")) return t.rd_cm_plan_ended;');
    expect(connect).toContain("return t.rd_cm_conn_try_again;");
  });
  it("the text of each answer: OFF = main's map; ON = the same, except a 403 no_beta never says 'contact Admin'", () => {
    for (const code of Object.keys(SHOPEE_LINK_ERR_KEY) as ShopeeLinkFail[]) {
      expect(shopeeLinkErrKey(code, false)).toBe(SHOPEE_LINK_ERR_KEY[code]);
      expect(shopeeLinkErrKey(code, true)).toBe(code === "no_beta" ? "rd_sh_err_unreach" : SHOPEE_LINK_ERR_KEY[code]);
    }
    expect(SHOPEE_LINK_ERR_KEY.no_beta).toBe("rd_sh_lock_ended");
  });
  it("every text exists in the 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const k of new Set([...Object.values(SHOPEE_LINK_ERR_KEY), "rd_sh_err_unreach", "rd_ios_expired_title", "rd_ios_expired_msg"])) expect(t[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});

describe("the Admin screen's Shopee Beta row is removed (switch on or off); the table and its functions stay", () => {
  const admin = readFileSync("src/redesign/screens/Admin.tsx", "utf8");
  const useAdmin = readFileSync("src/redesign/adapters/useAdmin.ts", "utf8");
  it("no label, no days left, no Start / extend, no Remove — and no read of the beta list when the sellers panel opens", () => {
    expect(admin).not.toMatch(/shopee_?beta/i);
    expect(admin).not.toContain("adm-shopee-beta");
    expect(admin).not.toContain("rd_sh_days_left");
    expect(useAdmin).not.toMatch(/admin_shopee_beta_(start|remove|list)/);
    expect(useAdmin).not.toMatch(/shopeeBeta/);
  });
  it("it does not depend on the switch", () => {
    expect(admin).not.toMatch(/shopeePublic|shopee_public/);
  });
  it("sql/135 (the table and its four functions) is still in the repo, and no SQL file of this change drops it", () => {
    const s135 = readFileSync("sql/135_shopee_beta.sql", "utf8");
    for (const fn of ["admin_shopee_beta_start", "admin_shopee_beta_remove", "admin_shopee_beta_list", "my_shopee_beta"]) expect(s135).toContain(`function public.${fn}(`);
    for (const f of readdirSync("sql").filter((x) => /^20[67]_/.test(x))) {
      const code = readFileSync(`sql/${f}`, "utf8").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
      expect(code, f).not.toMatch(/shopee_beta/);
    }
  });
  it("the seller's own beta read is untouched (the app still asks my_shopee_beta once per sign-in)", () => {
    expect(readFileSync("src/redesign/adapters/shopeeBeta.ts", "utf8")).toContain('await supabase.rpc("my_shopee_beta")');
  });
});
