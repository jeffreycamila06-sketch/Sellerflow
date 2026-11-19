// "Choose price before print" — the pop-up shown before a 1-Click / pinned-comment print.
// Phone (< 720px): a bottom sheet, big buttons 3 per row, safe-area padding. Wider: a centered
// dialog (CSS only — redesign.css .sfl-cpp-*). No timer: it waits for the seller.
//
//   pick  — tap a price → onPick(price). "Type price" → the type view. "Skip" → onSkip.
//   type  — a price field + "Print" + "Back" (the iPhone number pad has no return key, so the
//           Print button is the way to send it). Same number rules as the per-comment Type price.
//   ask   — the code went sold out while the comment waited: "Print anyway" / "Skip".
//
// onPick answers what happened: "blocked" (orders paused — nothing created) keeps the sheet open
// with `blockedText`; { soldOut } opens the ask view; anything else → the parent removes the item.
//
// TAP-THROUGH GUARD: the sheet is mounted fresh for every waiting comment (key = the item), so a
// second fast tap on the same spot would land on the NEXT comment's button. Every action is
// ignored for TAP_GUARD_MS after the sheet appears.
// Portaled into the [data-redesign] root so the tokens resolve.
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useT, tpl } from "../i18n";
import { fmtMoney, hasCents, priceInput } from "../../lib/money";
import { TAP_GUARD_MS, priceLabelSize, type PickResult, type PriceChoiceItem } from "../adapters/priceChoiceQueue";

// The clock, read only inside tap handlers and the mount effect (never while rendering).
const nowMs = (): number => Date.now();

const priceBtn = (isDefault: boolean, label: string): CSSProperties => ({
  minHeight: 58, borderRadius: 14, fontFamily: "var(--font-mono)", fontSize: priceLabelSize(label), fontWeight: 800, cursor: "pointer",
  border: isDefault ? "2px solid var(--accent)" : "1.5px solid var(--border-strong)",
  background: isDefault ? "var(--accent)" : "var(--surface-2)",
  color: isDefault ? "var(--accent-text)" : "var(--text)",
  padding: "8px 2px", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap",
  touchAction: "manipulation",
});
const sideBtn: CSSProperties = {
  flex: 1, minHeight: 50, borderRadius: 14, fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, cursor: "pointer",
  border: "1.5px solid var(--border-strong)", background: "transparent", color: "var(--text)", touchAction: "manipulation",
};
const mainBtn = (off: boolean): CSSProperties => ({
  ...sideBtn, border: "2px solid var(--accent)", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 800,
  opacity: off ? 0.45 : 1, cursor: off ? "not-allowed" : "pointer",
});

