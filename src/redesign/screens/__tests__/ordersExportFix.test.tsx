// Orders Export fix (2026-11-06). Live bug: exporting a PAST session to Excel did nothing —
// the sheet name "Past session · 10/08 → 10/10" has "/" and exceljs threw; the button
// swallowed it. Covers: the sheet-name sanitizer, a past session really producing a .xlsx,
// a seller-words message on every failure, the phone app shell sharing the file (prepared
// first, shared inside the tap), and the laptop path staying a plain download.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";

const S = vi.hoisted(() => ({ bySession: {} as Record<string, unknown[]>, summaries: [] as unknown[] }));
function builder() {
  const filters: Record<string, unknown> = {};
  const q = {
    select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, not: () => q, order: () => q,
    range: async () => ({ data: S.bySession[String(filters.session_id)] || [], error: null }),
  };
  return q;
}
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => builder(), rpc: async () => ({ data: S.summaries, error: null }), auth: { getSession: async () => ({ data: { session: { user: { id: "me" } } } }) } },
}));
vi.mock("../../../db", () => ({ saveOrderToDatabase: vi.fn(), saveLiveSessionOrder: vi.fn(), saveCustomerToDatabase: vi.fn() }));
// Spy-able real module: tests flip `fail` to make the real export reject / throw.
const F = vi.hoisted(() => ({ xlsxFail: false, pdfThrow: false }));
vi.mock("../../adapters/brandedExport", async (orig) => {
  const real = await orig<typeof import("../../adapters/brandedExport")>();
  return {
    ...real,
    exportBrandedXlsx: async (i: Parameters<typeof real.exportBrandedXlsx>[0]) => { if (F.xlsxFail) throw new Error("boom"); return real.exportBrandedXlsx(i); },
    exportBrandedPdf: (i: Parameters<typeof real.exportBrandedPdf>[0], onErr?: () => void) => { if (F.pdfThrow) throw new Error("boom"); return real.exportBrandedPdf(i, onErr); },
  };
});

import ExcelJS from "exceljs";
import { TProvider, buildT } from "../../i18n";
import Orders from "../Orders";
import { safeSheetName, buildBrandedXlsxBytes, SHEET_NAME_FALLBACK, XLSX_TYPE, type BrandedExportInput } from "../../adapters/brandedExport";
import { useBrandedExport } from "../../adapters/useBrandedExport";
import type { Buyer } from "../../../lib/orderTypes";
import type { Order } from "../../data";

const q = (sel: string) => document.querySelector(`[data-testid='${sel}']`) as HTMLElement | null;
const qa = (sel: string) => Array.from(document.querySelectorAll(`[data-testid='${sel}']`)) as HTMLElement[];
const settle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };
const waitFor = async (pred: () => boolean, ms = 4000) => {
  const end = Date.now() + ms;
  while (!pred()) { if (Date.now() > end) throw new Error("timeout"); await act(async () => { await new Promise((r) => setTimeout(r, 15)); }); }
};

const ON = Date.UTC(2026, 9, 14, 5);
const ANN: Buyer = { handle: "@ann", name: "Ann", platform: "TikTok", num: 3, totalSpent: 350, totalOrders: 1, orders: [{ item: "A1 dress", total: 350, qty: 1, orderNum: ON }] as never };
let nextRowId = 1000;
const row = (sid: string, day: string, n: number, handle: string, name: string, product: string, price: number) =>
  ({ id: nextRowId++, session_id: sid, session_date: day, created_at: `${day}T05:00:00.000Z`, buyer_number: n, handle, customer_name: name, platform: "TikTok", product, price, qty: 1, comment_msg_id: null, auto_code: null });
