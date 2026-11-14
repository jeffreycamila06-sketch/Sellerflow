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

import DragBar, { DRAGBAR_HTML_CLASS, scrollerOf } from "../DragBar";
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

// In the app the list's box scrolls (.sfl-scroll, overflow-y:auto), not the window.
// Box: top 60, bottom 860, right 400; header bottom 172 → bar top 178, height 860−8−178 = 674,
// span 618, left 400 − 28 = 372. Content 3800 tall, box 800 → 3000 px to scroll.
describe("DragBar in a scroll box (the real app)", () => {
  const box = { top: 0 };
  const mountInBox = () => {
    const headRef = createRef<HTMLDivElement>();
    const fit = (el: HTMLDivElement | null) => {
      if (!el) return;
      el.getBoundingClientRect = () => ({ top: 60, bottom: 860, left: 0, right: 400, width: 400, height: 800, x: 0, y: 60, toJSON() {} }) as DOMRect;
      Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 3800 });
      Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 800 });
      Object.defineProperty(el, "scrollTop", { configurable: true, get: () => box.top, set: (v: number) => { box.top = v; } });
    };
    const fitHead = (el: HTMLDivElement | null) => {
      (headRef as { current: HTMLDivElement | null }).current = el;
      if (el) el.getBoundingClientRect = () => ({ top: 60, bottom: 172, left: 0, right: 400, width: 400, height: 112, x: 0, y: 60, toJSON() {} }) as DOMRect;
    };
    const r = render(
      <div ref={fit} data-testid="box" style={{ overflowY: "auto" }}>
        <div ref={fitHead}>header</div>
        <DragBar headerRef={headRef} label="Scroll the list" />
      </div>,
    );
    return r;
  };
  beforeEach(() => { box.top = 0; page.height = 800; }); // the window itself does not scroll

  it("finds the box as the scroller and shows the bar on the box's own right edge", async () => {
    const r = mountInBox();
    expect(scrollerOf(r.getByText("header"))).toBe(r.getByTestId("box"));
    await waitFor(() => expect(r.getByTestId("pt-dragbar")).toBeTruthy());
    const bar = r.getByTestId("pt-dragbar");
    expect(bar.style.left).toBe("372px");          // box.right − 28, never over the nav
    expect(bar.style.top).toBe("178px");
    expect(bar.style.height).toBe("674px");
    expect(parseFloat(bar.style.top) + parseFloat(bar.style.height)).toBeLessThanOrEqual(860);
  });
  it("scrolling the box moves the thumb", async () => {
    const r = mountInBox();
    await waitFor(() => expect(r.getByTestId("pt-dragbar-thumb").style.top).toBe("0px"));
    box.top = 1500;
    act(() => { r.getByTestId("box").dispatchEvent(new Event("scroll")); });
    expect(r.getByTestId("pt-dragbar-thumb").style.top).toBe("309px");
    expect(r.getByTestId("pt-dragbar-thumb").getAttribute("aria-valuenow")).toBe("50");
  });
  it("dragging to the middle sets the box's scrollTop ≈ 50% (the window is not scrolled)", async () => {
    const r = mountInBox();
    await waitFor(() => expect(r.getByTestId("pt-dragbar-thumb").style.top).toBe("0px"));
    fireEvent.pointerDown(r.getByTestId("pt-dragbar-thumb"), { clientY: 178 + 10, pointerId: 1 });
    fireEvent.pointerMove(r.getByTestId("pt-dragbar-thumb"), { clientY: 178 + 309 + 10, pointerId: 1 });
    expect(box.top).toBe(1500);
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.pointerUp(r.getByTestId("pt-dragbar-thumb"), { pointerId: 1 });
    fireEvent.pointerDown(r.getByTestId("pt-dragbar"), { clientY: 178 + 28 + 618 * 0.25, pointerId: 1 }); // tap the track
    expect(box.top).toBe(750);
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
