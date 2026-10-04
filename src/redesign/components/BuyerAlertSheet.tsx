// BUYER ALERT sheet (Phase 1) — opened by tapping a buyer's name on a Dashboard comment row
// (gated sellers only). Counts: Returned (after forgive) / Nasa 7-11 / Nakuha (7 days), then
// the returned parcels, each with Forgive / Undo. A forgiven return is not counted.
// No phone numbers, no recipient names (the RPC never returns them).
import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { isForgiven, taipeiDate, type BuyerRecord } from "../adapters/buyerAlert";

const stat: CSSProperties = { flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 8px", textAlign: "center" };
const statN: CSSProperties = { fontSize: 20, fontWeight: 800, color: "var(--text)", fontFamily: "var(--font-display)" };
const statL: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", marginTop: 2 };

export default function BuyerAlertSheet({
  handle, record, overrides, cur, onForgive, onClose,
}: {
  handle: string;
  record: BuyerRecord;
  overrides: Record<string, boolean>;
  cur: string;
  onForgive: (id: string, on: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const returns = record.returned.filter((r) => !isForgiven(r, overrides)).length;
  const toggle = async (id: string, on: boolean) => {
    setBusy(id); setFailed(false);
    const ok = await onForgive(id, on);
    setBusy(null); if (!ok) setFailed(true);
  };
  const node = (
    <div onClick={onClose} data-testid="ba-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="ba-sheet" role="dialog" aria-label={t.rd_ba_tap_title}
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "10px 14px calc(18px + env(safe-area-inset-bottom))", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 2px 12px" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>@{handle}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_ba_tap_title}</span>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_ba_close}</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div style={stat} data-testid="ba-returned"><div style={{ ...statN, color: returns ? "var(--danger)" : statN.color }}>{returns}</div><div style={statL}>{t.rd_ba_returned}</div></div>
          <div style={stat} data-testid="ba-at-store"><div style={statN}>{record.atStore}</div><div style={statL}>{t.rd_ba_at_store}</div></div>
          <div style={stat} data-testid="ba-picked-up"><div style={statN}>{record.pickedUp}</div><div style={statL}>{t.rd_ba_picked_up}</div></div>
        </div>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".04em", color: "var(--text-muted)", margin: "0 2px 8px" }}>{t.rd_ba_returns_list}</div>
        {record.returned.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "6px 2px" }}>{t.rd_ba_no_returns}</div>}
        {record.returned.map((r) => {
          const fg = isForgiven(r, overrides);
          return (
            <div key={r.id} data-testid="ba-return" data-forgiven={fg} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 8, opacity: fg ? 0.6 : 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: fg ? "line-through" : "none" }}>{r.store || "7-11"}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  {r.returnedAt ? taipeiDate(Date.parse(r.returnedAt)) : "—"}{r.amount != null ? ` · ${cur}${r.amount}` : ""}{fg ? ` · ${t.rd_ba_forgiven}` : ""}
                </div>
              </div>
              <button onClick={() => void toggle(r.id, !fg)} disabled={busy === r.id} data-testid={fg ? "ba-undo" : "ba-forgive"}
                style={{ fontSize: 11, fontWeight: 800, padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0, opacity: busy === r.id ? 0.6 : 1,
                  ...(fg ? { background: "transparent", color: "var(--text)", border: "1.3px solid var(--border-strong)" } : { background: "var(--accent)", color: "var(--accent-text)", border: "none" }) }}>
                {fg ? t.rd_ba_undo : t.rd_ba_forgive}
              </button>
            </div>
          );
        })}
        {failed && <div role="alert" style={{ fontSize: 12, color: "var(--danger)", padding: "4px 2px" }}>{t.rd_ba_save_failed}</div>}
      </div>
    </div>
  );
  // Into the [data-redesign] root (LiveSourceSheet pattern) — the theme tokens live there.
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
