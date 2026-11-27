// Admin → Printer testers → Printer list (sql/229): Built-in 5 (read only) · Locked — working (read only:
// no Shift / Flip / Save / Remove) · Testing (today's controls + "Lock — working na" with an in-panel
// confirmation → admin_lock_approved_printer). Approve / Add back show a message on prefix_overlaps_locked.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TProvider } from "../../i18n";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    rpc: (...a: unknown[]) => h.rpc(...a),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://x/p.jpg" }, error: null }) }) },
  },
}));
import PrinterTestersPanel from "../PrinterTestersPanel";
import { BUILT_IN_SHOWN, adminRpcCode } from "../../adapters/printerTesters";
import { WHITELIST } from "../../adapters/printerModels";

const FIX = JSON.parse(readFileSync(resolve(__dirname, "../../adapters/__tests__/fixtures/approvedPrinters.live.json"), "utf8")).rows as Record<string, unknown>[];
// today's 12 rows as the admin list answers AFTER sql/229: the 11 active ones locked
const listAfter229 = () => FIX.map((r, i) => ({ id: `a${i}`, ...r, locked: r.active === true }))
  .concat([{ id: "t1", prefix: "NEW-UNIT", brand: "Brand", model: "NEW-UNIT_1", lang: "tspl", active: true, approved_at: "2026-11-27T00:00:00Z", shift_mm: 0, flip: false, locked: false } as never]);
const REPORT = { id: "r1", email: "t@x.com", printer_name: "AE241-BT_C11D-LE", lang: "tspl", sticker_size: "50x30mm", send_ok: true, send_code: null, clean: true, photo_path: "u/1.jpg", created_at: "2026-11-27T00:00:00Z", ble_facts: {} };

let answers: Record<string, { data?: unknown; error?: { message: string } }> = {};
beforeEach(() => {
  h.rpc.mockReset();
  answers = {
    admin_printer_testers: { data: [] }, admin_printer_test_reports: { data: [REPORT] }, admin_approved_printers: { data: listAfter229() },
    admin_lock_approved_printer: { data: true }, admin_set_approved_printer_active: { data: true }, admin_set_approved_printer_layout: { data: true }, admin_approve_printer: { data: "n1" },
  };
  h.rpc.mockImplementation(async (fn: string) => ({ data: answers[fn]?.data ?? null, error: answers[fn]?.error ?? null }));
});
const calls = (fn: string) => h.rpc.mock.calls.filter((c) => c[0] === fn);
const openList = async () => {
  render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
  fireEvent.click(screen.getByTestId("pt-tab-approved"));
  await screen.findAllByTestId("pt-locked");
};

describe("Printer list — groups", () => {
  it("the note, Built-in · 5 (names from the WHITELIST), Locked — working · 11, Testing · 2", async () => {
    await openList();
    expect(screen.getByTestId("pt-list-note").textContent).toBe("Built-in 5 + Locked printers can't be changed or removed here.");
    expect(screen.getByTestId("pt-grp-builtin").textContent).toBe("Built-in · 5");
    expect(screen.getAllByTestId("pt-builtin").map((e) => e.textContent)).toEqual(["AIMO D520BT", "Flash Y41BT", "Xprinter XP-420B", "Niimbot B1", "Niimbot B1 Pro"]);
    for (const b of BUILT_IN_SHOWN) expect(WHITELIST.some((w) => w.brand === b.brand && w.model === b.model)).toBe(true);
    expect(screen.getByTestId("pt-grp-locked").textContent).toBe("Locked — working · 11");
    expect(screen.getByTestId("pt-grp-testing").textContent).toBe("Testing · 2"); // the removed XP-470B duplicate + a new one
  });
  it("a Locked row: name · lang, Shift / Flip / date, a green Locked badge — and NO Shift, Flip, Save, Remove or Lock", async () => {
    await openList();
    const rows = screen.getAllByTestId("pt-locked");
    expect(rows).toHaveLength(11);
    const ct = rows.find((r) => r.textContent!.includes("Clabel CT221B"))!;
    expect(ct.textContent).toContain("Clabel CT221B · TSPL");
    expect(within(ct).getByTestId("pt-locked-line").textContent).toMatch(/^Shift 2 mm · Flip On · /);
    const ae = rows.find((r) => r.textContent!.includes("Aiyin"))!;
    expect(within(ae).getByTestId("pt-locked-line").textContent).toMatch(/^Shift 0 mm · Flip Off · /);
    for (const r of rows) {
      expect(within(r).getByTestId("pt-locked-badge").textContent).toBe("Locked");
      expect(within(r).getByTestId("pt-locked-badge").style.color).toBe("var(--ok)");
      for (const id of ["pt-shift", "pt-flip", "pt-shift-save", "pt-approved-toggle", "pt-lock"]) expect(within(r).queryByTestId(id)).toBeNull();
      expect(r.querySelector("input, button")).toBeNull();
    }
  });
  it("a Testing row keeps today's controls and has the Lock button (an active row only)", async () => {
    await openList();
    const rows = screen.getAllByTestId("pt-approved");
    const fresh = rows.find((r) => r.textContent!.includes("NEW-UNIT_1"))!;
    for (const id of ["pt-shift", "pt-flip", "pt-shift-save", "pt-approved-toggle", "pt-lock"]) expect(within(fresh).getByTestId(id)).toBeTruthy();
    expect(within(fresh).getByTestId("pt-lock").textContent).toBe("Lock — working na");
    const removed = rows.find((r) => r.textContent!.includes("Removed"))!;
    expect(within(removed).queryByTestId("pt-lock")).toBeNull();
    expect(within(removed).getByTestId("pt-approved-toggle").textContent).toBe("Add back");
  });
  it("rows without the locked key (before sql/229) are Testing rows — the panel as today", async () => {
    answers.admin_approved_printers = { data: FIX.map((r, i) => ({ id: `a${i}`, ...r })) };
    render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
    fireEvent.click(screen.getByTestId("pt-tab-approved"));
    expect(await screen.findAllByTestId("pt-approved")).toHaveLength(12);
    expect(screen.queryAllByTestId("pt-locked")).toHaveLength(0);
  });
});

