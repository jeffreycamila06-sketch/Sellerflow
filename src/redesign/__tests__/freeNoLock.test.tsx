// Free plan: no 4-hour lock (sql/216, Jeff 2026-11-25) — the "Plan full" popup, the Shopee shops screen and the
// helpers they share. The database sends `no_lock: true` for a free seller (and no lock time); these screens then
// never show "Wait a little" and leave the 4-hour sentences out. "End your live first" stays.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { TProvider, buildT } from "../i18n";
import PlanFullPopup, { type RemoveResult } from "../components/PlanFullPopup";
import ShopeeShops from "../screens/ShopeeShops";
import { parseAccountList, lockMs, waitMs, lockNoteText, removeBodyText, type AccountList, type AccountRow } from "../adapters/planFull";

vi.mock("../components/AccountQuotaLine", () => ({ default: () => <div data-testid="account-quota-line">Accounts used: 1 of 1</div> }));

const NOW = Date.parse("2026-11-25T10:00:00Z");
const IN_3H = "2026-11-25T13:00:00Z";
const tt = (lockUntil: string | null = null): AccountRow => ({ platform: "tiktok", key: "budgetukay.ph", id: null, name: null, link: false, rank: 1, covered: true, addedAt: null, lockUntil });
const shop = (lockUntil: string | null = null): AccountRow => ({ platform: "shopee", key: "ph:111122223", id: "a", name: null, link: true, rank: 1, covered: true, addedAt: "2026-11-24T08:00:00Z", lockUntil });
const mk = (o: Partial<AccountList>): AccountList => ({ v2: true, plan: "free", limit: 1, unlimited: false, used: 1, locked: 0, nextFreeAt: null, serverNow: "2026-11-25T10:00:00Z", loadedAt: NOW, accounts: [tt()], noLock: true, ...o });
const NO_LIVE = { tiktok: null, facebook: null, instagram: null, shopeeUid: null, shopeeShopId: null };
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
afterEach(() => cleanup());

function popup(o: { list: AccountList; live?: typeof NO_LIVE; ios?: boolean; planName?: string }) {
  const onRemove = vi.fn(async () => ({ ok: true } as RemoveResult));
  const load = vi.fn(async () => o.list);
  render(<div data-redesign=""><TProvider lang="en">
    <PlanFullPopup target={{ kind: "shopee" }} ios={!!o.ios} planName={o.planName ?? "Free"} live={o.live ?? NO_LIVE} onRemove={onRemove} onUpgrade={() => {}} onClose={() => {}} load={load} now={() => NOW} />
  </TProvider></div>);
  return { onRemove };
}
const sheet = () => screen.getByTestId("pf-sheet").textContent || "";

describe("what the database sends", () => {
  it("no_lock true → noLock; absent / anything else (an older database) → false", () => {
    const raw = { v2: true, plan: "free", limit: 1, unlimited: false, used: 1, locked: 0, next_free_at: null, now: "2026-11-25T10:00:00Z", accounts: [{ platform: "tiktok", key: "a", rank: 1 }] };
    expect(parseAccountList({ ...raw, no_lock: true })?.noLock).toBe(true);
    expect(parseAccountList(raw)?.noLock).toBe(false);
    expect(parseAccountList({ ...raw, no_lock: "true" })?.noLock).toBe(false);
    expect(parseAccountList({ ...raw, no_lock: false })?.noLock).toBe(false);
  });
  it("noLock: never a lock time and never a wait, whatever else the answer holds", () => {
    const l = mk({ accounts: [tt(IN_3H)], locked: 1, used: 1, nextFreeAt: IN_3H });
    expect(lockMs(l.accounts[0], l, NOW)).toBeNull();
    expect(waitMs(l, { kind: "tiktok" }, NOW)).toBeNull();
    expect(waitMs(l, { kind: "shopee", wait: { nextFreeAt: IN_3H, serverNow: "2026-11-25T10:00:00Z", receivedAt: NOW } }, NOW)).toBeNull();
    // the same answer without no_lock = today's 3 hours
    const paid = { ...l, noLock: false };
    expect(lockMs(paid.accounts[0], paid, NOW)).toBe(3 * 3600_000);
    expect(waitMs({ ...paid, used: 1, accounts: [] }, { kind: "tiktok" }, NOW)).toBe(3 * 3600_000);
  });
  it("the two sentences without the 4 hours, in all 8 languages; with a lock = today's", () => {
    for (const lang of LANGS) {
      const t = buildT(lang);
      for (const s of [lockNoteText(mk({}), t), removeBodyText(mk({}), t)]) { expect(s.length).toBeGreaterThan(8); expect(s).not.toMatch(/4/); }
      expect(t.rd_pf_lock_note.startsWith(lockNoteText(mk({}), t).replace(/[.。]$/, ""))).toBe(true);     // the same first sentence as today
      expect(t.rd_pf_rm_body.startsWith(removeBodyText(mk({}), t).replace(/[.。]$/, ""))).toBe(true);
      expect(lockNoteText(mk({ noLock: false }), t)).toBe(t.rd_pf_lock_note);
      expect(removeBodyText(mk({ noLock: false }), t)).toBe(t.rd_pf_rm_body);
      expect(lockNoteText(null, t)).toBe(t.rd_pf_lock_note);
    }
  });
});

