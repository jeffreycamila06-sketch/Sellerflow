// Settings → Channels 2×2 (components/ChannelsGrid.tsx) — Jeff's approved compact design.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import ChannelsGrid from "../ChannelsGrid";
import { channelTiles, type GridInput } from "../../adapters/channelsGrid";

const t = buildT("en");
const base: GridInput = { tiktokNames: ["bysheilaph.clothing"], facebookName: null, instagram: { open: false, name: null }, shopee: { state: "open", name: "Shopee shop ·6789" } };
afterEach(cleanup);

describe("the four boxes", () => {
  it("order TikTok, Facebook / Instagram, Shopee; dot green = an account is registered", () => {
    const tiles = channelTiles(base, t);
    expect(tiles.map((x) => x.key)).toEqual(["tiktok", "facebook", "instagram", "shopee"]);
    expect(tiles.map((x) => [x.name, x.line, x.registered])).toEqual([
      ["TikTok", "@bysheilaph.clothing", true],
      ["Facebook", "Not connected", false],
      ["Instagram", "Coming soon", false],
      ["Shopee", "Shopee shop ·6789", true],
    ]);
  });
  it("Instagram is Coming soon (not tappable) unless it is open (admin)", () => {
    expect(channelTiles(base, t)[2]).toMatchObject({ disabled: true, line: "Coming soon" });
    expect(channelTiles({ ...base, instagram: { open: true, name: "my_ig" } }, t)[2]).toMatchObject({ disabled: false, line: "my_ig", registered: true });
    expect(channelTiles({ ...base, instagram: { open: true, name: null } }, t)[2]).toMatchObject({ disabled: false, line: "Not connected", registered: false });
  });
  it("Shopee follows the Live tile: no beta → Coming soon; beta ended → the lock line; both not tappable", () => {
    expect(channelTiles({ ...base, shopee: { state: "soon", name: null } }, t)[3]).toMatchObject({ disabled: true, line: "Coming soon" });
    expect(channelTiles({ ...base, shopee: { state: "locked", name: null, lockText: t.rd_sh_lock_ended } }, t)[3]).toMatchObject({ disabled: true, line: "Shopee access ended — contact Admin" });
    expect(channelTiles({ ...base, shopee: { state: "open", name: null } }, t)[3]).toMatchObject({ disabled: false, line: "Not connected" });
    expect(channelTiles(base, t).some((x) => "beta" in x)).toBe(false); // no Beta chip on any box (2026-11-22)
  });
  it("a name already starting with @ is not doubled; no TikTok name → Not connected", () => {
    expect(channelTiles({ ...base, tiktokNames: ["@shop"] }, t)[0].line).toBe("@shop");
    expect(channelTiles({ ...base, tiktokNames: [] }, t)[0]).toMatchObject({ line: "Not connected", registered: false });
  });
});

describe("rendered", () => {
  it("2 per row; long names cut with … (one line); a tap opens that channel; Coming soon does nothing", () => {
    const onOpen = vi.fn();
    render(<TProvider lang="en"><ChannelsGrid input={{ ...base, tiktokNames: ["a_very_long_tiktok_username_that_does_not_fit_in_the_box"] }} onOpen={onOpen} /></TProvider>);
    const grid = screen.getByTestId("cg-grid");
    expect(grid.className).toBe("sfl-cg-grid");
    expect(grid.children).toHaveLength(4);
    expect(screen.getByTestId("cg-tiktok-line").className).toContain("sfl-cg-line");
    fireEvent.click(screen.getByTestId("cg-tiktok"));
    fireEvent.click(screen.getByTestId("cg-facebook"));
    fireEvent.click(screen.getByTestId("cg-shopee"));
    fireEvent.click(screen.getByTestId("cg-instagram"));
    expect(onOpen.mock.calls.map((c) => c[0])).toEqual(["tiktok", "facebook", "shopee"]);
    expect((screen.getByTestId("cg-instagram") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cg-tiktok-dot").className).toBe("sfl-cg-dot on");
    expect(screen.getByTestId("cg-facebook-dot").className).toBe("sfl-cg-dot");
  });
  it("the CSS keeps one line with … and 2 columns; the laptop shows the status word (no Beta chip)", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/redesign/redesign.css", "utf8");
    expect(css).toContain(".sfl-cg-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }");
    expect(css).toMatch(/\.sfl-cg-line \{[^}]*white-space: nowrap; overflow: hidden; text-overflow: ellipsis;/);
    expect(css).toMatch(/@media \(min-width: 900px\) \{[\s\S]*\.sfl-cg-status \{ display: inline-flex;/);
    expect(css).not.toContain("sfl-cg-beta");
  });
  it("every grid / Shopee-shops text exists in all 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const tl = buildT(lang) as unknown as Record<string, string>;
      for (const k of ["rd_cg_facebook", "rd_cg_shopee", "rd_ss_title", "rd_ss_empty", "rd_ss_wait", "rd_ss_added", "rd_ss_add_hint"]) expect(tl[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});