export default function ChoosePriceSheet({ item, prices, cur, waiting, onPick, onSkip, blockedText }: {
  item: PriceChoiceItem;
  prices: number[];           // first = default
  cur: string;
  waiting: number;            // how many more are queued after this one
  onPick: (price: number, soldOutOk?: boolean) => PickResult;
  onSkip: () => void;
  blockedText: string;        // shown when a tap could not make the order (orders paused)
}) {
  const t = useT();
  const [mode, setMode] = useState<"pick" | "type">("pick");
  const [typed, setTyped] = useState("");
  const [ask, setAsk] = useState<{ price: number; code: string } | null>(null);
  const [blocked, setBlocked] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const armAt = useRef(Number.POSITIVE_INFINITY);   // not armed until the sheet has really appeared

  useEffect(() => {
    armAt.current = nowMs() + TAP_GUARD_MS;
    sheetRef.current?.focus();                       // the sheet itself — never a price button
    // The page behind must not scroll while the sheet is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // iPhone: the keyboard is drawn OVER the bottom of the page, so a bottom sheet's Print button
  // would sit under it. Lift the sheet by the part of the page the keyboard covers (0 where the
  // page itself shrinks, e.g. Android).
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const back = sheetRef.current?.parentElement;
    if (!vv || !back) return;
    const fit = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      back.style.setProperty("padding-bottom", covered > 0 ? `${covered}px` : "");
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); };
  }, []);

  // A view change removes the button that was tapped — keep the focus inside the sheet (Tab trap).
  useEffect(() => {
    const root = sheetRef.current;
    if (root && !root.contains(document.activeElement)) root.focus();
  }, [mode, ask]);

  const armed = () => nowMs() >= armAt.current;
  const send = (price: number, soldOutOk = false) => {
    const r = onPick(price, soldOutOk);
    if (r === "blocked") { setBlocked(true); return; }
    if (typeof r === "object") { setAsk({ price, code: r.soldOut }); setBlocked(false); }
  };
  const typedPrice = Number(typed || "0") || 0;      // same rule as the per-comment Type price: must be > 0
  const printTyped = () => { if (armed() && typedPrice > 0) send(typedPrice); };

  // Tab stays inside the sheet.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const root = sheetRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
    if (els.length === 0) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1];
    const cur0 = document.activeElement;
    if (e.shiftKey && (cur0 === first || cur0 === root)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (cur0 === last || cur0 === root || !root.contains(cur0))) { e.preventDefault(); first.focus(); }
  };

  if (typeof document === "undefined") return null;
  const who = item.name || item.handle;
  const node = (
    <div className="sfl-cpp-backdrop" data-testid="cpp-backdrop">
      <div ref={sheetRef} tabIndex={-1} onKeyDown={onKeyDown} className="sfl-cpp-sheet" role="dialog" aria-modal="true" aria-label={t.rd_cpp_pop_title} data-testid="cpp-sheet" data-mode={ask ? "ask" : mode}>
        <div className="sfl-cpp-grip" aria-hidden="true" />
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>{t.rd_cpp_pop_title}</div>
        <div data-testid="cpp-name" style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", lineHeight: 1.3, overflowWrap: "anywhere" }}>
          {who}{item.handle && item.handle !== who ? <span style={{ fontWeight: 600, color: "var(--text-muted)", fontSize: 14 }}> @{item.handle.replace(/^@/, "")}</span> : null}
        </div>
        <div data-testid="cpp-comment" style={{ marginTop: 6, marginBottom: 14, fontSize: 15, color: "var(--text-dim)", lineHeight: 1.4, background: "var(--surface-2)", borderRadius: 12, padding: "10px 12px", overflowWrap: "anywhere", maxHeight: 96, overflowY: "auto" }}>
          {item.comment || "—"}
        </div>

        {ask ? (
          <>
            <div data-testid="cpp-soldout" role="alert" style={{ fontSize: 15, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4, marginBottom: 12 }}>{tpl(t.rd_cpp_soldout_q, { code: ask.code })}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => { if (armed()) send(ask.price, true); }} data-testid="cpp-soldout-yes" style={mainBtn(false)}>{t.rd_cpp_soldout_yes}</button>
              <button type="button" onClick={() => { if (armed()) onSkip(); }} data-testid="cpp-skip" style={{ ...sideBtn, color: "var(--text-muted)" }}>{t.rd_cpp_skip}</button>
            </div>
          </>
        ) : mode === "type" ? (
          <>
            <div className="sfl-lsm-field" style={{ marginBottom: 12 }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: 16 }}>{cur}</span>
              <input autoFocus inputMode={hasCents(cur) ? "decimal" : "numeric"} autoComplete="off" value={typed} placeholder={t.rd_smp_placeholder} aria-label={t.rd_dash_enterprise}
                onChange={(e) => { setTyped(priceInput(e.target.value, cur)); setBlocked(false); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); printTyped(); } }}
                data-testid="cpp-type-input"
                style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 700, color: "var(--text)", outline: "none", padding: 0 }} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" onClick={() => { setMode("pick"); setBlocked(false); }} data-testid="cpp-type-back" style={{ ...sideBtn, flex: "0 0 34%" }}>{t.rd_sp_back}</button>
              <button type="button" onClick={printTyped} disabled={typedPrice <= 0} data-testid="cpp-type-print" style={mainBtn(typedPrice <= 0)}>{t.rd_cpp_print}</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
              {prices.map((p, i) => {
                const label = `${cur}${fmtMoney(p)}`;
                return (
                  <button key={p} type="button" onClick={() => { if (armed()) send(p); }} data-testid={`cpp-price-${i}`} data-default={i === 0 ? "1" : undefined}
                    aria-label={`${label}${i === 0 ? ` · ${t.rd_cpp_default}` : ""}`} style={priceBtn(i === 0, label)}>
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button type="button" onClick={() => { if (armed()) { setMode("type"); setTyped(""); setBlocked(false); } }} data-testid="cpp-type" style={sideBtn}>{t.rd_dash_enterprise}</button>
              <button type="button" onClick={() => { if (armed()) onSkip(); }} data-testid="cpp-skip" style={{ ...sideBtn, color: "var(--text-muted)" }}>{t.rd_cpp_skip}</button>
            </div>
          </>
        )}

        {blocked && <div data-testid="cpp-blocked" role="alert" style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: "var(--danger)", lineHeight: 1.4, textAlign: "center" }}>{blockedText}</div>}
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
