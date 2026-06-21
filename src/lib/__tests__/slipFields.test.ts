import { describe, it, expect } from "vitest";
import { slipFieldVisibility } from "../slipFields";

describe("slipFieldVisibility — canonical slip on/off contract", () => {
  it("prints everything when all flags are on", () => {
    expect(
      slipFieldVisibility({
        printStoreName: true,
        printBuyerNumber: true,
        printBuyerUsername: true,
        printOrderItems: true,
        printTotal: true,
      }),
    ).toEqual({
      storeName: true,
      buyerNumber: true,
      buyerName: true,
      buyerUsername: true,
      orderItems: true,
      total: true,
    });
  });

  it("hides everything toggleable when all flags are off (buyer name still prints)", () => {
    expect(
      slipFieldVisibility({
        printStoreName: false,
        printBuyerNumber: false,
        printBuyerUsername: false,
        printOrderItems: false,
        printTotal: false,
      }),
    ).toEqual({
      storeName: false,
      buyerNumber: false,
      buyerName: true,
      buyerUsername: false,
      orderItems: false,
      total: false,
    });
  });

  it("buyer name has no toggle — always printed regardless of flags", () => {
    expect(slipFieldVisibility({}).buyerName).toBe(true);
    expect(
      slipFieldVisibility({
        printStoreName: false,
        printBuyerNumber: false,
        printBuyerUsername: false,
        printOrderItems: false,
        printTotal: false,
      }).buyerName,
    ).toBe(true);
  });

  it("total is INDEPENDENT of order items (the regression this fixes)", () => {
    // items off + total on -> total still shows
    const itemsOff = slipFieldVisibility({ printOrderItems: false, printTotal: true });
    expect(itemsOff.orderItems).toBe(false);
    expect(itemsOff.total).toBe(true);
    // items on + total off -> items show, total hidden
    const totalOff = slipFieldVisibility({ printOrderItems: true, printTotal: false });
    expect(totalOff.orderItems).toBe(true);
    expect(totalOff.total).toBe(false);
  });

  it("each toggle gates exactly its own field", () => {
    expect(slipFieldVisibility({ printStoreName: false }).storeName).toBe(false);
    expect(slipFieldVisibility({ printBuyerNumber: false }).buyerNumber).toBe(false);
    expect(slipFieldVisibility({ printBuyerUsername: false }).buyerUsername).toBe(false);
    expect(slipFieldVisibility({ printOrderItems: false }).orderItems).toBe(false);
    expect(slipFieldVisibility({ printTotal: false }).total).toBe(false);
  });

  it("a missing flag defaults to on (payload without settings prints everything)", () => {
    expect(slipFieldVisibility({})).toEqual({
      storeName: true,
      buyerNumber: true,
      buyerName: true,
      buyerUsername: true,
      orderItems: true,
      total: true,
    });
  });
});
