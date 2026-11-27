// Admin → Manage sellers → a seller → Printer tuning (sql/230). A fake database answers the four RPCs the
// way sql/230 does (versions, built-in refusal, stale version, not_tester while the switch is off).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AdminPrinterTuning from "../AdminPrinterTuning";
import { TProvider, buildT } from "../../i18n";
import { chipProposal, CHIP_IDS, GENERIC_DEFAULTS } from "../../adapters/printerTuningChips";
import { parseAdminTuning, tuningDiff } from "../../adapters/printerTuningAdmin";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));
const t = buildT("en") as unknown as Record<string, string>;

interface Db { settings: Record<string, unknown> | null; version: number; top: number; builtIn: boolean; tester: boolean; switchOn: boolean; history: Record<string, unknown>[]; staleNext?: boolean }
function fakeDb(over: Partial<Db> = {}) {
  const db: Db = { settings: null, version: 0, top: 0, builtIn: false, tester: true, switchOn: false, history: [], ...over };
  const err = (m: string) => ({ data: null, error: { message: m } });
  rpc.mockImplementation(async (fn: string, a: Record<string, unknown>) => {
    if (fn === "admin_printer_tuning_get") return { data: {
      settings: db.settings, version: db.version, updated_at: db.version ? "2026-11-27T06:00:00Z" : null, switch_on: db.switchOn, tester: db.tester,
      printer_name: db.builtIn ? "XP-420B" : "AE241-BT_C11D-LE", built_in: db.builtIn, locked_name: db.builtIn ? null : "AE241-BT_B57A-LE",
      history: db.history, reports: [{ id: "r1", printer_name: "AE241-BT_C11D-LE", sticker_size: "60x40", lang: "tspl", created_at: "2026-11-27T05:00:00Z", clean: false, send_ok: true, tuning_version: 2, app_build: 14 }],
    }, error: null };
    if (fn === "admin_printer_tuning_set") {
      if (db.builtIn) return err("built_in_printer");
      if (!db.switchOn && !db.tester) return err("not_tester");
      if (db.staleNext) { db.staleNext = false; db.version = 9; db.top = 9; db.settings = { density: 2 }; return err("stale_version"); }
      if (a.p_expected_version !== db.version) return err("stale_version");
      db.history.unshift({ id: db.history.length + 1, action: "set", before: db.settings, after: a.p_settings, version: db.top + 1, undone: false, at: "2026-11-27T06:00:00Z" });
      db.settings = a.p_settings as Record<string, unknown>; db.top += 1; db.version = db.top;
      return { data: db.version, error: null };
    }
    if (fn === "admin_printer_tuning_undo") { if (a.p_expected_version !== db.version) return err("stale_version"); db.settings = null; db.version = 0; return { data: 0, error: null }; }
    if (fn === "admin_printer_tuning_reset") { if (a.p_expected_version !== db.version) return err("stale_version"); const had = !!db.settings; db.settings = null; db.version = 0; return { data: had, error: null }; }
    return err("unknown");
  });
  return db;
}
const open = () => render(<TProvider lang="en"><div data-redesign><AdminPrinterTuning email="seller@x.com" onClose={() => {}} /></div></TProvider>);
const calls = (fn: string) => rpc.mock.calls.filter((c) => c[0] === fn);
afterEach(() => rpc.mockReset());

describe("chip mapping (adapters/printerTuningChips.ts)", () => {
  it("each chip's change, from no tuning", () => {
    expect(chipProposal("blank_labels", null)).toEqual({ sensor: "gap", gapMm: 3, speed: 3 });
    expect(chipProposal("cut_edge", null)).toEqual({ shiftMm: 1 });
    expect(chipProposal("upside_down", null)).toEqual({ flip: true });
    expect(chipProposal("light_dark", null)).toEqual({ density: 11 });
    expect(chipProposal("light_dark", null, GENERIC_DEFAULTS, false)).toEqual({ density: 5 });
    expect(chipProposal("stops", null)).toEqual({ speed: 3, sendSpeed: "slow" });
    expect(chipProposal("garbled", null)).toEqual({ speed: 2, sendSpeed: "slow" });
    expect(CHIP_IDS).toHaveLength(6);
  });
  it("on top of the current tuning + the model's own shift / flip; clamped", () => {
    expect(chipProposal("cut_edge", { shiftMm: 4.5, density: 9 })).toEqual({ shiftMm: 5, density: 9 });
    expect(chipProposal("cut_edge", { shiftMm: 5 })).toEqual({ shiftMm: 5 });
    expect(chipProposal("upside_down", null, { ...GENERIC_DEFAULTS, flip: true })).toEqual({ flip: false });
    expect(chipProposal("cut_edge", null, { ...GENERIC_DEFAULTS, shiftMm: 2 })).toEqual({ shiftMm: 3 });
    expect(chipProposal("light_dark", { density: 14 })).toEqual({ density: 15 });
    expect(chipProposal("stops", { speed: 1 })).toEqual({ speed: 1, sendSpeed: "slow" });
    expect(chipProposal("blank_labels", { gapMm: 6, speed: 1 })).toEqual({ sensor: "gap", gapMm: 6, speed: 1 });
  });
  it("tuningDiff lists only what changes", () => {
    expect(tuningDiff({ density: 8 }, { density: 8, flip: true })).toEqual([{ field: "flip", from: undefined, to: true }]);
    expect(tuningDiff(null, null)).toEqual([]);
  });
  it("parseAdminTuning: odd answers → null / safe defaults", () => {
    expect(parseAdminTuning(null)).toBeNull();
    expect(parseAdminTuning({})).toMatchObject({ tuning: null, version: 0, builtIn: false, tester: false, history: [], reports: [] });
  });
});

