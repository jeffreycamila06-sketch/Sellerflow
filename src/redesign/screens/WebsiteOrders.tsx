// Seller Website — Orders → Website tab. Own website orders (newest 200), read when the tab opens
// and on Refresh (no polling). Tap an order → detail: items, buyer, delivery, payment, the receipt
// picture (signed link, "Check your bank app first"), and one action at a time:
// Money received / Not received / Mark as shipped / Cancel (stock goes back) / Block buyer.
// Every step shows on the buyer's order link. Opening an order clears its "New" badge.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { headerBar, headerTitle, card } from "../ui";
import { useT, tpl } from "../i18n";
import { productImageUrl } from "../adapters/productImages";
import { actionsFor, matchesFilter, wNo, type OrderAction, type OrderFilter, type WebsiteOrder } from "../adapters/websiteSeller";
import { realOrdersApi, type OrdersApi } from "../adapters/websiteEditorApi";
import { shareUrl } from "../../website/route";

const FILTERS: OrderFilter[] = ["new", "check", "unpaid", "ship", "done", "cancelled", "all"];

export default function WebsiteOrders({ cur = "NT$", topTabs, onNewCount, onToast, api = realOrdersApi, liveTick = 0, subdomainReady = false }: {
  cur?: string; topTabs?: ReactNode; onNewCount?: (n: number) => void; onToast: (m: string) => void; api?: OrdersApi;
  liveTick?: number; // bumped by Realtime when an own website order is added / changed → re-read the list
  subdomainReady?: boolean; // app_settings website_subdomain_ready (sql/164): order links on <sub>.sellerflowlive.com only when true
}) {
  const t = useT() as unknown as Record<string, string>;
  const [orders, setOrders] = useState<WebsiteOrder[] | null | "loading">("loading");
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [sub, setSub] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const fetchAll = useCallback(() => Promise.all([api.load(), api.blocked(), api.shopSub()]), [api]);
  const apply = useCallback(([o, b, s]: [WebsiteOrder[] | null, Set<string>, string | null]) => {
    setOrders(o); setBlocked(b); setSub(s);
    if (o) { const n = o.filter((x) => matchesFilter(x, "new")).length; onNewCount?.(n); if (n > 0) setFilter("new"); }
  }, [onNewCount]);
  const load = useCallback(async () => { apply(await fetchAll()); }, [fetchAll, apply]);
  useEffect(() => {
    let live = true;
    void fetchAll().then((r) => { if (live) apply(r); });
    return () => { live = false; };
  }, [fetchAll, apply]);
  // A live change: re-read quietly — the chosen filter and an open order stay as they are.
  const seenTick = useRef(liveTick);
  useEffect(() => {
    if (liveTick === seenTick.current) return;
    seenTick.current = liveTick;
    let live = true;
    void fetchAll().then(([o, b, s]) => {
      if (!live || !o) return;
      setOrders(o); setBlocked(b); setSub(s);
      onNewCount?.(o.filter((x) => matchesFilter(x, "new")).length);
    });
    return () => { live = false; };
  }, [liveTick, fetchAll, onNewCount]);
  const list = useMemo(() => (Array.isArray(orders) ? orders : []), [orders]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, list.filter((o) => matchesFilter(o, f)).length])) as Record<OrderFilter, number>, [list]);
  const shown = list.filter((o) => matchesFilter(o, filter));
  const open = list.find((o) => o.id === openId) || null;
  const patch = (id: string, p: Partial<WebsiteOrder>) => setOrders((os) => (Array.isArray(os) ? os.map((o) => (o.id === id ? { ...o, ...p } : o)) : os));
  const openOrder = (o: WebsiteOrder) => {
    setOpenId(o.id);
    if (!o.seenAt) {
      patch(o.id, { seenAt: new Date().toISOString() });
      onNewCount?.(Math.max(0, counts.new - 1));
      void api.act(o.id, "seen");
    }
  };
  const doAction = async (o: WebsiteOrder, a: OrderAction): Promise<boolean> => {
    const r = await api.act(o.id, a);
    if (r.ok === false) { onToast(t.rd_wor_act_failed); return false; }
    const now = new Date().toISOString();
    patch(o.id, { status: r.status, ...(a === "not_received" ? { paymentIssue: true } : a === "paid" ? { paymentIssue: false, paidAt: now } : a === "shipped" ? { shippedAt: now } : a === "cancel" ? { cancelledAt: now, cancelReason: "seller" } : {}) });
    setBlocked((b) => { const n = new Set(b); if (r.blocked) n.add(o.buyerPhone); else n.delete(o.buyerPhone); return n; });
    if (a !== "block" && a !== "unblock") onToast(t.rd_wor_updated);
    return true;
  };
  const chip = (on: boolean): CSSProperties => ({ flexShrink: 0, minHeight: 36, padding: "0 12px", borderRadius: 999, border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent)" : "var(--surface)", color: on ? "var(--accent-text)" : "var(--text)", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", display: "inline-flex", alignItems: "center", gap: 5 });
  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_wsa_title}</div>
          <button type="button" data-testid="wor-refresh" onClick={() => { setOrders("loading"); void load(); }} style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", border: "none", color: "var(--on-header)", padding: "7px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 34 }}>↻ {t.rd_wor_refresh}</button>
        </div>
        {topTabs}
      </div>
      <div style={{ padding: "12px 12px 90px", maxWidth: 760, margin: "0 auto" }}>
        <div data-testid="wor-filters" style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, WebkitOverflowScrolling: "touch" }}>
          {FILTERS.map((f) => <button key={f} type="button" data-testid={`wor-f-${f}`} aria-pressed={filter === f} onClick={() => setFilter(f)} style={chip(filter === f)}>{t[`rd_wor_f_${f}`]}{counts[f] > 0 && f !== "all" && <span style={{ fontSize: 11, fontWeight: 800, background: filter === f ? "rgba(255,255,255,.25)" : f === "new" ? "var(--danger)" : "var(--chip-bg)", color: filter === f ? "inherit" : f === "new" ? "#fff" : "var(--text)", borderRadius: 999, padding: "1px 6px" }}>{counts[f]}</span>}</button>)}
        </div>
        {orders === "loading" && <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>…</div>}
        {orders === null && <div style={{ ...card, color: "var(--danger)" }} data-testid="wor-failed">{t.rd_wor_load_failed}</div>}
        {Array.isArray(orders) && shown.length === 0 && <div style={{ ...card, textAlign: "center", color: "var(--text-muted)" }} data-testid="wor-empty">{t.rd_wor_empty}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          {shown.map((o) => (
            <button key={o.id} type="button" data-testid="wor-row" onClick={() => openOrder(o)} style={{ ...card, padding: 12, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)", color: "var(--text)", width: "100%" }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <b style={{ fontSize: 14.5 }}>{wNo(o.orderNo)}</b>
                  {!o.seenAt && o.status !== "cancelled" && <span data-testid="wor-new" style={{ fontSize: 10.5, fontWeight: 800, color: "#fff", background: "var(--danger)", borderRadius: 999, padding: "1px 7px" }}>{t.rd_wor_f_new}</span>}
                  <StatusPill o={o} t={t} />
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.buyerName} · ×{o.items.reduce((a, i) => a + i.qty, 0)} · {timeOf(o.createdAt)}</span>
              </span>
              <span style={{ fontWeight: 800, fontSize: 15, color: "var(--accent-fg)", flexShrink: 0 }}>{cur}{fmtN(o.total)}</span>
            </button>
          ))}
        </div>
      </div>
      {open && <Detail o={open} t={t} cur={cur} blocked={blocked.has(open.buyerPhone)} link={sub ? `${shareUrl(sub, subdomainReady)}/o/${open.token}` : ""} api={api} onClose={() => setOpenId(null)} onAction={(a) => doAction(open, a)} onToast={onToast} />}
    </div>
  );
}