const sum = (session_id: string, first_day: string, last_day: string, orders: number) => ({ session_id, first_day, last_day, orders, latest: `${last_day}T05:00:00.000Z` });
const todayOrder = { id: "#7", buyer: "Today Row Buyer", handle: "@row", items: "Z9", total: 10, time: "13:00", platform: "TikTok", status: "New", date: "2026-10-14", orderNum: ON } as unknown as Order;
const renderOrders = (lang = "en") => render(<TProvider lang={lang}><Orders onGoPrint={vi.fn()} cur="NT$" orders={[todayOrder]} state="live" buyers={[ANN]} todayId="2026-10-14" sessionId="cur" tiktokSend sellerId="me" /></TProvider>);
const pickPastSession = async () => {
  fireEvent.click(q("ord-range")!); await settle();
  fireEvent.click(qa("ord-session-item")[0]); await settle();
};

// Capture blob downloads (laptop path): the anchor's download name + the blob bytes.
let downloads: { name: string; blob: Blob }[] = [];
let blobs = new Map<string, Blob>();
let shareSpy: ReturnType<typeof vi.fn> | null = null;
beforeEach(() => {
  F.xlsxFail = false; F.pdfThrow = false; downloads = []; blobs = new Map(); localStorage.clear();
  S.summaries = [sum("old", "2026-10-08", "2026-10-10", 2)];
  S.bySession = { old: [row("old", "2026-10-08", 1, "@oldann", "Old Ann", "P1", 200), row("old", "2026-10-09", 2, "@oldbea", "Old Bea", "P2", 90)] };
  let n = 0;
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b: Blob) => { const u = `blob:t/${n++}`; blobs.set(u, b); return u; };
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ name: this.download, blob: blobs.get(this.href)! }); });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { Capacitor?: unknown }).Capacitor;
  if (shareSpy) { delete (navigator as { share?: unknown }).share; delete (navigator as { canShare?: unknown }).canShare; shareSpy = null; }
});
const readBook = async (blobOrBytes: Blob | Uint8Array) => {
  const wb = new ExcelJS.Workbook();
  const bytes = blobOrBytes instanceof Uint8Array ? blobOrBytes : new Uint8Array(await blobOrBytes.arrayBuffer());
  await wb.xlsx.load(bytes.buffer as ArrayBuffer);
  return wb;
};

describe("1 — safeSheetName (Excel sheet-tab rules)", () => {
  it("replaces every forbidden char * ? : \\ / [ ] with '-'", () => {
    for (const c of ["*", "?", ":", "\\", "/", "[", "]"]) expect(safeSheetName(`a${c}b`)).toBe("a-b");
    expect(safeSheetName("Past session · 10/08 → 10/10")).toBe("Past session · 10-08 → 10-10");
    expect(safeSheetName("x*?:\\/[]y")).toBe("x-------y");
  });
  it("keeps at most 31 characters (Excel's limit) and never splits an emoji", () => {
    const long = "Past session · 2026/10/08 → 2026/10/10 long name";
    expect(safeSheetName(long).length).toBeLessThanOrEqual(31);
    expect(safeSheetName(long)).toBe("Past session · 2026-10-08 → 202");
    const emoji = "a".repeat(30) + "😀z";                       // the emoji straddles unit 31
    expect(safeSheetName(emoji)).toBe("a".repeat(30));
  });
  it("never empty — blank, spaces, quotes only, 'History' → 'Orders'", () => {
    expect(SHEET_NAME_FALLBACK).toBe("Orders");
    for (const v of ["", "   ", "''", "History", "history"]) expect(safeSheetName(v)).toBe("Orders");
    expect(safeSheetName(undefined as unknown as string)).toBe("Orders");
    expect(safeSheetName("'Orders'")).toBe("Orders");               // no leading/trailing apostrophe
    expect(safeSheetName("///")).toBe("---");
  });
  it("every result is accepted by exceljs (the bug: the raw title threw)", () => {
    expect(() => new ExcelJS.Workbook().addWorksheet("Past session · 10/08 → 10/10")).toThrow(/cannot include/);
    for (const v of ["Past session · 10/08 → 10/10", "a*b?c:d\\e/f[g]h", "", "History", "'x'", "x".repeat(80)]) {
      expect(() => new ExcelJS.Workbook().addWorksheet(safeSheetName(v))).not.toThrow();
    }
  });
});

