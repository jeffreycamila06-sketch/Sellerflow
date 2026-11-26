// Admin → Controls → "Receipt add-on" (sql/223) and the "+ Receipt" badge in Manage sellers / the
// expiry lists. The three database functions are played by a small in-memory stand-in that keeps the
// same rules as sql/223 (only enabled rows listed; remove = enabled false, the row stays; not admin →
// nothing). The real database rules are proven by scripts/sql223-behaviour.mjs (PGlite).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, within, cleanup, act } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

type Row = { user_id: string; enabled: boolean; note: string | null; created_at: string };
const DB = vi.hoisted(() => ({
  admin: true,
  rows: [] as Row[],
  profiles: [] as { user_id: string; email: string; shop: string; plan: string; plan_status: string; plan_expiry: string | null }[],
  calls: [] as { fn: string; args: unknown }[],
  failList: false,
}));
vi.mock("../../../supabase", () => {
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    DB.calls.push({ fn, args });
    if (fn === "admin_receipt_addon_list") {
      if (DB.failList) return { data: null, error: { message: "x" } };
      if (!DB.admin) return { data: [], error: null };
      return {
        data: DB.rows.filter((r) => r.enabled).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => {
          const p = DB.profiles.find((x) => x.user_id === r.user_id)!;
          return { user_id: r.user_id, email: p.email, shop: p.shop || null, plan: p.plan, plan_status: p.plan_status, plan_expiry: p.plan_expiry, since: r.created_at, note: r.note };
        }), error: null,
      };
    }
    if (!DB.admin) return { data: { ok: false, error: "not_admin" }, error: null };
    if (fn === "admin_receipt_addon_set") {
      const p = DB.profiles.find((x) => x.email.toLowerCase() === String(args.p_email || "").trim().toLowerCase());
      if (!p) return { data: { ok: false, error: "not_found" }, error: null };
      const r = DB.rows.find((x) => x.user_id === p.user_id);
      if (args.p_on) {
        if (r?.enabled) return { data: { ok: true, result: "already" }, error: null };
        if (!r) { DB.rows.push({ user_id: p.user_id, enabled: true, note: null, created_at: "2026-11-26T08:00:00Z" }); return { data: { ok: true, result: "added" }, error: null }; }
        r.enabled = true; return { data: { ok: true, result: "enabled" }, error: null };
      }
      if (!r?.enabled) return { data: { ok: true, result: "not_enabled" }, error: null };
      r.enabled = false; return { data: { ok: true, result: "removed" }, error: null };
    }
    if (fn === "admin_receipt_addon_note") {
      const r = DB.rows.find((x) => x.user_id === args.p_user);
      if (!r) return { data: { ok: false, error: "not_found" }, error: null };
      r.note = String(args.p_note || "").trim() || null; return { data: { ok: true }, error: null };
    }
    return { data: null, error: { message: "not mocked" } };
  };
  const from = () => ({ select: async () => ({ data: [], error: null }) });
  return { supabase: { from, rpc }, isSupabaseConfigured: true };
});
vi.mock("../../adapters/appShell", async (importActual) => ({ ...(await importActual<object>()), isAppShell: () => false }));

import { AdminPanel, type AdminPanelKind } from "../Admin";
import { accountUsersToRedesign } from "../../adapters/useReadData";
import { addonEndsSoon, addonEnded, filterAddons, addonsFromRpc } from "../../adapters/receiptAddon";

