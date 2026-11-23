// "Plan full" popup — the pure helpers (adapters/planFull.ts).
import { describe, it, expect } from "vitest";
import { buildT } from "../../i18n";
import {
  accountLimitsV2Visible, parseAccountList, tiktokKey, shopTail, accountName, platformName, isAccountLive, waitMs, lockMs, countdownText, planFullTexts, waitLead,
  type AccountList, type AccountRow,
} from "../planFull";

const t = buildT("en");
const row = (o: Partial<AccountRow>): AccountRow => ({ platform: "tiktok", key: "shop_a", id: null, name: null, link: false, rank: 1, covered: true, addedAt: null, lockUntil: null, ...o });
const NOW = Date.parse("2026-11-22T10:00:00Z");
const list = (o: Partial<AccountList> = {}): AccountList => ({ v2: true, plan: "basic", limit: 1, unlimited: false, used: 1, locked: 0, nextFreeAt: null, serverNow: "2026-11-22T10:00:00Z", loadedAt: NOW, accounts: [row({})], ...o });

describe("who sees it", () => {
  it("admins, the preview key, or everyone once the switch is on; nobody else", () => {
    expect(accountLimitsV2Visible({ isAdmin: false, previewKey: false, switchOn: false })).toBe(false);
    expect(accountLimitsV2Visible({ isAdmin: true, previewKey: false, switchOn: false })).toBe(true);
    expect(accountLimitsV2Visible({ isAdmin: false, previewKey: true, switchOn: false })).toBe(true);
    expect(accountLimitsV2Visible({ isAdmin: false, previewKey: false, switchOn: true })).toBe(true);
  });
});

describe("parseAccountList (my_account_list)", () => {
  it("reads the numbers and the rows; drops unknown platforms and empty keys; odd values → safe defaults", () => {
    const l = parseAccountList({ v2: true, plan: "plus", limit: 2, unlimited: false, used: 3, locked: 1, next_free_at: "2026-11-22T12:15:00Z", now: "2026-11-22T10:00:00Z",
      accounts: [
        { platform: "tiktok", key: "a_shop", rank: 1, covered: true, link: false, added_at: "2026-11-01T00:00:00Z" },
        { platform: "shopee", key: "ph:12345678", id: "row-1", name: null, rank: 2, covered: false, link: true, lock_until: "2026-11-22T13:00:00Z" },
        { platform: "x", key: "y" }, { platform: "facebook", key: "" },
      ] })!;
    expect(l.limit).toBe(2); expect(l.used).toBe(3); expect(l.locked).toBe(1);
    expect(l.nextFreeAt).toBe("2026-11-22T12:15:00Z"); expect(l.serverNow).toBe("2026-11-22T10:00:00Z");
    expect(l.accounts.map((a) => `${a.platform}:${a.key}`)).toEqual(["tiktok:a_shop", "shopee:ph:12345678"]);
    expect(l.accounts[1]).toMatchObject({ id: "row-1", link: true, covered: false, lockUntil: "2026-11-22T13:00:00Z" });
    expect(l.accounts[0].lockUntil).toBeNull();                                  // no key (before sql/205) = not locked
    expect(parseAccountList({ accounts: [{ platform: "tiktok", key: "a", lock_until: "later" }] })!.accounts[0].lockUntil).toBeNull();
    expect(parseAccountList(null)).toBeNull();
    expect(parseAccountList({ plan: "x" })).toBeNull();
    expect(parseAccountList({ accounts: [], limit: "2", next_free_at: "soon" })).toMatchObject({ limit: 1, nextFreeAt: null });
  });
});

describe("names", () => {
  it("TikTok as the database keys it; a Shopee shop by the last 4 of its uid", () => {
    expect(tiktokKey(" @Shop_A ")).toBe("shop_a");
    expect(shopTail("ph:123456789")).toBe("6789");
    expect(accountName(row({}), t)).toBe("@shop_a");
    expect(accountName(row({ platform: "shopee", key: "ph:123456789", link: true }), t)).toBe("Shopee shop ·6789");
    expect(accountName(row({ platform: "facebook", key: "p1", name: "My Page" }), t)).toBe("My Page");
    expect(accountName(row({ platform: "facebook", key: "p1" }), t)).toBe("Facebook Page");
    expect(platformName("instagram", t)).toBe("Instagram");
  });
  it("the account live right now (→ End your live first instead of Remove)", () => {
    const live = { tiktok: "@Shop_A", facebook: "p1", instagram: null, shopeeUid: "123456789", shopeeShopId: null };
    expect(isAccountLive(row({}), live)).toBe(true);
    expect(isAccountLive(row({ key: "other" }), live)).toBe(false);
    expect(isAccountLive(row({ platform: "facebook", key: "p1" }), live)).toBe(true);
    expect(isAccountLive(row({ platform: "shopee", key: "ph:123456789", link: true }), live)).toBe(true);
    expect(isAccountLive(row({ platform: "shopee", key: "ph:999", link: true }), live)).toBe(false);
    expect(isAccountLive(row({ platform: "instagram", key: "i1" }), live)).toBe(false);
  });
});

