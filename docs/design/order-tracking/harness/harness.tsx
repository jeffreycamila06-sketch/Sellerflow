// Order tracking — the seller's Website orders (REAL screen) with a parcel, for the screenshots (NOT in the app build).
//   ?st=shipped|transit|store|picked|returned  &ship=cvs|other  &pay=cod|first  &pickup=1 (seller has Pickup Status)
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import WebsiteOrders from "../../../../src/redesign/screens/WebsiteOrders";
import type { OrdersApi } from "../../../../src/redesign/adapters/websiteEditorApi";
import type { WebsiteOrder } from "../../../../src/redesign/adapters/websiteSeller";
import type { ParcelView } from "../../../../src/website/parcelView";

const q = new URLSearchParams(location.search);
const st = q.get("st") || "store", cvs = q.get("ship") !== "other", first = q.get("pay") === "first";
const ORDER: WebsiteOrder = {
  id: "o1", orderNo: 1, token: "f".repeat(64), status: "shipped", paymentIssue: false, buyerName: "Maria Santos", buyerPhone: "0912345782", buyerContact: null,
  delivery: cvs ? "fm" : "home", storeId: cvs ? "151003" : null, storeName: null, address: cvs ? null : "No. 5, Lane 20, Taipei", payment: first ? "bank" : "cod",
  items: [{ pid: 1, vid: null, name: "TSHIRT ONEPIECE", price: 7.9, qty: 3 }], subtotal: 23.7, shipFee: 60, total: 83.7, note: null, receiptPath: null, receiptAt: null,
  autoCancelAt: null, paidAt: first ? "2026-11-16T15:00:00Z" : null, shippedAt: "2026-11-17T06:15:00Z", cancelledAt: null, cancelReason: null, seenAt: "2026-11-17T06:15:00Z",
  createdAt: "2026-11-16T14:07:00Z", courier: cvs ? undefined : "Black Cat", tracking: cvs ? "12345678901" : "TW8842001",
};
const P: Record<string, ParcelView | undefined> = {
  shipped: undefined,
  transit: { state: "in_transit", checkedAt: "2026-11-18T01:40:00Z" },
  store: { state: "at_store", arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26", checkedAt: "2026-11-19T01:40:00Z" },
  picked: { state: "picked_up", arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26", pickedUpAt: "2026-11-21T10:42:00Z", checkedAt: "2026-11-21T01:40:00Z" },
  returned: { state: "returned", arrivedAt: "2026-11-19T01:30:00Z", deadline: "2026-11-26", returnedAt: "2026-11-27T00:00:00Z", checkedAt: "2026-11-27T01:40:00Z" },
};
const parcel = cvs ? P[st] : undefined;
const api: OrdersApi = {
  load: async () => [ORDER], blocked: async () => new Set(), shopSub: async () => "budgetukay", receipt: async () => null,
  act: async () => ({ ok: true, status: "shipped", blocked: false }), parcels: async () => new Map(parcel ? [["o1", parcel]] : []),
};
createRoot(document.getElementById("root")!).render(
  <TProvider lang="en">
    <div data-redesign="" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <WebsiteOrders onToast={() => {}} api={api} onOpenPickup={q.get("pickup") === "1" ? () => {} : undefined} />
    </div>
  </TProvider>,
);
