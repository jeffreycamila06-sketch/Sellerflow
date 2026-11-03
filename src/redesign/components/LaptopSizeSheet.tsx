// "Choose your sticker size" — round 4 (item 5). A laptop (no native printer) keeps printing the OLD laptop page
// until a sticker size is chosen here (printing.ts laptopSizeChosen). The sheet is shown ONCE: after the first
// laptop print (the order is already queued when it appears — it never delays or blocks a print) or when Printer
// settings opens on a laptop. Size list + the live preview (the bitmap the new page prints) + Test print.
// "Use this size" = chosen → the new bitmap page from the next print; "Later" / tap outside = dismissed for good
// (the Printer settings size picker chooses too).
import { type CSSProperties, useEffect, useRef } from "react";
import { useT } from "../i18n";
import ExactStickerPreview from "./ExactStickerPreview";
import { printLaptopTestSticker, type Settings } from "../adapters/printing";
import { buildTestBuyer } from "../adapters/printerBridge";
import { LAPTOP_SIZES, sizeKeyOf, isTypingTarget } from "../adapters/laptopSize";

export default function LaptopSizeSheet({ psSize, onPick, settings, cur, storeName, onChoose, onLater }: {
  psSize: string; onPick: (s: string) => void;
  settings: Settings; cur: string; storeName: string;
  onChoose: () => void; onLater: () => void;
}) {
  const t = useT() as unknown as Record<string, string>;
  const preview: Settings = { ...settings, stickerSize: sizeKeyOf(psSize) };
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Round 5 (item 4): Escape = Later; focus moves into the sheet and returns to where it was after — unless a typing
  // field had it (a live in progress): then focus is left alone.
  const onLaterRef = useRef(onLater);
  useEffect(() => { onLaterRef.current = onLater; }, [onLater]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onLaterRef.current(); } };
    window.addEventListener("keydown", onKey);
    const prev = document.activeElement as HTMLElement | null;
    const moved = !isTypingTarget(prev);
    if (moved) boxRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      if (moved && prev && prev.isConnected && typeof prev.focus === "function") prev.focus();
    };
  }, []);
  const overlay: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" };
  const sheet: CSSProperties = { width: "100%", maxWidth: 520, maxHeight: "92vh", overflowY: "auto", background: "var(--surface)", borderRadius: "20px 20px 0 0", padding: "18px 18px 16px", boxShadow: "0 -12px 40px rgba(9,7,24,.35)", fontFamily: "var(--font-ui)" };
  const btn: CSSProperties = { padding: "12px 0", borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 46 };
  return (
    <div style={overlay} role="dialog" aria-label={t.rd_ps_lsize_title} data-testid="laptop-size-sheet" onClick={onLater}>
      <div ref={boxRef} tabIndex={-1} data-testid="laptop-size-box" style={{ ...sheet, outline: "none" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{t.rd_ps_lsize_title}</div>
        <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "6px 0 12px", lineHeight: 1.5 }}>{t.rd_ps_lsize_intro}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }} data-testid="laptop-size-list">
          {LAPTOP_SIZES.map((z) => {
            const on = z === psSize;
            return (
              <button key={z} type="button" onClick={() => onPick(z)} aria-pressed={on} data-testid={`laptop-size-${sizeKeyOf(z)}`}
                style={{ padding: "9px 13px", borderRadius: 999, border: `1.5px solid ${on ? "var(--accent)" : "var(--border-strong)"}`, background: on ? "var(--accent-softer)" : "var(--surface-2)", color: "var(--text)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 40 }}>
                {z.replace(/\s*\(.*\)$/, "")}
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 12 }}>
          <ExactStickerPreview settings={preview} cur={cur} shopName={storeName} path="browser" browser />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginTop: 14 }}>
          <button type="button" data-testid="laptop-size-test" onClick={() => printLaptopTestSticker(buildTestBuyer(), cur, storeName, preview)} style={btn}>{t.rd_ps_test_print}</button>
          <button type="button" data-testid="laptop-size-use" onClick={onChoose} style={{ ...btn, border: "none", background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 4px 14px var(--accent-soft)" }}>{t.rd_ps_lsize_use}</button>
        </div>
        <button type="button" data-testid="laptop-size-later" onClick={onLater} style={{ width: "100%", marginTop: 8, padding: "10px 0", border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_ps_lsize_later}</button>
      </div>
    </div>
  );
}
