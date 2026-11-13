// Parcel Scan FamilyMart — store # check OFF = main, proven with the REAL fmScan adapter (not
// mocked): a recording Supabase client keeps every select / insert / update of the screen, and no
// "store_check" appears anywhere while the check is off. Plus item 3: an answer belongs to one store #.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

vi.mock("../../../supabase", async () => (await import("./fmFakeSupabase")).fakeSupabaseModule);
vi.mock("../../../lib/dateHelpers", async (orig) => ({ ...(await orig<typeof import("../../../lib/dateHelpers")>()), taipeiDayId: () => "2026-10-11" }));

import FmParcelScan from "../FmParcelScan";
import { fake } from "./fmFakeSupabase";
import { loadFmScans, fmStoreAnswerOf } from "../../adapters/fmScan";
import { writeFmStoreCheck } from "../../adapters/fmStoreCheck";

const dbRow = (id: string, extra = {}) => ({ id, recipient_name: `Buyer ${id}`, phone: "0958704782", store_id: "022131", amount: 500, shipping_fee: 39, order_date: "2026-10-11", buyer_username: "@x", contact_platform: null, created_at: "2026-10-11T03:00:00Z", exported_at: null, export_batch_id: null, ...extra });
const fetchMock = vi.fn();

beforeEach(() => {
  fake.reset(); fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:x"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); });

async function driveTheScreen(on: boolean) {
  fake.rows = [dbRow("a", { store_check_status: "not_found", store_check_store_id: "022131" })];
  const r = render(<TProvider lang="en"><FmParcelScan storeCheckOn={on} /></TProvider>);
  await waitFor(() => expect(r.getAllByTestId("fms-row").length).toBe(1));
  // add a parcel
  await waitFor(() => expect((r.getByTestId("fms-manual") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(r.getByTestId("fms-manual"));
  fireEvent.change(r.getByTestId("fms-name"), { target: { value: "New Buyer" } });
  fireEvent.change(r.getByTestId("fms-phone"), { target: { value: "0958704782" } });
  fireEvent.change(r.getByTestId("fms-store"), { target: { value: "015905" } });
  fireEvent.change(r.getByTestId("fms-amount"), { target: { value: "300" } });
  fireEvent.change(r.getByTestId("fms-username"), { target: { value: "@n" } });
  fireEvent.click(r.getByTestId("fms-save"));
  await waitFor(() => expect(r.getAllByTestId("fms-row").length).toBe(2));
  fireEvent.click(r.getByTestId("fms-manual-cancel"));
  // edit the saved one: another store #
  fireEvent.click(r.container.querySelector('[data-row-id="a"] [data-testid="fms-row-edit"]')!);
  fireEvent.change(r.getByTestId("fms-store"), { target: { value: "022777" } });
  fireEvent.click(r.getByTestId("fms-save"));
  await waitFor(() => expect(fake.writes().some((w) => w.store_id === "022777")).toBe(true));
  await waitFor(() => expect(r.queryByTestId("fms-confirm")).toBeNull());
  return r;
}

describe("check off and login not listed = main (real adapter)", () => {
  it("add, edit, export: no 'store_check' in any select or update, no server call, no new label", async () => {
    const r = await driveTheScreen(false);
    await waitFor(() => expect((r.getByTestId("fms-export-btn") as HTMLButtonElement).disabled).toBe(false));
    expect(r.getByTestId("fms-export-btn").textContent).toContain("2"); // the saved not_found row is exported as on main
    fireEvent.click(r.getByTestId("fms-export-btn"));
    fireEvent.click(r.getByTestId("fms-confirm-export"));
    await waitFor(() => expect(fake.writes().some((w) => "exported_at" in w && w.exported_at)).toBe(true));
    const ops = fake.calls.filter((c) => c.table === "fm_parcel_scans").map((c) => c.ops[0].m);
    expect(ops).toEqual(expect.arrayContaining(["select", "insert", "update"]));
    expect(fake.text()).not.toContain("store_check");
    expect(fetchMock).not.toHaveBeenCalled();
    for (const id of ["fms-store-badge", "fms-store-ok", "fms-recheck", "fms-attn", "fms-attn-toast", "fms-tab-wrong"]) expect(r.queryByTestId(id)).toBeNull();
  });
  it("control — with the check ON the same recorder does see the columns (so the proof above can fail)", async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => ({ success: true, status: "valid" }) }));
    await driveTheScreen(true);
    await waitFor(() => expect(fake.text()).toContain("store_check_store_id"));
    expect(fetchMock).toHaveBeenCalled();
  });
});

describe("3 — an answer belongs to one store #", () => {
  it("only 'valid' / 'not_found' written for the row's CURRENT store # count; anything else = not checked", () => {
    expect(fmStoreAnswerOf({ store_id: "022131", store_check_status: "valid", store_check_store_id: "022131" })).toBe("valid");
    expect(fmStoreAnswerOf({ store_id: "022131", store_check_status: "not_found", store_check_store_id: "022131" })).toBe("not_found");
    expect(fmStoreAnswerOf({ store_id: "022999", store_check_status: "not_found", store_check_store_id: "022131" })).toBeNull(); // the store # changed elsewhere
    expect(fmStoreAnswerOf({ store_id: "022131", store_check_status: "valid", store_check_store_id: null })).toBeNull();
    expect(fmStoreAnswerOf({ store_id: "022131", store_check_status: "unknown", store_check_store_id: "022131" })).toBeNull();
    expect(fmStoreAnswerOf({ store_id: "022131" })).toBeNull();
  });
  it("the list read applies it; the write carries the checked store # and only real answers", async () => {
    fake.rows = [
      dbRow("same", { store_check_status: "not_found", store_check_store_id: "022131" }),
      dbRow("moved", { store_id: "022999", store_check_status: "not_found", store_check_store_id: "022131" }),
    ];
    const on = await loadFmScans(true);
    expect(on.rows.map((x) => [x.id, x.storeCheckStatus])).toEqual([["same", "not_found"], ["moved", undefined]]);
    const sel = fake.calls[0].ops[0];
    expect(sel.args[0]).toContain("store_check_status, store_check_store_id");
    fake.calls = [];
    expect((await loadFmScans()).rows.every((x) => x.storeCheckStatus === undefined)).toBe(true);
    expect(fake.text()).not.toContain("store_check");
    fake.calls = [];
    expect(await writeFmStoreCheck("same", "022131", "valid")).toBe(true);
    expect(fake.writes()[0]).toMatchObject({ store_check_status: "valid", store_check_store_id: "022131" });
    expect(fake.calls[0].ops.filter((o) => o.m === "eq").map((o) => o.args)).toEqual([["id", "same"], ["user_id", "u1"], ["store_id", "022131"]]);
    fake.calls = [];
    expect(await writeFmStoreCheck("same", "022131", "unknown" as never)).toBe(false);
    expect(fake.calls.length).toBe(0);
  });
});
