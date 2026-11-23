// Settings → Channels → Shopee shops (screens/ShopeeShops.tsx): the registered shops, Remove with the confirm
// sheet, "End your live first" for the shop live now, the 4-hour countdown and the "Accounts used" line.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { TProvider } from "../../i18n";
import ShopeeShops from "../ShopeeShops";
import type { AccountList, AccountRow } from "../../adapters/planFull";

vi.mock("../../components/AccountQuotaLine", () => ({ default: () => <div data-testid="account-quota-line">Accounts used: 2 of 3</div> }));

const NOW = Date.parse("2026-11-22T10:00:00Z");
const shopA: AccountRow = { platform: "shopee", key: "ph:111122223", id: "a", name: null, link: true, rank: 2, covered: true, addedAt: "2026-11-20T08:00:00Z", lockUntil: null };
const shopB: AccountRow = { platform: "shopee", key: "tw:999988887", id: "b", name: null, link: true, rank: 3, covered: false, addedAt: null, lockUntil: null };
const tt: AccountRow = { platform: "tiktok", key: "shop1", id: null, name: null, link: false, rank: 1, covered: true, addedAt: null, lockUntil: null };
const mk = (o: Partial<AccountList> = {}): AccountList => ({ v2: true, plan: "pro", limit: 3, unlimited: false, used: 3, locked: 0, nextFreeAt: null, serverNow: "2026-11-22T10:00:00Z", loadedAt: NOW, accounts: [tt, shopA, shopB], ...o });
const NO_LIVE = { tiktok: null, facebook: null, instagram: null, shopeeUid: null, shopeeShopId: null };
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
afterEach(() => { cleanup(); vi.useRealTimers(); });

function show(o: { list?: AccountList | null; live?: typeof NO_LIVE; onRemove?: () => Promise<{ ok: true } | { ok: false; error: "failed" }>; now?: () => number } = {}) {
  const onRemove = vi.fn(o.onRemove ?? (async () => ({ ok: true as const })));
  const onReload = vi.fn(); const onBack = vi.fn();
  render(<div data-redesign=""><TProvider lang="en"><ShopeeShops list={o.list === undefined ? mk() : o.list} live={o.live ?? NO_LIVE} onRemove={onRemove} onReload={onReload} onBack={onBack} now={o.now ?? (() => NOW)} /></TProvider></div>);
  return { onRemove, onReload, onBack };
}

