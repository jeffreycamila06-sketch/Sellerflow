// Admin → Free tier list (2026-11-26): groups (Using now · Finished · No orders yet), filter chips,
// "Last order", and the look-alike warning + sheet. The last order times come from sql/228
// (admin_free_tier_activity), played here by a stand-in that answers like the function: [] for a
// caller who is not admin. The real database rule is proven by scripts/sql228-behaviour.mjs.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { FreeUserRow } from "../../adapters/useReadData";

const DB = vi.hoisted(() => ({ admin: true, fail: false, last: {} as Record<string, string | null>, calls: 0 }));
vi.mock("../../../supabase", () => {
  const rpc = async (fn: string) => {
    if (fn !== "admin_free_tier_activity") return { data: [], error: null };
    DB.calls++;
    if (DB.fail) return { data: null, error: { message: "function public.admin_free_tier_activity() does not exist" } };
    if (!DB.admin) return { data: [], error: null };
    return { data: Object.entries(DB.last).map(([email, last_order_at]) => ({ email, last_order_at })), error: null };
  };
  const from = () => ({ select: async () => ({ data: [], error: null }) });
  return { supabase: { from, rpc }, isSupabaseConfigured: true };
});
vi.mock("../../adapters/appShell", async (importActual) => ({ ...(await importActual<object>()), isAppShell: () => false }));

import { AdminPanel } from "../Admin";
import { accountUsersToRedesign } from "../../adapters/useReadData";
import { lookalikeKey, keysOf, lookalikeGroups, groupFreeRows, filterFreeRows, agoParts, isActive7 } from "../../adapters/freeTierList";

const H = 3600e3, D = 864e5;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const raw = (email: string, o: { tiktok?: string; shop?: string; joined?: string; plan?: AccountUser["plan"] } = {}): AccountUser => ({
  authUserId: email, email, plan: o.plan || "free", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller", createdAt: o.joined || "2026-11-01T00:00:00Z",
  profile: { fullName: "", storeName: o.shop || "", phone: "", tiktok: o.tiktok || "", facebook: "", adminContactNote: "", country: "TW" },
});
const fr = (email: string, count: number, shop = ""): FreeUserRow => ({ email, store_name: shop, full_name: "", count, cap: 150, near_cap: count >= 110, capped: count >= 150, cycle_resets_in_days: 0 });

// The free list: three budgetukay look-alikes, one short-key pair, a finished one, two with no orders.
const FREE = [
  fr("b1@x.com", 30, "Budget Ukay"), fr("b2@x.com", 150, ""), fr("b4@x.com", 0, ""),
  fr("ab1@x.com", 5, "ab"), fr("ab2@x.com", 6, "ab"),
  fr("solo@x.com", 90, "Solo Shop"), fr("done@x.com", 150, "Done Shop"),
  fr("new1@x.com", 0, "New One"), fr("new2@x.com", 0, "New Two"),
];
const RAW: AccountUser[] = [
  raw("b1@x.com", { tiktok: "budgetukay1", shop: "Budget Ukay" }), raw("b2@x.com", { tiktok: "@budget_ukay2" }), raw("b4@x.com", { tiktok: "budgetukay4", joined: "2026-10-01T00:00:00Z" }),
  raw("ab1@x.com", { tiktok: "ab1", shop: "ab" }), raw("ab2@x.com", { tiktok: "ab_2", shop: "ab" }),
  raw("solo@x.com", { tiktok: "solo.shop", shop: "Solo Shop" }), raw("done@x.com", { tiktok: "doneshop", shop: "Done Shop" }),
  raw("new1@x.com", { tiktok: "newone", shop: "New One", joined: "2026-11-20T00:00:00Z" }), raw("new2@x.com", { tiktok: "newtwo", shop: "New Two", joined: "2026-11-25T00:00:00Z" }),
  // a PAID seller with the same name — must never be compared or shown
  raw("paid@x.com", { tiktok: "budgetukay9", shop: "Budget Ukay", plan: "pro" }),
];
const rawByEmail = Object.fromEntries(RAW.map((u) => [u.email, u]));
const LAST: Record<string, string | null> = {
  "b1@x.com": ago(3 * H), "b2@x.com": ago(2 * D), "b4@x.com": null,
  "ab1@x.com": ago(10 * D), "ab2@x.com": ago(1 * H),
  "solo@x.com": ago(20 * H), "done@x.com": ago(30 * D),
  "new1@x.com": null, "new2@x.com": null,
};
const lastMap = new Map(Object.entries(LAST).map(([e, v]) => [e, v ? Date.parse(v) : null]));