describe("the panel", () => {
  it("shows the seller's printer: name, Model locked, In Testers, last test, app build, size, the only-this-seller line", async () => {
    fakeDb();
    open();
    await screen.findByTestId("ptu-printer");
    expect(screen.getByTestId("ptu-printer-name").textContent).toBe("AE241-BT_C11D-LE");
    expect(screen.getByTestId("ptu-locked").textContent).toContain("AE241-BT_B57A-LE");
    expect(screen.getByTestId("ptu-tester").textContent).toBe("✓");
    expect(screen.getByTestId("ptu-size").textContent).toBe("60x40");
    expect(screen.getByTestId("ptu-app").textContent).toBe("build 14");
    expect(screen.getByTestId("ptu-last-test").textContent).toContain("v2");
    expect(screen.getByTestId("ptu-only-this").textContent).toBe(t.rd_ptu_only_this);
    expect(screen.queryByTestId("ptu-builtin")).toBeNull();
  });
  it("built-in printer: the badge, every control off, nothing can be saved", async () => {
    fakeDb({ builtIn: true });
    open();
    await screen.findByTestId("ptu-builtin");
    expect(screen.getByTestId("ptu-builtin").textContent).toBe("Built-in — can't tune");
    for (const id of ["ptu-chip-cut_edge", "ptu-save", "ptu-undo", "ptu-reset"]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("ptu-adv-toggle"));
    expect((screen.getByTestId("ptu-density-plus") as HTMLButtonElement).disabled).toBe(true);
    expect(calls("admin_printer_tuning_set")).toHaveLength(0);
  });
  it("a chip shows its change BEFORE Save; Save asks inside the page; then saved with the version read", async () => {
    const db = fakeDb();
    open();
    fireEvent.click(await screen.findByTestId("ptu-chip-cut_edge"));
    expect(screen.getByTestId("ptu-change-shiftMm").textContent).toContain("model → 1 mm left");
    expect(calls("admin_printer_tuning_set")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("ptu-save"));
    expect(screen.getByTestId("ptu-save-ask").textContent).toContain("seller@x.com");
    fireEvent.click(screen.getByTestId("ptu-save-ask-yes"));
    await waitFor(() => expect(screen.getByTestId("ptu-note").textContent).toBe(t.rd_ptu_saved));
    expect(calls("admin_printer_tuning_set")[0][1]).toEqual({ p_email: "seller@x.com", p_settings: { shift_mm: 1 }, p_expected_version: 0 });
    expect(db.version).toBe(1);
    expect(screen.getByTestId("ptu-version").textContent).toContain("v1");
    expect(screen.getAllByTestId("ptu-history-row")).toHaveLength(1);
  });
  it("Cancel in the question saves nothing", async () => {
    fakeDb();
    open();
    fireEvent.click(await screen.findByTestId("ptu-chip-upside_down"));
    fireEvent.click(screen.getByTestId("ptu-save"));
    fireEvent.click(screen.getByTestId("ptu-save-ask-no"));
    expect(calls("admin_printer_tuning_set")).toHaveLength(0);
    expect(screen.getByTestId("ptu-change-flip")).toBeTruthy();
  });
  it("someone else saved first → reload + say so; nothing overwritten", async () => {
    const db = fakeDb({ staleNext: true });
    open();
    fireEvent.click(await screen.findByTestId("ptu-chip-upside_down"));
    fireEvent.click(screen.getByTestId("ptu-save"));
    fireEvent.click(screen.getByTestId("ptu-save-ask-yes"));
    await waitFor(() => expect(screen.getByTestId("ptu-note").textContent).toBe(t.rd_ptu_stale));
    expect(db.settings).toEqual({ density: 2 });                          // the other save stands
    expect(screen.getByTestId("ptu-version").textContent).toContain("v9");  // reloaded
    expect(screen.queryByTestId("ptu-change-flip")).toBeNull();            // the draft = the reloaded settings
  });
  it("switch off + not a tester → the warning line, and the database's not_tester answer is shown", async () => {
    fakeDb({ tester: false, switchOn: false });
    open();
    await screen.findByTestId("ptu-needs-tester");
    fireEvent.click(screen.getByTestId("ptu-chip-garbled"));
    fireEvent.click(screen.getByTestId("ptu-save"));
    fireEvent.click(screen.getByTestId("ptu-save-ask-yes"));
    await waitFor(() => expect(screen.getByTestId("ptu-note").textContent).toBe(t.rd_ptu_not_tester));
    expect(screen.getByTestId("ptu-send-note")).toBeTruthy();
  });
  it("Too light or too dark → Darker / Lighter", async () => {
    fakeDb();
    open();
    fireEvent.click(await screen.findByTestId("ptu-chip-light_dark"));
    fireEvent.click(screen.getByTestId("ptu-lighter"));
    expect(screen.getByTestId("ptu-change-density").textContent).toContain("model → 5");
    fireEvent.click(screen.getByTestId("ptu-darker"));
    expect(screen.getByTestId("ptu-change-density").textContent).toContain("model → 8");
  });
  it("Undo and Reset ask inside the page, send the version read", async () => {
    fakeDb({ settings: { density: 10 }, version: 4, top: 4, history: [{ id: 1, action: "set", before: null, after: { density: 10 }, version: 4, undone: false, at: "2026-11-27T05:00:00Z" }] });
    open();
    fireEvent.click(await screen.findByTestId("ptu-undo"));
    fireEvent.click(screen.getByTestId("ptu-undo-ask-yes"));
    await waitFor(() => expect(calls("admin_printer_tuning_undo")).toHaveLength(1));
    expect(calls("admin_printer_tuning_undo")[0][1]).toEqual({ p_email: "seller@x.com", p_expected_version: 4 });
    await waitFor(() => expect(screen.getByTestId("ptu-note").textContent).toBe(t.rd_ptu_undone));
  });
  it("Reset to model", async () => {
    fakeDb({ settings: { density: 10 }, version: 4, top: 4 });
    open();
    fireEvent.click(await screen.findByTestId("ptu-reset"));
    expect(screen.getByTestId("ptu-reset-ask").textContent).toBe(t.rd_ptu_reset_q + t.rd_ptu_reset + t.rd_ptu_cancel);
    fireEvent.click(screen.getByTestId("ptu-reset-ask-yes"));
    await waitFor(() => expect(screen.getByTestId("ptu-note").textContent).toBe(t.rd_ptu_reset_done));
    expect(calls("admin_printer_tuning_reset")[0][1]).toEqual({ p_email: "seller@x.com", p_expected_version: 4 });
  });
  it("advanced settings are clamped (density never above 15, speed never below 1)", async () => {
    fakeDb({ settings: { density: 15, speed: 1 }, version: 1, top: 1 });
    open();
    fireEvent.click(await screen.findByTestId("ptu-adv-toggle"));
    fireEvent.click(screen.getByTestId("ptu-density-plus"));
    fireEvent.click(screen.getByTestId("ptu-speed-minus"));
    expect(screen.getByTestId("ptu-density-value").textContent).toBe("15");
    expect(screen.getByTestId("ptu-speed-value").textContent).toBe("1");
    expect(screen.getByTestId("ptu-changes").textContent).toBe(t.rd_ptu_no_changes);
  });
  it("load failure → a line + Try again", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    open();
    await screen.findByTestId("ptu-load-err");
    fakeDb();
    fireEvent.click(screen.getByTestId("ptu-retry"));
    await screen.findByTestId("ptu-printer");
  });
});

it("Admin.tsx: a Printer tuning button on every seller card opens the sheet", () => {
  const src = readFileSync(resolve(__dirname, "../../screens/Admin.tsx"), "utf8");
  expect(src).toContain('data-testid="adm-tuning-open" onClick={() => setTuningEmail(u.email)}');
  expect(src).toContain("{tuningEmail && <AdminPrinterTuning email={tuningEmail} onClose={() => setTuningEmail(null)} onToast={notify} />}");
});