describe("Lock — working na", () => {
  it("asks INSIDE the panel first (no window.confirm), Cancel = nothing", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    await openList();
    const fresh = screen.getAllByTestId("pt-approved").find((r) => r.textContent!.includes("NEW-UNIT_1"))!;
    fireEvent.click(within(fresh).getByTestId("pt-lock"));
    expect(within(fresh).getByTestId("pt-lock-confirm").textContent).toContain("Lock this printer? It can't be changed or removed after this.");
    fireEvent.click(within(fresh).getByTestId("pt-lock-no"));
    expect(within(fresh).queryByTestId("pt-lock-confirm")).toBeNull();
    expect(calls("admin_lock_approved_printer")).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
  it("Lock → admin_lock_approved_printer(id), then the list is read again (the row moves to Locked)", async () => {
    await openList();
    const fresh = screen.getAllByTestId("pt-approved").find((r) => r.textContent!.includes("NEW-UNIT_1"))!;
    fireEvent.click(within(fresh).getByTestId("pt-lock"));
    answers.admin_approved_printers = { data: listAfter229().map((r) => (r.id === "t1" ? { ...r, locked: true } : r)) };
    fireEvent.click(within(fresh).getByTestId("pt-lock-yes"));
    await waitFor(() => expect(calls("admin_lock_approved_printer")).toEqual([["admin_lock_approved_printer", { p_id: "t1" }]]));
    await waitFor(() => expect(screen.getByTestId("pt-grp-locked").textContent).toBe("Locked — working · 12"));
    expect(screen.getByTestId("pt-grp-testing").textContent).toBe("Testing · 1");
  });
});

describe("overlap with a locked printer", () => {
  it("approve: the server's prefix_overlaps_locked → the message under the name; the form stays; typing clears it", async () => {
    answers.admin_approve_printer = { error: { message: "prefix_overlaps_locked" } };
    render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
    fireEvent.click(screen.getByTestId("pt-tab-reports"));
    fireEvent.click(await screen.findByTestId("pt-approve"));
    fireEvent.change(screen.getByTestId("pt-prefix"), { target: { value: "AE241" } });
    fireEvent.click(screen.getByTestId("pt-approve-save"));
    expect((await screen.findByTestId("pt-approve-overlap")).textContent).toBe("This name is too close to a locked printer. Use a longer name.");
    expect(screen.getByTestId("pt-approve-form")).toBeTruthy();
    expect(screen.queryByTestId("pt-error")).toBeNull();
    fireEvent.change(screen.getByTestId("pt-prefix"), { target: { value: "AE241-BT_C11D" } });
    expect(screen.queryByTestId("pt-approve-overlap")).toBeNull();
  });
  it("approve: any other failure → no overlap line, the form stays open (the error handling as before)", async () => {
    answers.admin_approve_printer = { error: { message: "report_not_clean" } };
    render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
    fireEvent.click(screen.getByTestId("pt-tab-reports"));
    fireEvent.click(await screen.findByTestId("pt-approve"));
    fireEvent.click(screen.getByTestId("pt-approve-save"));
    await waitFor(() => expect(calls("admin_approve_printer")).toHaveLength(1));
    await waitFor(() => expect(calls("admin_approved_printers").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByTestId("pt-approve-overlap")).toBeNull();
    expect(screen.getByTestId("pt-approve-form")).toBeTruthy();
  });
  it("Add back of the removed XP-470B duplicate: prefix_overlaps_locked → the message on that row", async () => {
    answers.admin_set_approved_printer_active = { error: { message: "prefix_overlaps_locked" } };
    await openList();
    const removed = screen.getAllByTestId("pt-approved").find((r) => r.textContent!.includes("Removed"))!;
    fireEvent.click(within(removed).getByTestId("pt-approved-toggle"));
    // "XP-470B" starts with the locked "XP-470B" row → that printer already covers it (Part 2 small fix)
    await waitFor(() => expect(screen.getByTestId("pt-row-overlap").textContent).toBe("This printer is already covered by the locked printer “Other XP-470B”. No need to approve it."));
  });
  for (const [typed, by] of [["AE241-BT_C11D", "Aiyin AE241-BT_B57A-LE"], ["ct221b-D4F8", "Clabel CT221B"], ["XP-420B-ZZ", "Xprinter XP-420B"], ["B1 Pro-7", "Niimbot B1 Pro"]]) {
    it(`approve "${typed}": starts with a locked / built-in name → "already covered by “${by}”"`, async () => {
      answers.admin_approve_printer = { error: { message: "prefix_overlaps_locked" } };
      render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
      fireEvent.click(screen.getByTestId("pt-tab-reports"));
      fireEvent.click(await screen.findByTestId("pt-approve"));
      fireEvent.change(screen.getByTestId("pt-prefix"), { target: { value: typed } });
      fireEvent.click(screen.getByTestId("pt-approve-save"));
      expect((await screen.findByTestId("pt-approve-overlap")).textContent).toBe(`This printer is already covered by the locked printer “${by}”. No need to approve it.`);
    });
  }
  it("a failed read → the red line; the next action (an add that works) clears it", async () => {
    answers.admin_printer_testers = { error: { message: "boom" } };
    render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
    await screen.findByTestId("pt-error");
    delete answers.admin_printer_testers;
    fireEvent.change(screen.getByTestId("pt-email"), { target: { value: "new@x.com" } });
    // a successful add → the error line is cleared by the action, the reload succeeds, no line
    answers.admin_printer_tester_add = { data: true };
    fireEvent.click(screen.getByTestId("pt-add"));
    await waitFor(() => expect(screen.queryByTestId("pt-error")).toBeNull());
  });
  it("an action that fails: the red line stays after the list is read again (until the next action)", async () => {
    answers.admin_printer_tester_add = { error: { message: "boom" } };
    render(<TProvider lang="en"><PrinterTestersPanel /></TProvider>);
    fireEvent.change(await screen.findByTestId("pt-email"), { target: { value: "new@x.com" } });
    const before = calls("admin_printer_testers").length;
    fireEvent.click(screen.getByTestId("pt-add"));
    await waitFor(() => expect(calls("admin_printer_testers").length).toBeGreaterThan(before)); // the re-read after the action
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId("pt-error")).toBeTruthy();                                        // still shown
    fireEvent.click(screen.getByTestId("pt-tab-reports"));                                       // the next action
    await waitFor(() => expect(screen.queryByTestId("pt-error")).toBeNull());
  });
  it("adminRpcCode reads the database word out of the error message", () => {
    expect(adminRpcCode("prefix_overlaps_locked")).toBe("prefix_overlaps_locked");
    expect(adminRpcCode("ERROR: printer_locked")).toBe("printer_locked");
    expect(adminRpcCode("forbidden")).toBeUndefined();
    expect(adminRpcCode(undefined)).toBeUndefined();
  });
});

describe("no price, English wording in every language", () => {
  it("the Printer list has no money figure", async () => {
    await openList();
    expect(screen.getByTestId("pt-panel").textContent).not.toMatch(/NT\$|₱|\$|price/i);
  });
  it("the new texts are English in all 8 languages", async () => {
    const src = readFileSync(resolve(__dirname, "../../i18n/index.tsx"), "utf8");
    for (const k of ["rd_prt_list_note", "rd_prt_grp_builtin", "rd_prt_grp_locked", "rd_prt_grp_testing", "rd_prt_locked_badge", "rd_prt_locked_line", "rd_prt_lock_btn", "rd_prt_lock_q", "rd_prt_lock_yes", "rd_prt_overlap"]) {
      const line = src.split("\n").find((l) => l.trim().startsWith(`${k}:`))!;
      const vals = [...line.matchAll(/: "((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      expect(vals).toHaveLength(8);
      expect(new Set(vals).size).toBe(1);
    }
  });
});
