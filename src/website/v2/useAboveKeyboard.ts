// Seller Website — a sheet or panel that opens from the bottom stays ABOVE the phone's keyboard.
// A fixed layer is laid out against the whole page area; when the keyboard is open (the buyer was typing in
// the search box and tapped "+" on a product), the bottom of that layer is under the keyboard and the sheet
// with it. Two things, both only while the sheet is open:
//   1. the field that had the cursor is released, so the keyboard closes;
//   2. the layer's bottom is lifted by the part of the screen the keyboard still covers (the browser's
//      visual viewport), and follows it if the keyboard opens again.
// A browser without a visual viewport, or with no keyboard open: nothing changes (0 px).
import { useLayoutEffect, type RefObject } from "react";

/** How much of the bottom of the page area is covered (the keyboard), in px. Pure. */
export function coveredBottom(layoutHeight: number, vv: { height: number; offsetTop: number } | null | undefined): number {
  if (!vv || !Number.isFinite(vv.height) || !Number.isFinite(layoutHeight)) return 0;
  const px = Math.round(layoutHeight - vv.height - (Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0));
  return px > 0 ? px : 0;
}

export function useAboveKeyboard(layer: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el || typeof window === "undefined") return;
    // 1. close the keyboard: release the field that has the cursor (never a field inside the sheet itself)
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && !el.contains(a) && typeof a.blur === "function" && a.matches("input,textarea,select,[contenteditable]")) a.blur();
    // 2. keep the layer's bottom above whatever still covers the screen
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => { const px = coveredBottom(window.innerHeight, vv); el.style.paddingBottom = px ? `${px}px` : ""; };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); el.style.paddingBottom = ""; };
  }, [layer]);
}
