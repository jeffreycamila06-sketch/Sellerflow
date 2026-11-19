// "Choose price before print" — the pop-up shown before a 1-Click / pinned-comment print.
// Phone (< 720px): a bottom sheet, big buttons 3 per row, safe-area padding. Wider: a centered
// dialog (CSS only — redesign.css .sfl-cpp-*). No timer: it waits for the seller.
// Tap a price → onPick(price). "Type price" → onType (hidden when there is no feed row to type
// into). "Skip" → onSkip. Portaled into the [data-redesign] root so the tokens resolve.
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { fmtMoney } from "../../lib/money";
import type { PriceChoiceItem } from "../adapters/priceChoiceQueue";

const priceBtn = (isDefault: boolean): CSSProperties => ({
  minHeight: 58, borderRadius: 14, fontFamily: "var(--font-mono)", fontSize: 19, fontWeight: 800, cursor: "pointer",
  border: isDefault ? "2px solid var(--accent)" : "1.5px solid var(--border-strong)",
  background: isDefault ? "var(--accent)" : "var(--surface-2)",
  color: isDefault ? "var(--accent-text)" : "var(--text)",
  padding: "8px 4px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  touchAction: "manipulation",
});
const sideBtn: CSSProperties = {
  flex: 1, minHeight: 50, borderRadius: 14, fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, cursor: "pointer",
  border: "1.5px solid var(--border-strong)", background: "transparent", color: "var(--text)", touchAction: "manipulation",
};

export default function ChoosePriceSheet({ item, prices, cur, waiting, onPick, onType, onSkip }: {
  item: PriceChoiceItem;
  prices: number[];           // first = default
  cur: string;
  waiting: number;            // how many more are queued after this one
  onPick: (price: number) => void;
  onType?: () => void;        // absent → no "Type price" button
  onSkip: () => void;
}) {
  const t = useT();
  if (typeof document === "undefined") return null;
  const who = item.name || item.handle;
  const node = (
    <div className="sfl-cpp-backdrop" data-testid="cpp-backdrop">
      <div className="sfl-cpp-sheet" role="dialog" aria-modal="true" aria-label={t.rd_cpp_pop_title} data-testid="cpp-sheet">
        <div className="sfl-cpp-grip" aria-hidden="true" />
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>{t.rd_cpp_pop_title}</div>
        <div data-testid="cpp-name" style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", lineHeight: 1.3, overflowWrap: "anywhere" }}>
          {who}{item.handle && item.handle !== who ? <span style={{ fontWeight: 600, color: "var(--text-muted)", fontSize: 14 }}> @{item.handle.replace(/^@/, "")}</span> : null}
        </div>
        <div data-testid="cpp-comment" style={{ marginTop: 6, marginBottom: 14, fontSize: 15, color: "var(--text-dim)", lineHeight: 1.4, background: "var(--surface-2)", borderRadius: 12, padding: "10px 12px", overflowWrap: "anywhere", maxHeight: 96, overflowY: "auto" }}>
          {item.comment || "—"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
          {prices.map((p, i) => (
            <button key={p} type="button" onClick={() => onPick(p)} data-testid={`cpp-price-${i}`} data-default={i === 0 ? "1" : undefined}
              aria-label={`${cur}${fmtMoney(p)}${i === 0 ? ` · ${t.rd_cpp_default}` : ""}`} style={priceBtn(i === 0)}>
              {cur}{fmtMoney(p)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          {onType && <button type="button" onClick={onType} data-testid="cpp-type" style={sideBtn}>{t.rd_dash_enterprise}</button>}
          <button type="button" onClick={onSkip} data-testid="cpp-skip" style={{ ...sideBtn, color: "var(--text-muted)" }}>{t.rd_cpp_skip}</button>
        </div>
        {waiting > 0 && (
          <div data-testid="cpp-waiting" style={{ marginTop: 12, textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--accent-fg)" }}>
            {tpl(t.rd_cpp_waiting, { n: waiting })}
          </div>
        )}
      </div>
    </div>
  );
  return createPortal(node, document.querySelector("[data-redesign]") || document.body);
}
