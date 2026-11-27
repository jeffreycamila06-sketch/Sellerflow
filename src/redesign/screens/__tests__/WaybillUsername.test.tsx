// WAYBILL USERNAME screen — the whole flow with REAL files (the fake TikTok CSV + the fake J&T PDF):
// upload → Add usernames → the counts → pick a buyer / leave blank → the new PDF (phone: shared inside
// the tap with ready bytes; the PDF really holds the usernames, the skipped page is untouched).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, act, screen, fireEvent, cleanup, within } from "@testing-library/react";
import WaybillUsername from "../WaybillUsername";
import BoldMarks from "../../components/BoldMarks";
import { pdfFilename } from "../../adapters/waybillOut";
import { buildCandidates, type CandidateLoad, type CandidateRow } from "../../adapters/waybillMatch";
import { buildOrderCsv, buildWaybillPdf } from "../../adapters/__tests__/fixtures/waybillFixture";
import { DEMO_ORDERS, DEMO_PAGES } from "../../adapters/__tests__/fixtures/waybillDemo";
import { readWaybillPages } from "../../adapters/waybillPdf";
import { renderToStaticMarkup } from "react-dom/server";
import { TProvider } from "../../i18n";

const TODAY = "2026-11-27";
const row = (handle: string, day: string, n = 1): CandidateRow[] => Array.from({ length: n }, (_, k) => ({ user_id: "me", platform: "TikTok", session_date: day, handle, price: 150, qty: 1, created_at: `${day}T0${k}:00:00Z` }));
const BUYERS = buildCandidates([
  ...row("ana_ukay8", TODAY, 3), ...row("angel_m8", TODAY, 2), ...row("amy_bae8", "2026-11-26"), ...row("mariel_3", TODAY, 2),
  ...row("jessa.ukays", TODAY), ...row("rhea_pinta", "2026-11-26", 2), ...row("kaycee.bay", TODAY), ...row("bennyshop01", "2026-11-26", 4),
  ...row("cheska.uz", TODAY), ...row("lorenz_dizon", TODAY),
], "me", TODAY);
const load = vi.fn(async (): Promise<CandidateLoad> => ({ ok: true, candidates: BUYERS, today: TODAY }));
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const until = async (fn: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await flush(1); } };
let pdfBytes: Uint8Array;
let shared: File[] = [];

beforeAll(async () => { pdfBytes = await buildWaybillPdf(DEMO_PAGES); });
beforeEach(() => {
  shared = [];
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
});
afterEach(() => { cleanup(); delete (window as unknown as { Capacitor?: unknown }).Capacitor; Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true }); });

async function upload() {
  render(<TProvider lang="en"><div data-redesign><WaybillUsername onBack={() => {}} userId="me" cur="₱" loadCandidates={load} /></div></TProvider>);
  await flush();
  fireEvent.change(screen.getByTestId("wb-csv-input"), { target: { files: [new File([buildOrderCsv(DEMO_ORDERS, { bom: true })], "All order.csv", { type: "text/csv" })] } });
  fireEvent.change(screen.getByTestId("wb-pdf-input"), { target: { files: [new File([new Uint8Array(pdfBytes)], "Shipping label.pdf", { type: "application/pdf" })] } });
  await until(() => !!screen.queryByTestId("wb-pdf-ok") && !!screen.queryByTestId("wb-csv-ok"));
}