const input = (title: string): BrandedExportInput => ({ title, columns: [{ header: "Order" }, { header: "Total" }], rows: [["#1", "NT$200"]], filename: "f", dateISO: "2026-11-06" });
describe("2 — the .xlsx keeps the FULL title in the subtitle row", () => {
  it("past-session title: sheet tab sanitized, subtitle has the real title", async () => {
    const wb = await readBook(await buildBrandedXlsxBytes(input("Past session · 10/08 → 10/10")));
    expect(wb.worksheets[0].name).toBe("Past session · 10-08 → 10-10");
    expect(String(wb.worksheets[0].getCell(2, 1).value)).toBe("Past session · 10/08 → 10/10 — exported 2026-11-06");
  });
});

describe("3 — Orders → Sessions → a past session → Export → Excel (laptop)", () => {
  it("downloads a real .xlsx with that session's orders; no share sheet", async () => {
    shareSpy = vi.fn(async () => {}); (navigator as { share?: unknown }).share = shareSpy;
    renderOrders();
    await pickPastSession();
    fireEvent.click(q("orders-export")!);
    expect(q("orders-export-xlsx")!.textContent).toBe("Excel (.xlsx)");   // no "Preparing…" on a laptop
    fireEvent.click(q("orders-export-xlsx")!);
    await waitFor(() => downloads.length === 1);
    expect(downloads[0].name).toBe("sellerflow-orders-session-2026-10-08_2026-10-10.xlsx");
    expect(downloads[0].blob.type).toBe(XLSX_TYPE);
    const ws = (await readBook(downloads[0].blob)).worksheets[0];
    expect(ws.name).toBe("Past session · 10-08 → 10-10");
    const cells = ws.getSheetValues().flat().map(String).join("|");
    expect(cells).toContain("Old Ann");
    expect(cells).toContain("Old Bea");
    expect(cells).not.toContain("Today Row Buyer");
    expect(shareSpy).not.toHaveBeenCalled();
    expect(q("export-toast")).toBeNull();
  });
  it("This session still exports (title 'Orders')", async () => {
    renderOrders();
    fireEvent.click(q("orders-export")!);
    fireEvent.click(q("orders-export-xlsx")!);
    await waitFor(() => downloads.length === 1);
    expect((await readBook(downloads[0].blob)).worksheets[0].name).toBe("Orders");
  });
});

describe("4 — never fail silently", () => {
  it("Excel failure → seller-words message (no technical text)", async () => {
    F.xlsxFail = true;
    renderOrders();
    fireEvent.click(q("orders-export")!);
    fireEvent.click(q("orders-export-xlsx")!);
    await waitFor(() => !!q("export-toast"));
    expect(q("export-toast")!.textContent).toBe("⚠ Export didn't work. Refresh the page and try again.");
    expect(q("export-toast")!.textContent).not.toContain("boom");
  });
  it("PDF failure → the same message; in Tagalog too", async () => {
    F.pdfThrow = true;
    renderOrders("fil");
    fireEvent.click(q("orders-export")!);
    fireEvent.click(q("orders-export-pdf")!);
    await waitFor(() => !!q("export-toast"));
    expect(q("export-toast")!.textContent).toBe("⚠ Hindi gumana ang export. I-refresh ang page at subukan ulit.");
  });
  it("all 4 messages are filled in all 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const k of ["rd_export_failed", "rd_export_pdf_phone", "rd_export_phone_unsupported", "rd_export_preparing"]) expect(t[k]?.trim(), `${lang} ${k}`).toBeTruthy();
    }
  });
  it("every export screen goes through useBrandedExport (no direct, unguarded export call left)", () => {
    for (const f of ["Orders", "Products", "SalesTab", "Miners"]) {
      const src = readFileSync(`src/redesign/screens/${f}.tsx`, "utf8");
      expect(src, f).toContain("useBrandedExport(");
      expect(src, f).not.toMatch(/exportBranded(Xlsx|Pdf)\(/);
    }
  });
});

