// Shopee Live BETA on the Live picker: the Shopee tile is active for a beta seller (BETA pill,
// days left), its panel is the paste-link form (Connect → the link), the server's error shows
// on the form, locked tiles are disabled with the lock text, and the connected state offers
// "Change link" (no Disconnect) that reopens the form. Plus RedesignApp wiring pins.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn(), toggleErrors: 0 }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";

const noop = () => {};
const baseProps = {
  comments: [] as never[], cur: "NT$", livePicker: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onManageTT: noop,
  ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onRefreshTT: noop,
  ttAccounts: ["shop_a"], fbAccounts: [] as string[],
  printed: {}, entId: null, entPrice: "",
  onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
};
type P = Partial<typeof baseProps> & Record<string, unknown>;
const renderDash = (over: P = {}) => render(<TProvider lang="en"><Dashboard {...baseProps} {...over} /></TProvider>);
const tile = (slug: string) => screen.getByTestId(`lpk-tile-${slug}`) as HTMLButtonElement;

describe("Shopee tile (beta)", () => {
  it("without the beta the Shopee tile stays 'Coming soon' (disabled)", () => {
    renderDash();
    expect(tile("sh").disabled).toBe(true);
    expect(screen.queryByTestId("lpk-beta")).toBeNull();
  });
  it("beta → tile active with the BETA pill + days left; tap → the paste form; Connect sends the link", () => {
    const onConnect = vi.fn();
    renderDash({ shopeeLink: { daysLeft: 23, error: null, onConnect } });
    expect(tile("sh").disabled).toBe(false);
    expect(screen.getByTestId("lpk-beta").textContent).toBe("Beta");
    expect(screen.getByText("Shopee Beta · 23 days left")).toBeTruthy();
    fireEvent.click(tile("sh"));
    const input = screen.getByTestId("sh-link-input") as HTMLInputElement;
    const btn = screen.getByTestId("sh-link-connect") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);                      // empty link
    fireEvent.change(input, { target: { value: " https://tw.shp.ee/jBv7BMm9 " } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onConnect).toHaveBeenCalledWith("https://tw.shp.ee/jBv7BMm9");
    expect(screen.queryByText("Disconnect")).toBeNull();
  });
  it("the server's answer shows on the form (i18n key → text)", () => {
    renderDash({ shopeeLink: { daysLeft: null, error: "rd_sh_err_not_own", onConnect: noop } });
    fireEvent.click(tile("sh"));
    expect(screen.getByTestId("sh-link-error").textContent).toBe("Paste the link of YOUR OWN live");
  });
  it("locked tiles are disabled and show the lock text (beta on a free plan)", () => {
    const lock = "Shopee Beta only — upgrade to use TikTok/Facebook";
    renderDash({ shopeeLink: { daysLeft: 5, error: null, onConnect: noop }, platformLocks: { TikTok: lock, Facebook: lock, Instagram: lock } });
    expect(tile("tt").disabled).toBe(true);
    expect(tile("fb").disabled).toBe(true);
    expect(tile("sh").disabled).toBe(false);
    expect(screen.getAllByText(lock).length).toBe(3);
  });
  it("beta ended → Shopee locked with its own text", () => {
    renderDash({ platformLocks: { Shopee: "Shopee Beta ended — contact Admin" } });
    expect(tile("sh").disabled).toBe(true);
    expect(screen.getByText("Shopee Beta ended — contact Admin")).toBeTruthy();
    expect(tile("tt").disabled).toBe(false);
  });
  it("connected → one source button reading 'Change link' (no Disconnect); open → the paste form", () => {
    const onToggleShopee = vi.fn();
    const { rerender } = render(<TProvider lang="en"><Dashboard {...baseProps} shopeeConnected shopeeLink={{ daysLeft: 9, error: null, onConnect: noop }} onToggleShopee={onToggleShopee} /></TProvider>);
    const src = screen.getByTestId("lpk-source-button");
    expect(src.textContent).toContain("Change link");
    expect(src.textContent).toContain("Shopee Live");
    expect(screen.queryByText("Disconnect")).toBeNull();
    fireEvent.click(src);
    expect(onToggleShopee).toHaveBeenCalledTimes(1);
    rerender(<TProvider lang="en"><Dashboard {...baseProps} shopeeConnected shopeeOpen shopeeLink={{ daysLeft: 9, error: null, onConnect: noop }} onToggleShopee={onToggleShopee} /></TProvider>);
    expect(screen.getByTestId("sh-link-form")).toBeTruthy();
  });
});

describe("RedesignApp wiring (source pins)", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("the paste-link connect rides the session-aware path (commitLiveConnect → runTargetConnect / connectPending)", () => {
    expect(app).toContain('void commitLiveConnect({ platform: "Shopee", shopId: 0, sessionId: "", shareLink });');
    expect(app).toContain('void (target.shareLink ? doShopeeLinkConnect(target.shareLink) : doShopeeConnect(target.shopId, target.sessionId));');
    expect(app).toContain('void (p.shareLink ? doShopeeLinkConnect(p.shareLink) : doShopeeConnect(p.shopId, p.sessionId));');
  });
  it("the Shopee uid from the server (or the beta row) is the comment-scoping selection", () => {
    expect(app).toContain('Shopee: shopeeLinkUid || shopeeBetaRow?.shopeeUid || (selectedShop ? String(selectedShop.shopId) : "")');
  });
  it("every connect door honours the beta locks", () => {
    expect(app).toContain('if (platformLocks[platform]) { setToast({ msg: lockText(platform), kind: "err" }); return; }');
    expect(app).toContain('if (platformLocks.Facebook) { setToast({ msg: lockText("Facebook"), kind: "err" }); return; }');
    expect(app).toContain('if (platformLocks.Instagram) { setToast({ msg: lockText("Instagram"), kind: "err" }); return; }');
    expect(app).toContain("if (platformLocks.Shopee) { setShopeeLinkErr(platformLocks.Shopee); return; }");
  });
  it("the free-cap soft block receives the order's platform and skips Shopee while the beta row is active (sql/136)", () => {
    expect(app).toContain("isCapped: (platform) => freeCap.freeCapped && freeCapAppliesTo(platform, shopeeBetaRowActive)");
    expect(readFileSync("src/redesign/adapters/useOrders.ts", "utf8")).toContain("if (isCapped?.(c.platform)) { onCapBlocked?.(); return null; }");
  });
  it("the tile shows only for allowed sellers in TW/PH", () => {
    expect(app).toContain("const shopeeLinkOn = shopeeBetaAcc.allowed && shopeeBetaMarketOk(market);");
  });
});