describe("upload", () => {
  it("Add usernames is off until both files are in; the cards say what was found", async () => {
    render(<TProvider lang="en"><div data-redesign><WaybillUsername onBack={() => {}} userId="me" cur="₱" loadCandidates={load} /></div></TProvider>);
    await flush();
    expect((screen.getByTestId("wb-go") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("wb-go-hint").textContent).toBe("Upload the order list (CSV) to continue");
    fireEvent.change(screen.getByTestId("wb-csv-input"), { target: { files: [new File([buildOrderCsv(DEMO_ORDERS)], "o.csv")] } });
    await until(() => !!screen.queryByTestId("wb-csv-ok"));
    expect(screen.getByTestId("wb-csv-ok").textContent).toContain("8 orders found");
    expect((screen.getByTestId("wb-go") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("wb-go-hint").textContent).toBe("Upload the waybill PDF to continue");
    fireEvent.change(screen.getByTestId("wb-pdf-input"), { target: { files: [new File([new Uint8Array(pdfBytes)], "w.pdf")] } });
    await until(() => !!screen.queryByTestId("wb-pdf-ok"));
    expect(screen.getByTestId("wb-pdf-ok").textContent).toContain("9 waybills found");
    expect((screen.getByTestId("wb-go") as HTMLButtonElement).disabled).toBe(false);
    expect(load).toHaveBeenCalledWith("me");
  });
  it("a CSV without the Buyer Username column → a clear message, Add usernames stays off", async () => {
    render(<TProvider lang="en"><div data-redesign><WaybillUsername onBack={() => {}} userId="me" cur="₱" loadCandidates={load} /></div></TProvider>);
    await flush();
    fireEvent.change(screen.getByTestId("wb-csv-input"), { target: { files: [new File([buildOrderCsv(DEMO_ORDERS, { noUsername: true })], "o.csv")] } });
    await until(() => !!screen.queryByTestId("wb-csv-err"));
    expect(screen.getByTestId("wb-csv-err").textContent).toContain("no Buyer Username column");
    expect((screen.getByTestId("wb-go") as HTMLButtonElement).disabled).toBe(true);
  });
  it("a file that is not a PDF → 'This file isn't a waybill PDF.'", async () => {
    render(<TProvider lang="en"><div data-redesign><WaybillUsername onBack={() => {}} userId="me" cur="₱" loadCandidates={load} /></div></TProvider>);
    await flush();
    fireEvent.change(screen.getByTestId("wb-pdf-input"), { target: { files: [new File(["not a pdf"], "x.pdf")] } });
    await until(() => !!screen.queryByTestId("wb-pdf-err"));
    expect(screen.getByTestId("wb-pdf-err").textContent).toBe("This file isn't a waybill PDF.");
  });
  it("the buyers could not be loaded → the message + Try again (reads again)", async () => {
    const failing = vi.fn(async (): Promise<CandidateLoad> => ({ ok: false }));
    render(<TProvider lang="en"><div data-redesign><WaybillUsername onBack={() => {}} userId="me" cur="₱" loadCandidates={failing} /></div></TProvider>);
    await flush();
    expect(screen.getByTestId("wb-buyers-failed").textContent).toContain("Couldn't load your buyers");
    fireEvent.click(within(screen.getByTestId("wb-buyers-failed")).getByRole("button"));
    await flush();
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("results", () => {
  it("counts, the green @usernames, Pick buyer, the not-in-the-list page", async () => {
    await upload();
    fireEvent.click(screen.getByTestId("wb-go")); await flush();
    expect(screen.getByTestId("wb-tile-added").textContent).toBe("6Username added");
    expect(screen.getByTestId("wb-tile-needs").textContent).toBe("2Pick the buyer");
    expect(screen.getByTestId("wb-chip-all").textContent).toBe("All 9");
    expect(screen.getByTestId("wb-chip-needs").textContent).toBe("Needs you 2");
    expect(screen.getByTestId("wb-chip-user-0").textContent).toBe("@mariel_3");
    expect(screen.getByTestId("wb-pick-2")).toBeTruthy(); // a******8 → angel_m8 / amy_bae8
    expect(screen.getByTestId("wb-pick-5")).toBeTruthy(); // l*****n → nobody
    expect(screen.getByTestId("wb-msg-8").textContent).toBe("Not in the order list");
    expect(screen.getByText("If you skip a buyer, that waybill prints without a username.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("wb-chip-needs")); await flush();
    expect(screen.queryByTestId("wb-chip-user-0")).toBeNull();
    expect(screen.getByTestId("wb-pick-2")).toBeTruthy();
  });
  it("Pick the buyer: the fitting buyers first (Today/Yesterday · orders · total), search over all, Use / leave blank", async () => {
    await upload();
    fireEvent.click(screen.getByTestId("wb-go")); await flush();
    fireEvent.click(screen.getByTestId("wb-pick-2")); await flush();
    const sheet = screen.getByTestId("wb-sheet");
    expect(sheet.textContent).toContain("Order …4823 · TikTok shows a******8");
    const fits = within(sheet).getAllByTestId(/^wb-cand-/).map((b) => b.textContent);
    expect(fits).toEqual(["A@angel_m8Today · 2 orders · ₱300", "A@amy_bae8Yesterday · 1 order · ₱150"]);
    expect((within(sheet).getByTestId("wb-sheet-use") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(sheet).getByTestId("wb-search"), { target: { value: "benny" } });
    expect(within(sheet).getAllByTestId(/^wb-found-/).map((b) => b.textContent)).toEqual(["B@bennyshop01Yesterday · 4 orders · ₱600"]);
    fireEvent.click(within(sheet).getByTestId("wb-cand-amy_bae8"));
    expect(within(sheet).getByTestId("wb-sheet-use").textContent).toBe("Use @amy_bae8");
    fireEvent.click(within(sheet).getByTestId("wb-sheet-use")); await flush();
    expect(screen.queryByTestId("wb-sheet")).toBeNull();
    expect(screen.getByTestId("wb-chip-user-2").textContent).toBe("@amy_bae8");
    expect(screen.getByTestId("wb-tile-added").textContent).toBe("7Username added");
    // the other one: nobody fits → the note, then leave blank
    fireEvent.click(screen.getByTestId("wb-pick-5")); await flush();
    expect(screen.getByTestId("wb-sheet-none").textContent).toContain("No buyer from today or yesterday fits l*****n");
    fireEvent.click(screen.getByTestId("wb-sheet-blank")); await flush();
    expect(screen.getByTestId("wb-blank-5").textContent).toBe("No username");
    expect(screen.getByTestId("wb-tile-needs").textContent).toBe("0Pick the buyer");
  });
  it("PHONE APP: Download PDF shares a ready PDF INSIDE the tap; the PDF has the usernames and the blank / skipped pages untouched", async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = {};
    const share = vi.fn((d: { files: File[] }) => { shared = d.files; return Promise.resolve(); });
    Object.assign(navigator, { share, canShare: () => true });
    await upload();
    fireEvent.click(screen.getByTestId("wb-go")); await flush();
    fireEvent.click(screen.getByTestId("wb-pick-5")); await flush();
    fireEvent.click(screen.getByTestId("wb-sheet-blank")); await flush();
    await until(() => !(screen.getByTestId("wb-download") as HTMLButtonElement).disabled);
    expect(screen.getByTestId("wb-download").textContent).toBe("Download PDF (9 waybills)");
    fireEvent.click(screen.getByTestId("wb-download"));
    expect(share).toHaveBeenCalledTimes(1); // called during the tap itself (nothing awaited first)
    expect(shared[0].type).toBe("application/pdf");
    expect(shared[0].name).toMatch(/^waybills-\d{8}-\d{4}\.pdf$/);
    const pages = await readWaybillPages(new Uint8Array(await shared[0].arrayBuffer()));
    expect(pages).toHaveLength(9);
    const stamp = (i: number) => pages![i].read.texts.find((t) => t.str.startsWith("@"))?.str ?? null;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(stamp)).toEqual(["@mariel_3", "@jessa.ukays", null, "@rhea_pinta", "@kaycee.bay", null, "@bennyshop01", "@cheska.uz", null]);
  });
  it("Back on the phone results goes back to the upload step (files kept)", async () => {
    await upload();
    fireEvent.click(screen.getByTestId("wb-go")); await flush();
    fireEvent.click(screen.getByTestId("back-btn")); await flush();
    expect(screen.getByTestId("wb-upload")).toBeTruthy();
    expect(screen.getByTestId("wb-pdf-ok")).toBeTruthy();
  });
});

describe("laptop", () => {
  it("upload left, table right: Print N waybills + Download PDF", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    await upload();
    expect(screen.getByTestId("wb-wide")).toBeTruthy();
    expect(screen.getByTestId("wb-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("wb-go")); await flush();
    expect(screen.getByTestId("wb-table")).toBeTruthy();
    await until(() => !(screen.getByTestId("wb-print") as HTMLButtonElement).disabled);
    expect(screen.getByTestId("wb-print").textContent).toBe("Print 9 waybills");
    expect(screen.getByTestId("wb-download").textContent).toBe("Download PDF");
    expect(screen.getByTestId("wb-print-note").textContent).toContain("If this laptop prints stickers by itself (auto-print), use Download PDF");
  });
  it("a double tap on Print opens ONE print window", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    const made: string[] = [];
    const urlApi = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    const keep = { c: urlApi.createObjectURL, r: urlApi.revokeObjectURL };
    urlApi.createObjectURL = () => { made.push("u"); return `blob:test-${made.length}`; };
    urlApi.revokeObjectURL = () => {};
    try {
      await upload();
      fireEvent.click(screen.getByTestId("wb-go")); await flush();
      await until(() => !(screen.getByTestId("wb-print") as HTMLButtonElement).disabled);
      fireEvent.click(screen.getByTestId("wb-print"));
      fireEvent.click(screen.getByTestId("wb-print-go"));
      fireEvent.click(screen.getByTestId("wb-print"));
      fireEvent.click(screen.getByTestId("wb-print-go"));
      expect(made).toHaveLength(1);
      expect(document.querySelectorAll("iframe[title=waybills]")).toHaveLength(1);
    } finally { urlApi.createObjectURL = keep.c; urlApi.revokeObjectURL = keep.r; }
  });
  it("Print asks first (an auto-print laptop prints at once): nothing is printed until \"Print now\"; Cancel prints nothing", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    const made: string[] = [];
    const urlApi = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
    const keep = { c: urlApi.createObjectURL, r: urlApi.revokeObjectURL };
    urlApi.createObjectURL = () => { made.push("u"); return `blob:test-${made.length}`; };
    urlApi.revokeObjectURL = () => {};
    try {
      await upload();
      fireEvent.click(screen.getByTestId("wb-go")); await flush();
      await until(() => !(screen.getByTestId("wb-print") as HTMLButtonElement).disabled);
      fireEvent.click(screen.getByTestId("wb-print"));
      expect(made).toHaveLength(0);
      expect(screen.getByTestId("wb-print-confirm").textContent).toContain("Print 9 waybills now?");
      fireEvent.click(screen.getByTestId("wb-print-cancel"));
      expect(screen.queryByTestId("wb-print-confirm")).toBeNull();
      expect(made).toHaveLength(0);
      fireEvent.click(screen.getByTestId("wb-print"));
      fireEvent.click(screen.getByTestId("wb-print-go"));
      expect(made).toHaveLength(1);
      expect(screen.queryByTestId("wb-print-confirm")).toBeNull();
    } finally { urlApi.createObjectURL = keep.c; urlApi.revokeObjectURL = keep.r; }
  });
  it("inside the phone / tablet app at laptop width: no Print button (it would do nothing there) — Download only", async () => {
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    (window as unknown as { Capacitor?: unknown }).Capacitor = {};
    await upload();
    fireEvent.click(screen.getByTestId("wb-go")); await flush();
    expect(screen.queryByTestId("wb-print")).toBeNull();
    expect(screen.queryByTestId("wb-print-note")).toBeNull();
    expect(screen.getByTestId("wb-download")).toBeTruthy();
  });
});

describe("small pieces", () => {
  it("**bold** marks in a translated sentence", () => {
    expect(renderToStaticMarkup(<p><BoldMarks text="Found **today and yesterday**. OK" /></p>)).toBe("<p>Found <b>today and yesterday</b>. OK</p>");
  });
  it("the file name uses the Philippines / Taiwan clock", () => {
    expect(pdfFilename(Date.UTC(2026, 10, 27, 16, 5))).toBe("waybills-20261128-0005.pdf");
  });
});
