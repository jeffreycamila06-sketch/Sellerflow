// The "Plan full" popup (components/PlanFullPopup.tsx) — every state of Jeff's approved design:
// 1 full (Basic, one account) · 2 confirm Remove · 3 full with two accounts + Upgrade plan · 4 "Wait a little"
// countdown · 5 an account live right now ("End your live first"); iPhone = Contact Admin, no plan words.
// sql/205 (Jeff 2026-11-22): the first swap is free — a removal is followed by "you can add the new account now";
// Remove on an account that took a place less than 4 hours ago shows "Wait a little" and removes nothing.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import PlanFullPopup, { type RemoveResult } from "../PlanFullPopup";
import { TELEGRAM_URL } from "../../../lib/telegram";
import type { AccountList, AccountRow, PlanFullTarget } from "../../adapters/planFull";

const t = buildT("en");
const NOW = Date.parse("2026-11-22T10:00:00Z");
const tt: AccountRow = { platform: "tiktok", key: "bysheilaph.clothing", id: null, name: null, link: false, rank: 1, covered: true, addedAt: null, lockUntil: null };
const fb: AccountRow = { platform: "facebook", key: "p1", id: "fb-row", name: "Sheila PH Clothing", link: false, rank: 2, covered: true, addedAt: null, lockUntil: null };
const shop: AccountRow = { platform: "shopee", key: "ph:123456789", id: "sh-row", name: null, link: true, rank: 2, covered: false, addedAt: null, lockUntil: null };
const mk = (o: Partial<AccountList>): AccountList => ({ v2: true, plan: "basic", limit: 1, unlimited: false, used: 1, locked: 0, nextFreeAt: null, serverNow: "2026-11-22T10:00:00Z", loadedAt: NOW, accounts: [fb], ...o });
const NO_LIVE = { tiktok: null, facebook: null, instagram: null, shopeeUid: null, shopeeShopId: null };
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

function open(o: { target?: PlanFullTarget; ios?: boolean; lists?: (AccountList | null)[]; live?: typeof NO_LIVE; onRemove?: (a: AccountRow) => Promise<RemoveResult>; now?: () => number; planName?: string }) {
  const lists = [...(o.lists ?? [mk({})])];
  const load = vi.fn(async () => (lists.length > 1 ? lists.shift()! : lists[0]));
  const onRemove = vi.fn(o.onRemove ?? (async () => ({ ok: true } as RemoveResult)));
  const onUpgrade = vi.fn(); const onClose = vi.fn();
  render(
    <div data-redesign="">
      <TProvider lang="en">
        <PlanFullPopup target={o.target ?? { kind: "shopee" }} ios={!!o.ios} planName={o.planName ?? "Basic"} live={o.live ?? NO_LIVE}
          onRemove={onRemove} onUpgrade={onUpgrade} onClose={onClose} load={load} now={o.now ?? (() => NOW)} />
      </TProvider>
    </div>,
  );
  return { load, onRemove, onUpgrade, onClose };
}
const text = () => screen.getByTestId("pf-sheet").textContent || "";
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("state 1 — plan full, one account (Basic → Shopee)", () => {
  it("title, lead, the account with Remove, the note, Upgrade plan + Cancel; drawn inside [data-redesign]", async () => {
    const h = open({});
    await flush();
    expect(screen.getByTestId("pf-title").textContent).toBe("Plan full");
    expect(screen.getByTestId("pf-lead").textContent).toBe("Your Basic plan includes 1 account. This is your account now:");
    expect(screen.getAllByTestId("pf-row-name").map((n) => n.textContent)).toEqual(["Sheila PH Clothing"]);
    expect(screen.getByTestId("pf-remove")).toBeTruthy();
    expect(screen.getByTestId("pf-note").textContent).toBe("To use Shopee, remove this account first. You can replace an account right away. The new account then can't be changed again for 4 hours.");
    fireEvent.click(screen.getByTestId("pf-upgrade"));
    expect(h.onUpgrade).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("pf-cancel"));
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("pf-overlay").parentElement?.hasAttribute("data-redesign")).toBe(true);
    expect(h.load).toHaveBeenCalledTimes(1);
  });
  it("iPhone: Contact Admin is a real link to Telegram; no plan / upgrade / price words anywhere", async () => {
    open({ ios: true });
    await flush();
    const a = screen.getByTestId("pf-contact") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(TELEGRAM_URL);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(screen.queryByTestId("pf-upgrade")).toBeNull();
    expect(screen.getByTestId("pf-title").textContent).toBe("No room for another account");
    expect(text()).not.toMatch(/plan|upgrade|basic|price|subscri/i);
  });
});

