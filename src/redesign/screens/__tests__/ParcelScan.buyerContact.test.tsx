// Parcel Scan with the buyer contact picker ON: header [Scan QR] [Customers], the picker in
// place of the handle row, saves carry the platform (NULL for TikTok / no contact), the
// platform STAYS after each save (v2 item 9), Scan QR selects TikTok, WhatsApp validation
// blocks Save, edit pre-fills the saved platform.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { saveParcelScan, updateParcelScan, loadRows, decodeQrFromFile } = vi.hoisted(() => ({
  saveParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-1" })),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  loadRows: { current: [] as ParcelScanRow[] },
  decodeQrFromFile: vi.fn(async (_f: File) => "https://www.tiktok.com/@maria_shops"),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual, fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan, updateParcelScan,
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(), deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    resetExtensionChecks: vi.fn(async () => ({ ok: true })), getCreditBalance: vi.fn(async () => ({ ok: true, balance: 5 })),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    confirmExportDelivered: vi.fn(async () => ({ ok: true, n: 1 })), undoExportBatch: vi.fn(async () => ({ ok: true, result: "undone" })),
  };
});
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile: (f: File) => decodeQrFromFile(f) }));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));
vi.mock("../../adapters/parcelFrozen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelFrozen")>();
  return { ...actual, loadFrozenState: vi.fn(async () => ({ allowed: false, blocked: false, mode: "常溫", cfg: null })) };
});

import ParcelScan from "../ParcelScan";

const row = (over: Partial<ParcelScanRow> = {}): ParcelScanRow => ({
  id: "r1", customerName: "王小美", phone: "0912345678", storeId: "266402", amount: 550, notes: "maria", status: "confirmed",
  storeCheckStatus: "valid", storeFullStatus: "open", phoneCheckStatus: "ok", phoneRestrictedUntil: null, createdAt: "2026-11-03T00:00:00Z", ...over,
});
const view = () => render(<TProvider lang="en"><ParcelScan cur="NT$" checkOn contactOn /></TProvider>);
const fill = (r: ReturnType<typeof render>) => {
  fireEvent.change(r.getByTestId("ps-name"), { target: { value: "王小美" } });
  fireEvent.change(r.getByTestId("ps-phone"), { target: { value: "0912345678" } });
  fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
  fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "550" } });
};
const save = (r: ReturnType<typeof render>) => fireEvent.click(r.getByText("Save"));
beforeEach(() => { saveParcelScan.mockClear(); updateParcelScan.mockClear(); loadRows.current = []; decodeQrFromFile.mockClear(); });

