// Approved printers read (one per session; failure → built-in only) + the Admin "Printer testers" panel.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const h = vi.hoisted(() => ({
  select: vi.fn(), rpc: vi.fn(), signed: vi.fn(async () => ({ data: { signedUrl: "https://x/photo.jpg" }, error: null })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({ select: (cols: string) => ({ eq: (...a: unknown[]) => h.select(cols, ...a) }) }),
    rpc: (...a: unknown[]) => h.rpc(...a),
    storage: { from: () => ({ createSignedUrl: h.signed }) },
  },
}));
import { loadApprovedPrinters, __resetApprovedPrinters } from "../printerTesters";
import * as models from "../printerModels";
import PrinterTestersPanel from "../../components/PrinterTestersPanel";

beforeEach(() => { __resetApprovedPrinters(); h.select.mockReset(); h.rpc.mockReset(); });

describe("approved printers read", () => {
  it("reads ACTIVE rows once per session (cached)", async () => {
    h.select.mockResolvedValue({ data: [{ prefix: "LabelThing-", brand: "Other", model: "LabelThing", lang: "escpos", active: true }], error: null });
    const a = await loadApprovedPrinters(); const b = await loadApprovedPrinters();
    expect(a).toEqual([{ prefix: "LabelThing-", brand: "Other", model: "LabelThing", lang: "escpos", shiftMm: 0, flip: false }]);
    expect(b).toBe(a);
    expect(h.select).toHaveBeenCalledTimes(1);
    expect(h.select).toHaveBeenCalledWith("prefix,brand,model,lang,active,shift_mm,flip", "active", true);
  });
  it("sql/161 not applied (no shift_mm / flip column) → the rows again without them (no shift, no flip)", async () => {
    h.select.mockImplementation(async (cols: string) => cols.includes("shift_mm")
      ? { data: null, error: { message: "column approved_printers.shift_mm does not exist" } }
      : { data: [{ prefix: "CT221B-", brand: "Clabel", model: "CT221B", lang: "tspl", active: true }], error: null });
    expect(await loadApprovedPrinters()).toEqual([{ prefix: "CT221B-", brand: "Clabel", model: "CT221B", lang: "tspl", shiftMm: 0, flip: false }]);
    expect(h.select.mock.calls.map((c) => c[0])).toEqual(["prefix,brand,model,lang,active,shift_mm,flip", "prefix,brand,model,lang,active"]);
  });
  it("a failed read (error or throw) = built-in only", async () => {
    h.select.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadApprovedPrinters()).toEqual([]);
    __resetApprovedPrinters();
    h.select.mockRejectedValue(new Error("offline"));
    const rows = await loadApprovedPrinters();
    expect(rows).toEqual([]);
    models.setApprovedPrinters(rows);
    expect(models.knownPrinterInfo({ name: "LabelThing-9" })).toBeNull();
    expect(models.knownPrinterInfo({ name: "XP-420B" })).toEqual({ brand: "Xprinter", model: "XP-420B" });
  });
});

