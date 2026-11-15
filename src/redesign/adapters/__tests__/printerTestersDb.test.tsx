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
    from: () => ({ select: () => ({ eq: (...a: unknown[]) => h.select(...a) }) }),
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
    expect(a).toEqual([{ prefix: "LabelThing-", brand: "Other", model: "LabelThing", lang: "escpos" }]);
    expect(b).toBe(a);
    expect(h.select).toHaveBeenCalledTimes(1);
    expect(h.select).toHaveBeenCalledWith("active", true);
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
  function rpcs(over: Record<string, unknown> = {}) {
    h.rpc.mockImplementation(async (fn: string) => {
      const base: Record<string, unknown> = { admin_printer_testers: [{ email: "t@x.com", created_at: "2026-11-14T00:00:00Z" }], admin_printer_test_reports: [REPORT, NOT_CLEAN], admin_approved_printers: [], admin_printer_tester_add: true, admin_printer_tester_remove: true, admin_approve_printer: "a1", admin_set_approved_printer_active: true, ...over };
      return { data: base[fn], error: null };
    });
  }
  const renderPanel = () => render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
  it("add / remove a tester calls the admin RPCs", async () => {
    rpcs();
    renderPanel();
    await screen.findByText("t@x.com");
    fireEvent.change(screen.getByTestId("pt-email"), { target: { value: " New@X.com " } });
    fireEvent.click(screen.getByTestId("pt-add"));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_printer_tester_add", { p_email: "new@x.com" }));
    fireEvent.click(screen.getByTestId("pt-remove"));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_printer_tester_remove", { p_email: "t@x.com" }));
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
  it("approved list: Remove sets active=false", async () => {
    rpcs({ admin_approved_printers: [{ id: "a1", prefix: "LabelThing-", brand: "Other", model: "LabelThing", lang: "escpos", active: true, approved_at: "2026-11-15T00:00:00Z" }] });
    renderPanel();
    fireEvent.click(screen.getByTestId("pt-tab-approved"));
    fireEvent.click(await screen.findByTestId("pt-approved-toggle"));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("admin_set_approved_printer_active", { p_id: "a1", p_active: false }));
  });
});
