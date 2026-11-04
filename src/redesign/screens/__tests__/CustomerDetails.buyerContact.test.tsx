// Customer Details with the buyer contact picker ON: the import row shows the picker with the
// contact's saved platform, Import passes the platform (4th arg) and the normalised value,
// the edit modal uses the picker and saves the platform (3rd arg).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelCustomer } from "../../adapters/parcelCustomers";

const { recent, saveParcelScan, updateParcelCustomer } = vi.hoisted(() => ({
  recent: { current: [] as ParcelCustomer[] },
  saveParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-1" })),
  updateParcelCustomer: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
}));
vi.mock("../../adapters/parcelCustomers", () => ({
  loadRecentParcelCustomers: async () => ({ ok: true, rows: recent.current }),
  searchParcelCustomers: async () => ({ ok: true, rows: [] }),
  updateParcelCustomer: (...a: unknown[]) => updateParcelCustomer(...a),
  deleteParcelCustomer: vi.fn(async () => ({ ok: true })),
  countPendingParcels: async () => ({ ok: true, count: 0 }),
  countParcelCustomers: async () => ({ ok: true, count: 2 }),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return { ...actual, saveParcelScan: (...a: unknown[]) => saveParcelScan(...a) };
});
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/parcelFrozen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelFrozen")>();
  return { ...actual, loadFrozenState: vi.fn(async () => ({ allowed: false, blocked: false, mode: "常溫", cfg: null })) };
});

import CustomerDetails from "../CustomerDetails";

