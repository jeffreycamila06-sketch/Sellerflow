// Order tracking — item 10: the seller's Website orders. A shipped 7-ELEVEN / FamilyMart order shows a "Parcel"
// line with the same state the buyer sees, the last-checked time, and "Open in Pickup Status" (only for sellers who
// have Pickup Status). No match yet → one quiet line. Other orders unchanged.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";
import WebsiteOrders from "../WebsiteOrders";
import type { WebsiteOrder } from "../../adapters/websiteSeller";
import type { OrdersApi } from "../../adapters/websiteEditorApi";
import type { ParcelView } from "../../../website/parcelView";

afterEach(() => cleanup());
const ORDER = (over: Partial<WebsiteOrder> = {}): WebsiteOrder => ({
  id: "o1", orderNo: 1, token: "f".repeat(64), status: "shipped", paymentIssue: false, buyerName: "Maria", buyerPhone: "0912345678", buyerContact: null,
  delivery: "fm", storeId: "151003", storeName: "Xinyi", address: null, payment: "cod", items: [{ pid: 1, vid: null, name: "TSHIRT ONEPIECE", price: 7.9, qty: 3 }],
  subtotal: 23.7, shipFee: 60, total: 83.7, note: null, receiptPath: null, receiptAt: null, autoCancelAt: null, paidAt: null, shippedAt: "2026-11-17T06:15:00Z",
  cancelledAt: null, cancelReason: null, seenAt: "2026-11-17T06:15:00Z", createdAt: "2026-11-16T14:07:00Z", tracking: "12345678901", ...over,
});
function api(list: WebsiteOrder[], parcels: [string, ParcelView][]): OrdersApi {
  return { load: vi.fn(async () => list), blocked: vi.fn(async () => new Set<string>()), receipt: vi.fn(async () => null), shopSub: vi.fn(async () => "budgetukay"),
    act: vi.fn(async () => ({ ok: true as const, status: "shipped" as const, blocked: false })), parcels: vi.fn(async () => new Map(parcels)) };
}
async function open(list: WebsiteOrder[], parcels: [string, ParcelView][], onOpenPickup?: () => void, id = "o1") {
  const a = api(list, parcels);
  render(<TProvider lang="en"><WebsiteOrders onToast={vi.fn()} api={a} onOpenPickup={onOpenPickup} /></TProvider>);
  await screen.findAllByTestId("wor-row");
  fireEvent.click(screen.getAllByTestId("wor-row")[list.findIndex((o) => o.id === id)]);
  return { a, detail: screen.getByTestId("wor-detail") };
}
const AT: ParcelView = { state: "at_store", deadline: "2026-11-26", checkedAt: "2026-11-19T01:40:00Z" };

describe("the seller's parcel line", () => {
  it("a match: the same state words as the buyer, the deadline, the last check, Open in Pickup Status", async () => {
    const go = vi.fn();
    const { a, detail } = await open([ORDER()], [["o1", AT]], go);
    expect(a.parcels).toHaveBeenCalledTimes(1);
    const line = within(detail).getByTestId("wor-parcel");
    expect(within(line).getByTestId("wor-parcel-chip")).toHaveTextContent("Ready for pickup");
    expect(line.textContent).toContain("Pick up by Nov 26");
    expect(within(line).getByTestId("wor-parcel-checked").textContent).toMatch(/^Last checked: Nov 19, .* · the buyer sees the same$/);
    fireEvent.click(within(line).getByTestId("wor-parcel-open"));
    expect(go).toHaveBeenCalledTimes(1);
  });
  it("the orders list: a small state chip on the row", async () => {
    await open([ORDER()], [["o1", { state: "returned" }]]);
    expect(screen.getAllByTestId("wor-parcel-chip")[0]).toHaveTextContent("Returned");
  });
  it("a seller without Pickup Status: no Open button", async () => {
    const { detail } = await open([ORDER()], [["o1", AT]]);
    expect(within(detail).queryByTestId("wor-parcel-open")).toBeNull();
  });
  it("no match yet: one quiet line", async () => {
    const { detail } = await open([ORDER()], []);
    expect(within(detail).getByTestId("wor-parcel-none")).toHaveTextContent("The parcel's state shows here once this tracking number is found in Pickup Status.");
    expect(within(detail).queryByTestId("wor-parcel")).toBeNull();
  });
  it("other orders (home, not shipped, no tracking): no parcel line at all", async () => {
    for (const o of [ORDER({ delivery: "home", storeId: null, storeName: null, address: "Taipei", courier: "Black Cat", tracking: "TW1" }), ORDER({ tracking: undefined }), ORDER({ status: "paid", tracking: undefined, shippedAt: null })]) {
      const { detail } = await open([o], [["o1", AT]]);
      expect(within(detail).queryByTestId("wor-parcel")).toBeNull();
      expect(within(detail).queryByTestId("wor-parcel-none")).toBeNull();
      cleanup();
    }
  });
  it("the app passes Open in Pickup Status only for sellers who have Pickup Status", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('<WebsiteOrders cur={cur} liveTick={webLiveTick} onOpenPickup={parcelTrackingAllowed ? () => setScreen("parceltracking") : undefined}');
  });
  it("without api.parcels (older code path) the screen is as before", async () => {
    const a = api([ORDER()], []); delete a.parcels;
    render(<TProvider lang="en"><WebsiteOrders onToast={vi.fn()} api={a} /></TProvider>);
    fireEvent.click((await screen.findAllByTestId("wor-row"))[0]);
    expect(screen.getByTestId("wor-parcel-none")).toBeInTheDocument();
  });
});
