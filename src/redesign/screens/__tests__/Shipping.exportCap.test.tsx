// Batch D / audit #6 — the 賣貨便 importer accepts MAX 500 rows per file.
// SHIP_MAX existed in the adapter but was NEVER enforced: an oversized export
// passed the quota RPC (spending quota!), built a >500-row .xlsm, and only the
// 7-11 importer rejected it. Now doExport refuses >SHIP_MAX selections up front
// with a clear localized message, BEFORE the RPC (no quota spent, no file).
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { Buyer } from "../../../lib/orderTypes";
import { SHIP_MAX, type ShippingEntry } from "../../adapters/shipping";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
const { rpcMock, entriesMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(async (): Promise<unknown> => ({ ok: false, error: "boom" })),
  entriesMock: { rows: [] as unknown[] },
}));
vi.mock("../../adapters/shippingDb", () => ({
  loadShippingEntries: vi.fn(async () => entriesMock.rows),
  upsertShippingEntry: vi.fn(async () => ({ ok: true })),
  deleteShippingEntry: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../../adapters/shippingExport", () => ({
  quotaForPlan: () => null, // master/unlimited — isolates the SHIP_MAX guard from the quota guard
  callExportRpc: (...a: unknown[]) => rpcMock(...(a as [string[]])),
  loadExportedCount: vi.fn(async () => 0),
  entryToXlsRow: vi.fn(() => []),
  exportFilename: vi.fn(() => "f.xlsm"),
  fetchShipTemplate: vi.fn(async () => new ArrayBuffer(0)),
  buildXlsmFromTemplate: vi.fn(async () => new Uint8Array()),
  deliverXlsm: vi.fn(async () => ({ ok: true, via: "blob" })),
  hasNativeFileShare: () => false,
  markBatchShipped: vi.fn(async () => ({ ok: true })),
}));

import Shipping from "../Shipping";

const mkEntry = (i: number): ShippingEntry => ({
  id: `e-${i}`, sessionKey: "2026-07-05", buyerNumber: i, bagNumber: 1,
  includedOrderIds: [1780000000000 + i], recipientName: "王小明", phone: "0912345678",
  storeId: "123456", tempLayer: "常溫", productDesc: `#${i} 商品x1`, orderAmount: 100,
  shippingFee: 38, buyerUsername: "", status: "encoded", exportBatchId: null, exportedAt: null, shippedAt: null,
});
// One real buyer group so the export card renders (groups.length > 0).
const buyers: Buyer[] = [{
  handle: "ann", name: "Ann", platform: "TikTok", num: 1, totalOrders: 1, totalSpent: 100,
  orders: [{ orderNum: 1780000000001, item: "x", qty: 1, price: 100, total: 100, time: "9 PM", handle: "ann", name: "Ann", bNum: 1, platform: "TikTok", status: "New", date: "2026-07-05" }],
} as unknown as Buyer];

const renderShipping = () =>
  render(<TProvider lang="en"><Shipping cur="NT$" buyers={buyers} sessionKey="2026-07-05" /></TProvider>);
const exportBtn = () => screen.getByText(new RegExp("Export", "i"), { selector: "button" });

beforeEach(() => { vi.clearAllMocks(); rpcMock.mockResolvedValue({ ok: false, error: "boom" }); });

describe(`Shipping export — ${SHIP_MAX}-row importer cap (Batch D / audit #6)`, () => {
  it(`${SHIP_MAX + 1} selected rows → export REFUSED with a clear message, RPC never called (no quota spent)`, async () => {
    entriesMock.rows = Array.from({ length: SHIP_MAX + 1 }, (_, i) => mkEntry(i + 1));
    renderShipping();
    await vi.waitFor(() => exportBtn()); // entries loaded → export card + button mounted
    fireEvent.click(exportBtn());
    await vi.waitFor(() => expect(screen.getByText(new RegExp(`Max ${SHIP_MAX} rows`))).toBeTruthy());
    expect(screen.getByText(new RegExp(`${SHIP_MAX + 1} selected`))).toBeTruthy(); // says how many they picked
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it(`exactly ${SHIP_MAX} rows → passes the cap and reaches the RPC (boundary is inclusive)`, async () => {
    entriesMock.rows = Array.from({ length: SHIP_MAX }, (_, i) => mkEntry(i + 1));
    renderShipping();
    await vi.waitFor(() => exportBtn()); // entries loaded → export card + button mounted
    fireEvent.click(exportBtn());
    await vi.waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect((rpcMock as Mock).mock.calls[0][0]).toHaveLength(SHIP_MAX);
    expect(screen.queryByText(new RegExp(`Max ${SHIP_MAX} rows`))).toBeNull();
  });
});