describe("Admin → Printer testers", () => {
  const REPORT = { id: "r1", email: "t@x.com", printer_name: "LabelThing-9", lang: "cpcl", sticker_size: "60x40mm", send_ok: true, send_code: null, clean: true, photo_path: "u/1.jpg", created_at: "2026-11-15T00:00:00Z", ble_facts: {} };
  const NOT_CLEAN = { ...REPORT, id: "r2", clean: false, photo_path: null };
  // slowMs: how long each of the named calls takes to answer (a call not named answers at once).
  function rpcs(over: Record<string, unknown> = {}, slowMs: Record<string, number> = {}) {
    h.rpc.mockImplementation(async (fn: string) => {
      const base: Record<string, unknown> = { admin_printer_testers: [{ email: "t@x.com", created_at: "2026-11-14T00:00:00Z" }], admin_printer_test_reports: [REPORT, NOT_CLEAN], admin_approved_printers: [], admin_printer_tester_add: true, admin_printer_tester_remove: true, admin_approve_printer: "a1", admin_set_approved_printer_active: true, ...over };
      if (slowMs[fn]) await new Promise((res) => setTimeout(res, slowMs[fn]));
      return { data: base[fn], error: null };
    });
  }
  const callsOf = (fn: string) => h.rpc.mock.calls.filter((c) => c[0] === fn).length;
  const renderPanel = () => render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
  it("add / remove a tester calls the admin RPCs", async () => {
    // The Add answers a moment later in EVERY run, as it does under CI load (run 1849: "remove" was
    // never called, 7 calls). While a change is on its way the panel's buttons are off — a tap then
    // does nothing — so the test taps Remove only once the button is on again.
    rpcs({}, { admin_printer_tester_add: 30 });
    renderPanel();
    await screen.findByText("t@x.com");
    const remove = () => screen.getByTestId("pt-remove") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("pt-email"), { target: { value: " New@X.com " } });
    fireEvent.click(screen.getByTestId("pt-add"));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_printer_tester_add", { p_email: "new@x.com" }));
    await waitFor(() => expect(remove().disabled).toBe(false));
    fireEvent.click(remove());
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_printer_tester_remove", { p_email: "t@x.com" }));
  });
  it("while one change is on its way, a second tap does nothing (no double add, no remove in between)", async () => {
    rpcs({}, { admin_printer_tester_add: 30 });
    renderPanel();
    await screen.findByText("t@x.com");
    const add = () => screen.getByTestId("pt-add") as HTMLButtonElement;
    const remove = () => screen.getByTestId("pt-remove") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("pt-email"), { target: { value: "new@x.com" } });
    fireEvent.click(add());
    expect([add().disabled, remove().disabled]).toEqual([true, true]);   // at once, before the answer
    fireEvent.click(add());
    fireEvent.click(remove());
    await waitFor(() => expect(remove().disabled).toBe(false));           // the Add has answered
    expect([callsOf("admin_printer_tester_add"), callsOf("admin_printer_tester_remove")]).toEqual([1, 0]);
    await waitFor(() => expect((screen.getByTestId("pt-email") as HTMLInputElement).value).toBe(""));   // the box is emptied after a saved Add
  });
  it("reports: Clean / Not clean; only a clean one offers 'Add to printer list' (default prefix, editable)", async () => {
    rpcs();
    renderPanel();
    fireEvent.click(screen.getByTestId("pt-tab-reports"));
    await screen.findAllByTestId("pt-report");
    expect(screen.getAllByTestId("pt-report-clean").map((n) => n.textContent)).toEqual(["Clean", "Not clean"]);
    expect(screen.getAllByTestId("pt-approve")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("pt-approve"));
    expect((screen.getByTestId("pt-prefix") as HTMLInputElement).value).toBe("LabelThing-");
    expect((screen.getByTestId("pt-brand") as HTMLInputElement).value).toBe("Other");
    fireEvent.change(screen.getByTestId("pt-brand"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByTestId("pt-approve-save"));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_approve_printer", { p_report: "r1", p_prefix: "LabelThing-", p_brand: "Acme", p_model: "LabelThing-9", p_lang: "cpcl" }));
  });
  it("each tab tap reloads the lists: a report sent while the panel is open shows without closing it", async () => {
    rpcs({ admin_printer_test_reports: [] });
    renderPanel();
    await screen.findByText("t@x.com");
    const reads = () => h.rpc.mock.calls.filter((c) => c[0] === "admin_printer_test_reports").length;
    expect(reads()).toBe(1);
    rpcs(); // a tester sends a report meanwhile
    fireEvent.click(screen.getByTestId("pt-tab-reports"));
    await waitFor(() => expect(screen.getAllByTestId("pt-report")).toHaveLength(2));
    expect(reads()).toBe(2);
    fireEvent.click(screen.getByTestId("pt-tab-approved"));
    fireEvent.click(screen.getByTestId("pt-tab-testers"));
    await waitFor(() => expect(reads()).toBe(4));
    for (const fn of ["admin_printer_testers", "admin_approved_printers"]) expect(h.rpc.mock.calls.filter((c) => c[0] === fn).length).toBe(4);
  });
  it("Printer list: Shift left (mm) + Flip 180° saved with one Save; out of range refused", async () => {
    rpcs({ admin_approved_printers: [{ id: "a1", prefix: "CT221B-", brand: "Clabel", model: "CT221B", lang: "tspl", active: true, approved_at: "2026-11-15T00:00:00Z", shift_mm: 0, flip: false }], admin_set_approved_printer_layout: true });
    renderPanel();
    fireEvent.click(screen.getByTestId("pt-tab-approved"));
    const box = await screen.findByTestId("pt-shift") as HTMLInputElement;
    const save = () => screen.getByTestId("pt-shift-save") as HTMLButtonElement;
    expect(box.value).toBe("0");
    expect(save().disabled).toBe(true); // nothing changed yet
    fireEvent.change(box, { target: { value: "9" } });
    expect(screen.getByTestId("pt-shift-bad")).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(box, { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("pt-flip"));
    expect(screen.getByTestId("pt-flip").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(save());
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_set_approved_printer_layout", { p_id: "a1", p_shift: 3, p_flip: true }));
  });
  it("approved list: Remove sets active=false", async () => {
    rpcs({ admin_approved_printers: [{ id: "a1", prefix: "LabelThing-", brand: "Other", model: "LabelThing", lang: "escpos", active: true, approved_at: "2026-11-15T00:00:00Z" }] });
    renderPanel();
    fireEvent.click(screen.getByTestId("pt-tab-approved"));
    fireEvent.click(await screen.findByTestId("pt-approved-toggle"));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_set_approved_printer_active", { p_id: "a1", p_active: false }));
  });
});
