// Pickup Status — own drag bar. Geometry (jsdom has no layout, so the page size, the header
// bottom and the scroll position are set by hand): header bottom 112 → bar top 118; the track
// has no measured height in jsdom → bar height = innerHeight − barTop − 8 = 674; thumb 56 →
// span 618. Page 3800 tall, window 800 → 3000 px to scroll.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { createRef } from "react";

const { loadParcelTracking } = vi.hoisted(() => ({ loadParcelTracking: vi.fn(async () => ({ ok: true, rows: [] as unknown[] })) }));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadMoreLive: vi.fn(async () => ({ ok: true, rows: [] })), loadBuyerNamesByHandle: vi.fn(async () => new Map()) };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => false }));
vi.mock("../../adapters/platform", () => ({ isIOS: () => false, isAndroid: () => false }));

import DragBar, { DRAGBAR_HTML_CLASS } from "../DragBar";
import ParcelTracking from "../../screens/ParcelTracking";
import { TProvider } from "../../i18n";

// jsdom has no PointerEvent: a MouseEvent with a pointerId carries clientY through fireEvent.
if (typeof window.PointerEvent === "undefined") {
  class PE extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
}

const page = { height: 3800, y: 0 };
const scrollTo = vi.fn((_x: number, y: number) => { page.y = y; });
const header = document.createElement("div");
header.getBoundingClientRect = () => ({ top: 0, bottom: 112, left: 0, right: 0, width: 0, height: 112, x: 0, y: 0, toJSON() {} }) as DOMRect;
const BAR_TOP = 118, SPAN = 800 - 118 - 8 - 56; // 618

beforeEach(() => {
  page.height = 3800; page.y = 0; scrollTo.mockClear();
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, get: () => page.height });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => page.y });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
});
afterEach(() => { document.documentElement.classList.remove(DRAGBAR_HTML_CLASS); });

const mountBar = () => {
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = header;
  return render(<DragBar headerRef={ref} label="Scroll the list" />);
};
const thumb = (r: ReturnType<typeof render>) => r.getByTestId("pt-dragbar-thumb");

describe("DragBar", () => {
  it("the thumb follows the page scroll (top + aria-valuenow)", async () => {
    const r = mountBar();
    await waitFor(() => expect(thumb(r).style.top).toBe("0px"));
    expect(r.getByTestId("pt-dragbar").style.top).toBe(`${BAR_TOP}px`);
    expect(thumb(r).getAttribute("role")).toBe("scrollbar");
    expect(thumb(r).getAttribute("aria-label")).toBe("Scroll the list");
    page.y = 1500; // half of 3000
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(thumb(r).style.top).toBe(`${SPAN / 2}px`);
    expect(thumb(r).getAttribute("aria-valuenow")).toBe("50");
    page.y = 3000;
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(thumb(r).style.top).toBe(`${SPAN}px`);
    expect(thumb(r).getAttribute("aria-valuenow")).toBe("100");
  });

  it("dragging the thumb to the middle scrolls the page to ~50%; release keeps it there", async () => {
    const r = mountBar();
    await waitFor(() => expect(thumb(r).style.top).toBe("0px"));
    fireEvent.pointerDown(thumb(r), { clientY: BAR_TOP + 10, pointerId: 1 }); // grab 10px into the thumb
    expect(thumb(r).getAttribute("data-dragging")).toBe("1");
    fireEvent.pointerMove(thumb(r), { clientY: BAR_TOP + SPAN / 2 + 10, pointerId: 1 });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1500);
    fireEvent.pointerUp(thumb(r), { clientY: BAR_TOP + SPAN / 2 + 10, pointerId: 1 });
    expect(thumb(r).getAttribute("data-dragging")).toBe("0");
    expect(page.y).toBe(1500);
    // clamped at the ends
    fireEvent.pointerDown(thumb(r), { clientY: BAR_TOP + 10, pointerId: 1 });
    fireEvent.pointerMove(thumb(r), { clientY: 5000, pointerId: 1 });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 3000);
  });

  it("a tap on the track (not the thumb) jumps there", async () => {
    const r = mountBar();
    await waitFor(() => expect(thumb(r).style.top).toBe("0px"));
    fireEvent.pointerDown(r.getByTestId("pt-dragbar"), { clientY: BAR_TOP + 28 + SPAN * 0.25, pointerId: 1 });
    expect(scrollTo).toHaveBeenLastCalledWith(0, 750);
  });

  it("hidden when the page does not scroll", async () => {
    page.height = 800;
    const r = mountBar();
    await waitFor(() => expect(r.getByTestId("pt-dragbar-off")).toBeTruthy());
    expect(r.queryByTestId("pt-dragbar")).toBeNull();
  });

  it("hides the browser's page scrollbar only while mounted", () => {
    expect(document.documentElement.classList.contains(DRAGBAR_HTML_CLASS)).toBe(false);
    const r = mountBar();
    expect(document.documentElement.classList.contains(DRAGBAR_HTML_CLASS)).toBe(true);
    r.unmount();
    expect(document.documentElement.classList.contains(DRAGBAR_HTML_CLASS)).toBe(false);
  });
});

describe("Pickup Status uses it", () => {
  it("the screen adds the html class while open; leaving the screen (Back) leaves none", async () => {
    const r = render(<TProvider lang="en"><ParcelTracking onBack={() => {}} /></TProvider>);
    await waitFor(() => expect(loadParcelTracking).toHaveBeenCalled());
    expect(document.documentElement.classList.contains(DRAGBAR_HTML_CLASS)).toBe(true);
    r.unmount();
    expect(document.documentElement.classList.contains(DRAGBAR_HTML_CLASS)).toBe(false);
  });
});
