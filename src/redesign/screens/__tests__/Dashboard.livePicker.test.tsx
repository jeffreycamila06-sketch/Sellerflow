// Live platform picker (admin preview) — a new LOOK over the classic chip callbacks.
// Pins: the gate (non-admins render the classic header / dropdowns / empty state);
// the view decision; the four tiles (order, disabled "Coming soon"); every panel row
// calls the SAME callback the classic dropdown calls; connecting / failure / connected
// states; the "Choose live source" overlay; 2+ live sources → classic; motion config.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import {
  livePickerEnabled, livePickerView, LIVE_PICKER_PUBLIC, LIVE_PICKER_MOTION, LIVE_PICKER_TIMING, PICKER_ORDER,
} from "../../adapters/livePicker";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";

const noop = () => {};
const baseProps = {
  comments: [] as never[], cur: "NT$",
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onManageTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onRefreshTT: noop,
  ttAccounts: ["shop_a", "shop_b"], fbAccounts: [] as string[],
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
type P = Partial<typeof baseProps> & Record<string, unknown>;
const ui = (over: P = {}) => <TProvider lang="en"><Dashboard {...baseProps} {...over} /></TProvider>;
const renderDash = (over: P = {}) => render(ui(over));
const comment = { id: "c1", name: "Ann", handle: "@ann", text: "mine po", time: "1:00", platform: "TikTok", mine: false };
const shopee = { shopeeEnabled: true, shopeeShops: [{ shopId: 7, shopName: "Shop Seven" }] };
const lpkIds = () => document.querySelectorAll("[data-testid^='lpk-']").length;

describe("gate", () => {
  it("admins only; one constant widens it", () => {
    expect(LIVE_PICKER_PUBLIC).toBe(false);
    expect(livePickerEnabled(true)).toBe(true);
    expect(livePickerEnabled(false)).toBe(false);
  });

  it("gate false → classic header chips, dropdown and empty state; no picker element", () => {
    for (const over of [{}, { livePicker: false }]) {
      const { unmount } = renderDash(over);
      expect(screen.getByText("shop_a")).toBeTruthy();                       // TikTok chip
      expect(screen.getByText("Connect Facebook")).toBeTruthy();              // Facebook chip
      expect(screen.getByText("Waiting for live comments…")).toBeTruthy();    // empty card
      expect(lpkIds()).toBe(0);
      unmount();
    }
    const onConnectTT = vi.fn();
    renderDash({ ttOpen: true, onConnectTT });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnectTT).toHaveBeenCalledTimes(1);
    expect(lpkIds()).toBe(0);
  });
});

describe("livePickerView", () => {
  const off = { connected: false, connecting: false };
  const on = { connected: true, connecting: false };
  const ing = { connected: false, connecting: true };
  const v = (o: Partial<Parameters<typeof livePickerView>[0]>) =>
    livePickerView({ enabled: true, tt: off, fb: off, sh: off, hasComments: false, chosen: null, ...o });
  it("picker / body / connected / classic", () => {
    expect(v({ enabled: false })).toEqual({ view: "classic" });
    expect(v({})).toEqual({ view: "picker" });
    expect(v({ hasComments: true })).toEqual({ view: "body" });
    expect(v({ tt: on })).toEqual({ view: "connected", platform: "TikTok" });
    expect(v({ sh: on, hasComments: true })).toEqual({ view: "connected", platform: "Shopee" });
    expect(v({ tt: ing })).toEqual({ view: "connected", platform: "TikTok" });     // app open / auto-reconnect
    expect(v({ tt: ing, chosen: "TikTok" })).toEqual({ view: "picker" });          // just chosen → "Connecting…" tile
    expect(v({ fb: ing, chosen: "Facebook", hasComments: true })).toEqual({ view: "body" });
    expect(v({ tt: on, fb: ing })).toEqual({ view: "classic" });                   // 2+ live → classic
    expect(v({ tt: on, sh: on, fb: on })).toEqual({ view: "classic" });
  });
});

