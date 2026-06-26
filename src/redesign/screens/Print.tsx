// Screen 11 — Print. REAL, matching App.tsx PrintPage (1932-1975): lists the
// current live-session buyers with a per-buyer print + "Print all", routed through
// the SAME native bridge (printing.ts printSlip — byte-parity with App.tsx).
// ⚠️ NATIVE-ONLY: on web/preview there's no SellerFlowPrinter bridge, so printSlip
// is a no-op (returns {ok:false,via:"none"}) — real printing only happens in the APK.
import { useState, type CSSProperties } from "react";
import { mono } from "../ui";
import { fmt } from "../data";
import { printSlip, type Settings } from "../adapters/printing";
import type { Buyer } from "../../lib/orderTypes";

const statCard: CSSProperties = { flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: "11px 12px", boxShadow: "var(--shadow)" };

export default function Print({ onBack, cur, buyers = [], storeName = "SellerFlowLive", settings }: {
  onBack: () => void;
  cur: string;
  buyers?: Buyer[];
  storeName?: string;
  settings?: Settings;
}) {
  const [note, setNote] = useState("");
  const totalOrders = buyers.reduce((s, b) => s + b.totalOrders, 0);
  const totalRev = buyers.reduce((s, b) => s + b.totalSpent, 0);
  const doPrint = (b: Buyer) => {
    if (!settings) return;
    const r = printSlip(b, cur, storeName, settings);             // native; no-op on web/preview
    setNote(r.ok ? `Sent to printer (${r.via}).` : "Printing runs in the SellerFlow app — open it on your phone to print.");
  };
  const printAll = () => { buyers.forEach((b) => settings && printSlip(b, cur, storeName, settings)); setNote(buyers.length ? "Printing runs in the SellerFlow app — open it on your phone to print." : ""); };

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onBack} style={{ background: "rgba(255,255,255,.18)", border: "none", width: 32, height: 32, borderRadius: 9, color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>‹</button>
        <div style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, letterSpacing: "-.01em" }}>Print</div>
        {buyers.length > 0 && <button onClick={printAll} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>🖨 Print all ({buyers.length})</button>}
      </div>
      <div style={{ padding: "16px 14px 22px" }}>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <div style={statCard}><div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Buyers</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 19, color: "var(--accent-fg)", marginTop: 3 }}>{buyers.length}</div></div>
          <div style={statCard}><div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Orders</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 19, color: "var(--text)", marginTop: 3 }}>{totalOrders}</div></div>
          <div style={statCard}><div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Revenue</div><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 19, color: "var(--ok)", marginTop: 3 }}>{cur}{fmt(totalRev)}</div></div>
        </div>

        {note && <div style={{ fontSize: 12, color: "var(--text-dim)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", marginBottom: 12 }}>{note}</div>}

        {buyers.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>No buyers to print yet.</div>}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 15, boxShadow: "var(--shadow)", overflow: "hidden", display: buyers.length ? "block" : "none" }}>
          {buyers.map((b) => (
            <div key={`${b.handle}-${b.platform}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 14px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: "var(--text-muted)", width: 26 }}>#{b.num}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{b.totalOrders} orders · {cur}{fmt(b.totalSpent)} · {b.platform}</div>
              </div>
              <button onClick={() => doPrint(b)} style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "7px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>🖨 Print</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