const view = () => render(<TProvider lang="en"><AdminPanel panel="subFree" onClose={() => {}} cur="NT$" users={accountUsersToRedesign(RAW)} usersState="live" rawByEmail={rawByEmail} freeUsers={FREE} freeUsersState="live" /></TProvider>);
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const emailsIn = (group: string) => Array.from(document.querySelectorAll(`[data-testid='ft-group-${group}'] [data-testid='ft-row']`)).map((r) => r.getAttribute("data-email"));
const allRows = () => Array.from(document.querySelectorAll("[data-testid='ft-row']")).map((r) => r.getAttribute("data-email"));

beforeEach(() => { DB.admin = true; DB.fail = false; DB.last = { ...LAST }; DB.calls = 0; });
afterEach(() => cleanup());

describe("look-alike key", () => {
  it("lower case, digits . _ - spaces and a leading @ removed", () => {
    expect(lookalikeKey("budgetukay1")).toBe("budgetukay");
    expect(lookalikeKey("budget_ukay2")).toBe("budgetukay");
    expect(lookalikeKey("@BudgetUkay4")).toBe("budgetukay");
    expect(lookalikeKey("Budget Ukay")).toBe("budgetukay");
    expect(lookalikeKey("solo.shop-22")).toBe("soloshop");
  });
  it("keys shorter than 4 are ignored", () => {
    expect(lookalikeKey("ab1")).toBeNull();
    expect(lookalikeKey("ab_2")).toBeNull();
    expect(lookalikeKey("a.b.c")).toBeNull();
    expect(lookalikeKey("")).toBeNull();
    expect(lookalikeKey("1234")).toBeNull();
    expect(lookalikeKey("abcd")).toBe("abcd");
  });
  it("a row's keys = each TikTok username + the shop name", () => {
    expect(keysOf(fr("x@x.com", 1, "Budget Ukay"), raw("x@x.com", { tiktok: "budgetukay1, other.name7" })).sort()).toEqual(["budgetukay", "othername"]);
  });
});

describe("look-alike groups", () => {
  it("budgetukay1 / budget_ukay2 / budgetukay4 = one group", () => {
    const g = lookalikeGroups(FREE, rawByEmail);
    expect(g.get("b1@x.com")?.sort()).toEqual(["b1@x.com", "b2@x.com", "b4@x.com"]);
    expect(g.get("b2@x.com")).toBe(g.get("b1@x.com"));
    expect(g.get("b4@x.com")).toBe(g.get("b1@x.com"));
  });
  it("short keys never make a group (ab1 / ab_2 with shop 'ab')", () => {
    const g = lookalikeGroups(FREE, rawByEmail);
    expect(g.has("ab1@x.com")).toBe(false);
    expect(g.has("ab2@x.com")).toBe(false);
  });
  it("a single account is no group", () => {
    const g = lookalikeGroups(FREE, rawByEmail);
    for (const e of ["solo@x.com", "done@x.com", "new1@x.com", "new2@x.com"]) expect(g.has(e)).toBe(false);
    expect(g.size).toBe(3);
  });
  it("a paid seller is never compared: only the free rows passed in are grouped", () => {
    const g = lookalikeGroups(FREE, rawByEmail);
    expect(g.has("paid@x.com")).toBe(false);
    expect([...g.values()].flat()).not.toContain("paid@x.com");
    // one free account + the paid look-alike → still no group
    const g2 = lookalikeGroups([fr("b1@x.com", 1, "Budget Ukay")], rawByEmail);
    expect(g2.size).toBe(0);
  });
  it("accounts joined through a shared key in a chain are one group", () => {
    const rows = [fr("c1@x.com", 1, "Sunny Closet"), fr("c2@x.com", 1, ""), fr("c3@x.com", 1, "")];
    const r = { "c1@x.com": raw("c1@x.com", { tiktok: "sunny01", shop: "Sunny Closet" }), "c2@x.com": raw("c2@x.com", { tiktok: "sunny.closet" }), "c3@x.com": raw("c3@x.com", { tiktok: "sunny_02" }) };
    expect(lookalikeGroups(rows, r).get("c3@x.com")?.sort()).toEqual(["c1@x.com", "c2@x.com", "c3@x.com"]);
  });
});