const cust = (over: Partial<ParcelCustomer> = {}): ParcelCustomer => ({ id: "c1", phone: "0922333444", name: "陳大文", storeId: "133712", notes: "+886922333444", contactPlatform: "whatsapp", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z", ...over });
const view = () => render(<TProvider lang="en"><CustomerDetails cur="NT$" contactOn /></TProvider>);
beforeEach(() => { saveParcelScan.mockClear(); updateParcelCustomer.mockClear(); recent.current = [cust(), cust({ id: "c2", name: "Ana", phone: "0966888999", notes: "@ana", contactPlatform: undefined })]; });

describe("Customer Details — buyer contact ON", () => {
  it("import row: picker pre-selected from the contact; Import passes the platform + normalised value", async () => {
    const r = view();
    fireEvent.click((await r.findAllByTestId("cd-row-main"))[0]);
    await r.findByTestId("cd-import-panel");
    expect(r.queryByTestId("cd-handle")).toBeNull();
    expect(r.getByTestId("cd-bc-pick-whatsapp").getAttribute("aria-checked")).toBe("true");
    expect((r.getByTestId("cd-bc-input") as HTMLInputElement).value).toBe("+886922333444");
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "300" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0]).toHaveLength(4);
    expect(saveParcelScan.mock.calls[0][0]).toMatchObject({ notes: "+886922333444", amount: 300 });
    expect(saveParcelScan.mock.calls[0][3]).toBe("whatsapp");
  });
  it("a TikTok contact imports with NULL; an invalid WhatsApp number is refused with the WhatsApp message", async () => {
    const r = view();
    fireEvent.click((await r.findAllByTestId("cd-row-main"))[1]);
    await r.findByTestId("cd-import-panel");
    expect(r.getByTestId("cd-bc-pick-tiktok").getAttribute("aria-checked")).toBe("true");
    fireEvent.change(r.getByTestId("cd-price"), { target: { value: "300" } });
    fireEvent.click(r.getByTestId("cd-bc-pick-whatsapp"));
    fireEvent.change(r.getByTestId("cd-bc-input"), { target: { value: "12345" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(r.getByTestId("cd-import-err").textContent).toBe("Enter a valid phone number (8–15 digits)"));
    expect(saveParcelScan).not.toHaveBeenCalled();
    fireEvent.click(r.getByTestId("cd-bc-pick-tiktok"));
    fireEvent.change(r.getByTestId("cd-bc-input"), { target: { value: "@ana" } });
    fireEvent.click(r.getByTestId("cd-import"));
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0][3]).toBeNull();
  });
  it("edit modal: picker with the saved platform; save passes the platform (3rd arg); TikTok → null", async () => {
    const r = view();
    fireEvent.click((await r.findAllByTestId("cd-row-main"))[0]);
    fireEvent.click(await r.findByTestId("cd-edit"));
    await r.findByTestId("cd-edit-overlay");
    expect(r.queryByTestId("cd-edit-notes")).toBeNull();
    expect(r.getByTestId("cd-edit-bc-pick-whatsapp").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(r.getByTestId("cd-edit-bc-pick-line"));
    fireEvent.change(r.getByTestId("cd-edit-bc-input"), { target: { value: "@Chen.Line" } });
    fireEvent.click(r.getByTestId("cd-edit-save"));
    await waitFor(() => expect(updateParcelCustomer).toHaveBeenCalledTimes(1));
    expect(updateParcelCustomer.mock.calls[0]).toHaveLength(3);
    expect(updateParcelCustomer.mock.calls[0][1]).toMatchObject({ notes: "chen.line" });
    expect(updateParcelCustomer.mock.calls[0][2]).toBe("line");
  });
  it("edit modal: an invalid WhatsApp number shows the error, disables Save and never calls the update", async () => {
    const r = view();
    fireEvent.click((await r.findAllByTestId("cd-row-main"))[0]);
    fireEvent.click(await r.findByTestId("cd-edit"));
    await r.findByTestId("cd-edit-overlay");
    fireEvent.change(r.getByTestId("cd-edit-bc-input"), { target: { value: "12345" } });
    expect(r.getByTestId("cd-edit-bc-err").textContent).toBe("Enter a valid phone number (8–15 digits)");
    expect((r.getByTestId("cd-edit-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("cd-edit-save"));
    await new Promise((res) => setTimeout(res, 20));
    expect(updateParcelCustomer).not.toHaveBeenCalled();
    fireEvent.change(r.getByTestId("cd-edit-bc-input"), { target: { value: "0922333444" } }); // valid again → enabled
    expect((r.getByTestId("cd-edit-save") as HTMLButtonElement).disabled).toBe(false);
  });
  it("edit modal: a Facebook share link shows the error, disables Save, never calls the update; a people/<name>/<id>/ link saves fb:<id>", async () => {
    const r = view();
    fireEvent.click((await r.findAllByTestId("cd-row-main"))[0]);
    fireEvent.click(await r.findByTestId("cd-edit"));
    await r.findByTestId("cd-edit-overlay");
    fireEvent.click(r.getByTestId("cd-edit-bc-pick-facebook"));
    fireEvent.change(r.getByTestId("cd-edit-bc-input"), { target: { value: "https://www.facebook.com/share/1AbCdEfGh/" } });
    expect(r.getByTestId("cd-edit-bc-err").textContent).toBe("Open the buyer's profile and copy that link — share links can't be used.");
    expect((r.getByTestId("cd-edit-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(r.getByTestId("cd-edit-save"));
    await new Promise((res) => setTimeout(res, 20));
    expect(updateParcelCustomer).not.toHaveBeenCalled();
    fireEvent.change(r.getByTestId("cd-edit-bc-input"), { target: { value: "https://www.facebook.com/people/Juan-Dela-Cruz/100012345678901/" } });
    expect(r.queryByTestId("cd-edit-bc-err")).toBeNull();
    fireEvent.click(r.getByTestId("cd-edit-save"));
    await waitFor(() => expect(updateParcelCustomer).toHaveBeenCalledTimes(1));
    expect(updateParcelCustomer.mock.calls[0][1]).toMatchObject({ notes: "fb:100012345678901" });
    expect(updateParcelCustomer.mock.calls[0][2]).toBe("facebook");
  });
});
