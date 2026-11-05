// FamilyMart Customer Details with the buyer contact picker ON: the edit modal refuses an
// invalid WhatsApp number (error shown, Save disabled, no update call) and saves the platform.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { FmCustomer } from "../../adapters/fmCustomers";

const { updateFmCustomer, rows } = vi.hoisted(() => ({
  updateFmCustomer: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  rows: { current: [] as FmCustomer[] },
}));
vi.mock("../../adapters/fmCustomers", () => ({
  loadRecentFmCustomers: async () => ({ ok: true, rows: rows.current }),
  searchFmCustomers: async () => ({ ok: true, rows: [] }),
  updateFmCustomer: (...a: unknown[]) => updateFmCustomer(...a),
  deleteFmCustomer: vi.fn(async () => ({ ok: true })),
  countFmCustomers: async () => ({ ok: true, count: 1 }),
}));
vi.mock("../../adapters/fmScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/fmScan")>();
  return { ...actual, loadFmGlobalFee: vi.fn(async () => 39), saveFmScan: vi.fn(async () => ({ ok: true })) };
});

import FmCustomerDetails from "../FmCustomerDetails";

const cust = (over: Partial<FmCustomer> = {}): FmCustomer => ({ id: "c1", phone: "0911222333", name: "黃志明", storeId: "022131", buyerUsername: "+886911222333", contactPlatform: "whatsapp", createdAt: "", updatedAt: "", ...over });
const view = () => render(<TProvider lang="en"><FmCustomerDetails cur="NT$" contactOn /></TProvider>);
beforeEach(() => { updateFmCustomer.mockClear(); rows.current = [cust()]; });

describe("FamilyMart Customer Details — buyer contact ON (edit)", () => {
  it("an invalid WhatsApp number shows the error, disables Save and never calls the update", async () => {
    const r = view();
    fireEvent.click((await r.findAllByTestId("fcd-row-main"))[0]);
    fireEvent.click(await r.findByTestId("fcd-edit"));
    await r.findByTestId("fcd-edit-overlay");
    expect(r.getByTestId("fcd-edit-bc-pick-whatsapp").getAttribute("aria-checked")).toBe("true");
    fireEvent.change(r.getByTestId("fcd-edit-bc-input"), { target: { value: "12345" } });
    expect(r.getByTestId("fcd-edit-bc-err").textContent).toBe("Enter a valid phone number (8–15 digits)");
    expect((r.getByTestId("fcd-edit-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("fcd-edit-save"));
    await new Promise((res) => setTimeout(res, 20));
    expect(updateFmCustomer).not.toHaveBeenCalled();
  });
  it("a valid number saves +digits with contact_platform; 'no contact' saves NULL", async () => {
    const r = view();
    fireEvent.click((await r.findAllByTestId("fcd-row-main"))[0]);
    fireEvent.click(await r.findByTestId("fcd-edit"));
    await r.findByTestId("fcd-edit-overlay");
    fireEvent.change(r.getByTestId("fcd-edit-bc-input"), { target: { value: "0922333444" } });
    expect((r.getByTestId("fcd-edit-save") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(r.getByTestId("fcd-edit-save"));
    await waitFor(() => expect(updateFmCustomer).toHaveBeenCalledTimes(1));
    expect(updateFmCustomer.mock.calls[0][1]).toMatchObject({ buyer_username: "+886922333444", contact_platform: "whatsapp" });
  });
});
