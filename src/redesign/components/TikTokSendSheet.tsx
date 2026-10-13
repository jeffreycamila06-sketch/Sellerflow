// "Send to TikTok" sheet (admin-only preview). Copy a ready message, open the buyer's TikTok
// profile (the SAME chaseTarget rule as Pickup Status Chase), then Message → Paste → Send in
// TikTok. Every edit here is message-only and is discarded on close — nothing is written to
// orders, live_session_orders, products or Sales. Only the note is remembered (per seller).
import { useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { chaseTarget } from "../adapters/parcelTracking";
import { isIOS } from "../adapters/platform";
import { copyText } from "./inviteShare";
import {
  initialSendLines, sumLines, messageTotal, buildSendMessage, loadSendNote, saveSendNote, type SendLine,
} from "../adapters/tiktokSend";
import type { BuyerReceipt } from "../adapters/useReadData";

const label: CSSProperties = { display: "block", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--text-muted)", margin: "12px 2px 6px" };
const input: CSSProperties = { boxSizing: "border-box", padding: "9px 10px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-ui)" };
const smallBtn: CSSProperties = { width: 40, height: 40, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text-muted)", fontSize: 18, lineHeight: 1, cursor: "pointer", fontFamily: "var(--font-ui)" };
const bigBtn: CSSProperties = { display: "block", boxSizing: "border-box", width: "100%", marginTop: 10, padding: "12px 0", borderRadius: 12, fontSize: 14, fontWeight: 800, textAlign: "center", textDecoration: "none", cursor: "pointer", fontFamily: "var(--font-ui)" };

export default function TikTokSendSheet({ receipt, cur, date, sellerId, onClose }: {
  receipt: BuyerReceipt; cur: string; date: string; sellerId: string; onClose: () => void;
}) {
  const t = useT();
  const [lines, setLines] = useState<SendLine[]>(() => initialSendLines(receipt.lines));
  const [totalOverride, setTotalOverride] = useState<string | null>(null);
  const [note, setNote] = useState(() => loadSendNote(sellerId));
  const [status, setStatus] = useState("");
  const nextId = useRef(0);
  const ios = isIOS();
  const target = chaseTarget(receipt.handle);

  const sum = sumLines(lines);
  const total = messageTotal(lines, totalOverride);
  const message = buildSendMessage({
    name: receipt.name, date, lines, total, cur, note,
    labels: { hi: t.rd_tts_msg_hi, order: t.rd_tts_msg_order, total: t.rd_tts_msg_total },
  });

  const setLine = (key: string, patch: Partial<SendLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));
  const addLine = () => { const key = `a${nextId.current++}`; setLines((ls) => [...ls, { key, text: "", price: "", added: true }]); };

  const copy = async (): Promise<boolean> => {
    saveSendNote(sellerId, note);
    return copyText(message);
  };
  // Copy, then the anchor's own navigation opens the profile (a real <a> tap — the only open
  // that works inside the iOS app). On iOS the clipboard keeps the MESSAGE (no @handle copy).
  const onCopyOpen = () => { void copy().then((ok) => setStatus(ok ? t.rd_tts_copied_open : t.rd_tts_copy_failed)); };
  const onCopyOnly = (lang: "only" | "find") => {
    void copy().then((ok) => setStatus(!ok ? t.rd_tts_copy_failed : lang === "find" ? t.rd_tts_copy_find : t.rd_tts_copied));
  };

  const node = (
    <div onClick={onClose} data-testid="tts-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t.rd_tts_title} data-testid="tts-sheet"
        style={{ background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, width: "100%", maxWidth: 560, margin: "0 auto", boxSizing: "border-box", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "10px 14px 6px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{t.rd_tts_title}</span>
            <button type="button" data-testid="tts-close" onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_rc_close}</button>
          </div>
          <div data-testid="tts-header" style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>
            <b style={{ fontFamily: "var(--font-mono)" }}>#{receipt.num}</b> {receipt.name} <span style={{ color: "var(--handle)" }}>{receipt.handle}</span>
          </div>
          {ios && target.kind !== "none" && (
            <div data-testid="tts-handle-big" style={{ marginTop: 8, fontSize: 22, fontWeight: 800, color: "var(--text)", userSelect: "text", WebkitUserSelect: "text", overflowWrap: "anywhere" }}>@{target.handle}</div>
          )}
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "4px 2px 0" }}>{t.rd_tts_hint}</div>

          <span style={label}>{t.rd_rc_lines}</span>
          {lines.map((l, i) => (
            <div key={l.key} data-testid={l.added ? "tts-line-added" : "tts-line"} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, minHeight: 40, padding: l.added ? 4 : 0, borderRadius: 10, background: l.added ? "var(--accent-soft)" : "transparent" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", width: 24, textAlign: "right", flexShrink: 0 }}>{i + 1}.</span>
              {l.added
                ? <input data-testid="tts-text" aria-label={t.rd_rc_item_ph} placeholder={t.rd_rc_item_ph} value={l.text} onChange={(e) => setLine(l.key, { text: e.target.value })} style={{ ...input, flex: 1, minWidth: 0 }} />
                : <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-dim)", overflowWrap: "anywhere" }}>{l.text}</span>}
              <input data-testid="tts-price" aria-label={t.rd_rc_price_ph} inputMode="decimal" value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value.replace(/[^0-9.]/g, "") })} style={{ ...input, width: 96, textAlign: "right" }} />
              <button type="button" data-testid="tts-remove" aria-label={t.rd_rs_remove_line} title={t.rd_rs_remove_line} onClick={() => removeLine(l.key)} style={smallBtn}>×</button>
            </div>
          ))}
          <button type="button" data-testid="tts-add" onClick={addLine}
            style={{ marginTop: 2, minHeight: 40, padding: "0 14px", border: "1px dashed var(--border-strong)", borderRadius: 10, background: "transparent", color: "var(--accent-fg)", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
            + {t.rd_tts_add}
          </button>

          <span style={label}>{t.rd_ord_receipt_total}{totalOverride !== null && totalOverride.trim() !== "" && <span data-testid="tts-edited" style={{ marginLeft: 6, fontWeight: 600, letterSpacing: 0, color: "var(--warn)" }}>{t.rd_tts_edited}</span>}</span>
          <input data-testid="tts-total" inputMode="decimal" value={totalOverride ?? String(sum)}
            onChange={(e) => setTotalOverride(e.target.value.replace(/[^0-9.]/g, ""))} style={{ ...input, width: 140, textAlign: "right" }} />

          <span style={label}>{t.rd_tts_note}</span>
          <textarea data-testid="tts-note" value={note} maxLength={500} placeholder={t.rd_tts_note_ph} onChange={(e) => setNote(e.target.value)} style={{ ...input, width: "100%", minHeight: 64, resize: "vertical" }} />

          <span style={label}>{t.rd_tts_preview}</span>
          <pre data-testid="tts-preview" style={{ margin: 0, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "var(--font-ui)" }}>{message}</pre>
        </div>

        <div style={{ flex: "0 0 auto", padding: "0 14px calc(18px + env(safe-area-inset-bottom))" }}>
          {target.kind === "open"
            ? <a href={target.url} target="_blank" rel="noreferrer" data-testid="tts-copy-open" onClick={onCopyOpen}
                style={{ ...bigBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)" }}>{t.rd_tts_copy_open}</a>
            : <button type="button" data-testid="tts-copy-find" onClick={() => onCopyOnly("find")}
                style={{ ...bigBtn, border: "none", background: "var(--accent)", color: "var(--accent-text)" }}>{t.rd_tts_copy_find_btn}</button>}
          <button type="button" data-testid="tts-copy-only" onClick={() => onCopyOnly("only")}
            style={{ ...bigBtn, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)" }}>{t.rd_tts_copy_only}</button>
          {status && <div role="status" data-testid="tts-status" style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: "var(--ok)", lineHeight: 1.45 }}>{status}</div>}
        </div>
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
