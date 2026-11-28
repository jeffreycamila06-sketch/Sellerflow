// BASKET LIST (paid plans, Jeff 2026-11-28, option C) — tap the 🛒N badge on a Live comment →
// this buyer's orders of the session: item, price (or Free), time, Reprint, Cancel (+ Undo).
// The list just scrolls — no "See all", no tab switch. Drawn in a portal into [data-redesign]
// (inside the Live screen it would sit under the bottom nav).
//   • Reprint = the parent's onReprintOrder (the Orders tab's zero-write path).
//   • Cancel / Undo = the parent's orderCancelUi (the Orders tab's calls), with the same question
//     inside the sheet. Absent → no Cancel button.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Order } from "../data";
import { useT, tpl } from "../i18n";
import { useScreenTimers } from "../adapters/useScreenTimers";
import { isFreeOrder } from "../../lib/freeOrder";
import { fbNameOnly } from "../adapters/fbName";
import type { CancelCheck, CancelResult, UndoResult } from "../adapters/orderCancel";

export interface BasketCancelUi {
  onCheck: (o: Order) => Promise<CancelCheck>;
  onCancel: (o: Order) => Promise<CancelResult>;
  onUndo: (o: Order) => Promise<UndoResult>;
}

const WIDE_AT = 900;
const REPRINT_REST_MS = 2000;
const mono = "var(--font-mono)";
const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString() : "0");

