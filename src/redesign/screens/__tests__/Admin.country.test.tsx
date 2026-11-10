// Admin → country flag + name per user (admin-only label, sql/143).
// Order shown: admin pick > seller_profiles.country > phone guess > "Hindi alam".
// Saving writes ONLY admin_user_country (never seller_profiles → the seller's market).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";

const DB = vi.hoisted(() => ({ picks: [] as { user_id: string; country: string }[], fail: false, tables: [] as string[], upserts: [] as unknown[], deletes: [] as string[] }));
vi.mock("../../../supabase", () => {
  const from = (table: string) => {
    DB.tables.push(table);
    return {
      select: async () => ({ data: DB.fail ? null : DB.picks, error: DB.fail ? { message: "x" } : null }),
      upsert: async (row: { user_id: string; country: string }) => { DB.upserts.push(row); return { error: DB.fail ? { message: "x" } : null }; },
      delete: () => ({ eq: async (_c: string, v: string) => { DB.deletes.push(v); return { error: DB.fail ? { message: "x" } : null }; } }),
    };
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: { message: "not mocked" } }) }, isSupabaseConfigured: true };
});
vi.mock("../../adapters/appShell", async (importActual) => ({ ...(await importActual<object>()), isAppShell: () => false }));

import { AdminPanel, type AdminPanelKind } from "../Admin";
import { accountUsersToRedesign } from "../../adapters/useReadData";

const mk = (id: string, email: string, phone: string, country: string | null, extra: Partial<AccountUser> = {}): AccountUser => ({
  authUserId: id, email, plan: "basic", planStatus: "active", planExpiry: new Date(Date.now() + 3 * 864e5).toISOString(), connectedAccounts: [], role: "seller", createdAt: "2026-11-01T00:00:00Z",
  profile: { fullName: "", storeName: "", phone, tiktok: "", facebook: "", adminContactNote: "", country }, ...extra,
});
const RAW = [
  mk("u-tw", "saved.tw@x.com", "", "TW"),
  mk("u-ph", "guess.ph@x.com", "09171234567", null),
  mk("u-ca", "picked@x.com", "0912345678", "TW"),
  mk("u-un", "no.country.with.a.really.long.email.address@example.com", "12345", null),
];
const rawByEmail = Object.fromEntries(RAW.map((u) => [u.email, u]));
const users = accountUsersToRedesign(RAW);
const view = (panel: AdminPanelKind = "sellers", usersState: "live" | "sample" = "live") =>
  render(<TProvider lang="en"><AdminPanel panel={panel} onClose={() => {}} cur="NT$" users={users} usersState={usersState} rawByEmail={rawByEmail} /></TProvider>);
const cardOf = (r: ReturnType<typeof view>, email: string) => r.getAllByText(email).map((n) => n.closest("[data-testid=adm-seller-head]")).find(Boolean) as HTMLElement;

beforeEach(() => { DB.picks = [{ user_id: "u-ca", country: "CA" }]; DB.fail = false; DB.tables = []; DB.upserts = []; DB.deletes = []; });

