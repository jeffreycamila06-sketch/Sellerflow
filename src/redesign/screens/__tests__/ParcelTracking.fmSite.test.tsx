// 2026-11-19 (sql/186) — Pickup Status with 全家 parcels FamilyMart's site has NOTHING for yet:
// their own group at the end of the In transit list, with its own number ("+N Not dropped off yet"
// on the phone card), the label "No record yet" (FamilyMart does not know the number) or
// "Not dropped off yet" (it knows the order), and the day the parcel leaves the list.
// The In transit number counts the parcels that are really moving. Rows without the saved answer
// (7-11, 全家 off, sql/186 not applied) show exactly as before.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import type { RedesignLang as Lang } from "../../i18n/langContext";
import type { ParcelTrackingRow } from "../../adapters/parcelTracking";

const M = vi.hoisted(() => ({ narrow: false }));
type LoadRes = { ok: boolean; rows: unknown[]; totals?: Record<string, number>; error?: string };
const { loadParcelTracking, loadMoreLive } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(async (): Promise<LoadRes> => ({ ok: true, rows: [] })),
  loadMoreLive: vi.fn(async (): Promise<LoadRes> => ({ ok: true, rows: [] })),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadMoreLive };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../adapters/fmPickup", () => ({ uploadFmExport: vi.fn() }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => M.narrow }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({ ...(await importOriginal<object>()), taipeiDayId: () => "2026-11-19" }));

import ParcelTracking from "../ParcelTracking";

