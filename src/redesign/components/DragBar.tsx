// Pickup Status — the screen's own drag bar (iPhone, Android, iPad, laptop): a fixed thumb on
// the right edge of the list's scroll box that follows the scroll and can be dragged, so a long
// parcel list is quick to move through on a phone. Used only in ParcelTracking. It only READS the
// scroll position and sets it — nothing in the list, pager or filter changes.
//
// The app does not scroll the window: `.sfl-scroll` (overflow-y:auto) does. So everything here
// works on the REAL scroller — scrollerOf(header) — and falls back to the window only when there
// is none (standalone page / tests). Rendered inline (inside the scroller's stacking context) so
// the screen's own menus (z 30) and toasts (z 60) stay above it.
// While mounted the browser's own page scrollbar is hidden (html class "pt-dragbar", see
// redesign.css); the class goes away on unmount.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type RefObject } from "react";

const THUMB = 56;       // thumb height (touch area)
const GAP_TOP = 6;      // below the sticky header
const GAP_BOTTOM = 8;   // above the scroll box's bottom
const WIDTH = 28;       // touch strip width
export const DRAGBAR_HTML_CLASS = "pt-dragbar";

/** The closest ancestor that scrolls vertically (overflow-y auto|scroll), never body/html; null → the window. */
// Shared with ParcelTracking's page change on purpose (one rule for "the real scroller"); a fast-refresh
// reload of this file only re-renders the bar, so the plain-function export is harmless here.
// eslint-disable-next-line react-refresh/only-export-components
export function scrollerOf(el: Element | null | undefined): HTMLElement | null {
  if (typeof window === "undefined" || !el) return null;
  for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const oy = window.getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return n;
  }
  return null;
}

