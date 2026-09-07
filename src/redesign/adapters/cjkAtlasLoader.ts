// CJK glyph-atlas loader — the ONLY reference to glyphAtlas.cjk.ts, and a
// DYNAMIC one, so vite code-splits the ~2.9MB atlas out of the main chunk
// (thin-shell cold opens re-download the main bundle; the atlas ships as its
// own cached chunk instead). Contract:
//   - prefetchCjkAtlas() fires at app start (RedesignApp mount effect) so the
//     chunk is normally resident long before the first print.
//   - loadCjkAtlas() is the SAME promise a CJK print awaits — a print that
//     races the prefetch simply waits for it; it can never paint blank because
//     the chunk was still in flight.
//   - A FAILED load (offline cold open) clears the in-flight slot, so the next
//     call retries the import; the print path falls back to the Classic TEXT
//     render for that one sticker (visible route notice) rather than tofu.
//   - ASCII/Latin prints never touch any of this (payloadNeedsCjk gate).
import type { GlyphAtlas } from "./stickerRaster";

let loaded: GlyphAtlas | null = null;
let inflight: Promise<GlyphAtlas> | null = null;

export function loadCjkAtlas(): Promise<GlyphAtlas> {
  if (loaded) return Promise.resolve(loaded);
  if (!inflight) {
    inflight = import("./glyphAtlas.cjk").then(
      (m) => { loaded = m.CJK_ATLAS; return loaded; },
      (err) => { inflight = null; throw err; }, // retry-able on the next call
    );
  }
  return inflight;
}

// Synchronous read for callers that only want the atlas if it's already here.
export const getCjkAtlasSync = (): GlyphAtlas | null => loaded;

// Fire-and-forget warm-up; a failure here is silent (the print path retries).
export function prefetchCjkAtlas(): void {
  void loadCjkAtlas().catch(() => { /* offline cold open — print path retries */ });
}