describe("the 4-hour wait", () => {
  it("only when the real accounts leave room and a held place fills the plan; measured on the server's clock", () => {
    const held = list({ limit: 1, used: 1, locked: 1, accounts: [], nextFreeAt: "2026-11-22T12:15:00Z" });
    expect(waitMs(held, { kind: "shopee" }, NOW)).toBe(2 * 3600_000 + 15 * 60_000);
    // it counts down as this device's time passes
    expect(waitMs(held, { kind: "shopee" }, NOW + 60_000)).toBe(2 * 3600_000 + 14 * 60_000);
    // the phone's clock is 1 hour late (loaded when it said 09:00): the server's time still decides
    const late = { ...held, loadedAt: NOW - 3600_000 };
    expect(waitMs(late, { kind: "shopee" }, NOW - 3600_000)).toBe(2 * 3600_000 + 15 * 60_000);
    expect(waitMs(late, { kind: "shopee" }, NOW - 3600_000 + 60_000)).toBe(2 * 3600_000 + 14 * 60_000);
    expect(waitMs(list({ locked: 0 }), { kind: "shopee" }, NOW)).toBeNull();                      // a full plan, no held place
    expect(waitMs(list({ limit: 1, used: 2, locked: 1, nextFreeAt: "2026-11-22T12:00:00Z" }), { kind: "shopee" }, NOW)).toBeNull(); // real accounts already fill it
    expect(waitMs(held, { kind: "shopee" }, NOW + 3 * 3600_000)).toBeNull();                      // the wait is over
    // the server's refusal carries the wait itself (no list needed)
    expect(waitMs(null, { kind: "shopee", wait: { nextFreeAt: "2026-11-22T10:30:00Z", serverNow: "2026-11-22T10:00:00Z", receivedAt: 5_000 } }, 5_000)).toBe(30 * 60_000);
    expect(waitMs(null, { kind: "shopee", wait: { nextFreeAt: "2026-11-22T10:30:00Z", serverNow: "2026-11-22T10:00:00Z", receivedAt: 5_000 } }, 5_000 + 10 * 60_000)).toBe(20 * 60_000);
  });
  it("countdown text", () => {
    expect(countdownText(2 * 3600_000 + 15 * 60_000, t)).toBe("2h 15m");
    expect(countdownText(30_000, t)).toBe("0h 1m");
    expect(countdownText(0, t)).toBe("0h 0m");
    expect(waitLead({ kind: "shopee" }, t)).toBe("An account was changed less than 4 hours ago. You can add a new Shopee shop in:");
  });
});

describe("an account's own 4 hours (sql/205: it took a removed account's place)", () => {
  const locked = row({ key: "new_shop", lockUntil: "2026-11-22T13:30:00Z" });
  it("the time left on the server's clock; null when it is not locked, when it is over, for an admin", () => {
    const l = list({ accounts: [locked] });
    expect(lockMs(locked, l, NOW)).toBe(3 * 3600_000 + 30 * 60_000);
    expect(lockMs(locked, l, NOW + 60_000)).toBe(3 * 3600_000 + 29 * 60_000);            // it counts down
    const late = { ...l, loadedAt: NOW - 3600_000 };                                     // the phone's clock is 1 hour late
    expect(lockMs(locked, late, NOW - 3600_000)).toBe(3 * 3600_000 + 30 * 60_000);
    expect(lockMs(locked, l, NOW + 4 * 3600_000)).toBeNull();                            // over
    expect(lockMs(row({}), l, NOW)).toBeNull();                                          // never locked
    expect(lockMs(locked, list({ unlimited: true, accounts: [locked] }), NOW)).toBeNull(); // an admin / exempt seller
    expect(lockMs(locked, null, NOW)).toBeNull();
  });
  it("a locked account alone is not the 'held place' wait (nothing was removed)", () => {
    expect(waitMs(list({ accounts: [locked] }), { kind: "tiktok" }, NOW)).toBeNull();
  });
});

describe("texts (the approved design)", () => {
  it("Basic, one account, Shopee: the design's state 1", () => {
    const tx = planFullTexts({ list: list(), target: { kind: "shopee" }, ios: false, planName: "Basic", t });
    expect(tx.title).toBe("Plan full");
    expect(tx.lead).toBe("Your Basic plan includes 1 account. This is your account now:");
    expect(tx.note).toBe("To use Shopee, remove this account first. You can replace an account right away. The new account then can't be changed again for 4 hours.");
  });
  it("Plus, two accounts: lead names the goal, note = the 4-hour line", () => {
    const tx = planFullTexts({ list: list({ limit: 2, accounts: [row({}), row({ platform: "facebook", key: "p1" })] }), target: { kind: "shopee" }, ios: false, planName: "Plus", t });
    expect(tx.lead).toBe("Your Plus plan includes 2 accounts. To use Shopee, remove one of them first.");
    expect(tx.note).toBe("You can replace an account right away. The new account then can't be changed again for 4 hours.");
  });
  it("live start with an account outside the plan", () => {
    const tx = planFullTexts({ list: list({ limit: 1, accounts: [row({}), row({ key: "second", covered: false })] }), target: { kind: "live", name: "@second" }, ios: false, planName: "Basic", t });
    expect(tx.lead).toBe("Your Basic plan includes 1 account. To go live with @second, remove another account first.");
    expect(tx.note).toBe("");
  });
  it("iPhone: no plan or upgrade words (App Store rule)", () => {
    for (const kind of ["tiktok", "facebook", "instagram", "shopee", "live"] as const) {
      for (const accounts of [[row({})], [row({}), row({ key: "b" })]]) {
        const tx = planFullTexts({ list: list({ limit: accounts.length, accounts }), target: { kind, name: "@x" }, ios: true, planName: "Basic", t });
        expect(`${tx.title} ${tx.lead} ${tx.note}`).not.toMatch(/plan|upgrade|basic|subscri|price/i);
      }
    }
  });
});
