// Parcel Scan "Scan QR" — decodes the buyer @username off the SFL sticker photo and
// auto-fills the required handle field VERBATIM; no QR → field untouched. decodeQrFromFile
// is mocked (the decode itself is covered by qrDecode.test); this pins the screen wiring.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";

const { saveParcelScan, loadRows, decodeQrFromFile } = vi.hoisted(() => ({
  saveParcelScan: vi.fn(async () => ({ ok: true, id: "new-1" }) as { ok: boolean; id?: string; error?: string }),
  loadRows: { current: [] as ParcelScanRow[] },
  decodeQrFromFile: vi.fn(async () => null as string | null),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan,
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(), deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: vi.fn(async () => ({ ok: true })), resetExtensionChecks: vi.fn(async () => ({ ok: true })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile }));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const view = () => render(<TProvider><ParcelScan cur="NT$" /></TProvider>);
const pickQr = (r: ReturnType<typeof view>) =>
  fireEvent.change(r.getByTestId("ps-qr-file"), { target: { files: [new File([new Uint8Array([1])], "label.jpg", { type: "image/jpeg" })] } });

beforeEach(() => {
  saveParcelScan.mockClear(); saveParcelScan.mockResolvedValue({ ok: true, id: "new-1" });
  decodeQrFromFile.mockReset(); decodeQrFromFile.mockResolvedValue(null);
  loadRows.current = [];
});

describe("Parcel Scan — Scan QR → auto-fill @username", () => {
  it("the Scan QR button is present on the encode form", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    expect(r.getByTestId("ps-scan-qr")).toBeTruthy();
  });

  it("a bare-handle QR (old sticker) fills the handle field (and un-ticks 'no handle')", async () => {
    decodeQrFromFile.mockResolvedValue("Ashley102031");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.click(r.getByTestId("ps-no-handle"));                    // start with the escape hatch on
    expect((r.getByTestId("ps-no-handle") as HTMLInputElement).checked).toBe(true);
    pickQr(r);
    await waitFor(() => expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe("Ashley102031"));
    expect((r.getByTestId("ps-no-handle") as HTMLInputElement).checked).toBe(false); // text present → box off
  });

  it("a TikTok profile URL QR (new sticker) fills just the @username", async () => {
    decodeQrFromFile.mockResolvedValue("https://tiktok.com/@Zona.nyaman1933");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    pickQr(r);
    await waitFor(() => expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe("Zona.nyaman1933"));
  });

  it("a non-TikTok / random QR is REJECTED → the handle field is left untouched", async () => {
    decodeQrFromFile.mockResolvedValue("https://youtube.com/@someone");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "typed_by_hand" } });
    pickQr(r);
    await waitFor(() => expect(decodeQrFromFile).toHaveBeenCalledTimes(1));
    expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe("typed_by_hand"); // unchanged
  });

  it("no QR found → the handle field is left UNTOUCHED (type / 'no handle' rules unchanged)", async () => {
    decodeQrFromFile.mockResolvedValue(null);
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "typed_by_hand" } });
    pickQr(r);
    await waitFor(() => expect(decodeQrFromFile).toHaveBeenCalledTimes(1));
    expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe("typed_by_hand"); // unchanged
  });

  it("a decoded QR enables Save once the other required fields are filled", async () => {
    decodeQrFromFile.mockResolvedValue("buyer.99");
    const r = view();
    fireEvent.click(await r.findByTestId("ps-manual"));
    fireEvent.change(r.getByTestId("ps-name"), { target: { value: "Juan" } });
    fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
    fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "300" } });
    expect((r.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(true); // handle still blank
    pickQr(r);
    await waitFor(() => expect((r.getByTestId("ps-notes") as HTMLInputElement).value).toBe("buyer.99"));
    expect((r.getByTestId("ps-save") as HTMLButtonElement).disabled).toBe(false);
  });
});