describe("state 2 — confirm Remove", () => {
  it("Remove → \"Remove X?\" with the orders-stay line; Keep it goes back; nothing removed", async () => {
    const h = open({ lists: [mk({ accounts: [tt] })], target: { kind: "shopee" } });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-title").textContent).toBe("Remove @bysheilaph.clothing?");
    expect(screen.getByTestId("pf-lead").textContent).toBe("Your orders and stickers stay. You can add a new account right away. After that, it can't be changed again for 4 hours.");
    expect(screen.getByTestId("pf-confirm-remove").textContent).toBe("Remove");
    fireEvent.click(screen.getByTestId("pf-keep"));
    expect(screen.getByTestId("pf-list")).toBeTruthy();
    expect(h.onRemove).not.toHaveBeenCalled();
  });
  it("THE FIRST SWAP IS FREE: Remove → removed, the list is read again → \"you can add the new account now\", no wait", async () => {
    const after = mk({ accounts: [], used: 0, locked: 0, nextFreeAt: null });          // sql/205: a removal holds no place
    const h = open({ lists: [mk({}), after] });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(h.onRemove).toHaveBeenCalledWith(fb);
    expect(h.load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("pf-title").textContent).toBe("Removed");
    expect(screen.getByTestId("pf-lead").textContent).toBe("Removed. You can add the new account now.");
    expect(screen.queryByTestId("pf-countdown")).toBeNull();
    expect(text()).not.toMatch(/wait/i);
  });
  it("the first swap is free for every kind of account (TikTok, Facebook, Instagram, Shopee)", async () => {
    const ig: AccountRow = { platform: "instagram", key: "i1", id: "ig-row", name: "sheila.ig", link: false, rank: 1, covered: true, addedAt: null, lockUntil: null };
    const shopRow: AccountRow = { ...shop, covered: true, rank: 1 };
    for (const [acc, kind] of [[tt, "facebook"], [fb, "tiktok"], [ig, "shopee"], [shopRow, "instagram"]] as const) {
      const h = open({ target: { kind }, lists: [mk({ accounts: [acc] }), mk({ accounts: [], used: 0 })] });
      await flush();
      fireEvent.click(screen.getByTestId("pf-remove"));
      expect(screen.getByTestId("pf-confirm-remove"), acc.platform).toBeTruthy();      // the confirm, not the wait
      await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
      await flush();
      expect(h.onRemove, acc.platform).toHaveBeenCalledWith(acc);
      expect(screen.getByTestId("pf-lead").textContent, acc.platform).toBe("Removed. You can add the new account now.");
      cleanup();
    }
  });
  it("after a removal the database still holds a place (a locked account was removed another way) → the countdown", async () => {
    const after = mk({ accounts: [], used: 1, locked: 1, nextFreeAt: "2026-11-22T14:00:00Z" });
    open({ lists: [mk({}), after] });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(screen.getByTestId("pf-title").textContent).toBe("Wait a little");
    expect(screen.getByTestId("pf-lead").textContent).toBe("An account was changed less than 4 hours ago. You can add a new Shopee shop in:");
    expect(screen.getByTestId("pf-countdown").textContent).toBe("4h 0m");
  });
  it("a TikTok name changed less than 4 hours ago → the slot message; any other failure → try again", async () => {
    open({ onRemove: async () => ({ ok: false, error: "cooldown" }) });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(screen.getByTestId("pf-error").textContent).toBe(t.rd_ch_cooldown_err);
    cleanup();
    open({ onRemove: async () => ({ ok: false, error: "failed" }) });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(screen.getByTestId("pf-error").textContent).toBe("Couldn't remove it. Try again.");
  });
});

