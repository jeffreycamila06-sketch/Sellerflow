// Audit Oct 13 item 2 — Auto Mode comments that arrive while the session board is
// (re)loading are HELD here instead of dropped, then replayed in arrival order
// through the SAME auto handler once the board is ready (so dedup, sold-out,
// codes-ready and platform checks all still apply at replay time). In memory
// only; capped; one entry per comment key.

export const DEFERRED_AUTO_CAP = 200;

export interface DeferredAutoQueue<T> {
  /** false = not held (already queued, or the queue is full). */
  push: (key: string, item: T) => boolean;
  /** Everything held, in arrival order; the queue is emptied. */
  take: () => T[];
  clear: () => void;
  size: () => number;
}

export function createDeferredAutoQueue<T>(cap = DEFERRED_AUTO_CAP): DeferredAutoQueue<T> {
  let held = new Map<string, T>();
  return {
    push: (key, item) => {
      if (!key || held.has(key) || held.size >= cap) return false;
      held.set(key, item);
      return true;
    },
    take: () => { const out = Array.from(held.values()); held = new Map(); return out; },
    clear: () => { held = new Map(); },
    size: () => held.size,
  };
}