interface Geo { visible: boolean; barTop: number; barH: number; left: number | null; max: number; thumbTop: number; pct: number }
const HIDDEN: Geo = { visible: false, barTop: 0, barH: 0, left: null, max: 0, thumbTop: 0, pct: 0 };
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export default function DragBar({ headerRef, dep, label }: { headerRef: RefObject<HTMLElement | null>; dep?: unknown; label: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<Geo>(HIDDEN);
  const [dragging, setDragging] = useState(false);
  const grab = useRef(0); // pointer offset inside the thumb at pointerdown

  const scroller = useCallback(() => scrollerOf(headerRef.current), [headerRef]);

  const measure = useCallback(() => {
    if (typeof window === "undefined") return;
    const sc = scroller();
    const head = headerRef.current;
    const headBottom = head ? head.getBoundingClientRect().bottom : 0;
    if (sc) {
      const max = Math.max(0, sc.scrollHeight - sc.clientHeight);
      if (max <= 0) { setGeo(HIDDEN); return; }
      const r = sc.getBoundingClientRect();
      const barTop = Math.max(r.top, headBottom) + GAP_TOP;
      const barH = Math.max(0, r.bottom - GAP_BOTTOM - barTop);
      const f = clamp01(sc.scrollTop / max);
      setGeo({ visible: barH > THUMB, barTop, barH, left: r.right - WIDTH, max, thumbTop: f * Math.max(0, barH - THUMB), pct: Math.round(f * 100) });
      return;
    }
    // Window fallback (standalone / tests).
    const max = Math.max(0, (document.documentElement.scrollHeight || 0) - window.innerHeight);
    if (max <= 0) { setGeo(HIDDEN); return; }
    const barTop = Math.max(0, headBottom) + GAP_TOP;
    const measured = trackRef.current?.getBoundingClientRect().height ?? 0;
    const barH = measured > 0 ? measured : Math.max(0, window.innerHeight - barTop - GAP_BOTTOM);
    const f = clamp01(window.scrollY / max);
    setGeo({ visible: barH > THUMB, barTop, barH, left: null, max, thumbTop: f * Math.max(0, barH - THUMB), pct: Math.round(f * 100) });
  }, [headerRef, scroller]);

  // Hide the browser's own page scrollbar only while this screen is open.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add(DRAGBAR_HTML_CLASS);
    return () => html.classList.remove(DRAGBAR_HTML_CLASS);
  }, []);

  // Follow the scroller: its scroll (passive), resize, the scroller / its content growing, and
  // every list change the screen reports through `dep` (page / filter / tab / search / sync).
  useEffect(() => {
    const raf = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : (cb: () => void) => window.setTimeout(cb, 0);
    const cancel = typeof window.cancelAnimationFrame === "function" ? window.cancelAnimationFrame.bind(window) : window.clearTimeout.bind(window);
    const id = raf(measure);
    const sc = scroller();
    const target: HTMLElement | Window = sc ?? window;
    target.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (ro) {
      if (sc) { ro.observe(sc); for (const c of Array.from(sc.children)) ro.observe(c); } else ro.observe(document.body);
    }
    return () => { cancel(id as number); target.removeEventListener("scroll", measure); window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, [measure, scroller, dep]);

  const scrollToFraction = (f: number) => {
    const y = clamp01(f) * geo.max;
    const sc = scroller();
    if (sc) sc.scrollTop = y; else window.scrollTo(0, y);
  };
  const fractionAt = (clientY: number, offset: number) => {
    const span = geo.barH - THUMB;
    return span > 0 ? (clientY - offset - geo.barTop) / span : 0;
  };

  const onThumbDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    grab.current = e.clientY - (geo.barTop + geo.thumbTop);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* best-effort */ }
    setDragging(true);
  };
  const onThumbMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.preventDefault();
    scrollToFraction(fractionAt(e.clientY, grab.current));
  };
  const onThumbUp = (e: RPointerEvent<HTMLDivElement>) => {
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* best-effort */ }
    setDragging(false); // the list stays where it is
  };
  // A MOUSE click on the track (not the thumb) jumps there: the thumb's middle lands on the click.
  // Touch / pen on the track does nothing — on phones the Chase / Copy button ends 1px from the
  // strip, so a slightly-off tap must never jump the list; only the thumb drags.
  const onTrackDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.pointerType !== "mouse") return;
    scrollToFraction(fractionAt(e.clientY, THUMB / 2));
  };

  if (!geo.visible && !dragging) return <div data-testid="pt-dragbar-off" hidden />;

  // Scroller: on the scroll box's own right edge (laptop: never over the nav), its own height.
  // Window fallback: right edge of the page.
  const place: CSSProperties = geo.left !== null
    ? { left: geo.left, top: geo.barTop, height: geo.barH }
    : { right: 0, top: geo.barTop, bottom: `calc(${GAP_BOTTOM}px + env(safe-area-inset-bottom))` };
  const pill = dragging ? 12 : 10;
  return (
    <div ref={trackRef} data-testid="pt-dragbar" onPointerDown={onTrackDown}
      style={{ position: "fixed", width: WIDTH, ...place, zIndex: 20, touchAction: "none" }}>
      <div aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, right: 4, width: 8, borderRadius: 4, background: "var(--border)", pointerEvents: "none" }} />
      <div role="scrollbar" aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={geo.pct} aria-label={label}
        data-testid="pt-dragbar-thumb" data-dragging={dragging ? "1" : "0"}
        onPointerDown={onThumbDown} onPointerMove={onThumbMove} onPointerUp={onThumbUp} onPointerCancel={onThumbUp}
        style={{ position: "absolute", right: 0, width: WIDTH, height: THUMB, top: geo.thumbTop, touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}>
        <div style={{
          position: "absolute", top: 0, bottom: 0, right: 8 - pill / 2, width: pill, borderRadius: pill / 2,
          background: dragging ? "var(--accent)" : "var(--text-muted)", opacity: dragging ? 1 : 0.6,
          boxShadow: "0 1px 4px rgba(0,0,0,.25)", transition: "width .12s, right .12s, background .12s",
        }} />
      </div>
    </div>
  );
}