describe("5 — phone app shell: prepare, then share inside the tap", () => {
  const msgs = { failed: "F", pdfPhone: "P", phoneUnsupported: "U" };
  it("Orders: 'Preparing…' → ready → share fires synchronously in the tap with the .xlsx; no blob download", async () => {
    (window as { Capacitor?: unknown }).Capacitor = {};
    shareSpy = vi.fn(async () => {}); (navigator as { share?: unknown }).share = shareSpy;
    (navigator as { canShare?: unknown }).canShare = () => true;
    renderOrders();
    await pickPastSession();
    fireEvent.click(q("orders-export")!);
    expect(q("orders-export-xlsx")!.textContent).toBe("Preparing…");
    expect((q("orders-export-xlsx") as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => q("orders-export-xlsx")?.textContent === "Excel (.xlsx)");
    fireEvent.click(q("orders-export-xlsx")!);
    expect(shareSpy).toHaveBeenCalledTimes(1);                    // same tick as the tap
    const arg = shareSpy.mock.calls[0][0] as { files: File[] };
    expect(arg.files[0].name).toBe("sellerflow-orders-session-2026-10-08_2026-10-10.xlsx");
    expect(arg.files[0].type).toBe(XLSX_TYPE);
    expect((await readBook(new Uint8Array(await arg.files[0].arrayBuffer()))).worksheets[0].name).toBe("Past session · 10-08 → 10-10");
    await settle();
    expect(downloads).toHaveLength(0);
    expect(q("export-toast")).toBeNull();
  });
  it("PDF in the app → 'use Excel on the phone' (8 languages), no print attempt", async () => {
    (window as { Capacitor?: unknown }).Capacitor = {};
    const iframes = () => document.querySelectorAll("iframe").length;
    renderOrders();
    fireEvent.click(q("orders-export")!);
    fireEvent.click(q("orders-export-pdf")!);
    expect(q("export-toast")!.textContent).toBe("⚠ PDF works on a computer browser; use Excel on the phone.");
    expect(iframes()).toBe(0);
  });
  it("no Web Share on this phone → honest message; user cancel → silent", async () => {
    (window as { Capacitor?: unknown }).Capacitor = {};
    const { result } = renderHook(() => useBrandedExport(() => input("Orders"), msgs));
    act(() => result.current.prepare());
    await waitFor(() => result.current.prep === "ready");
    act(() => result.current.xlsx());
    await settle();
    expect(result.current.message).toBe("U");
    shareSpy = vi.fn(async () => { throw new DOMException("x", "AbortError"); }); (navigator as { share?: unknown }).share = shareSpy;
    const h2 = renderHook(() => useBrandedExport(() => input("Orders"), msgs));
    act(() => h2.result.current.prepare());
    await waitFor(() => h2.result.current.prep === "ready");
    act(() => h2.result.current.xlsx());
    await settle();
    expect(shareSpy).toHaveBeenCalledTimes(1);
    expect(h2.result.current.message).toBeNull();
  });
  it("a failed prepare → the failure message on tap (never a silent no-op)", async () => {
    (window as { Capacitor?: unknown }).Capacitor = {};
    const { result } = renderHook(() => useBrandedExport(() => { throw new Error("x"); }, msgs));
    act(() => result.current.prepare());
    expect(result.current.prep).toBe("error");
    act(() => result.current.xlsx());
    expect(result.current.message).toBe("F");
  });
  it("laptop: prepare() does nothing (no early build), Excel = plain download", async () => {
    const { result } = renderHook(() => useBrandedExport(() => input("Past session · 10/08"), msgs));
    act(() => result.current.prepare());
    expect(result.current.prep).toBe("idle");
    expect(result.current.preparing).toBe(false);
    act(() => result.current.xlsx());
    await waitFor(() => downloads.length === 1);
    expect(downloads[0].name).toBe("f.xlsx");
  });
});
