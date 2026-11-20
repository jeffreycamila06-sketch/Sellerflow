// Parcel Scan (7-11) — its five 2.5 s toasts hide themselves, and their timers stop when the screen
// closes (the same fix as Pickup Status, CI run 1843):
//   saved a new parcel · saved an edit · Scan QR filled the username · Scan QR found nothing ·
//   Scan QR could not read the picture.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ParcelScanRow } from "../../adapters/parcelScan";
import { TProvider } from "../../i18n";
import { expectNothingLate, tick, until } from "../../adapters/__tests__/pageGone";

const { saveParcelScan, updateParcelScan, loadRows, decodeQrFromFile } = vi.hoisted(() => ({
  saveParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true, id: "new-1" }) as { ok: boolean; id?: string }),
  updateParcelScan: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: boolean }),
  loadRows: { current: [] as ParcelScanRow[] },
  decodeQrFromFile: vi.fn(async (..._a: unknown[]) => null as string | null),
}));
vi.mock("../../adapters/parcelScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelScan")>();
  return {
    ...actual,
    fileToScanBase64: vi.fn(), scanParcel: vi.fn(), saveParcelScan: (...a: unknown[]) => saveParcelScan(...a),
    loadParcelScans: vi.fn(async () => ({ ok: true, rows: loadRows.current })),
    loadLastExportBatch: vi.fn(async () => ({ ok: true, batch: null })), loadUndeliveredExports: vi.fn(async () => ({ ok: true, batches: [] })),
    checkEmapStore: vi.fn(async () => ({ status: "valid" as const })), saveStoreCheck: vi.fn(async () => ({ ok: true })),
    markScansExported: vi.fn(), unmarkScansExported: vi.fn(), deleteParcelScan: vi.fn(), deleteExportedParcels: vi.fn(),
    updateParcelScan: (...a: unknown[]) => updateParcelScan(...a), resetExtensionChecks: vi.fn(async () => ({ ok: true })),
    getCreditBalance: vi.fn(async () => ({ ok: true, balance: 99 })),
  };
});
vi.mock("../../adapters/qrDecode", async () => (await import("./qrReaderMock")).qrReaderModule((f: File) => decodeQrFromFile(f)));
vi.mock("../../adapters/shippingSettings", () => ({ loadGlobalShippingFee: async () => 38 }));

import ParcelScan from "../ParcelScan";

const SAVED: ParcelScanRow = { id: "r1", customerName: "Old Name", phone: "0911111111", storeId: "266402", amount: 300, notes: "@old", status: "confirmed", storeCheckStatus: "valid", createdAt: "2026-09-08T00:00:00Z" };
const view = () => render(<TProvider lang="en"><ParcelScan cur="NT$" manualOnly /></TProvider>);
const toastOf = (r: ReturnType<typeof view>) => r.queryByTestId("ps-toast")?.textContent ?? null;
const pickQr = (r: ReturnType<typeof view>) =>
  fireEvent.change(r.getByTestId("ps-qr-file"), { target: { files: [new File([new Uint8Array([1])], "label.jpg", { type: "image/jpeg" })] } });

async function saveNew(r: ReturnType<typeof view>) {
  await until(() => r.queryByTestId("ps-manual"));
  fireEvent.click(r.getByTestId("ps-manual"));
  fireEvent.change(r.getByTestId("ps-name"), { target: { value: "Juan Cruz" } });
  fireEvent.change(r.getByTestId("ps-phone"), { target: { value: "0912345678" } });
  fireEvent.change(r.getByTestId("ps-store"), { target: { value: "266402" } });
  fireEvent.change(r.getByTestId("ps-amount"), { target: { value: "550" } });
  fireEvent.change(r.getByTestId("ps-notes"), { target: { value: "@juan" } });
  fireEvent.click(r.getByTestId("ps-save"));
  await until(() => saveParcelScan.mock.calls.length === 1);
}
async function saveEdit(r: ReturnType<typeof view>) {
  await until(() => r.queryByTestId("ps-row-edit"));
  fireEvent.click(r.getByTestId("ps-row-edit"));
  fireEvent.change(r.getByTestId("ps-name"), { target: { value: "New Name" } });
  fireEvent.click(r.getByTestId("ps-save"));
  await until(() => updateParcelScan.mock.calls.length === 1);
}
async function scanQr(r: ReturnType<typeof view>) {
  await until(() => r.queryByTestId("ps-manual"));
  fireEvent.click(r.getByTestId("ps-manual"));
  pickQr(r);
  await until(() => decodeQrFromFile.mock.calls.length === 1);
}

const CASES: Array<{ name: string; toast: string; arrange: () => void; act: (r: ReturnType<typeof view>) => Promise<void> }> = [
  { name: "a new parcel was saved", toast: "Parcel saved", arrange: () => {}, act: saveNew },
  { name: "an edit was saved", toast: "Parcel saved", arrange: () => { loadRows.current = [SAVED]; }, act: saveEdit },
  { name: "Scan QR filled the username", toast: "Filled @username from QR", arrange: () => { decodeQrFromFile.mockResolvedValue("https://tiktok.com/@maria_shops"); }, act: scanQr },
  { name: "Scan QR found no username", toast: "No QR found — type the username", arrange: () => { decodeQrFromFile.mockResolvedValue(null); }, act: scanQr },
  { name: "Scan QR could not read the picture", toast: "No QR found — type the username", arrange: () => { decodeQrFromFile.mockRejectedValue(new Error("unreadable")); }, act: scanQr },
];

beforeEach(() => {
  vi.useFakeTimers();   // the clock moves only when a test moves it
  saveParcelScan.mockReset(); saveParcelScan.mockResolvedValue({ ok: true, id: "new-1" });
  updateParcelScan.mockReset(); updateParcelScan.mockResolvedValue({ ok: true });
  decodeQrFromFile.mockReset(); decodeQrFromFile.mockResolvedValue(null);
  loadRows.current = [];
});
afterEach(() => { vi.useRealTimers(); });

describe("Parcel Scan — the screen is closed right after a toast", () => {
  for (const c of CASES) {
    it(`${c.name}: no timer is left and nothing updates late`, async () => {
      c.arrange();
      const r = view();
      await c.act(r);
      await until(() => toastOf(r) === c.toast);
      r.unmount();
      expectNothingLate();
    });
  }
  it("closed while Scan QR is still reading the picture: no timer is started afterwards", async () => {
    let done: ((v: string | null) => void) | null = null;
    decodeQrFromFile.mockImplementation(() => new Promise((res) => { done = res; }));
    const r = view();
    await scanQr(r);
    r.unmount();
    done!("https://tiktok.com/@maria_shops");
    await tick(0);
    expectNothingLate();
  });
});

describe("Parcel Scan — while the screen is open nothing changed", () => {
  for (const c of CASES) {
    it(`${c.name}: the toast stays 2.5 seconds`, async () => {
      c.arrange();
      const r = view();
      await c.act(r);
      await until(() => toastOf(r) === c.toast);
      await tick(2499);
      expect(toastOf(r)).toBe(c.toast);
      await tick(1);
      expect(toastOf(r)).toBeNull();
    });
  }
});