describe("Plan full popup — Free plan", () => {
  it("the list: Remove on the account, the note without the 4 hours", async () => {
    popup({ list: mk({}) });
    await flush();
    expect(screen.getByTestId("pf-lead").textContent).toBe("Your Free plan includes 1 account. This is your account now:");
    expect(screen.getByTestId("pf-note").textContent).toBe("To use Shopee, remove this account first. You can replace an account right away.");
    expect(screen.getByTestId("pf-remove")).toBeTruthy();
    expect(sheet()).not.toMatch(/4 hours|Wait a little|locked/i);
  });
  it("Remove → the question without the 4 hours → removed → 'you can add the new account now'", async () => {
    const lists = [mk({}), mk({ used: 0, accounts: [] })];
    const onRemove = vi.fn(async () => ({ ok: true } as RemoveResult));
    render(<div data-redesign=""><TProvider lang="en">
      <PlanFullPopup target={{ kind: "shopee" }} ios={false} planName="Free" live={NO_LIVE} onRemove={onRemove} onUpgrade={() => {}} onClose={() => {}} load={async () => (lists.length > 1 ? lists.shift()! : lists[0])} now={() => NOW} />
    </TProvider></div>);
    await flush();
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-sheet").getAttribute("data-phase")).toBe("confirm");
    expect(sheet()).toContain("Your orders and stickers stay. You can add a new account right away.");
    expect(sheet()).not.toMatch(/4 hours/);
    await act(async () => { fireEvent.click(screen.getByTestId("pf-confirm-remove")); });
    await flush();
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("pf-sheet").getAttribute("data-phase")).toBe("room");
    expect(sheet()).toContain("Removed. You can add the new account now.");
  });
  it("a lock time left in the answer changes nothing: Remove asks, it never says 'Wait a little'", async () => {
    popup({ list: mk({ accounts: [tt(IN_3H)], locked: 1, nextFreeAt: IN_3H }) });
    await flush();
    expect(screen.getByTestId("pf-sheet").getAttribute("data-phase")).toBe("list");
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-sheet").getAttribute("data-phase")).toBe("confirm");
    expect(sheet()).not.toMatch(/Wait a little|4 hours/);
  });
  it("the account that is live right now: 'End your live first', no Remove — Free too", async () => {
    popup({ list: mk({}), live: { ...NO_LIVE, tiktok: "@BudgetUkay.ph" } });
    await flush();
    expect(screen.getByTestId("pf-end-live").textContent).toBe("End your live first");
    expect(screen.queryByTestId("pf-remove")).toBeNull();
  });
  it("iPhone: the same, no 4 hours, Contact Admin", async () => {
    popup({ list: mk({}), ios: true });
    await flush();
    expect(sheet()).not.toMatch(/4 hours|Wait a little/);
    expect(screen.getByTestId("pf-contact")).toBeTruthy();
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(sheet()).toContain("You can add a new account right away.");
    expect(sheet()).not.toMatch(/4 hours/);
  });
  it("a paid seller's list (no_lock false) with a lock: 'Wait a little' as today", async () => {
    popup({ list: mk({ plan: "basic", noLock: false, accounts: [tt(IN_3H)] }), planName: "Basic" });
    await flush();
    expect(screen.getByTestId("pf-note").textContent).toContain("can't be changed again for 4 hours");
    fireEvent.click(screen.getByTestId("pf-remove"));
    expect(screen.getByTestId("pf-sheet").getAttribute("data-phase")).toBe("wait");
    expect(screen.getByTestId("pf-countdown").textContent).toContain("3h 0m");
  });
});

describe("Shopee shops screen — Free plan", () => {
  const show = (list: AccountList, live = NO_LIVE) => {
    const onRemove = vi.fn(async () => ({ ok: true as const }));
    render(<div data-redesign=""><TProvider lang="en"><ShopeeShops list={list} live={live} onRemove={onRemove} onReload={() => {}} onBack={() => {}} now={() => NOW} /></TProvider></div>);
    return { onRemove };
  };
  it("the note and the Remove question without the 4 hours; a lock time left in the answer never blocks Remove", async () => {
    const h = show(mk({ accounts: [shop(IN_3H)], locked: 1, nextFreeAt: IN_3H }));
    expect(screen.getByTestId("ss-lock-note").textContent).toBe("You can replace an account right away.");
    expect(screen.queryByTestId("ss-wait")).toBeNull();
    fireEvent.click(screen.getByTestId("ss-remove"));
    expect(screen.queryByTestId("ss-locked")).toBeNull();
    expect(screen.getByTestId("ss-confirm").textContent).toContain("Your orders and stickers stay. You can add a new account right away.");
    expect(document.body.textContent).not.toMatch(/4 hours|Wait a little/);
    await act(async () => { fireEvent.click(screen.getByTestId("ss-confirm-remove")); });
    await flush();
    expect(h.onRemove).toHaveBeenCalledTimes(1);
  });
  it("the shop that is live right now: 'End your live first', no Remove", () => {
    show(mk({ accounts: [shop()] }), { ...NO_LIVE, shopeeUid: "111122223" });
    expect(screen.getByTestId("ss-end-live").textContent).toBe("End your live first");
    expect(screen.queryByTestId("ss-remove")).toBeNull();
  });
  it("a paid seller's locked shop: 'Wait a little' as today", () => {
    show(mk({ plan: "basic", noLock: false, accounts: [shop(IN_3H)] }));
    expect(screen.getByTestId("ss-lock-note").textContent).toContain("4 hours");
    fireEvent.click(screen.getByTestId("ss-remove"));
    expect(screen.getByTestId("ss-locked")).toBeTruthy();
  });
});