describe("Manage sellers — country pill", () => {
  it("shows the pill before Seller / plan, in order admin pick > saved > phone > unknown", async () => {
    const r = view();
    await waitFor(() => expect(within(cardOf(r, "picked@x.com")).getByTestId("cty-pill").textContent).toBe("Canada"));
    const pill = (e: string) => within(cardOf(r, e)).getByTestId("cty-pill");
    expect(pill("picked@x.com").getAttribute("data-source")).toBe("admin");
    expect(pill("saved.tw@x.com").textContent).toBe("Taiwan");
    expect(pill("saved.tw@x.com").getAttribute("data-source")).toBe("saved");
    expect(pill("guess.ph@x.com").textContent).toBe("Philippines");
    expect(pill("guess.ph@x.com").getAttribute("data-source")).toBe("phone");
    const un = pill("no.country.with.a.really.long.email.address@example.com");
    expect(un.textContent).toBe("Hindi alam");
    expect(un.style.border).toContain("dashed");
    // pill comes before the Seller and plan pills in the same row
    const head = cardOf(r, "saved.tw@x.com");
    const texts = Array.from(head.querySelectorAll("button, span")).map((n) => n.textContent);
    expect(texts.indexOf("Taiwan")).toBeLessThan(texts.indexOf("Seller"));
    expect(head.style.flexWrap).toBe("wrap");
  });

  it("flags are images, never emoji", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("cty-flag").length).toBeGreaterThan(0));
    const img = r.getAllByTestId("cty-flag")[0] as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")?.startsWith("data:image/svg+xml")).toBe(true);
    expect(/[\u{1F1E6}-\u{1F1FF}]/u.test(r.container.textContent || "")).toBe(false);
  });

  it("picker: search Can → Canada, save → only admin_user_country is written, list updates without reload", async () => {
    const r = view();
    const un = await waitFor(() => within(cardOf(r, "no.country.with.a.really.long.email.address@example.com")).getByTestId("cty-pill"));
    fireEvent.click(un);
    const pick = r.getByTestId("cty-picker");
    expect(within(pick).getByText("Piliin ang bansa")).toBeTruthy();
    expect(within(pick).getByTestId("cty-picker-email").textContent).toBe("no.country.with.a.really.long.email.address@example.com");
    expect(within(pick).getAllByTestId("cty-quick").map((b) => b.getAttribute("data-iso"))).toEqual(["TW", "PH", "US"]);
    fireEvent.change(within(pick).getByTestId("cty-search"), { target: { value: "Can" } });
    const first = within(pick).getAllByTestId("cty-opt")[0];
    expect(first.getAttribute("data-iso")).toBe("CA");
    fireEvent.click(first);
    fireEvent.click(within(pick).getByTestId("cty-save"));
    await waitFor(() => expect(r.queryByTestId("cty-picker")).toBeNull());
    expect(DB.upserts).toEqual([expect.objectContaining({ user_id: "u-un", country: "CA" })]);
    expect(new Set(DB.tables)).toEqual(new Set(["admin_user_country"]));
    expect(within(cardOf(r, "no.country.with.a.really.long.email.address@example.com")).getByTestId("cty-pill").textContent).toBe("Canada");
  });

  it("quick button + clear back to automatic", async () => {
    const r = view();
    await waitFor(() => expect(within(cardOf(r, "picked@x.com")).getByTestId("cty-pill").textContent).toBe("Canada"));
    fireEvent.click(within(cardOf(r, "picked@x.com")).getByTestId("cty-pill"));
    fireEvent.click(r.getByTestId("cty-auto"));
    await waitFor(() => expect(r.queryByTestId("cty-picker")).toBeNull());
    expect(DB.deletes).toEqual(["u-ca"]);
    expect(within(cardOf(r, "picked@x.com")).getByTestId("cty-pill").textContent).toBe("Taiwan"); // back to the saved country
    // quick pick on another user
    fireEvent.click(within(cardOf(r, "guess.ph@x.com")).getByTestId("cty-pill"));
    expect(r.queryByTestId("cty-auto")).toBeNull(); // no admin pick yet → nothing to clear
    fireEvent.click(r.getAllByTestId("cty-quick").find((b) => b.getAttribute("data-iso") === "US")!);
    fireEvent.click(r.getByTestId("cty-save"));
    await waitFor(() => expect(within(cardOf(r, "guess.ph@x.com")).getByTestId("cty-pill").textContent).toBe("United States"));
  });

  it("a failed save keeps the picker open with an error and changes nothing", async () => {
    const r = view();
    const p = await waitFor(() => within(cardOf(r, "saved.tw@x.com")).getByTestId("cty-pill"));
    DB.fail = true;
    fireEvent.click(p);
    fireEvent.click(r.getAllByTestId("cty-quick").find((b) => b.getAttribute("data-iso") === "PH")!);
    fireEvent.click(r.getByTestId("cty-save"));
    await waitFor(() => expect(r.getByTestId("cty-err")).toBeTruthy());
    expect(r.getByTestId("cty-picker")).toBeTruthy();
    expect(within(cardOf(r, "saved.tw@x.com")).getByTestId("cty-pill").textContent).toBe("Taiwan");
  });

  it("the existing card controls are all still there", async () => {
    const r = view();
    await waitFor(() => expect(r.getAllByTestId("cty-pill").length).toBe(4));
    for (const label of ["+ Add days", "Edit", "Reset PW", "Make Admin", "Expire", "Delete", "Free", "Basic", "Plus", "Pro", "Master"]) {
      expect(r.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(r.getAllByTestId("adm-cred-open").length).toBe(4);
  });

  it("sample / preview data → no country pills at all", () => {
    const r = view("sellers", "sample");
    expect(r.queryByTestId("cty-pill")).toBeNull();
    expect(DB.tables).toEqual([]);
  });
});