let n = 0;
const mk = (o: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `F000${n}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: null, storeId: "S", recStore: "中壢華強",
  status: "in_transit", statusMessage: null, pickupDeadline: null, arrivedAt: null, shipType: "C2C", specialType: null, orderAmount: 300, terminal: false, carrier: "711", ...o,
});
const fm = (o: Partial<ParcelTrackingRow> = {}) => mk({ carrier: "fm", trackingNo: `1635174${6000 + n}`, recStore: "樹林新柑園店", ...o });
const held = (o: Partial<ParcelTrackingRow> = {}) => fm({ fmSiteState: "not_dropped", createdAt: "2026-11-15T02:00:00.000Z", ...o });
// 2 moving (1 7-11, 1 全家) · 4 全家 FamilyMart has nothing for · 1 waiting
const ROWS = () => [
  mk({ buyerUsername: "seven_moving" }),
  fm({ buyerUsername: "fm_moving", statusMessage: "貨件進行配送中", createdAt: "2026-11-15T02:00:00.000Z", fmSiteState: null }),
  held({ buyerUsername: "ella_tw", pickupDeadline: "2026-11-25" }),                         // knows the order, file gives a date
  held({ buyerUsername: "faye_ukay" }),                                                     // knows the order, no date
  held({ buyerUsername: "ivy_live", fmSiteState: "not_found" }),                           // does not know the number
  held({ buyerUsername: "gone_soon", fmSiteState: "not_found", pickupDeadline: "2026-11-18" }), // date passed → next check
  mk({ buyerUsername: "seven_wait", status: "at_store", pickupDeadline: "2026-11-22" }),
];
const view = (lang: Lang = "en") => render(<TProvider lang={lang}><ParcelTracking fm /></TProvider>);
const num = (el: HTMLElement) => Number((el.firstElementChild?.textContent ?? "").match(/\d+/)?.[0]);
const buyerOf = (row: HTMLElement) => row.querySelector('span[title^="@"]')?.getAttribute("title")?.slice(1);
const rowOf = (r: ReturnType<typeof view>, who: string) => r.getAllByTestId("pt-row").find((e) => buyerOf(e) === who)!;
// the list in screen order, with the group head written as "GROUP"
const listOrder = (r: ReturnType<typeof view>) => {
  const box = (r.queryByTestId("pt-list") ?? r.container.querySelector("tbody")) as HTMLElement;
  return [...box.querySelectorAll('[data-testid="pt-row"], [data-testid="pt-fm-group"]')].map((e) => (e.getAttribute("data-testid") === "pt-fm-group" ? "GROUP" : buyerOf(e as HTMLElement)));
};

beforeEach(() => {
  M.narrow = false;
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS() });
  loadMoreLive.mockReset(); loadMoreLive.mockResolvedValue({ ok: true, rows: [] });
});

describe("PHONE", () => {
  beforeEach(() => { M.narrow = true; });
  it("the In transit card counts the moving parcels only and says '+4 Not dropped off yet' under it", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-cards")).toBeTruthy());
    const card = r.getByTestId("pt-card-transit");
    expect(num(card)).toBe(2);
    expect(within(card).getByTestId("pt-card-held").textContent).toBe("+4 Not dropped off yet");
    expect(within(r.getByTestId("pt-card-waiting")).queryByTestId("pt-card-held")).toBeNull();
  });
  it("In transit: the moving parcels, then the group with its head and number (inside it: the date that comes first, first)", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("pt-card-transit"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
    expect(listOrder(r)).toEqual(["seven_moving", "fm_moving", "GROUP", "gone_soon", "ella_tw", "faye_ukay", "ivy_live"]);
    const head = r.getByTestId("pt-fm-group");
    expect(head.textContent).toBe("Not dropped off yet · 4FamilyMart has not received these yet. They leave this list after 10 days.");
    expect(within(head).getByTestId("pt-fm-group-n").textContent).toBe("4");
  });
  it("the labels and the right-hand column of each row", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("pt-card-transit"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
    const label = (who: string) => {
      const row = rowOf(r, who);
      return { chip: (within(row).queryByTestId("pt-no-record") ?? within(row).queryByTestId("pt-not-dropped"))?.textContent ?? null, left: within(row).getByTestId("pt-left").textContent };
    };
    expect(label("ella_tw")).toEqual({ chip: "Not dropped off yet", left: "Drop off before Nov 25" }); // the file's date wins
    expect(label("faye_ukay")).toEqual({ chip: "Not dropped off yet", left: "Leaves this list Nov 25" });
    expect(label("ivy_live")).toEqual({ chip: "No record yet", left: "Leaves this list Nov 25" });
    expect(label("gone_soon")).toEqual({ chip: "No record yet", left: "Leaves this list at the next check" });
    expect(label("fm_moving").chip).toBeNull();
  });
  it("Waiting and Picked up show no group", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("pt-card-waiting"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(1));
    expect(r.queryByTestId("pt-fm-group")).toBeNull();
  });
  it("exact numbers from the database: the card and the group head use them", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS(), totals: { all: 40, picked: 0, returned: 0, live: 7, waiting: 1, transit: 12, notDropped: 9 } });
    const r = view();
    await waitFor(() => expect(num(r.getByTestId("pt-card-transit"))).toBe(12));
    expect(r.getByTestId("pt-card-held").textContent).toBe("+9 Not dropped off yet");
    fireEvent.click(r.getByTestId("pt-card-transit"));
    await waitFor(() => expect(r.getByTestId("pt-fm-group-n").textContent).toBe("9"));
  });
  it("the 7-11 store filter: no group, no card line; FamilyMart: the group of FamilyMart's parcels", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("pt-card-transit"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
    fireEvent.click(r.getByTestId("pt-store-btn")); fireEvent.click(r.getByTestId("pt-store-opt-711"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(1));
    expect(r.queryByTestId("pt-fm-group")).toBeNull();
    expect(r.queryByTestId("pt-card-held")).toBeNull();
    fireEvent.click(r.getByTestId("pt-store-btn")); fireEvent.click(r.getByTestId("pt-store-opt-fm"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(5));
    expect(listOrder(r)).toEqual(["fm_moving", "GROUP", "gone_soon", "ella_tw", "faye_ukay", "ivy_live"]);
    expect(num(r.getByTestId("pt-card-transit"))).toBe(1);
    expect(r.getByTestId("pt-card-held").textContent).toBe("+4 Not dropped off yet");
  });
  it("search: the group shows the matches only", async () => {
    const r = view();
    fireEvent.click(await r.findByTestId("pt-card-transit"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
    fireEvent.change(r.getByTestId("pt-search"), { target: { value: "ivy" } });
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(1));
    expect(listOrder(r)).toEqual(["GROUP", "ivy_live"]);
    expect(r.getByTestId("pt-fm-group-n").textContent).toBe("1");
    fireEvent.change(r.getByTestId("pt-search"), { target: { value: "seven_moving" } });
    await waitFor(() => expect(listOrder(r)).toEqual(["seven_moving"]));
  });
  it("no saved answer on any row (7-11 only, 全家 off, sql/186 not applied) → exactly as before: no group, no card line", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS().map(({ fmSiteState: _f, createdAt: _c, ...x }) => x) });
    const r = view();
    await waitFor(() => expect(num(r.getByTestId("pt-card-transit"))).toBe(6));
    expect(r.queryByTestId("pt-card-held")).toBeNull();
    fireEvent.click(r.getByTestId("pt-card-transit"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
    expect(r.queryByTestId("pt-fm-group")).toBeNull();
    expect(r.queryByTestId("pt-no-record")).toBeNull();
    // the older rule stays: a 全家 in-transit row with a drop-off date from the file
    expect(within(rowOf(r, "ella_tw")).getByTestId("pt-not-dropped")).toBeTruthy();
    expect(within(rowOf(r, "faye_ukay")).queryByTestId("pt-not-dropped")).toBeNull();
  });
});

describe("LAPTOP", () => {
  it("the In transit tab counts the moving parcels; the table has the group row before the first such parcel", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tab-transit")).toBeTruthy());
    expect(r.getByTestId("pt-tab-transit").textContent).toMatch(/2$/);
    fireEvent.click(r.getByTestId("pt-tab-transit"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
    expect(listOrder(r)).toEqual(["seven_moving", "fm_moving", "GROUP", "gone_soon", "ella_tw", "faye_ukay", "ivy_live"]);
    const groupRow = r.getByTestId("pt-fm-group-row");
    expect(groupRow.tagName).toBe("TR");
    expect(groupRow.querySelector("td")?.getAttribute("colspan")).toBe("6");
  });
  it("All lists every parcel and shows no group head", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pt-tab-all")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-tab-all"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(7));
    expect(r.queryByTestId("pt-fm-group")).toBeNull();
  });
});

describe("every app language", () => {
  const LANGS: Lang[] = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
  for (const lang of LANGS) {
    it(lang, async () => {
      M.narrow = true;
      const t = buildT(lang) as unknown as Record<string, string>;
      const r = view(lang);
      await waitFor(() => expect(r.getByTestId("pt-card-held")).toBeTruthy());
      expect(r.getByTestId("pt-card-held").textContent).toBe(`+4 ${t.rd_pt_fm_not_dropped}`);
      fireEvent.click(r.getByTestId("pt-card-transit"));
      await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
      expect(r.getByTestId("pt-fm-group").textContent).toBe(`${t.rd_pt_fm_not_dropped} · 4${t.rd_pt_fm_group_hint}`);
      expect(within(rowOf(r, "ivy_live")).getByTestId("pt-no-record").textContent).toBe(t.rd_pt_fm_no_record);
      expect(within(rowOf(r, "faye_ukay")).getByTestId("pt-not-dropped").textContent).toBe(t.rd_pt_fm_not_dropped);
      expect(within(rowOf(r, "gone_soon")).getByTestId("pt-left").textContent).toBe(t.rd_pt_fm_leaves_next);
      const leaves = within(rowOf(r, "faye_ukay")).getByTestId("pt-left").textContent ?? "";
      const [before, after] = t.rd_pt_fm_leaves_on.split("{date}");
      expect(leaves.startsWith(before) && leaves.endsWith(after) && leaves.length > before.length + after.length, leaves).toBe(true);
      for (const k of ["rd_pt_fm_no_record", "rd_pt_fm_leaves_on", "rd_pt_fm_leaves_next", "rd_pt_fm_group_hint"]) expect(t[k], `${lang} ${k}`).toBeTruthy();
    });
  }
});

// Fix round 1 (2026-11-19): the right-hand line may wrap only between whole pieces — the date and every
// short word group are each one unbreakable piece. (jsdom has no layout: the real wrapping is measured on a
// real browser by docs/design/fm-pickup-accuracy-2/harness/wrap-check.cjs → proof/wrap-after.txt.)
describe("the right-hand line keeps the date and the words together", () => {
  beforeEach(() => { M.narrow = true; });
  const whole = (el: HTMLElement) => [...el.querySelectorAll("span")].filter((s) => s.style.whiteSpace === "nowrap").map((s) => s.textContent);
  const openTransit = async (lang: Lang) => {
    const r = view(lang);
    fireEvent.click(await r.findByTestId("pt-card-transit"));
    await waitFor(() => expect(r.getAllByTestId("pt-row")).toHaveLength(6));
    return r;
  };
  it("Traditional Chinese: 請在 · 11月25日 · 前寄件 are three whole pieces (never 前寄 ⏎ 件)", async () => {
    const r = await openTransit("zh-TW");
    const left = within(rowOf(r, "ella_tw")).getByTestId("pt-left");
    expect(left.textContent).toBe("請在 11月25日 前寄件");
    expect(whole(left)).toEqual(["請在", "11月25日", "前寄件"]);
    expect(left.querySelector("[data-date]")?.textContent).toBe("11月25日");
    expect(whole(within(rowOf(r, "gone_soon")).getByTestId("pt-left"))).toEqual(["下次", "檢查時", "移出", "清單"]);
    expect(whole(within(rowOf(r, "faye_ukay")).getByTestId("pt-left"))).toEqual(["11月25日", "移出清單"]);
  });
  it("English: the date is one piece (never Nov ⏎ 25)", async () => {
    const r = await openTransit("en");
    const left = within(rowOf(r, "ella_tw")).getByTestId("pt-left");
    expect(left.textContent).toBe("Drop off before Nov 25");
    expect(left.querySelector("[data-date]")?.textContent).toBe("Nov 25");
    expect(whole(left)).toEqual(["Drop", "off", "before", "Nov 25"]);
  });
  it("every language: the date of each line is one piece, and the text is the label word for word", async () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as Lang[]) {
      const t = buildT(lang) as unknown as Record<string, string>;
      const r = await openTransit(lang);
      for (const who of ["ella_tw", "faye_ukay", "ivy_live"]) {
        const left = within(rowOf(r, who)).getByTestId("pt-left");
        const date = left.querySelector("[data-date]");
        expect(date, `${lang} ${who}`).toBeTruthy();
        expect(date!.parentElement, `${lang} ${who}`).toBe(left);
        expect((date as HTMLElement).style.whiteSpace).toBe("nowrap");
        const tmpl = who === "ella_tw" ? t.rd_pt_fm_drop_by : t.rd_pt_fm_leaves_on;
        expect(left.textContent, `${lang} ${who}`).toBe(tmpl.replace("{date}", date!.textContent ?? ""));
      }
      r.unmount();
    }
  });
});