const DAY = 864e5;
const NOW = Date.parse("2026-11-26T06:00:00Z");
const mk = (id: string, email: string, plan: string, expiryDays: number | null, shop = ""): AccountUser => ({
  authUserId: id, email, plan, planStatus: "active", planExpiry: expiryDays == null ? "" : new Date(NOW + expiryDays * DAY).toISOString(), connectedAccounts: [], role: "seller", createdAt: "2026-11-01T00:00:00Z",
  profile: { fullName: "", storeName: shop, phone: "", tiktok: "", facebook: "", adminContactNote: "", country: "TW" },
});
const RAW = [
  mk("u1", "lia@x.com", "pro", 40, "Lia Closet"),
  mk("u2", "ben@x.com", "plus", 3, "Ben Shop"),        // ends in 3 days → amber
  mk("u3", "cy@x.com", "basic", -2, ""),               // ended → amber
  mk("u4", "dee@x.com", "basic", 4, "Dee Store"),      // no add-on
];
const rawByEmail = Object.fromEntries(RAW.map((u) => [u.email, u]));
const users = accountUsersToRedesign(RAW);
const iso = (d: number | null) => (d == null ? null : new Date(NOW + d * DAY).toISOString());
const toasts: Array<[string, string]> = [];
const view = (panel: AdminPanelKind = "receiptaddon") =>
  render(<TProvider lang="en"><AdminPanel panel={panel} onClose={() => {}} cur="NT$" users={users} usersState="live" rawByEmail={rawByEmail} onToast={(m, k) => toasts.push([m, k])} /></TProvider>);
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const rowsShown = () => Array.from(document.querySelectorAll("[data-testid='ra-row']")).map((r) => r.getAttribute("data-email"));
const rowOf = (email: string) => document.querySelector(`[data-testid='ra-row'][data-email='${email}']`) as HTMLElement;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW);
  DB.admin = true; DB.failList = false; DB.calls = []; toasts.length = 0;
  DB.profiles = RAW.map((u) => ({ user_id: u.authUserId, email: u.email, shop: u.profile.storeName, plan: u.plan, plan_status: "active", plan_expiry: iso(u.email === "lia@x.com" ? 40 : u.email === "ben@x.com" ? 3 : u.email === "cy@x.com" ? -2 : 4) }));
  DB.rows = [
    { user_id: "u1", enabled: true, note: "paid in chat", created_at: "2026-10-05T02:00:00Z" },
    { user_id: "u2", enabled: true, note: null, created_at: "2026-11-20T02:00:00Z" },
    { user_id: "u3", enabled: true, note: "trial", created_at: "2026-11-01T02:00:00Z" },
    { user_id: "u4", enabled: false, note: "removed earlier", created_at: "2026-09-01T02:00:00Z" },
  ];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the Receipt add-on list", () => {
  it("shows exactly the enabled rows — count, shop, email, plan, + Receipt, plan end, since, note", async () => {
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    expect(rowsShown()).toEqual(["ben@x.com", "cy@x.com", "lia@x.com"]);            // the removed row is not shown
    expect(q("ra-count")!.textContent).toBe("3 sellers have the Receipt add-on");
    const lia = rowOf("lia@x.com");
    expect(within(lia).getByTestId("ra-shop").textContent).toBe("Lia Closet");
    expect(within(lia).getByTestId("ra-email").textContent).toBe("lia@x.com");
    expect(within(lia).getByTestId("ra-plan").textContent).toBe("pro");
    expect(within(lia).getByTestId("ra-row-badge").textContent).toBe("+ Receipt");
    expect(within(lia).getByTestId("ra-expiry").textContent).toBe("Plan ends Jan 5, 2027");
    expect(within(lia).getByTestId("ra-since").textContent).toBe("Since Oct 5, 2026");
    expect(within(lia).getByTestId("ra-note").textContent).toBe("paid in chat");
    expect(within(rowOf("cy@x.com")).getByTestId("ra-shop").textContent).toBe("cy@x.com");   // no shop name → the email
    expect(within(rowOf("ben@x.com")).getByTestId("ra-note").textContent).toBe("Add a note");
  });
  it("amber when the plan ends in under 7 days or has ended; not when it is further away", async () => {
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    const exp = (e: string) => within(rowOf(e)).getByTestId("ra-expiry");
    expect(exp("ben@x.com").getAttribute("data-warn")).toBe("1");
    expect(exp("ben@x.com").style.color).toBe("var(--warn)");
    expect(exp("cy@x.com").getAttribute("data-warn")).toBe("1");
    expect(exp("cy@x.com").textContent).toBe("Plan ended Nov 24, 2026");
    expect(exp("lia@x.com").getAttribute("data-warn")).toBeNull();
  });
  it("search by shop or email", async () => {
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    fireEvent.change(q("ra-search")!, { target: { value: "CLOSET" } });
    expect(rowsShown()).toEqual(["lia@x.com"]);
    fireEvent.change(q("ra-search")!, { target: { value: "cy@" } });
    expect(rowsShown()).toEqual(["cy@x.com"]);
    fireEvent.change(q("ra-search")!, { target: { value: "nobody" } });
    expect(rowsShown()).toEqual([]);
    expect(q("ra-no-match")).not.toBeNull();
  });
  it("+ Add seller by email → added, the list reads again and shows them", async () => {
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    fireEvent.click(q("ra-add-open")!);
    fireEvent.change(q("ra-add-email")!, { target: { value: " Dee@X.com " } });
    fireEvent.click(q("ra-add-go")!);
    await waitFor(() => expect(rowsShown()).toContain("dee@x.com"));
    expect(DB.calls.find((c) => c.fn === "admin_receipt_addon_set")!.args).toEqual({ p_email: "Dee@X.com", p_on: true, p_note: null });
    expect(DB.rows.find((r) => r.user_id === "u4")!.enabled).toBe(true);     // the old row is turned back on
    expect(toasts.at(-1)).toEqual(["Receipt add-on turned on for Dee@X.com.", "ok"]);
    expect(q("ra-add-form")).toBeNull();
  });
  it("adding an unknown email or one that already has it says so and changes nothing", async () => {
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    fireEvent.click(q("ra-add-open")!);
    fireEvent.change(q("ra-add-email")!, { target: { value: "nobody@x.com" } });
    fireEvent.click(q("ra-add-go")!); await flush();
    expect(toasts.at(-1)).toEqual(["No seller with this email.", "err"]);
    fireEvent.change(q("ra-add-email")!, { target: { value: "lia@x.com" } });
    fireEvent.click(q("ra-add-go")!); await flush();
    expect(toasts.at(-1)).toEqual(["lia@x.com already has the Receipt add-on.", "ok"]);
    expect(rowsShown()).toEqual(["ben@x.com", "cy@x.com", "lia@x.com"]);
  });
  it("Remove asks inside the page; Cancel = nothing; Remove = enabled false (the row is kept) and it leaves the list", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    fireEvent.click(within(rowOf("ben@x.com")).getByTestId("ra-remove"));
    expect(within(rowOf("ben@x.com")).getByTestId("ra-confirm").textContent).toContain("Remove the Receipt add-on from ben@x.com?");
    fireEvent.click(within(rowOf("ben@x.com")).getByTestId("ra-confirm-no"));
    expect(q("ra-confirm")).toBeNull();
    expect(DB.calls.some((c) => c.fn === "admin_receipt_addon_set")).toBe(false);
    fireEvent.click(within(rowOf("ben@x.com")).getByTestId("ra-remove"));
    fireEvent.click(within(rowOf("ben@x.com")).getByTestId("ra-confirm-yes"));
    await waitFor(() => expect(rowsShown()).toEqual(["cy@x.com", "lia@x.com"]));
    const ben = DB.rows.find((r) => r.user_id === "u2")!;
    expect(ben).toBeTruthy();
    expect(ben.enabled).toBe(false);
    expect(toasts.at(-1)).toEqual(["Receipt add-on removed for ben@x.com.", "ok"]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
  it("edit a note inline: Save writes it and the row shows it; Cancel keeps the old one", async () => {
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    fireEvent.click(within(rowOf("lia@x.com")).getByTestId("ra-note"));
    fireEvent.change(within(rowOf("lia@x.com")).getByTestId("ra-note-input"), { target: { value: "typo" } });
    fireEvent.click(within(rowOf("lia@x.com")).getByTestId("ra-note-cancel"));
    expect(within(rowOf("lia@x.com")).getByTestId("ra-note").textContent).toBe("paid in chat");
    fireEvent.click(within(rowOf("lia@x.com")).getByTestId("ra-note"));
    fireEvent.change(within(rowOf("lia@x.com")).getByTestId("ra-note-input"), { target: { value: "paid Nov 26" } });
    fireEvent.click(within(rowOf("lia@x.com")).getByTestId("ra-note-save"));
    await waitFor(() => expect(within(rowOf("lia@x.com")).getByTestId("ra-note").textContent).toBe("paid Nov 26"));
    expect(DB.calls.find((c) => c.fn === "admin_receipt_addon_note")!.args).toEqual({ p_user: "u1", p_note: "paid Nov 26" });
  });
  it("a list that cannot be read says so (never an empty list)", async () => {
    DB.failList = true;
    view();
    await waitFor(() => expect(q("ra-error")).not.toBeNull());
    expect(q("ra-none")).toBeNull();
  });
  it("no price anywhere in the panel", async () => {
    view();
    await waitFor(() => expect(q("ra-panel")).not.toBeNull());
    expect(q("ra-panel")!.textContent).not.toMatch(/NT\$|₱|\$\s?\d|price|\/\s?mo/i);
  });
});

