// F6 — Miners platform split (sql/88). Shopee / Instagram buyers used to be counted as
// "Facebook" (fbPct = 100 − tiktokPct). Pins: the per-platform numbers, the "Other" bucket,
// the old-response fallback (before sql/88 is applied), the SQL contract, and the card
// listing only the platforms that have buyers.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mapMinersReport, platformSplit } from "../minersReport";
import { TProvider } from "../../i18n";
import Miners from "../../screens/Miners";
import type { UseMinersReport } from "../minersReport";

const base = { platform_all_total: 10, platform_all_tiktok: 4 };

describe("platformSplit — per-platform buckets", () => {
  it("Shopee and Instagram are their own buckets, never Facebook", () => {
    const r = { ...base, platform_all_facebook: 1, platform_all_shopee: 3, platform_all_instagram: 2 };
    expect(platformSplit(r)).toEqual([
      { platform: "TikTok", pct: 40 }, { platform: "Facebook", pct: 10 },
      { platform: "Shopee", pct: 30 }, { platform: "Instagram", pct: 20 },
    ]);
    const d = mapMinersReport(r);
    expect(d.fbPct).toBe(10);
    expect(d.tiktokPct).toBe(40);
  });
  it("a blank / unknown platform goes to Other", () => {
    const r = { ...base, platform_all_facebook: 4, platform_all_shopee: 0, platform_all_instagram: 0 };
    expect(platformSplit(r)).toEqual([{ platform: "TikTok", pct: 40 }, { platform: "Facebook", pct: 40 }, { platform: "Other", pct: 20 }]);
  });
  it("only platforms with buyers are listed (TikTok-only → just TikTok)", () => {
    expect(platformSplit({ platform_all_total: 7, platform_all_tiktok: 7, platform_all_facebook: 0, platform_all_shopee: 0, platform_all_instagram: 0 }))
      .toEqual([{ platform: "TikTok", pct: 100 }]);
  });
  it("before sql/88 (no per-platform keys): the old TikTok / Facebook split, zero entries dropped", () => {
    expect(platformSplit({ platform_all_total: 30, platform_all_tiktok: 21 })).toEqual([{ platform: "TikTok", pct: 70 }, { platform: "Facebook", pct: 30 }]);
    expect(platformSplit({ platform_all_total: 5, platform_all_tiktok: 5 })).toEqual([{ platform: "TikTok", pct: 100 }]);
    expect(mapMinersReport({ platform_all_total: 30, platform_all_tiktok: 21 }).fbPct).toBe(30);
  });
  it("no buyers / garbage → empty, no NaN", () => {
    expect(platformSplit({})).toEqual([]);
    expect(platformSplit({ platform_all_total: 0, platform_all_tiktok: 0 })).toEqual([]);
    expect(mapMinersReport(null).split).toEqual([]);
  });
});

describe("sql/88 contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../sql", "88_miners_platform_split.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("same function and signature, invoker, authenticated only", () => {
    expect(code).toContain("create or replace function public.miners_report(\n  p_start date,\n  p_end   date,\n  p_limit int\n)");
    expect(code.toLowerCase()).toContain("security invoker");
    expect(code.toLowerCase()).not.toContain("security definer");
    expect(code).toContain("grant  execute on function public.miners_report(date, date, int) to authenticated");
  });
  it("keeps the old keys and adds the three per-platform counts", () => {
    for (const k of ["platform_all_tiktok", "platform_all_total", "platform_all_facebook", "platform_all_shopee", "platform_all_instagram"]) expect(code).toContain(`'${k}'`);
  });
  it("explicit own-row filter on every read (7)", () => {
    expect((code.match(/user_id = \(select auth\.uid\(\)\)/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
  it("the rollback is the sql/42 body", () => {
    const rb = readFileSync(resolve(__dirname, "../../../../sql", "88_miners_platform_split_rollback.sql"), "utf8");
    const s42 = readFileSync(resolve(__dirname, "../../../../sql", "42_miners_report.sql"), "utf8");
    const body = (s: string) => s.slice(s.indexOf("create or replace function public.miners_report("));
    expect(body(rb)).toBe(body(s42));
    expect(rb).not.toMatch(/drop\s+\w+\s+if\s+exists/i);
  });
});

describe("Miners card — lists only the platforms that have buyers", () => {
  const rep = (raw: Record<string, unknown>): UseMinersReport => ({ data: mapMinersReport({ spent: 1, orders: 1, buyers: 1, ...raw }), state: "live", load: vi.fn(), reload: vi.fn() });
  const cells = (r: UseMinersReport) => {
    const { container } = render(<TProvider lang="en"><Miners cur="NT$" rep={r} todayId="2026-10-08" sessionStartId="2026-10-08" /></TProvider>);
    const label = Array.from(container.querySelectorAll("div")).filter((e) => (e.textContent || "").startsWith("Platforms")).pop()!;
    return Array.from(label.nextElementSibling!.children).map((c) => c.textContent);
  };
  it("TikTok + Shopee + Other", () => {
    expect(cells(rep({ platform_all_total: 10, platform_all_tiktok: 6, platform_all_facebook: 0, platform_all_shopee: 3, platform_all_instagram: 0 })))
      .toEqual(["60%TikTok", "30%Shopee", "10%Other"]);
  });
  it("TikTok + Facebook buyers → the same two cells as before", () => {
    expect(cells(rep({ platform_all_total: 10, platform_all_tiktok: 7, platform_all_facebook: 3, platform_all_shopee: 0, platform_all_instagram: 0 })))
      .toEqual(["70%TikTok", "30%Facebook"]);
  });
  it("no buyers yet → the original TikTok 0% / Facebook 0% pair", () => {
    expect(cells(rep({ platform_all_total: 0, platform_all_tiktok: 0 }))).toEqual(["0%TikTok", "0%Facebook"]);
  });
});