describe("Shopee shops", () => {
  it("lists only the paste-link shops, with the quota line, the 4-hour note and how to add one", () => {
    show();
    expect(screen.getAllByTestId("ss-row-name").map((n) => n.textContent)).toEqual(["Shopee shop ·2223", "Shopee shop ·8887"]);
    expect(screen.getByTestId("account-quota-line").textContent).toBe("Accounts used: 2 of 3");
    expect(screen.getByTestId("ss-lock-note").textContent).toBe("You can replace an account right away. The new account then can't be changed again for 4 hours.");
    expect(screen.getByTestId("ss-add-hint").textContent).toContain("paste it on the Live screen");
    expect(screen.getByTestId("ss-not-covered").textContent).toBe("Not covered");
    expect(screen.getAllByTestId("ss-row")[0].textContent).toContain("Added");
  });
  it("Remove → confirm sheet (orders and stickers stay) → removed → the list is read again", async () => {
    const h = show();
    fireEvent.click(screen.getAllByTestId("ss-remove")[0]);
    expect(screen.getByTestId("ss-confirm").textContent).toContain("Remove Shopee shop ·2223?");
    expect(screen.getByTestId("ss-confirm").textContent).toContain("Your orders and stickers stay. You can add a new account right away. After that, it can't be changed again for 4 hours.");
    await act(async () => { fireEvent.click(screen.getByTestId("ss-confirm-remove")); });
    await flush();
    expect(h.onRemove).toHaveBeenCalledWith(shopA);
    expect(h.onReload).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("ss-confirm")).toBeNull();
  });
  it("Keep it → nothing removed; a failed removal → one line", async () => {
    const h = show({ onRemove: async () => ({ ok: false, error: "failed" }) });
    fireEvent.click(screen.getAllByTestId("ss-remove")[0]);
    fireEvent.click(screen.getByTestId("ss-keep"));
    expect(h.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTestId("ss-remove")[0]);
    await act(async () => { fireEvent.click(screen.getByTestId("ss-confirm-remove")); });
    await flush();
    expect(screen.getByTestId("ss-error").textContent).toBe("Couldn't remove it. Try again.");
    expect(h.onReload).not.toHaveBeenCalled();
  });
  it("the shop live right now → End your live first, no Remove", () => {
    show({ live: { ...NO_LIVE, shopeeUid: "111122223" } });
    const rows = screen.getAllByTestId("ss-row");
    expect(rows[0].textContent).toContain("End your live first");
    expect(rows[0].textContent).toContain("Shopee · live now");
    expect(rows[0].querySelector("[data-testid=ss-remove]")).toBeNull();
    expect(rows[1].querySelector("[data-testid=ss-remove]")).toBeTruthy();
  });
  it("a removed account's place → live countdown on the server's clock", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let now = NOW;
    show({ list: mk({ accounts: [tt, shopA], used: 3, locked: 1, nextFreeAt: "2026-11-22T12:15:00Z" }), now: () => now });
    expect(screen.getByTestId("ss-wait").textContent).toBe("You can add a new Shopee shop in 2h 15m.");
    now += 60_000;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("ss-wait").textContent).toBe("You can add a new Shopee shop in 2h 14m.");
  });
  it("sql/205 — a shop that took a place less than 4 hours ago: Remove → \"Wait a little\" + the time left; nothing removed", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let now = NOW;
    const lockedShop: AccountRow = { ...shopA, lockUntil: "2026-11-22T13:30:00Z" };
    const h = show({ list: mk({ accounts: [tt, lockedShop, shopB] }), now: () => now });
    fireEvent.click(screen.getAllByTestId("ss-remove")[0]);
    expect(screen.queryByTestId("ss-confirm")).toBeNull();
    const sheet = screen.getByTestId("ss-locked");
    expect(sheet.textContent).toContain("Wait a little");
    expect(screen.getByTestId("ss-locked-lead").textContent).toBe("Shopee shop ·2223 replaced another account less than 4 hours ago. You can change it again in:");
    expect(screen.getByTestId("ss-locked-countdown").textContent).toBe("3h 30m");
    expect(screen.getByTestId("ss-locked-overlay").parentElement?.hasAttribute("data-redesign")).toBe(true);
    now += 60_000;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("ss-locked-countdown").textContent).toBe("3h 29m");
    fireEvent.click(screen.getByTestId("ss-locked-ok"));
    expect(screen.queryByTestId("ss-locked")).toBeNull();
    expect(h.onRemove).not.toHaveBeenCalled();
    // the other shop (not locked) keeps the normal confirm
    fireEvent.click(screen.getAllByTestId("ss-remove")[1]);
    expect(screen.getByTestId("ss-confirm").textContent).toContain("Remove Shopee shop ·8887?");
  });
  it("sql/205 — the 4 hours are over, or the seller has no limit (an admin): Remove asks as usual", () => {
    const lockedShop: AccountRow = { ...shopA, lockUntil: "2026-11-22T13:30:00Z" };
    show({ list: mk({ accounts: [lockedShop] }), now: () => NOW + 4 * 3600_000 });
    fireEvent.click(screen.getByTestId("ss-remove"));
    expect(screen.getByTestId("ss-confirm")).toBeTruthy();
    cleanup();
    show({ list: mk({ unlimited: true, accounts: [lockedShop] }) });
    fireEvent.click(screen.getByTestId("ss-remove"));
    expect(screen.getByTestId("ss-confirm")).toBeTruthy();
  });
  it("no shop yet → how one is added; still loading → …; Back goes back", () => {
    const h = show({ list: mk({ accounts: [tt] }) });
    expect(screen.getByTestId("ss-empty").textContent).toBe("No Shopee shop yet. It is added when you connect your Shopee live on the Live screen.");
    cleanup();
    const h2 = show({ list: null });
    expect(screen.getByTestId("ss-loading")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(h2.onBack).toHaveBeenCalled();
    void h;
  });
});