describe("the + Receipt badge in the other admin lists", () => {
  it("Manage sellers: next to the plan of sellers with the add-on only", async () => {
    view("sellers");
    await waitFor(() => expect(document.querySelectorAll("[data-testid='ra-badge']").length).toBe(3));
    const head = (e: string) => Array.from(document.querySelectorAll("[data-testid='adm-seller-head']")).find((h) => h.textContent?.includes(e)) as HTMLElement;
    for (const e of ["lia@x.com", "ben@x.com", "cy@x.com"]) expect(within(head(e)).getByTestId("ra-badge").textContent).toBe("+ Receipt");
    expect(within(head("dee@x.com")).queryByTestId("ra-badge")).toBeNull();
  });
  it("the Expiring list too", async () => {
    view("subExpiring");
    await waitFor(() => expect(document.querySelectorAll("[data-testid='ra-badge']").length).toBeGreaterThan(0));
    const row = (e: string) => Array.from(document.querySelectorAll("[data-testid='ra-badge']")).some((b) => b.closest("div[style*='border-radius: 12px']")?.textContent?.includes(e));
    expect(row("ben@x.com")).toBe(true);
    expect(row("dee@x.com")).toBe(false);
  });
  it("other panels never read the add-on list", async () => {
    view("broadcast");
    await flush();
    expect(DB.calls.filter((c) => c.fn === "admin_receipt_addon_list")).toHaveLength(0);
  });
});

describe("pure helpers", () => {
  it("amber rule, ended rule, search, odd rows dropped", () => {
    expect(addonEndsSoon(null, NOW)).toBe(false);
    expect(addonEndsSoon(iso(6.5), NOW)).toBe(false);   // shown as 7 days left
    expect(addonEndsSoon(iso(6), NOW)).toBe(true);
    expect(addonEndsSoon(iso(-1), NOW)).toBe(true);
    expect(addonEnded(iso(-1), NOW)).toBe(true);
    expect(addonEnded(iso(1), NOW)).toBe(false);
    expect(addonEnded("not a date", NOW)).toBe(false);
    const list = addonsFromRpc([{ user_id: "a", email: "x@y.com", shop: "Shop" }, { email: "no id" }, null, 5]);
    expect(list).toHaveLength(1);
    expect(filterAddons(list, " sho ")).toHaveLength(1);
    expect(filterAddons(list, "zzz")).toHaveLength(0);
    expect(addonsFromRpc("nope")).toEqual([]);
  });
});
