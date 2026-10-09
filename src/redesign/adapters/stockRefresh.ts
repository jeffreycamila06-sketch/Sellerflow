// Build 6 — "Stock freshness" (switch stock_refresh_v2, sql/107). Auto-mode codes and live stock
// used to be read ONCE at sign-in, so a restock or a new code made on the laptop never reached
// the live phone. This module: the stock race guard, the merge of a reload into the live counts,
// the 10-second debounce, and the hook that listens for "the app is back" (switch ON only).
// It never touches the per-session dedup state (Rule 1/2/3 refs) — only codes + stock.
import { useEffect, useRef } from "react";
import type { Product } from "./products";

export const STOCK_REFRESH_DEBOUNCE_MS = 10 * 1000;
// An Auto order's stock decrement runs inside the order path without a completion signal; a
// reload started within this window of a local deduction keeps the local count for that product.
export const STOCK_TOUCH_GUARD_MS = 15 * 1000;

// Per-product in-flight deductions (begin/end around an awaited stock RPC) + last local touch.
export function createStockGuard() {
  const pending = new Map<number, number>();
  const touched = new Map<number, number>();
  return {
    begin(lid: number, now: number) { pending.set(lid, (pending.get(lid) || 0) + 1); touched.set(lid, now); },
    end(lid: number, now: number) { const n = (pending.get(lid) || 0) - 1; if (n > 0) pending.set(lid, n); else pending.delete(lid); touched.set(lid, now); },
    touch(lid: number, now: number) { touched.set(lid, now); },
    // May a reload that STARTED at startedAt overwrite this product's local count?
    canOverwrite(lid: number, startedAt: number): boolean {
      if ((pending.get(lid) || 0) > 0) return false;
      const t = touched.get(lid);
      return t == null || t < startedAt - STOCK_TOUCH_GUARD_MS;
    },
    pendingCount: (lid: number) => pending.get(lid) || 0,
  };
}
export type StockGuard = ReturnType<typeof createStockGuard>;

// The database list → the new live stock map. Guarded products keep their local count.
export function mergeReloadedStock(local: Map<number, number>, fresh: Product[], guard: StockGuard, startedAt: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of fresh) out.set(p.id, guard.canOverwrite(p.id, startedAt) || !local.has(p.id) ? p.stock : (local.get(p.id) as number));
  return out;
}

export function debounceAllows(lastAt: number, now: number, ms = STOCK_REFRESH_DEBOUNCE_MS): boolean {
  return lastAt === 0 || now - lastAt >= ms;
}

// Switch ON: call onBack when the page becomes visible again or the native app resumes
// (Capacitor App plugin, only if present). OFF: no listener at all.
export function useStockRefreshTriggers(on: boolean, onBack: () => void): void {
  const cb = useRef(onBack);
  useEffect(() => { cb.current = onBack; });
  useEffect(() => {
    if (!on || typeof document === "undefined") return;
    const vis = () => { if (document.visibilityState === "visible") cb.current(); };
    document.addEventListener("visibilitychange", vis);
    let handle: { remove?: () => unknown } | null = null;
    let gone = false;
    const app = (typeof window !== "undefined" ? (window as unknown as { Capacitor?: { Plugins?: { App?: { addListener?: (e: string, f: () => void) => unknown } } } }).Capacitor?.Plugins?.App : undefined);
    if (app && typeof app.addListener === "function") {
      try {
        const h = app.addListener("resume", () => cb.current());
        void Promise.resolve(h).then((x) => { const hh = x as { remove?: () => unknown }; if (gone) { try { hh?.remove?.(); } catch { /* ignore */ } } else handle = hh; }).catch(() => {});
      } catch { /* no App plugin */ }
    }
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", vis);
      try { handle?.remove?.(); } catch { /* ignore */ }
    };
  }, [on]);
}