describe("group order", () => {
  it("Using now (newest last order) · Finished (newest last order) · No orders yet (newest joined)", () => {
    const g = groupFreeRows(FREE, lastMap, rawByEmail);
    expect(g.using.map((r) => r.email)).toEqual(["ab2@x.com", "b1@x.com", "solo@x.com", "ab1@x.com"]);
    expect(g.finished.map((r) => r.email)).toEqual(["b2@x.com", "done@x.com"]);
    expect(g.none.map((r) => r.email)).toEqual(["new2@x.com", "new1@x.com", "b4@x.com"]);
  });
  it("no last order time → bottom of its group; read failed → server order kept", () => {
    const m = new Map(lastMap); m.set("b1@x.com", null);
    expect(groupFreeRows(FREE, m, rawByEmail).using.map((r) => r.email)).toEqual(["ab2@x.com", "solo@x.com", "ab1@x.com", "b1@x.com"]);
    expect(groupFreeRows(FREE, null, rawByEmail).using.map((r) => r.email)).toEqual(["b1@x.com", "ab1@x.com", "ab2@x.com", "solo@x.com"]);
  });
  it("filters: Active 7 days = last order within 7 days; Look-alike = grouped rows", () => {
    const g = lookalikeGroups(FREE, rawByEmail);
    expect(filterFreeRows(FREE, "active", lastMap, g, NOW).map((r) => r.email).sort()).toEqual(["ab2@x.com", "b1@x.com", "b2@x.com", "solo@x.com"]);
    expect(filterFreeRows(FREE, "look", lastMap, g, NOW).map((r) => r.email).sort()).toEqual(["b1@x.com", "b2@x.com", "b4@x.com"]);
    expect(filterFreeRows(FREE, "all", lastMap, g, NOW)).toHaveLength(FREE.length);
    expect(isActive7(NOW - 7 * D, NOW)).toBe(true);
    expect(isActive7(NOW - 7 * D - 1, NOW)).toBe(false);
    expect(isActive7(null, NOW)).toBe(false);
  });
  it("time ago", () => {
    expect(agoParts(NOW - 30e3, NOW)).toEqual({ kind: "now", n: 0 });
    expect(agoParts(NOW - 5 * 60e3, NOW)).toEqual({ kind: "m", n: 5 });
    expect(agoParts(NOW - 3 * H, NOW)).toEqual({ kind: "h", n: 3 });
    expect(agoParts(NOW - 2 * D, NOW)).toEqual({ kind: "d", n: 2 });
  });
});