function StatusPill({ o, t }: { o: WebsiteOrder; t: Record<string, string> }) {
  const tone = o.status === "cancelled" || o.status === "shipped" ? ["var(--chip-bg)", "var(--text-dim)"] : o.status === "payment_sent" ? ["rgba(37,99,235,.14)", "#1D4ED8"] : o.status === "awaiting_payment" ? ["rgba(234,88,12,.14)", "#C2410C"] : ["rgba(16,185,129,.15)", "#047857"];
  return <span data-testid="wor-status" style={{ fontSize: 11, fontWeight: 800, background: tone[0], color: tone[1], borderRadius: 999, padding: "2px 8px" }}>{o.status === "cancelled" && o.cancelReason === "auto" ? t.rd_wor_cancel_auto : t[`rd_wor_st_${o.status}`]}</span>;
}

function Detail({ o, t, cur, blocked, link, api, onClose, onAction, onToast }: {
  o: WebsiteOrder; t: Record<string, string>; cur: string; blocked: boolean; link: string; api: OrdersApi; onClose: () => void; onAction: (a: OrderAction) => Promise<boolean>; onToast: (m: string) => void;
}) {
  const [busy, setBusy] = useState<OrderAction | "">("");
  const [receipt, setReceipt] = useState<string | null | "loading">(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const acts = actionsFor(o);
  const run = async (a: OrderAction) => { setBusy(a); await onAction(a); setBusy(""); if (a === "cancel") setConfirmCancel(false); };
  const showReceipt = async () => { if (!o.receiptPath) return; setReceipt("loading"); setReceipt(await api.receipt(o.receiptPath)); };
  const label: Record<string, string> = { paid: t.rd_wor_paid, not_received: t.rd_wor_not_received, shipped: t.rd_wor_shipped, cancel: t.rd_wor_cancel };
  const where = o.delivery === "home" ? (o.address || "") : `${o.storeName || ""} #${o.storeId || ""}`;
  const del = o.delivery === "s711" ? "7-11" : o.delivery === "fm" ? t.rd_shop_fm : t.rd_shop_home;
  const pay = o.payment === "bank" ? t.rd_shop_pay_bank : o.payment === "qr" ? t.rd_shop_pay_qr : t.rd_shop_pay_cod;
  return (
    <div role="dialog" aria-modal="true" data-testid="wor-detail" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", background: "var(--bg, var(--surface))", borderRadius: "20px 20px 0 0", padding: "16px 14px calc(18px + env(safe-area-inset-bottom))", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><b style={{ fontSize: 18 }}>{wNo(o.orderNo)}</b><StatusPill o={o} t={t} /></div>
          <button type="button" aria-label="✕" data-testid="wor-close" onClick={onClose} style={{ width: 40, height: 40, borderRadius: 20, border: "none", background: "var(--chip-bg)", color: "var(--text)", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
        {o.paymentIssue && o.status === "awaiting_payment" && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 700, color: "#C2410C" }}>{t.rd_wor_issue}</div>}
        {o.status === "awaiting_payment" && o.autoCancelAt && <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>{tpl(t.rd_wor_autocancel, { time: timeOf(o.autoCancelAt) })}</div>}

        <div style={{ ...card, marginTop: 12, padding: 12 }}>
          {o.items.map((i, n) => (
            <div key={n} style={{ display: "flex", gap: 10, alignItems: "center", padding: "5px 0" }}>
              <span style={{ width: 42, height: 42, borderRadius: 9, overflow: "hidden", background: "var(--chip-bg)", flexShrink: 0 }}>{i.photo && <img src={productImageUrl(i.photo)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}><b style={{ display: "block" }}>{i.name}</b><span style={{ color: "var(--text-muted)", fontSize: 12.5 }}>{[i.label, i.code, `×${i.qty}`].filter(Boolean).join(" · ")}</span></span>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{cur}{fmtN(i.price * i.qty)}</span>
            </div>
          ))}
          <KV k={t.rd_shop_shipping} v={o.shipFee ? `${cur}${fmtN(o.shipFee)}` : t.rd_shop_co_free} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 16, marginTop: 4 }}><span>{t.rd_shop_co_total}</span><span data-testid="wor-total" style={{ color: "var(--accent-fg)" }}>{cur}{fmtN(o.total)}</span></div>
        </div>

        <div style={{ ...card, marginTop: 10, padding: 12, display: "flex", flexDirection: "column", gap: 5 }}>
          <KV k={t.rd_shop_msg_name} v={o.buyerName} />
          <KV k={t.rd_wor_phone} v={<a href={`tel:${o.buyerPhone}`} style={{ color: "var(--accent-fg)", fontWeight: 800 }}>{o.buyerPhone}</a>} />
          {o.buyerContact && <KV k={t.rd_wor_contact} v={o.buyerContact} />}
          <KV k={t.rd_shop_od_ship_to} v={`${del} · ${where}`} />
          <KV k={t.rd_shop_payment} v={pay} />
          {o.note && <KV k={t.rd_wor_note} v={o.note} />}
        </div>

        {o.payment !== "cod" && (
          <div style={{ ...card, marginTop: 10, padding: 12 }} data-testid="wor-receipt">
            <div style={{ fontSize: 14, fontWeight: 800 }}>{t.rd_wor_receipt}</div>
            {o.receiptPath ? (
              <>
                <div data-testid="wor-receipt-warn" style={{ marginTop: 6, fontSize: 12.5, fontWeight: 800, color: "#B45309", background: "rgba(245,158,11,.14)", padding: "8px 10px", borderRadius: 10 }}>⚠️ {t.rd_wor_receipt_warn}</div>
                {receipt && receipt !== "loading"
                  ? <img data-testid="wor-receipt-img" src={receipt} alt={t.rd_wor_receipt} style={{ display: "block", width: "100%", maxHeight: 460, objectFit: "contain", marginTop: 8, borderRadius: 10, background: "#fff" }} />
                  : <button type="button" data-testid="wor-receipt-open" onClick={() => void showReceipt()} style={{ ...secBtn, marginTop: 8, width: "100%" }}>{receipt === "loading" ? "…" : t.rd_wor_open_receipt}</button>}
              </>
            ) : <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--text-muted)" }}>{t.rd_wor_receipt_none}</div>}
          </div>
        )}

        {acts.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {acts.filter((a) => a !== "cancel").map((a) => (
              <button key={a} type="button" data-testid={`wor-act-${a}`} disabled={!!busy} onClick={() => void run(a)}
                style={a === "not_received" ? secBtn : mainBtn}>{busy === a ? "…" : label[a]}</button>
            ))}
            {acts.includes("cancel") && (confirmCancel
              ? <div style={{ gridColumn: "1 / -1", ...card, padding: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700 }}>{t.rd_wor_cancel_confirm}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button type="button" style={{ ...secBtn, flex: 1 }} onClick={() => setConfirmCancel(false)}>{t.rd_shop_back}</button>
                    <button type="button" data-testid="wor-cancel-yes" disabled={!!busy} style={{ ...mainBtn, flex: 1, background: "var(--danger)" }} onClick={() => void run("cancel")}>{busy === "cancel" ? "…" : t.rd_wor_cancel}</button>
                  </div>
                </div>
              : <button type="button" data-testid="wor-act-cancel" onClick={() => setConfirmCancel(true)} style={{ ...secBtn, gridColumn: "1 / -1", color: "var(--danger)" }}>{t.rd_wor_cancel}</button>)}
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {link && <button type="button" data-testid="wor-link" onClick={() => { void navigator.clipboard?.writeText(link).catch(() => {}); onToast(t.rd_shop_od_copied); }} style={secBtn}>🔗 {t.rd_wor_link} · {t.rd_shop_od_copy}</button>}
          {blocked && <div data-testid="wor-blocked" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", textAlign: "center" }}>{t.rd_wor_blocked}</div>}
          <button type="button" data-testid={blocked ? "wor-unblock" : "wor-block"} onClick={() => void onAction(blocked ? "unblock" : "block")} style={{ ...secBtn, color: blocked ? "var(--text)" : "var(--danger)" }}>{blocked ? t.rd_wor_unblock : t.rd_wor_block}</button>
        </div>
      </div>
    </div>
  );
}
const mainBtn: CSSProperties = { minHeight: 46, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "var(--font-ui)", padding: "0 10px" };
const secBtn: CSSProperties = { minHeight: 46, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "var(--font-ui)", padding: "0 10px" };
function KV({ k, v }: { k: string; v: ReactNode }) { return <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5 }}><span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{k}</span><span style={{ fontWeight: 700, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span></div>; }
const fmtN = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
function timeOf(s: string): string {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("en-CA", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replace(",", "") : "";
}