describe("Parcel Scan — buyer contact ON", () => {
  it("header: Scan QR + Customers; picker replaces the handle row; TikTok default; legacy row gone", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    const card = await r.findByTestId("ps-confirm");
    const header = card.firstElementChild!;
    expect(header.querySelector('[data-testid="ps-scan-qr"]')).toBeTruthy();
    expect(header.querySelector('[data-testid="ps-open-customers"]')).toBeTruthy();
    expect(card.querySelector('[data-testid="ps-bc-field"]')).toBeTruthy();
    expect(card.querySelector('[data-testid="ps-notes"]')).toBeNull();
    expect(card.querySelector('[data-testid="ps-no-handle"]')).toBeNull();
    expect(card.textContent).not.toContain("Buyer @username (TikTok/FB/IG)");
    expect(r.getByTestId("ps-bc-pick-tiktok").getAttribute("aria-checked")).toBe("true");
    expect(card.querySelector('[data-testid="ps-qr-file"]')).toBeTruthy();
  });
  it("WhatsApp: saves +digits with contact_platform 'whatsapp'; the platform STAYS for the next parcel; an invalid number blocks Save", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    await r.findByTestId("ps-confirm");
    fill(r);
    fireEvent.click(r.getByTestId("ps-bc-pick-whatsapp"));
    fireEvent.change(r.getByTestId("ps-bc-input"), { target: { value: "12345" } });
    expect((r.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
    expect(r.getByTestId("ps-bc-err")).toBeTruthy();
    fireEvent.change(r.getByTestId("ps-bc-input"), { target: { value: "0922 333 444" } });
    expect((r.getByText("Save") as HTMLButtonElement).disabled).toBe(false);
    save(r);
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0]).toHaveLength(4);
    expect(saveParcelScan.mock.calls[0][0]).toMatchObject({ notes: "+886922333444" });
    expect(saveParcelScan.mock.calls[0][3]).toBe("whatsapp");
    // continuous manual mode: blank form, platform still WhatsApp (v2 item 9)
    expect((r.getByTestId("ps-bc-input") as HTMLInputElement).value).toBe("");
    expect(r.getByTestId("ps-bc-pick-whatsapp").getAttribute("aria-checked")).toBe("true");
  });
  it("TikTok and 'Buyer has no contact' save contact_platform NULL (notes blank for no contact); LINE / Facebook link normalised", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    await r.findByTestId("ps-confirm");
    fill(r);
    fireEvent.change(r.getByTestId("ps-bc-input"), { target: { value: "@maria" } });
    save(r);
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0][0]).toMatchObject({ notes: "@maria" });
    expect(saveParcelScan.mock.calls[0][3]).toBeNull();
    fill(r);
    fireEvent.click(r.getByTestId("ps-bc-none"));
    expect((r.getByText("Save") as HTMLButtonElement).disabled).toBe(false);
    save(r);
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(2));
    expect(saveParcelScan.mock.calls[1][0]).toMatchObject({ notes: null });
    expect(saveParcelScan.mock.calls[1][3]).toBeNull();
    fill(r);
    fireEvent.click(r.getByTestId("ps-bc-pick-facebook"));
    fireEvent.change(r.getByTestId("ps-bc-input"), { target: { value: "https://www.facebook.com/joy.reyes.90" } });
    save(r);
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(3));
    expect(saveParcelScan.mock.calls[2][0]).toMatchObject({ notes: "joy.reyes.90" });
    expect(saveParcelScan.mock.calls[2][3]).toBe("facebook");
    expect((saveParcelScan.mock.calls[2][0] as { notes: string }).notes.length).toBeLessThanOrEqual(50);
  });
  it("a pasted 55-char Facebook profile link is NOT cut by the input: saved as fb:<id>", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    await r.findByTestId("ps-confirm");
    fill(r);
    fireEvent.click(r.getByTestId("ps-bc-pick-facebook"));
    const link = "https://www.facebook.com/profile.php?id=100012345678901";
    expect(link).toHaveLength(55);
    fireEvent.change(r.getByTestId("ps-bc-input"), { target: { value: link } });
    expect((r.getByTestId("ps-bc-input") as HTMLInputElement).value).toBe(link); // whole link still in the field
    save(r);
    await waitFor(() => expect(saveParcelScan).toHaveBeenCalledTimes(1));
    expect(saveParcelScan.mock.calls[0][0]).toMatchObject({ notes: "fb:100012345678901" });
    expect(saveParcelScan.mock.calls[0][3]).toBe("facebook");
  });
  it("Scan QR fills the handle AND selects TikTok (from any platform)", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    await r.findByTestId("ps-confirm");
    fireEvent.click(r.getByTestId("ps-bc-pick-line"));
    fireEvent.change(r.getByTestId("ps-qr-file"), { target: { files: [new File(["x"], "qr.png", { type: "image/png" })] } });
    await waitFor(() => expect((r.getByTestId("ps-bc-input") as HTMLInputElement).value).toBe("maria_shops"));
    expect(r.getByTestId("ps-bc-pick-tiktok").getAttribute("aria-checked")).toBe("true");
  });
  it("edit pre-fills the row's platform and saves it (5th arg); a TikTok row saves NULL", async () => {
    loadRows.current = [row({ id: "b", notes: "yating.line", contactPlatform: "line" }), row({ id: "a", notes: "maria" })];
    const r = view();
    const edits = await r.findAllByTestId("ps-row-edit");
    fireEvent.click(edits[0]);
    await r.findByTestId("ps-confirm");
    expect(r.getByTestId("ps-bc-pick-line").getAttribute("aria-checked")).toBe("true");
    expect((r.getByTestId("ps-bc-input") as HTMLInputElement).value).toBe("yating.line");
    fireEvent.change(r.getByTestId("ps-bc-input"), { target: { value: "Yating.New" } });
    save(r);
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(1));
    expect(updateParcelScan.mock.calls[0]).toHaveLength(5);
    expect(updateParcelScan.mock.calls[0][1]).toMatchObject({ notes: "yating.new" });
    expect(updateParcelScan.mock.calls[0][4]).toBe("line");
    fireEvent.click((await r.findAllByTestId("ps-row-edit"))[1]);
    await r.findByTestId("ps-confirm");
    expect(r.getByTestId("ps-bc-pick-tiktok").getAttribute("aria-checked")).toBe("true");
    save(r);
    await waitFor(() => expect(updateParcelScan).toHaveBeenCalledTimes(2));
    expect(updateParcelScan.mock.calls[1][4]).toBeNull();
  });
});
