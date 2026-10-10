// Settings hub — Parcel Scan split into "· 7-11" (today's tile, unchanged behaviour) and
// "· FamilyMart" (Coming soon, toast only). TW-market sellers with no 7-11 access see a
// Coming-soon 7-11 tile too. Our own inline-SVG shop icon — no store logos / image files.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider, buildT } from "../../i18n";
import SettingsHub from "../SettingsHub";
import { effectiveMarket, marketHides } from "../../adapters/market";

const t = buildT("en");
const noop = () => {};
const base = { onGeneral: noop, onCustomers: noop, onAdmin: noop, onCustomerData: noop, onLegal: noop, onDelete: noop, onLogout: noop };
const view = (extra: Record<string, unknown> = {}, lang = "en") =>
  render(<TProvider lang={lang}><SettingsHub {...base} {...extra} /></TProvider>);

describe("7-11 tile — today's behaviour kept", () => {
  it("with access: opens Parcel Scan, label 'Parcel Scan' + '7-11', shop icon with a 3-colour bar", () => {
    const onParcelScan = vi.fn(), onParcelSoon = vi.fn();
    const r = view({ onParcelScan, onParcelSoon });
    const tile = r.getByTestId("tile-parcelscan");
    expect(tile.textContent).toContain("Parcel Scan");
    expect(tile.textContent).toContain("7-11");
    expect(tile.querySelector('[data-testid="parcel-icon-711"]')).toBeTruthy();
    expect(Array.from(tile.querySelectorAll('[data-testid="parcel-accent"]')).map((r) => r.getAttribute("fill"))).toEqual(["#f58220", "#00965e", "#e4002b"]);
    fireEvent.click(tile);
    expect(onParcelScan).toHaveBeenCalledTimes(1);
    expect(onParcelSoon).not.toHaveBeenCalled();
    expect(r.queryByTestId("tile-parcelscan-soon")).toBeNull();
  });
  it("basic/free: the locked upsell tile stays (not the Coming-soon one)", () => {
    const onParcelUpsell = vi.fn();
    const r = view({ parcelLocked: true, onParcelUpsell, onParcelSoon: vi.fn() });
    fireEvent.click(r.getByTestId("tile-parcelscan-locked"));
    expect(onParcelUpsell).toHaveBeenCalledTimes(1);
    expect(r.queryByTestId("tile-parcelscan-soon")).toBeNull();
  });
  it("TW seller with no 7-11 access (no working, no locked tile) → grey Coming-soon 7-11 tile, tap = toast only", () => {
    const onParcelSoon = vi.fn();
    const r = view({ onParcelSoon });
    const tile = r.getByTestId("tile-parcelscan-soon");
    expect(tile.textContent).toContain(t.rd_soon); // SoonBadge
    expect(tile.style.opacity).toBe("0.5");
    fireEvent.click(tile);
    expect(onParcelSoon).toHaveBeenCalledWith("711");
    expect(r.queryByTestId("tile-parcelscan")).toBeNull();
  });
});

describe("FamilyMart tile", () => {
  it("shows for a TW seller WITHOUT Parcel Scan access; Soon badge; grey; shop icon with a 2-colour bar; tap = toast only", () => {
    const onParcelSoon = vi.fn();
    const r = view({ onParcelSoon });
    const fm = r.getByTestId("tile-parcelscan-fm");
    expect(fm.textContent).toContain("Parcel Scan");
    expect(fm.textContent).toContain("FamilyMart");
    expect(fm.textContent).toContain(t.rd_soon);
    expect(fm.style.opacity).toBe("0.5");
    expect(Array.from(fm.querySelectorAll('[data-testid="parcel-accent"]')).map((r) => r.getAttribute("fill"))).toEqual(["#00a14b", "#0072bc"]);
    fireEvent.click(fm);
    expect(onParcelSoon).toHaveBeenCalledTimes(1);
    expect(onParcelSoon).toHaveBeenCalledWith("fm");
  });
  it("also shows next to the working 7-11 tile (same row) for sellers with access", () => {
    const r = view({ onParcelScan: noop, onParcelSoon: vi.fn() });
    const pair = r.getByTestId("parcel-pair");
    expect(pair.style.gridColumn).toBe("1 / -1");
    expect(pair.contains(r.getByTestId("tile-parcelscan"))).toBe(true);
    expect(pair.contains(r.getByTestId("tile-parcelscan-fm"))).toBe(true);
  });
  it("hidden for non-TW markets (no onParcelSoon) — and the 7-11 Coming-soon tile too", () => {
    const r = view({});
    expect(r.queryByTestId("tile-parcelscan-fm")).toBeNull();
    expect(r.queryByTestId("tile-parcelscan-soon")).toBeNull();
  });
  it("no logo images: inline SVG only, no <img>, no image files referenced", () => {
    const r = view({ onParcelScan: noop, onParcelSoon: noop });
    for (const id of ["tile-parcelscan", "tile-parcelscan-fm"]) {
      const el = r.getByTestId(id);
      expect(el.querySelector("img, image, use")).toBeNull();
      expect(el.querySelector("svg")).toBeTruthy();
    }
    const src = readFileSync("src/redesign/components/ParcelStoreIcon.tsx", "utf8");
    expect(src).not.toMatch(/\.(png|jpe?g|svg|webp|gif)["']|<image|href=/);
  });
  it("Tagalog / Chinese labels", () => {
    expect(view({ onParcelSoon: noop }, "zh-TW").getByTestId("tile-parcelscan-fm").textContent).toContain("全家");
  });
});

describe("toast text + market rule", () => {
  it("toast strings", () => {
    expect(t.rd_sh_fm_soon_toast).toBe("FamilyMart parcel scan is coming soon!");
    expect(buildT("fil").rd_sh_fm_soon_toast).toBe("Malapit na ang Parcel Scan para sa FamilyMart!");
    expect(t.rd_sh_ps_soon_toast).toBe("Parcel Scan is coming soon!");
  });
  it("the gate = the market rule that lets Parcel Scan appear at all: TW shown, PH hidden, admin shown", () => {
    expect(marketHides("parcelScan", effectiveMarket({ role: "seller", country: null }))).toBe(false);
    expect(marketHides("parcelScan", effectiveMarket({ role: "seller", country: "TW" }))).toBe(false);
    expect(marketHides("parcelScan", effectiveMarket({ role: "seller", country: "PH" }))).toBe(true);
    expect(marketHides("parcelScan", effectiveMarket({ role: "admin", country: "PH" }))).toBe(false);
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    const line = app.split("\n").find((l) => l.includes("onParcelSoon=")) ?? "";
    expect(line).toMatch(/onParcelSoon=\{hideParcelScan \? undefined :/);
    expect(line).not.toMatch(/parcelAllowed|parcelLocked|setScreen/); // no 7-11 access rule, no navigation
  });
});