describe("the panel", () => {
  it("shows the three groups with counts, in order, and reads the last order times ONCE", async () => {
    view();
    await waitFor(() => expect(q("ft-last")?.textContent).not.toBe("Last order —"));
    expect(q("ft-group-using-head")?.textContent).toBe("Using now · 4");
    expect(q("ft-group-finished-head")?.textContent).toBe("Finished 150 · 2");
    expect(q("ft-group-none-head")?.textContent).toBe("No orders yet · 3");
    expect(emailsIn("using")).toEqual(["ab2@x.com", "b1@x.com", "solo@x.com", "ab1@x.com"]);
    expect(emailsIn("finished")).toEqual(["b2@x.com", "done@x.com"]);
    expect(emailsIn("none")).toEqual(["new2@x.com", "new1@x.com", "b4@x.com"]);
    const groups = Array.from(document.querySelectorAll("[data-testid^='ft-group-'][data-testid$='-head']")).map((n) => n.getAttribute("data-testid"));
    expect(groups).toEqual(["ft-group-using-head", "ft-group-finished-head", "ft-group-none-head"]);
    await new Promise((r) => setTimeout(r, 30));
    expect(DB.calls).toBe(1);
  });
  it("each row: 'x / 150' + 'Last order …' (green within 24 h) / 'No orders yet'", async () => {
    view();
    await waitFor(() => expect(q("ft-last")?.textContent).not.toBe("Last order —"));
    const rowOf = (e: string) => document.querySelector(`[data-testid='ft-row'][data-email='${e}']`) as HTMLElement;
    const lastOfRow = (e: string) => within(rowOf(e)).getByTestId("ft-last");
    expect(rowOf("b1@x.com").textContent).toContain("30 / 150");
    expect(lastOfRow("b1@x.com").textContent).toBe("Last order 3h ago");
    expect(lastOfRow("b1@x.com").getAttribute("data-recent")).toBe("1");
    expect(lastOfRow("solo@x.com").getAttribute("data-recent")).toBe("1");
    expect(lastOfRow("b2@x.com").textContent).toBe("Last order 2d ago");
    expect(lastOfRow("b2@x.com").getAttribute("data-recent")).toBe("0");
    expect(lastOfRow("new1@x.com").textContent).toBe("No orders yet");
    expect(rowOf("new1@x.com").textContent).toContain("Joined Nov 20");
  });
  it("chips: All · 9 / Active 7 days · 4 / ⚠ Look-alike · 3, and they filter", async () => {
    view();
    await waitFor(() => expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 4"));
    expect(q("ft-chip-all")?.textContent).toBe("All · 9");
    expect(q("ft-chip-look")?.textContent).toBe("⚠ Look-alike · 3");
    fireEvent.click(q("ft-chip-active")!);
    expect(allRows().sort()).toEqual(["ab2@x.com", "b1@x.com", "b2@x.com", "solo@x.com"]);
    expect(q("ft-group-none")).toBeNull();
    fireEvent.click(q("ft-chip-look")!);
    expect(allRows()).toEqual(["b1@x.com", "b2@x.com", "b4@x.com"]);
    expect(q("ft-group-using-head")?.textContent).toBe("Using now · 1");
    fireEvent.click(q("ft-chip-all")!);
    expect(allRows()).toHaveLength(9);
    for (const k of ["all", "active", "look"]) expect(q(`ft-chip-${k}`)!.style.minHeight).toBe("44px");
  });
  it("look-alike rows are amber with '⚠ 3 look-alike'; others are not", async () => {
    view();
    await waitFor(() => expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 4"));
    const look = Array.from(document.querySelectorAll("[data-testid='ft-row'][data-look='1']")).map((r) => r.getAttribute("data-email")).sort();
    expect(look).toEqual(["b1@x.com", "b2@x.com", "b4@x.com"]);
    for (const n of document.querySelectorAll("[data-testid='ft-row'][data-look='1']")) {
      expect(within(n as HTMLElement).getByTestId("ft-badge").textContent).toBe("⚠ 3 look-alike");
      expect((n as HTMLElement).style.background).toBe("var(--warn-soft)");
    }
    expect(document.querySelectorAll("[data-testid='ft-badge']")).toHaveLength(3);
    expect(document.body.textContent).not.toContain("paid@x.com");
  });
  it("tap → the group side by side + 'Free orders used together' — nothing written", async () => {
    view();
    await waitFor(() => expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 4"));
    fireEvent.click(document.querySelector("[data-testid='ft-row'][data-email='b2@x.com']")!);
    const sheet = q("ft-sheet")!;
    expect(sheet).not.toBeNull();
    const cards = within(sheet).getAllByTestId("ft-sheet-card");
    expect(cards).toHaveLength(3);
    const text = sheet.textContent || "";
    for (const s of ["@budgetukay1", "@budget_ukay2", "@budgetukay4", "b1@x.com", "b2@x.com", "b4@x.com", "Budget Ukay", "30 / 150", "150 / 150", "0 / 150", "Joined Oct 1", "Last order 3h ago", "No orders yet"]) expect(text).toContain(s);
    expect(text).not.toContain("paid@x.com");
    expect(text).not.toContain("budgetukay9");
    expect(q("ft-together")?.textContent).toBe("Free orders used together: 180");
    expect(q("ft-sheet-grid")!.style.gridTemplateColumns).toContain("minmax(148px");
    fireEvent.click(q("ft-sheet-close")!);
    expect(q("ft-sheet")).toBeNull();
    expect(DB.calls).toBe(1); // only the one read — tapping reads and writes nothing
  });
  it("Escape and a tap outside close the sheet", async () => {
    view();
    await waitFor(() => expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 4"));
    fireEvent.click(document.querySelector("[data-testid='ft-row'][data-email='b1@x.com']")!);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(q("ft-sheet")).toBeNull();
    fireEvent.click(document.querySelector("[data-testid='ft-row'][data-email='b1@x.com']")!);
    fireEvent.click(q("ft-sheet-overlay")!);
    expect(q("ft-sheet")).toBeNull();
  });
  it("a row that is not a look-alike opens nothing", async () => {
    view();
    await waitFor(() => expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 4"));
    fireEvent.click(document.querySelector("[data-testid='ft-row'][data-email='solo@x.com']")!);
    expect(q("ft-sheet")).toBeNull();
  });
  it("function missing (sql/228 not applied) → one line, the list still shows, sorted by orders used", async () => {
    DB.fail = true;
    view();
    await waitFor(() => expect(q("ft-unread")).not.toBeNull());
    expect(emailsIn("using")).toEqual(["b1@x.com", "ab1@x.com", "ab2@x.com", "solo@x.com"]);
    expect(q("ft-last")?.textContent).toBe("Last order —");
    expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 0");
    expect(q("ft-chip-look")?.textContent).toBe("⚠ Look-alike · 3"); // look-alike needs no database read
  });
  it("not an admin → the function answers nothing → no last order shown as recent", async () => {
    DB.admin = false;
    view();
    await waitFor(() => expect(DB.calls).toBe(1));
    await waitFor(() => expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 0"));
    expect(document.querySelectorAll("[data-testid='ft-last'][data-recent='1']")).toHaveLength(0);
  });
  it("count > 0 with no stored order → 'Last order over 3 months ago'", async () => {
    DB.last = { ...LAST, "solo@x.com": null };
    view();
    await waitFor(() => expect(q("ft-chip-active")?.textContent).toBe("Active 7 days · 3"));
    const r = document.querySelector("[data-testid='ft-row'][data-email='solo@x.com']") as HTMLElement;
    expect(within(r).getByTestId("ft-last").textContent).toBe("Last order over 3 months ago");
  });
});
