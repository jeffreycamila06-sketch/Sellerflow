// Shipping — parity tests for the ported shipment manager (App.tsx 1440-1634).
import { describe, it, expect, beforeEach } from "vitest";
import {
  nextDailyNum, findOpenShipment, shipmentSubtotal, shipmentGrandTotal, isValidShipment,
  applyAddOrder, applyDeleteOrder, applyEditPrice, applyUpdateFee, applyMarkShipped,
  buildMyShipRows, isNumericPrice, shipmentsKey, custDataKey, loadShippingCustomers,
  SHIP_TEMP, SHIP_DEFAULT_FEE, MYSHIP_HEADERS, type Shipment, type ShippingCustomer,
} from "../shipping";

const ship = (over: Partial<Shipment> = {}): Shipment => ({
  id: "s1", buyerUsername: "ann", dayId: "2026-06-26", num: 1, name: "Ann", phone: "0917", store: "123456",
  fee: "38", status: "open", createdAt: "2026-06-26T00:00:00.000Z", orders: [{ id: "o1", product: "Dress", price: "320" }], ...over,
});
const cust = (over: Partial<ShippingCustomer> = {}): ShippingCustomer => ({
  username: "ann", name: "Ann", phone: "0917000", sevenCode: "123456", note: "", lastComment: "", firstSeen: "", status: "Registered", isNew: false, ...over,
});

describe("key helpers — same localStorage keys as App.tsx (per seller, lowercased)", () => {
  it("formats sf_shipments / sf_shipping_customer_data with sellerIdOf", () => {
    expect(shipmentsKey("Owner@Shop.com")).toBe("sf_shipments:owner@shop.com");
    expect(custDataKey("Owner@Shop.com")).toBe("sf_shipping_customer_data:owner@shop.com");
  });
});

describe("pure helpers — verbatim from App.tsx", () => {
  it("nextDailyNum = max(num for day)+1", () => {
    expect(nextDailyNum([], "2026-06-26")).toBe(1);
    expect(nextDailyNum([ship({ num: 3 }), ship({ num: 1, dayId: "2026-06-25" })], "2026-06-26")).toBe(4);
  });
  it("findOpenShipment matches open + same day + username (case-insensitive)", () => {
    const list = [ship({ buyerUsername: "Ann" })];
    expect(findOpenShipment(list, "ann", "2026-06-26")?.id).toBe("s1");
    expect(findOpenShipment(list, "ann", "2026-06-27")).toBeNull();
    expect(findOpenShipment([ship({ status: "shipped" })], "ann", "2026-06-26")).toBeNull();
  });
  it("subtotal sums orders; grand total adds fee", () => {
    const s = ship({ orders: [{ id: "a", product: "x", price: "100" }, { id: "b", product: "y", price: "50" }], fee: "38" });
    expect(shipmentSubtotal(s)).toBe(150);
    expect(shipmentGrandTotal(s)).toBe(188);
  });
  it("isValidShipment rejects corrupt rows", () => {
    expect(isValidShipment(ship())).toBe(true);
    expect(isValidShipment({ id: "x" })).toBe(false);
    expect(isValidShipment(null)).toBe(false);
    expect(isValidShipment({ ...ship(), status: "weird" })).toBe(false);
  });
  it("isNumericPrice mirrors the add/edit guard", () => {
    expect(isNumericPrice("0")).toBe(true);
    expect(isNumericPrice("320")).toBe(true);
    expect(isNumericPrice("")).toBe(false);
    expect(isNumericPrice("-5")).toBe(false);
    expect(isNumericPrice("abc")).toBe(false);
  });
});

describe("applyAddOrder — append vs create (App.tsx addOrder)", () => {
  it("creates a new shipment when none open for the buyer/day (fee=default, status=open)", () => {
    const r = applyAddOrder([], cust(), "Top", "250", "2026-06-26", { shipment: "S", order: "O" }, "2026-06-26T01:00:00.000Z");
    expect(r.existing).toBe(false); expect(r.num).toBe(1); expect(r.next).toHaveLength(1);
    expect(r.next[0]).toMatchObject({ id: "S", buyerUsername: "ann", num: 1, name: "Ann", phone: "0917000", store: "123456", fee: SHIP_DEFAULT_FEE, status: "open" });
    expect(r.next[0].orders).toEqual([{ id: "O", product: "Top", price: "250" }]);
  });
  it("appends to the existing open shipment + refreshes name/phone/store", () => {
    const r = applyAddOrder([ship()], cust({ name: "Ann B", phone: "0999", sevenCode: "654321" }), "Skirt", "180", "2026-06-26", { shipment: "S2", order: "O2" }, "t");
    expect(r.existing).toBe(true); expect(r.num).toBe(1); expect(r.next).toHaveLength(1);
    expect(r.next[0].orders).toHaveLength(2);
    expect(r.next[0]).toMatchObject({ name: "Ann B", phone: "0999", store: "654321" });
  });
});

describe("applyDeleteOrder / edit / fee / markShipped", () => {
  it("deletes an order, auto-removing the shipment when empty (number stays consumed)", () => {
    expect(applyDeleteOrder([ship()], "s1", "o1")).toEqual([]);
    const two = ship({ orders: [{ id: "o1", product: "a", price: "1" }, { id: "o2", product: "b", price: "2" }] });
    expect(applyDeleteOrder([two], "s1", "o1")[0].orders.map((o) => o.id)).toEqual(["o2"]);
  });
  it("edits an order price", () => {
    expect(applyEditPrice([ship()], "s1", "o1", "999")[0].orders[0].price).toBe("999");
  });
  it("updateFee strips non-numeric", () => {
    expect(applyUpdateFee([ship()], "s1", "NT$ 45a")[0].fee).toBe("45");
  });
  it("markShipped flips status for the given ids only", () => {
    const list = [ship({ id: "s1" }), ship({ id: "s2" })];
    const next = applyMarkShipped(list, new Set(["s1"]));
    expect(next[0].status).toBe("shipped"); expect(next[1].status).toBe("open");
  });
});

describe("buildMyShipRows — 7-ELEVEN MyShip column mapping", () => {
  it("maps one row per shipment to the exact A–J columns", () => {
    const s = ship({ name: "Ann", phone: "0917", store: "123456", fee: "38", orders: [{ id: "a", product: "Dress", price: "320" }, { id: "b", product: "Top", price: "180" }] });
    expect(MYSHIP_HEADERS[0]).toBe("取件人姓名");
    expect(buildMyShipRows([s])[0]).toEqual(["Ann", "0917", "123456", SHIP_TEMP, "Dress / Top", 500, 38, "", "", ""]);
  });
});

describe("loadShippingCustomers — registry filter (name + phone + 6-digit code)", () => {
  beforeEach(() => localStorage.clear());
  it("keeps only valid registered customers under the seller key", () => {
    const rows = [cust({ username: "ok", name: "Ok", phone: "0917", sevenCode: "123456" }), cust({ username: "bad", name: "Bad", phone: "0917", sevenCode: "12" }), cust({ username: "noname", name: "", phone: "0917", sevenCode: "123456" })];
    localStorage.setItem(custDataKey("s@x.com"), JSON.stringify(rows));
    expect(loadShippingCustomers("s@x.com").map((c) => c.username)).toEqual(["ok"]);
  });
});
