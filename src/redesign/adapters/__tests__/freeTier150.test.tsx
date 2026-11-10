// Jeff 2026-11-10: the Free plan = 150 orders in total (was 20), one time, never resets. The
// "almost there" warning shows when 20 are left = at order 130. The database is the real gate
// (sql/148; behaviour proof with real Postgres in scripts/sql148-behaviour.mjs); the app keeps ONE
// copy of the numbers (lib/freeTier) for fallbacks + the help text, and every popup reads the RPC.
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FREE_TIER_CAP, FREE_TIER_NEAR_CAP, freeOrdersLeft } from "../../../lib/freeTier";
import { computeFreeFlags, shouldShowNearCap, isCapError, type FreeStatus } from "../useFreeCap";
import { freeCapAppliesTo } from "../shopeeBeta";
import { freeUsersSummary } from "../useReadData";
import CapPopup from "../../screens/CapPopup";
import Support from "../../screens/Support";
import { TProvider, buildT, REDESIGN_STRINGS } from "../../i18n";

afterEach(cleanup);
const LANGS = Object.keys(REDESIGN_STRINGS);
const rd = (p: string) => fs.readFileSync(p, "utf8");
/** The RPC answer exactly as free_tier_status_for_user builds it after sql/148. */
const rpc = (count: number, warned = false): FreeStatus => ({
  is_free: true, count, cap: 150, near_cap_threshold: 130, near_cap: count >= 130, capped: count >= 150, warning_shown: warned,
});

describe("one source: lib/freeTier = sql/148", () => {
  it("150 in total, warning at 130 = 20 left", () => {
    expect(FREE_TIER_CAP).toBe(150);
    expect(FREE_TIER_NEAR_CAP).toBe(130);
    expect(FREE_TIER_CAP - FREE_TIER_NEAR_CAP).toBe(20);
  });
  it("sql/148 sets exactly these numbers; the rollback brings back 20 / 15; the definitions stay as live", () => {
    const up = rd("sql/148_free_cap_150.sql"), down = rd("sql/148_free_cap_150_rollback.sql");
    const fn = (sql: string, name: string) => sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)\\n RETURNS integer\\n LANGUAGE sql\\n IMMUTABLE\\n SET search_path TO '([^']*)'\\nAS \\$function\\$ select (\\d+) \\$function\\$;`));
    expect(fn(up, "free_tier_cap")?.slice(1)).toEqual(["", String(FREE_TIER_CAP)]);
    expect(fn(up, "free_tier_near_cap")?.slice(1)).toEqual(["public", String(FREE_TIER_NEAR_CAP)]);
    expect(fn(down, "free_tier_cap")?.slice(1)).toEqual(["", "20"]);
    expect(fn(down, "free_tier_near_cap")?.slice(1)).toEqual(["public", "15"]);
    // nothing else: no count reset, no trigger change
    for (const sql of [up, down]) {
      expect(sql).not.toMatch(/free_orders_count\s*=/);
      expect(sql).not.toMatch(/check_and_increment_free_order\s*\(\)\s*\n\s*RETURNS/i);
      expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(2);
    }
  });
  it("the optional sql/148b only clears the old warning mark of free sellers under 130", () => {
    const sql = rd("sql/148b_free_cap_rewarn.sql").replace(/--[^\n]*/g, "");
    expect(sql).toMatch(/update public\.seller_profiles\s+set free_warned_at = null\s+where plan = 'free'\s+and free_warned_at is not null\s+and free_orders_count < 130;/);
    expect(sql).not.toMatch(/free_orders_count\s*=/);
  });
  it("freeOrdersLeft: from the answer; missing numbers → 150", () => {
    expect(freeOrdersLeft(rpc(130))).toBe(20);
    expect(freeOrdersLeft(rpc(150))).toBe(0);
    expect(freeOrdersLeft({ cap: 150, count: 170 })).toBe(0);
    expect(freeOrdersLeft(null)).toBe(150);
    expect(freeOrdersLeft({})).toBe(150);
  });
});