describe("State A — four tiles replace only the empty comments card", () => {
  it("order, LIVE tag, Coming soon, header row 2 gone, Live comments row kept", () => {
    renderDash({ livePicker: true });
    const tiles = screen.getAllByTestId(/^lpk-tile-/);
    expect(tiles.map((b) => b.getAttribute("data-testid"))).toEqual(["lpk-tile-tt", "lpk-tile-fb", "lpk-tile-ig", "lpk-tile-sh"]);
    expect(PICKER_ORDER).toEqual(["TikTok", "Facebook", "Instagram", "Shopee"]);
    for (const b of tiles) expect(within(b).getByText("LIVE")).toBeTruthy();
    expect((screen.getByTestId("lpk-tile-ig") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("lpk-tile-sh") as HTMLButtonElement).disabled).toBe(true);   // no shops
    expect(within(screen.getByTestId("lpk-tile-ig")).getByText("Coming soon")).toBeTruthy();
    expect(within(screen.getByTestId("lpk-tile-tt")).getByText("Tap to choose")).toBeTruthy();
    expect(screen.queryByText("shop_a")).toBeNull();                        // chip row not rendered
    expect(screen.queryByText("Waiting for live comments…")).toBeNull();     // empty card replaced
    expect(screen.getByText("Live comments")).toBeTruthy();                  // row kept…
    expect(screen.getByText("Games")).toBeTruthy();                          // …with Games + switch
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("Shopee is enabled when Shopee is on and a shop is authorized", () => {
    renderDash({ livePicker: true, ...shopee });
    expect((screen.getByTestId("lpk-tile-sh") as HTMLButtonElement).disabled).toBe(false);
  });

  it("a disabled tile cannot be chosen", () => {
    renderDash({ livePicker: true });
    fireEvent.click(screen.getByTestId("lpk-tile-ig"));
    expect(screen.getByTestId("lpk-picker").className).not.toContain("sfl-lpk--chosen");
  });
});

describe("State B — chosen tile + the platform's own menu (same callbacks)", () => {
  it("TikTok: others hide, animations stop, every row calls the classic callback", () => {
    const onPickTT = vi.fn(), onManageTT = vi.fn(), onRefreshTT = vi.fn(), onConnectTT = vi.fn(), onToggleTT = vi.fn();
    renderDash({ livePicker: true, onPickTT, onManageTT, onRefreshTT, onConnectTT, onToggleTT });
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    expect(screen.getByTestId("lpk-picker").className).toContain("sfl-lpk--chosen");
    expect(screen.getByTestId("lpk-slot-fb").className).toContain("is-hidden");
    expect(screen.getByTestId("lpk-slot-ig").className).toContain("is-hidden");
    expect(screen.getByTestId("lpk-slot-sh").className).toContain("is-hidden");
    expect(within(screen.getByTestId("lpk-tile-tt")).getByText("Choose an account")).toBeTruthy();
    const panel = screen.getByTestId("lpk-panel-tt");
    fireEvent.click(within(panel).getByText("shop_b"));
    expect(onPickTT).toHaveBeenCalledWith(1);
    fireEvent.click(within(panel).getByText("Manage / add accounts"));
    expect(onManageTT).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel).getByRole("button", { name: /Refresh/ }));
    expect(onRefreshTT).toHaveBeenCalledTimes(1);
    fireEvent.click(within(panel).getByRole("button", { name: "Connect" }));
    expect(onConnectTT).toHaveBeenCalledTimes(1);
    expect(onToggleTT).not.toHaveBeenCalled();
  });

  it("tapping the chosen tile again (Back) returns to the four tiles", () => {
    renderDash({ livePicker: true });
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    expect(screen.queryByTestId("lpk-panel-tt")).toBeNull();
    expect(screen.getByTestId("lpk-picker").className).not.toContain("sfl-lpk--chosen");
  });

  it("Connecting… while connecting; a failed connect returns to the panel", () => {
    const r = renderDash({ livePicker: true });
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    r.rerender(ui({ livePicker: true, ttConnecting: true }));
    expect(within(screen.getByTestId("lpk-tile-tt")).getByText("Connecting…")).toBeTruthy();
    expect(screen.queryByTestId("lpk-panel-tt")).toBeNull();
    r.rerender(ui({ livePicker: true, ttConnecting: false }));
    expect(screen.getByTestId("lpk-panel-tt")).toBeTruthy();
  });

  it("the panel sits after the chosen slot (not inside it), held until its pop delay", () => {
    renderDash({ livePicker: true });
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    const slot = screen.getByTestId("lpk-slot-tt"), panel = screen.getByTestId("lpk-panel-tt");
    expect(slot.contains(panel)).toBe(false);
    expect(slot.nextElementSibling).toBe(panel);
    expect(panel.className).not.toContain("sfl-lpk-panel--now");
    expect(slot.style.flex).toBe("0 0 auto");           // held at its tap-time height (inline)
    expect(slot.style.height).not.toBe("");
  });

  it("after a connect attempt the panel comes back without the pop delay", () => {
    const r = renderDash({ livePicker: true });
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    r.rerender(ui({ livePicker: true, ttConnecting: true }));
    r.rerender(ui({ livePicker: true, ttConnecting: false }));
    expect(screen.getByTestId("lpk-panel-tt").className).toContain("sfl-lpk-panel--now");
  });

  it("Facebook honest gate: same text + Telegram link; the link closes the panel locally", () => {
    const onToggleFB = vi.fn();
    renderDash({ livePicker: true, onToggleFB });
    fireEvent.click(screen.getByTestId("lpk-tile-fb"));
    const panel = screen.getByTestId("lpk-panel-fb");
    const link = within(panel).getByRole("link");
    expect(link.getAttribute("href")).toContain("t.me/");
    fireEvent.click(link);
    expect(screen.queryByTestId("lpk-panel-fb")).toBeNull();
    expect(onToggleFB).not.toHaveBeenCalled();
  });

  it("Facebook real connect (fbConnectEnabled) and Shopee use their classic callbacks", () => {
    const onPickFB = vi.fn(), onConnectFB = vi.fn(), onConnectShopee = vi.fn(), onManageShopee = vi.fn(), onPickShopee = vi.fn();
    renderDash({ livePicker: true, fbConnectEnabled: true, fbPages: [{ pageId: "p1", name: "Page One", username: "one" }, { pageId: "p2", name: "Page Two", username: "two" }],
      onPickFB, onConnectFB, ...shopee, onConnectShopee, onManageShopee, onPickShopee });
    fireEvent.click(screen.getByTestId("lpk-tile-fb"));
    const fb = screen.getByTestId("lpk-panel-fb");
    fireEvent.click(within(fb).getByText("Page Two"));
    expect(onPickFB).toHaveBeenCalledWith(1);
    fireEvent.click(within(fb).getByRole("button", { name: "Connect" }));
    expect(onConnectFB).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("lpk-tile-fb"));       // Back
    fireEvent.click(screen.getByTestId("lpk-tile-sh"));
    const sh = screen.getByTestId("lpk-panel-sh");
    fireEvent.click(within(sh).getByText("Shop Seven"));
    expect(onPickShopee).toHaveBeenCalledWith(0);
    fireEvent.click(within(sh).getByRole("button", { name: "Connect" }));
    expect(onConnectShopee).toHaveBeenCalledTimes(1);
  });
});

