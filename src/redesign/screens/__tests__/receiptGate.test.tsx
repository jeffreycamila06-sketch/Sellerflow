// Messenger receipt step 1 — the gates and the "no writes" rule.
//   • SettingsHub: the Receipt format tile only when onReceiptFormat is passed;
//   • Orders: the Messenger receipt button only for a Facebook buyer AND fbReceipt;
//     otherwise the receipt box HTML is identical to before;
//   • editing in the sheet writes nothing (no order / session / customer / settings write);
//   • RedesignApp passes both only for FB preview accounts.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, fireEvent, act } from "@testing-library/react";

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, rpc: vi.fn(), auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } }));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
const saveReceiptSettings = vi.hoisted(() => vi.fn());
vi.mock("../../adapters/receiptSettings", async (orig) => ({
  ...(await orig<typeof import("../../adapters/receiptSettings")>()),
  saveReceiptSettings,
  loadReceiptSettings: vi.fn(async () => ({ ok: true, settings: { opening: "Thanks!", note: "Pay in 3 days", qrImage: null } })),
}));

import { TProvider } from "../../i18n";
import Orders from "../Orders";
import SettingsHub from "../SettingsHub";
import { saveOrderToDatabase, saveLiveSessionOrder, saveCustomerToDatabase } from "../../../db";
import type { Buyer } from "../../../lib/orderTypes";

beforeEach(() => {
  vi.clearAllMocks();
  HTMLCanvasElement.prototype.getContext = (() => null) as never; // jsdom has no canvas → picture "failed", quietly
});

const buyer = (platform: string): Buyer => ({
  handle: "@ann", name: "Ann Reyes", platform, num: 3, totalSpent: 630, totalOrders: 2,
  orders: [{ item: "A1", total: 350 }, { item: "100", total: 0 }] as never,
});
const renderOrders = (b: Buyer, fbReceipt?: boolean) => {
  const r = render(<TProvider lang="en"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[]} state="live" buyers={[b]} {...(fbReceipt === undefined ? {} : { fbReceipt })} /></TProvider>);
  fireEvent.change(r.container.querySelector("input")!, { target: { value: "3" } });
  return r;
};
const box = (c: HTMLElement) => c.querySelector("[data-testid='buyer-receipt']")!;

describe("Orders receipt box gate", () => {
  it("Facebook buyer + FB preview account → Messenger receipt button", () => {
    const { container } = renderOrders(buyer("Facebook"), true);
    expect(container.querySelector("[data-testid='messenger-receipt-btn']")).not.toBeNull();
  });
  it("non-preview account (fbReceipt false / absent) → no button, box HTML identical", () => {
    const a = box(renderOrders(buyer("Facebook")).container).outerHTML;
    const b = box(renderOrders(buyer("Facebook"), false).container).outerHTML;
    expect(a).toBe(b);
    expect(a).not.toContain("messenger-receipt-btn");
  });
  it("TikTok / Shopee buyer → no button even for a preview account, box identical to a non-preview render", () => {
    for (const p of ["TikTok", "Shopee"]) {
      const withGate = box(renderOrders(buyer(p), true).container).outerHTML;
      const without = box(renderOrders(buyer(p)).container).outerHTML;
      expect(withGate).toBe(without);
      expect(withGate).not.toContain("messenger-receipt-btn");
    }
  });
});

describe("Receipt sheet — edits write nothing", () => {
  it("opens with saved opening/note prefilled; editing lines/opening/note calls no write", async () => {
    const { container, getByTestId, getAllByTestId } = renderOrders(buyer("Facebook"), true);
    fireEvent.click(getByTestId("messenger-receipt-btn"));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect((getByTestId("rs-opening") as HTMLTextAreaElement).value).toBe("Thanks!");
    expect((getByTestId("rs-note") as HTMLTextAreaElement).value).toBe("Pay in 3 days");
    const prices = getAllByTestId("rs-price") as HTMLInputElement[];
    expect(prices.map((p) => p.value)).toEqual(["350", "0"]);
    fireEvent.change(getAllByTestId("rs-item")[0], { target: { value: "A1 red" } });
    fireEvent.change(prices[1], { target: { value: "150" } });
    fireEvent.change(getByTestId("rs-opening"), { target: { value: "Hello" } });
    fireEvent.change(getByTestId("rs-note"), { target: { value: "GCash" } });
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(saveReceiptSettings).not.toHaveBeenCalled();
    expect(saveOrderToDatabase).not.toHaveBeenCalled();
    expect(saveLiveSessionOrder).not.toHaveBeenCalled();
    expect(saveCustomerToDatabase).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();                  // no direct table write either
    const sheet = document.querySelector("[data-testid='receipt-sheet']")!;  // portaled outside the container
    // Close + the line controls (one remove per line, Add line) — still no Send without a session.
    expect([...sheet.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close", "×", "×", "+ Add line"]);
    expect(sheet.textContent).not.toMatch(/\bSend\b/);
    fireEvent.click(getByTestId("receipt-sheet-close"));
    expect(document.querySelector("[data-testid='receipt-sheet']")).toBeNull();
    // the box itself still shows the original orders
    expect(box(container).textContent).toContain("A1");
    expect(box(container).textContent).not.toContain("A1 red");
  });
});

describe("SettingsHub tile gate", () => {
  const hub = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><SettingsHub onGeneral={vi.fn()} onCustomers={vi.fn()} onAdmin={vi.fn()} onCustomerData={vi.fn()} onLegal={vi.fn()} onDelete={vi.fn()} onLogout={vi.fn()} {...extra} /></TProvider>);
  it("no onReceiptFormat → no tile; with it → the tile opens the screen", () => {
    expect(hub().container.querySelector("[data-testid='tile-receipt-format']")).toBeNull();
    const open = vi.fn();
    const { container } = hub({ onReceiptFormat: open });
    fireEvent.click(container.querySelector("[data-testid='tile-receipt-format']")!);
    expect(open).toHaveBeenCalledTimes(1);
  });
  it("RedesignApp passes the tile, the screen and the Orders button only for FB preview accounts or /fb/access receipt", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('onReceiptFormat={fbReceiptUi ? () => setScreen("receiptformat") : undefined}');
    expect(src).toContain('{screen === "receiptformat" && fbReceiptUi && <ReceiptFormat');
    expect(src).toContain("fbReceipt={fbReceiptUi}");
    expect(src).toContain("const fbPreview = fbPreviewEnabled(auth.profile?.email);");
    // fbReceiptUi = fbPreview || /fb/access receipt (fbUiGates, pinned in fbAccessClient.test.tsx)
    expect(src).toContain("receiptUi: fbReceiptUi } = fbUiGates({ fbFlag, fbPreview, access: fbAccess })");
  });
});