describe("warning at 130, limit at 150", () => {
  it("129 → no warning; 130 → warning once; already shown → not again", () => {
    expect(shouldShowNearCap(true, rpc(129), "")).toBe(false);
    expect(shouldShowNearCap(true, rpc(130), "")).toBe(true);
    expect(shouldShowNearCap(true, rpc(130, true), "")).toBe(false);
    expect(shouldShowNearCap(true, rpc(150), "")).toBe(false); // capped → the hard popup instead
  });
  it("149 → can still order; 150 → capped (the 151st order is blocked)", () => {
    expect(computeFreeFlags("free", rpc(149)).freeCapped).toBe(false);
    expect(computeFreeFlags("free", rpc(150)).freeCapped).toBe(true);
    expect(isCapError({ message: "free_tier_cap_reached" })).toBe(true);
  });
  it("the warning popup says 20 of 150 left", () => {
    render(<TProvider lang="en"><CapPopup kind="near" freeStatus={rpc(130)} onUpgrade={() => {}} onClose={() => {}} onViewOrders={() => {}} /></TProvider>);
    expect(screen.getByText("Only 20 of your 150 free orders left. Upgrade for unlimited orders.")).toBeTruthy();
  });
  it("the limit-reached popup says 150", () => {
    render(<TProvider lang="en"><CapPopup kind="hard" freeStatus={rpc(150)} onUpgrade={() => {}} onClose={() => {}} onViewOrders={() => {}} /></TProvider>);
    expect(screen.getByText("You've reached your 150-order limit")).toBeTruthy();
    expect(screen.getByText("You've used all 150 free orders. Upgrade to keep selling.")).toBeTruthy();
  });
  it("an answer without numbers still says 150 (never the old 100 / 20)", () => {
    render(<TProvider lang="en"><CapPopup kind="hard" freeStatus={null} onUpgrade={() => {}} onClose={() => {}} onViewOrders={() => {}} /></TProvider>);
    expect(screen.getByText("You've reached your 150-order limit")).toBeTruthy();
  });
});

describe("Shopee beta + paid plans unchanged", () => {
  it("Shopee beta: a Shopee order is not under the limit; others are", () => {
    expect(freeCapAppliesTo("Shopee", true)).toBe(false);
    expect(freeCapAppliesTo("TikTok", true)).toBe(true);
    expect(freeCapAppliesTo("Shopee", false)).toBe(true);
  });
  it("paid plans are never free / never capped", () => {
    for (const plan of ["basic", "plus", "pro", "master"]) {
      expect(computeFreeFlags(plan, { is_free: false })).toEqual({ isFreeUser: false, freeCapped: false });
      expect(shouldShowNearCap(false, rpc(140), "")).toBe(false);
    }
  });
});

describe("no '20 orders' text left", () => {
  it("Help → plans text shows 150 in all 8 languages", () => {
    for (const lang of LANGS) {
      const body = buildT(lang).rd_sup_g4_body;
      expect(body, lang).toContain("{cap}");
      expect(body, lang).not.toMatch(/(^|[^\d,])20([^\d,]|$)/);
    }
  });
  it("Help → the plans card, opened, shows 150 (8 languages) and no {cap} left", () => {
    for (const lang of LANGS) {
      const t = buildT(lang);
      const r = render(<TProvider lang={lang}><Support onLegal={() => {}} /></TProvider>);
      fireEvent.click(screen.getByText(t.rd_sup_g4));
      const body = screen.getByText((_, el) => !!el && el.tagName === "DIV" && el.textContent === t.rd_sup_g4_body.replace("{cap}", "150"));
      expect(body.textContent, lang).toContain("150");
      expect(body.textContent, lang).not.toContain("{cap}");
      r.unmount();
    }
  });
  it("free-limit texts carry {cap}/{left}, never a written number", () => {
    for (const lang of LANGS) {
      const t = buildT(lang);
      for (const k of ["rd_cap_hard_title", "rd_cap_hard_msg_one", "rd_cap_hard_msg_many", "rd_cap_near_msg", "rd_ios_cap_near_msg", "rd_sub_resets_one", "rd_sub_resets_many", "rd_ios_cap_hard_msg"]) {
        expect(t[k], `${lang} ${k}`).not.toMatch(/\b(15|20|75|100)\b/);
      }
    }
  });
  it("no '?? 100' fallback left; every fallback is FREE_TIER_CAP", () => {
    for (const p of ["src/redesign/screens/CapPopup.tsx", "src/redesign/screens/Subscription.tsx", "src/redesign/RedesignApp.tsx", "src/redesign/adapters/useReadData.ts"]) {
      const s = rd(p);
      expect(s, p).not.toMatch(/cap \?\? \d/);
      expect(s, p).toContain("FREE_TIER_CAP");
    }
    expect(freeUsersSummary([]).cap).toBe(150);
  });
  it("help guide: 150 in the plans table and the free-limit section; 116b in sync", () => {
    const g = rd("docs/support/sfl-guide.md");
    expect(g).toContain("| Free | 1 | 150 orders in total");
    expect(g).toContain("On the **Free** plan you can create **150 orders in total**.");
    expect(g).toContain("When you have 20 orders left, a popup says");
    expect(g).not.toMatch(/\b20 orders in total|free plan, 20 orders/);
    expect(rd("sql/116b_guide_seed.sql")).toContain("150 orders in total");
  });
});