describe("State C — one full-width button; Change never disconnects", () => {
  it("chosen → connected flies up; the button only toggles; Disconnect stays in the dropdown", () => {
    const onToggleTT = vi.fn(), onConnectTT = vi.fn();
    const r = renderDash({ livePicker: true, onToggleTT, onConnectTT });
    fireEvent.click(screen.getByTestId("lpk-tile-tt"));
    r.rerender(ui({ livePicker: true, onToggleTT, onConnectTT, ttConnected: true }));
    expect(screen.queryByTestId("lpk-picker")).toBeNull();
    expect(screen.getByText("Waiting for live comments…")).toBeTruthy();        // normal body again
    const btn = screen.getByTestId("lpk-source-button");
    expect(within(btn).getByText("shop_a")).toBeTruthy();
    expect(within(btn).getByText("Change")).toBeTruthy();
    expect(btn.parentElement!.className).toContain("sfl-lpk-fly");
    fireEvent.click(btn);
    expect(onToggleTT).toHaveBeenCalledTimes(1);
    expect(onConnectTT).not.toHaveBeenCalled();
    r.rerender(ui({ livePicker: true, onToggleTT, onConnectTT, ttConnected: true, ttOpen: true }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onConnectTT).toHaveBeenCalledTimes(1);
  });

  it("opening the app already connected (or reconnecting) → straight to State C, no fly", () => {
    renderDash({ livePicker: true, ttConnecting: true });
    const btn = screen.getByTestId("lpk-source-button");
    expect(btn.parentElement!.className).not.toContain("sfl-lpk-fly");
    expect(screen.queryByTestId("lpk-picker")).toBeNull();
  });

  it("an auto-reconnect while the tiles are shown (nothing chosen) → State C without the fly-up", () => {
    const r = renderDash({ livePicker: true });
    r.rerender(ui({ livePicker: true, ttConnected: true }));
    expect(screen.getByTestId("lpk-source-button").parentElement!.className).not.toContain("sfl-lpk-fly");
  });

  it("2+ sources live or connecting → the classic chip row, even for the admin", () => {
    renderDash({ livePicker: true, ttConnected: true, fbConnecting: true });
    expect(lpkIds()).toBe(0);
    expect(screen.getByText("shop_a")).toBeTruthy();
  });
});

describe("board still has comments, nothing live", () => {
  it("comments stay; the header shows Choose live source; it opens the tiles as an overlay", () => {
    renderDash({ livePicker: true, comments: [comment] as never[] });
    expect(screen.getByText("mine po")).toBeTruthy();
    expect(screen.queryByTestId("lpk-picker")).toBeNull();
    fireEvent.click(screen.getByTestId("lpk-choose-button"));
    expect(within(screen.getByTestId("lpk-overlay")).getAllByTestId(/^lpk-tile-/)).toHaveLength(4);
    expect(screen.getByText("mine po")).toBeTruthy();
    fireEvent.click(screen.getByTestId("lpk-overlay-close"));
    expect(screen.queryByTestId("lpk-overlay")).toBeNull();
  });
});

describe("motion + text", () => {
  const css = readFileSync("src/redesign/redesign.css", "utf8");
  it("mode + durations live in one place; default always", () => {
    expect(LIVE_PICKER_MOTION).toBe("always");
    expect(LIVE_PICKER_TIMING.idle).toEqual({ TikTok: 1700, Facebook: 2800, Instagram: 3200, Shopee: 3800 });
    renderDash({ livePicker: true });
    expect(screen.getByTestId("lpk-picker").className).toContain("sfl-lpk--m-always");
  });
  it("approved keyframes (prefixed, so the existing sflBeat is untouched), idle rules gated, reduced motion off", () => {
    expect(css.match(/@keyframes sflBeat\b/g)).toHaveLength(1);
    expect(css).toContain("@keyframes sflLpkBeat{0%,100%{transform:scale(1)}10%{transform:scale(1.1)}20%{transform:scale(1)}30%{transform:scale(1.06)}40%{transform:scale(1)}}");
    expect(css).toContain("@keyframes sflLpkFlip{0%,55%{transform:rotateY(0deg)}85%,100%{transform:rotateY(360deg)}}");
    expect(css).toContain(".sfl-lpk:not(.sfl-lpk--m-off):not(.sfl-lpk--chosen) .sfl-lpk-tile:not(:disabled) .sfl-lpk-emb--sh { animation: sflLpkFlip");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\n\s+\[data-redesign\] \.sfl-lpk, \[data-redesign\] \.sfl-lpk \*, \[data-redesign\] \.sfl-lpk-fly \{ animation: none !important; transition: none !important; \}/);
  });
  it("tap timing: chosen slot frozen then shrunk after the collapse delay; panel held; emblems sized to fit", () => {
    expect(css).toContain("@keyframes sflLpkHold{from{max-height:0;margin-top:0;padding-top:0;padding-bottom:0;border-width:0;overflow:hidden;pointer-events:none}to{max-height:1200px}}");
    expect(css).toContain(".sfl-lpk-panel { animation: sflLpkPop var(--lpk-pop) ease-out var(--lpk-pop-delay) both, sflLpkHold 1ms linear var(--lpk-pop-delay) both; }");
    expect(css).toContain(".sfl-lpk-slot.is-chosen { max-height: none; transition: none; animation: sflLpkChosen var(--lpk-collapse) ease var(--lpk-collapse-delay) forwards; }");
    expect(css).toContain("transform: scale(.98); transition: transform var(--lpk-collapse) ease var(--lpk-collapse-delay);");
    expect(css).toContain("--lpk-u: calc(min(82px, 100cqh) / 82);");                 // scales with the tile height
    expect(css).toContain("border: calc(var(--lpk-u) * 6) double var(--text);");     // TikTok ring visible in both themes
    expect(css).toMatch(/\.sfl-lpk-shape--sh \{\n\s+width: calc\(var\(--lpk-u\) \* 38\)/);   // (38+14)·√2 ≈ 73.5 ≤ 74
  });
  it("new text is translated in every app language", () => {
    const src = readFileSync("src/redesign/i18n/index.tsx", "utf8");
    for (const k of ["rd_lpk_tap", "rd_lpk_choose_acct", "rd_lpk_back"]) {
      const line = src.split("\n").find((l) => l.trimStart().startsWith(`${k}:`))!;
      for (const lang of ["en:", "fil:", "zh:", '"zh-TW":', "vi:", "th:", "id:", "bg:"]) expect(line).toContain(lang);
    }
  });
});