function useWide(): boolean {
  const read = () => (typeof window !== "undefined" ? window.innerWidth >= WIDE_AT : false);
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const on = () => setWide(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

export function BasketSheet({ orders, handle, cur, onClose, onReprint, cancel, hidden = false }: {
  orders: Order[];            // this buyer's orders, oldest first (cancelled ones included)
  handle: string;             // the comment's display handle ("@maria88")
  cur: string;
  onClose: () => void;
  onReprint?: (o: Order) => void;
  cancel?: BasketCancelUi;
  // A printer pop-up ("No printer connected" / "Bluetooth is off") is open on top: the sheet steps aside
  // (kept, not closed) so the pop-up can be seen and tapped; it comes back when the pop-up closes.
  hidden?: boolean;
}) {
  const t = useT();
  const later = useScreenTimers();
  const wide = useWide();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const [over, setOver] = useState<Map<string, boolean>>(() => new Map());
  const isCx = (o: Order) => (o.ref && over.has(o.ref) ? !!over.get(o.ref) : !!o.cancelled);
  const [ask, setAsk] = useState<{ o: Order; check: "loading" | CancelCheck } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [printing, setPrinting] = useState<string | null>(null);

  // Escape closes the question first, then the sheet (never while a call is on its way).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy || hidden) return;
      if (ask) setAsk(null); else onClose();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [ask, busy, hidden, onClose]);

  const newest = orders[orders.length - 1];
  const name = newest?.buyer || "";
  const platform = newest?.platform || "";
  const bNum = orders[0]?.id || "";
  const live = orders.filter((o) => !isCx(o));
  const cxN = orders.length - live.length;
  const total = live.reduce((s, o) => s + (Number(o.total) || 0), 0); // a Free order is always price 0
  const manyDays = new Set(orders.map((o) => o.date || "")).size > 1;
  const keyOf = (o: Order) => `${o.orderNum ?? o.ref ?? o.id}`;

  const reprint = (o: Order) => {
    if (!onReprint || printing) return;
    const key = keyOf(o);
    // The sheet cannot know whether the printer really printed (a missing printer shows its own pop-up),
    // so it never says "Printed" — "Printing…" for the 2 s rest, then Reprint again (the Orders tab's way).
    setPrinting(key);
    onReprint(o);
    later(() => setPrinting(null), REPRINT_REST_MS);
  };

  const setCx = (ref: string, on: boolean) => setOver((m) => { const n = new Map(m); n.set(ref, on); return n; });
  const openCx = (o: Order) => {
    if (!cancel || !o.ref || busy) return;
    setErr(""); setNote("");
    setAsk({ o, check: "loading" });
    void cancel.onCheck(o).then((c) => {
      if (!alive.current) return;
      if (c.result === "cancelled") { setCx(o.ref!, true); setAsk(null); return; }
      if (c.result === "not_found") setErr(t.rd_oc_not_ready);
      setAsk((curAsk) => (curAsk && curAsk.o.ref === o.ref ? { o, check: c } : curAsk));
    });
  };
  const confirmCx = async () => {
    const a = ask;
    if (!cancel || !a || !a.o.ref || busy) return;
    setBusy(a.o.ref); setErr("");
    const r = await cancel.onCancel(a.o);
    if (!alive.current) return;
    setBusy("");
    if (r === "cancelled" || r === "already") {
      setCx(a.o.ref, true);
      setAsk(null);
      setNote(tpl(t.rd_oc_done, { n: a.o.id }));
      return;
    }
    setErr(r === "not_found" ? t.rd_oc_not_ready : t.rd_oc_failed);
  };
  const undoCx = async (o: Order) => {
    if (!cancel || !o.ref || busy) return;
    setBusy(o.ref); setNote(""); setErr("");
    const r = await cancel.onUndo(o);
    if (!alive.current) return;
    setBusy("");
    if (r === "restored" || r === "not_cancelled") {
      setCx(o.ref, false);
      setNote(tpl(t.rd_oc_back, { n: o.id }));
      return;
    }
    setErr(t.rd_oc_undo_failed);
  };

  const priceOf = (o: Order) => (isFreeOrder({ price: o.total, item: o.items })
    ? <span data-testid="bk-free" style={{ fontSize: 14, fontWeight: 800, color: "var(--ok)" }}>{t.rd_cpp_free}</span>
    : <span style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: isCx(o) ? "var(--text-muted)" : "var(--text)", textDecoration: isCx(o) ? "line-through" : undefined }}>{cur}{fmt(o.total)}</span>);
  const timeOf = (o: Order) => (manyDays && o.date ? `${o.date.slice(5).replace("-", "/")} ${o.time}` : o.time);

  const smallBtn = { minHeight: 32, padding: "0 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 800, fontFamily: "var(--font-ui)", whiteSpace: "nowrap" as const, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4 };

  const head = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.3, overflowWrap: "anywhere" }}>
          <span style={{ fontFamily: mono, color: "var(--accent-fg)" }}>{bNum}</span> {name}
        </div>
        {!fbNameOnly(platform, name) && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--handle)", marginTop: 2, overflowWrap: "anywhere" }}>{handle.startsWith("@") ? handle : `@${handle}`}</div>}
        <div data-testid="bk-summary" style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4 }}>
          {live.length === 1 ? t.rd_bk_items_1 : tpl(t.rd_bk_items, { n: live.length })} · <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{cur}{fmt(total)}</span>
          {cxN > 0 && <span> · {tpl(t.rd_bk_cancelled_n, { n: cxN })}</span>}
        </div>
      </div>
      <button type="button" data-testid="bk-close" aria-label={t.rd_bk_close} disabled={!!busy} onClick={onClose} className="sfl-tap44"
        style={{ width: 34, height: 34, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 18, lineHeight: 1, cursor: "pointer", flexShrink: 0, fontFamily: "var(--font-ui)", padding: 0 }}>×</button>
    </div>
  );

  const list = (
    <div data-testid="bk-list" style={{ minHeight: 0, overflowY: "auto", marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      {orders.length === 0 && <div style={{ fontSize: 13, color: "var(--text-dim)", padding: "10px 2px" }}>{t.rd_bk_empty}</div>}
      {orders.map((o) => {
        const cx = isCx(o);
        const k = keyOf(o);
        return (
          <div key={k} data-testid="bk-line" data-cancelled={cx ? "1" : undefined} style={{ border: "1px solid var(--border)", borderRadius: 13, padding: "10px 12px", background: "var(--surface-2)", opacity: cx ? 0.85 : 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <div data-testid="bk-item" style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: cx ? "var(--text-muted)" : "var(--text)", textDecoration: cx ? "line-through" : undefined, overflowWrap: "anywhere" }}>{o.items}</div>
              <div style={{ flexShrink: 0 }}>{priceOf(o)}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span data-testid="bk-time" style={{ fontSize: 12, color: "var(--text-muted)", marginRight: "auto" }}>{timeOf(o)}</span>
              {cx && <span data-testid="bk-cx-chip" style={{ fontSize: 11, fontWeight: 800, color: "var(--danger)", border: "1px solid var(--danger)", padding: "3px 9px", borderRadius: 7 }}>{t.rd_oc_chip}</span>}
              {!cx && onReprint && o.orderNum != null && (
                <button type="button" data-testid="bk-reprint" className="sfl-tap44" disabled={!!printing} onClick={() => reprint(o)}
                  title={t.rd_dash_reprint_title}
                  style={{ ...smallBtn, color: "var(--ok)", background: "transparent", border: "1.5px solid var(--ok)", cursor: printing ? "default" : "pointer", opacity: printing && printing !== k ? 0.55 : 1 }}>
                  {printing === k ? t.rd_dash_reprinting : `↻ ${t.rd_dash_reprint}`}
                </button>
              )}
              {cancel && o.ref && (cx
                ? <button type="button" data-testid="bk-undo" className="sfl-tap44" disabled={!!busy} onClick={() => void undoCx(o)}
                    style={{ ...smallBtn, color: "var(--accent-fg)", background: "transparent", border: "1.5px solid var(--accent)", cursor: busy ? "default" : "pointer", opacity: busy && busy !== o.ref ? 0.55 : 1 }}>↺ {busy === o.ref ? t.rd_oc_busy : t.rd_oc_undo}</button>
                : <button type="button" data-testid="bk-cancel" className="sfl-tap44" disabled={!!busy} onClick={() => openCx(o)}
                    style={{ ...smallBtn, color: "#be123c", background: "transparent", border: "1.5px solid #be123c", cursor: busy ? "default" : "pointer" }}>{t.rd_bk_cancel}</button>)}
            </div>
          </div>
        );
      })}
    </div>
  );

  const question = ask && (
    <div data-testid="bk-cx-ask" style={{ minHeight: 0, overflowY: "auto", marginTop: 4 }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>{t.rd_oc_title}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 13, background: "var(--surface-2)" }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{ask.o.items}</div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 11, color: "var(--text-muted)" }}>{ask.o.id} · {ask.o.time}</div>
          {priceOf(ask.o)}
        </div>
      </div>
      <ul style={{ margin: "12px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.5, color: "var(--text-dim)" }}>
        <li>{t.rd_oc_l1}</li>
        <li>{tpl(t.rd_oc_l2, { n: ask.o.id })}</li>
        <li>{t.rd_oc_l3}</li>
        <li>{t.rd_oc_l4}</li>
      </ul>
      {ask.check !== "loading" && ask.check.sent && (
        <div data-testid="bk-cx-sent" role="note" style={{ marginTop: 10, padding: "9px 12px", borderRadius: 10, background: "#fef3c7", color: "#92400e", border: "1px solid #f59e0b", fontSize: 12.5, fontWeight: 700, lineHeight: 1.4 }}>⚠ {t.rd_oc_sent}</div>
      )}
    </div>
  );

  const host = (typeof document !== "undefined" && (document.querySelector("[data-redesign]") as HTMLElement)) || document.body;
  return createPortal(
    <div data-testid="bk-sheet" onClick={() => { if (busy) return; if (ask) setAsk(null); else onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(15,23,42,.45)", display: hidden ? "none" : "flex", alignItems: wide ? "center" : "flex-end", justifyContent: "center" }}>
      <div role="dialog" aria-modal="true" aria-label={ask ? t.rd_oc_title : `${bNum} ${name}`} data-testid="bk-panel" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: wide ? 460 : 520, boxSizing: "border-box", maxHeight: wide ? "80vh" : "85vh", display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: wide ? 18 : "20px 20px 0 0", padding: "14px 16px calc(16px + env(safe-area-inset-bottom))", boxShadow: "0 -10px 40px rgba(0,0,0,.25)", fontFamily: "var(--font-ui)" }}>
        {!wide && <div style={{ width: 40, height: 4, borderRadius: 99, background: "var(--border-strong)", margin: "0 auto 12px", flexShrink: 0 }} />}
        {ask ? question : <>{head}{list}</>}
        {note && !ask && <div role="status" data-testid="bk-note" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "var(--ok)", flexShrink: 0 }}>✓ {note}</div>}
        {err && <div role="alert" data-testid="bk-error" style={{ marginTop: 10, fontSize: 12.5, fontWeight: 700, color: "var(--danger)", flexShrink: 0 }}>{err}</div>}
        {ask && (
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexShrink: 0 }}>
            <button type="button" data-testid="bk-cx-keep" disabled={!!busy} onClick={() => { setAsk(null); setErr(""); }} style={{ flex: 1, minHeight: 46, borderRadius: 12, border: "1.5px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 800, cursor: busy ? "default" : "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_oc_keep}</button>
            <button type="button" data-testid="bk-cx-yes" disabled={!!busy || ask.check === "loading"} onClick={() => void confirmCx()} style={{ flex: 1, minHeight: 46, borderRadius: 12, border: "none", background: "#be123c", color: "#fff", fontSize: 14, fontWeight: 800, cursor: busy ? "default" : "pointer", fontFamily: "var(--font-ui)", opacity: ask.check === "loading" ? 0.6 : 1 }}>{busy ? t.rd_oc_busy : t.rd_oc_yes}</button>
          </div>
        )}
      </div>
    </div>, host);
}