describe("bucket lists — country tag", () => {
  it("Expiring soon shows flag + name under the email line, tappable", async () => {
    const r = view("subExpiring");
    // Wait for the admin pick (Canada, loaded async from admin_user_country) — not just
    // for 4 tags: before the pick lands, picked@x.com shows its saved country (Taiwan).
    await r.findByText("Canada");
    await waitFor(() => {
      const names = r.getAllByTestId("cty-tag").map((n) => n.textContent);
      expect(names.length).toBe(4);
      expect(names).toEqual(expect.arrayContaining(["Canada", "Taiwan", "Philippines", "Hindi alam"]));
    });
    fireEvent.click(r.getAllByTestId("cty-tag")[0]);
    expect(r.getByTestId("cty-picker")).toBeTruthy();
  });
  it("Active paid list shows the tag too", async () => {
    const raw = RAW.map((u) => ({ ...u, planExpiry: new Date(Date.now() + 30 * 864e5).toISOString() }));
    const r = render(<TProvider lang="en"><AdminPanel panel="subActive" onClose={() => {}} cur="NT$" users={accountUsersToRedesign(raw)} usersState="live" rawByEmail={Object.fromEntries(raw.map((u) => [u.email, u]))} /></TProvider>);
    await waitFor(() => expect(r.getAllByTestId("cty-tag").length).toBe(4));
  });
});

describe("Free tier + Business Pulse — country tag", () => {
  it("Free tier: flag + name next to 'Joined'", async () => {
    const free = RAW.map((u) => ({ email: u.email, store_name: "", full_name: "", count: 0, cap: 20, near_cap: false, capped: false, cycle_resets_in_days: 10 }));
    const r = render(<TProvider lang="en"><AdminPanel panel="subFree" onClose={() => {}} cur="NT$" users={users} usersState="live" rawByEmail={rawByEmail} freeUsers={free} freeUsersState="live" /></TProvider>);
    await waitFor(() => expect(r.getAllByTestId("cty-tag").length).toBe(4));
    const row = r.getAllByTestId("cty-tag").find((n) => n.textContent === "Philippines")!.parentElement!;
    expect(row.textContent).toContain("Joined Nov 1");
  });
  it("Business Pulse sellers today: flag + name per seller", async () => {
    const pulse = { generatedAt: new Date().toISOString(), summary: { active_15m: 1, active_60m: 1, orders_60m: 2, orders_today: 5, active_today: 2 }, hourly: [], sellers: [
      { email: "saved.tw@x.com", store_name: "TW Shop", orders_today: 3, orders_60m: 1, last_order_at: new Date().toISOString() },
      { email: "guess.ph@x.com", store_name: "PH Shop", orders_today: 2, orders_60m: 0, last_order_at: null },
    ] };
    const r = render(<TProvider lang="en"><AdminPanel panel="pulse" onClose={() => {}} cur="NT$" users={users} usersState="live" rawByEmail={rawByEmail} pulse={pulse as never} pulseState="live" /></TProvider>);
    await waitFor(() => expect(r.getAllByTestId("cty-tag").map((n) => n.textContent)).toEqual(["Taiwan", "Philippines"]));
  });
});