describe("state 3 — two accounts, Upgrade plan (Android / web)", () => {
  it("the lead names the goal; both accounts can be removed", async () => {
    open({ lists: [mk({ plan: "plus", limit: 2, used: 2, accounts: [tt, fb] })], planName: "Plus" });
    await flush();
    expect(screen.getByTestId("pf-lead").textContent).toBe("Your Plus plan includes 2 accounts. To use Shopee, remove one of them first.");
    expect(screen.getAllByTestId("pf-remove")).toHaveLength(2);
    expect(screen.getByTestId("pf-note").textContent).toBe("You can replace an account right away. The new account then can't be changed again for 4 hours.");
    expect(screen.getByTestId("pf-upgrade").textContent).toBe("Upgrade plan");
  });
});

describe("state 4 — the 4-hour wait", () => {
  it("opened from the server's refusal: live countdown on the server's clock, ticking every second", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let now = 5_000;                                   // the phone's own clock is far off — the server's time decides
    open({ target: { kind: "shopee", wait: { nextFreeAt: "2026-11-22T12:15:00Z", serverNow: "2026-11-22T10:00:00Z", receivedAt: 5_000 } }, now: () => now });
    await flush();
    expect(screen.getByTestId("pf-title").textContent).toBe("Wait a little");
    expect(screen.getByTestId("pf-countdown").textContent).toBe("2h 15m");
    now += 61_000;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("pf-countdown").textContent).toBe("2h 14m");
    fireEvent.click(screen.getByTestId("pf-back"));
    expect(screen.getByTestId("pf-list")).toBeTruthy();
  });
  it("from the list's numbers: held place + room → the wait, OK closes", async () => {
    const h = open({ lists: [mk({ accounts: [], used: 1, locked: 1, nextFreeAt: "2026-11-22T10:30:00Z" })] });
    await flush();
    expect(screen.getByTestId("pf-countdown").textContent).toBe("0h 30m");
    fireEvent.click(screen.getByTestId("pf-ok"));
    expect(h.onClose).toHaveBeenCalled();
  });
});

describe("THE SECOND SWAP inside the 4 hours — Remove on a locked account", () => {
  const lockedFb: AccountRow = { ...fb, lockUntil: "2026-11-22T13:30:00Z" };          // it took a place 30 minutes ago
  it("every kind of account: \"Wait a little\" + the time left, live; nothing is removed; no confirm", async () => {
    const ig: AccountRow = { platform: "instagram", key: "i1", id: "ig-row", name: "sheila.ig", link: false, rank: 1, covered: true, addedAt: null, lockUntil: "2026-11-22T13:30:00Z" };
    const cases: [AccountRow, string][] = [
      [{ ...tt, lockUntil: "2026-11-22T13:30:00Z" }, "@bysheilaph.clothing"], [lockedFb, "Sheila PH Clothing"], [ig, "sheila.ig"],
      [{ ...shop, covered: true, lockUntil: "2026-11-22T13:30:00Z" }, "Shopee shop ·6789"],
    ];
    for (const [acc, name] of cases) {
      const h = open({ target: { kind: "tiktok" }, lists: [mk({ accounts: [acc] })] });
      await flush();
      expect(screen.getByTestId("pf-list"), name).toBeTruthy();                        // a locked account alone opens the list, not the wait
      fireEvent.click(screen.getByTestId("pf-remove"));
      expect(screen.getByTestId("pf-title").textContent, name).toBe("Wait a little");
      expect(screen.getByTestId("pf-lead-locked").textContent, name).toBe(`${name} replaced another account less than 4 hours ago. You can change it again in:`);
      expect(screen.getByTestId("pf-countdown").textContent, name).toBe("3h 30m");
      expect(screen.queryByTestId("pf-confirm-remove"), name).toBeNull();
      expect(h.onRemove, name).not.toHaveBeenCalled();
      cleanup();
    }
  });
  it("the countdown runs on the server's clock and ticks; Back returns to the list; OK closes", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let now = NOW;
    const h = open({ lists: [mk({ accounts: [lockedFb] })], now: () => now });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-countdown").textContent).toBe("3h 30m");
    now += 61_000;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("pf-countdown").textContent).toBe("3h 29m");
    fireEvent.click(screen.getByTestId("pf-back"));
    expect(screen.getByTestId("pf-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pf-remove"));
    fireEvent.click(screen.getByTestId("pf-ok"));
    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onRemove).not.toHaveBeenCalled();
  });
  it("two accounts, one locked: the other one is removed as usual (the first swap of that place)", async () => {
    const h = open({ lists: [mk({ plan: "plus", limit: 2, used: 2, accounts: [tt, lockedFb] }), mk({ plan: "plus", limit: 2, used: 1, accounts: [lockedFb] })], planName: "Plus" });
    await flush();
    fireEvent.click(screen.getAllByTestId("pf-remove")[0]);
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(h.onRemove).toHaveBeenCalledWith(tt);
    expect(screen.getByTestId("pf-lead").textContent).toBe("Removed. You can add the new account now.");
  });
  it("the 4 hours are over → Remove works again; an admin's list (no limit) is never locked", async () => {
    open({ lists: [mk({ accounts: [lockedFb] })], now: () => NOW + 4 * 3600_000 });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-confirm-remove")).toBeTruthy();
    cleanup();
    open({ lists: [mk({ unlimited: true, accounts: [lockedFb] })] });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-confirm-remove")).toBeTruthy();
  });
  it("iPhone: the locked sheet has no plan / upgrade / price words", async () => {
    open({ ios: true, lists: [mk({ accounts: [lockedFb] })] });
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-title").textContent).toBe("Wait a little");
    expect(text()).not.toMatch(/plan|upgrade|basic|price|subscri/i);
  });
});

describe("state 5 — an account live right now", () => {
  it("shows \"TikTok · live now\" and \"End your live first\" instead of Remove; the others keep Remove", async () => {
    open({ lists: [mk({ plan: "plus", limit: 2, accounts: [tt, fb] })], live: { ...NO_LIVE, tiktok: "@BySheilaPH.clothing" }, planName: "Plus" });
    await flush();
    const rows = screen.getAllByTestId("pf-row");
    expect(rows[0].textContent).toContain("TikTok · live now");
    expect(rows[0].querySelector("[data-testid=pf-end-live]")?.textContent).toBe("End your live first");
    expect(rows[0].querySelector("[data-testid=pf-remove]")).toBeNull();
    expect(rows[1].querySelector("[data-testid=pf-remove]")).toBeTruthy();
  });
});

describe("live start with an account outside the plan", () => {
  it("the not-covered shop is marked; after a removal: \"You can go live with … now\"", async () => {
    const h = open({ target: { kind: "live", name: "Shopee shop" }, lists: [mk({ accounts: [tt, shop] })] });
    await flush();
    expect(screen.getByTestId("pf-lead").textContent).toBe("Your Basic plan includes 1 account. To go live with Shopee shop, remove another account first.");
    expect(screen.getAllByTestId("pf-row-name").map((n) => n.textContent)).toEqual(["@bysheilaph.clothing", "Shopee shop ·6789"]);
    expect(screen.getByTestId("pf-row-not-covered").textContent).toContain("Not covered");
    fireEvent.click(screen.getAllByTestId("pf-remove")[0]);
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(h.onRemove).toHaveBeenCalledWith(tt);
    expect(screen.getByTestId("pf-title").textContent).toBe("Removed");
    expect(screen.getByTestId("pf-lead").textContent).toBe("You can go live with Shopee shop now. Tap Connect again.");
  });
});

describe("edges", () => {
  it("the list can't be read → one honest line + the same buttons", async () => {
    open({ lists: [null] });
    await flush();
    expect(screen.getByTestId("pf-lead").textContent).toBe("Couldn't load your accounts. Try again.");
    expect(screen.getByTestId("pf-upgrade")).toBeTruthy();
  });
  it("Escape and a tap outside close it; a tap inside does not", async () => {
    const h = open({});
    await flush();
    fireEvent.click(screen.getByTestId("pf-sheet"));
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("pf-overlay"));
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });
  it("every text it shows exists in all 8 languages", () => {
    const keys = Object.keys(t).filter((k) => k.startsWith("rd_pf_"));
    expect(keys.length).toBeGreaterThan(40);
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const tl = buildT(lang) as unknown as Record<string, string>;
      for (const k of keys) expect(tl[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});
