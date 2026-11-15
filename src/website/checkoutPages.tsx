// Seller Website — checkout, store pick, order sent, order link (Phase 1).
// No login. The buyer's details are remembered on this device only; "Not you?" clears them.
// The order is placed through ONE server call (website_place_order): prices and stock are checked
// there, never trusted from the browser. Store pick = the buyer types the store number (+ name) with
// a link to the official map — no "store checked / full / closed" in Phase 1.
// Send to chat: the order is ALREADY saved; tapping a chat button copies the order text and opens the
// app (a real link, so it works on iPhone). WhatsApp and a LINE Official Account open with the text
// typed in; Messenger / Instagram: the buyer pastes.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT, tpl } from "../redesign/i18n";
import type { ShopPage } from "./route";
import type { Shop } from "./shopApi";
import { money, photoUrl } from "./shopApi";
import { freeShipping, subtotalOf, type LineInfo } from "./cart";
import { mutedText } from "./shopStyle";
import { chatHref, CHAT_PREFILL } from "./shopLinks";
import { BrandIcon, type BrandKey } from "./brandIcons";
import { SmallPhoto } from "./ui";
import {
  realOrderApi, readBuyer, saveBuyer, forgetBuyer, deviceId, draftErrors,
  type OrderApi, type OrderDraft, type Delivery, type Payment, type FieldError, type OrderView, type PlaceResult,
} from "./orderApi";
import { orderMessage, deliveryLabel, paymentLabel, CHAT_APP_NAME } from "./orderText";
import { STORE_MAPS, deliveriesOf, paymentsOf, placeFailText, copyText } from "./checkoutLogic";

export interface CheckoutFlowProps {
  shop: Shop; cur: string; route: ShopPage; go: (r: ShopPage) => void; infos: LineInfo[]; preview: boolean; onPlaced: () => void;
  api?: OrderApi; linkFor?: (r: ShopPage) => string;
}

function initialDraft(shop: Shop): OrderDraft {
  const m = readBuyer();
  const dels = deliveriesOf(shop);
  const delivery = dels[0] ?? null;
  const last = delivery === "s711" || delivery === "fm" ? m?.stores?.[delivery]?.[0] : undefined;
  const pays = paymentsOf(shop, delivery);
  return {
    name: m?.name || "", phone: m?.phone || "", contact: m?.contact || "", delivery,
    storeId: last?.id || "", storeName: last?.name || "", address: m?.address || "",
    payment: pays.find((p) => p !== "cod") ?? pays[0] ?? null, note: "",
  };
}
export function CheckoutFlow({ shop, cur, route, go, infos, preview, onPlaced, api = realOrderApi, linkFor }: CheckoutFlowProps) {
  const [draft, setDraft] = useState<OrderDraft>(() => (preview ? emptyDraft(shop) : initialDraft(shop)));
  const [toast, setToast] = useState("");
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2600); };
  const link = (r: ShopPage) => (linkFor ? linkFor(r) : "");
  let body: ReactNode = null;
  if (route.page === "checkout") body = <Checkout shop={shop} cur={cur} infos={infos} draft={draft} setDraft={setDraft} preview={preview} api={api} go={go} onPlaced={onPlaced} />;
  else if (route.page === "store") body = <StorePick draft={draft} setDraft={setDraft} done={() => go({ page: "checkout" })} />;
  else if (route.page === "sent" || route.page === "order") body = <OrderPage key={route.token} token={route.token} fresh={route.page === "sent"} cur={cur} api={api} link={link({ page: "order", token: route.token })} say={say} onShop={() => go({ page: "home" })} />;
  return (
    <>
      {body}
      {toast && <div role="status" data-testid="co-toast" style={{ position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", background: "#111827", color: "#fff", padding: "10px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, zIndex: 60, maxWidth: "calc(100vw - 32px)", textAlign: "center" }}>{toast}</div>}
    </>
  );
}
function emptyDraft(shop: Shop): OrderDraft {
  const d = deliveriesOf(shop)[0] ?? null; const p = paymentsOf(shop, d);
  return { name: "", phone: "", contact: "", delivery: d, storeId: "", storeName: "", address: "", payment: p.find((x) => x !== "cod") ?? p[0] ?? null, note: "" };
}

// ── checkout ──────────────────────────────────────────────────────────────────
function Checkout({ shop, cur, infos, draft, setDraft, preview, api, go, onPlaced }: {
  shop: Shop; cur: string; infos: LineInfo[]; draft: OrderDraft; setDraft: (f: (d: OrderDraft) => OrderDraft) => void; preview: boolean; api: OrderApi; go: (r: ShopPage) => void; onPlaced: () => void;
}) {
  const t = useT() as unknown as Record<string, string>;
  const [errs, setErrs] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const [remembered, setRemembered] = useState(() => !preview && !!readBuyer());
  const dels = deliveriesOf(shop);
  const pays = paymentsOf(shop, draft.delivery);
  const sub = subtotalOf(infos);
  const free = freeShipping(sub, shop.checkout.freeOver);
  const isFree = !!free && free.remaining <= 0;
  const feeOf = (k: Delivery) => (isFree ? 0 : shop.checkout.ship[k]?.fee ?? 0);
  const fee = draft.delivery ? feeOf(draft.delivery) : 0;
  const total = sub + fee;
  const set = (patch: Partial<OrderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const pickDelivery = (k: Delivery) => setDraft((d) => {
    const m = readBuyer(); const last = k === "s711" || k === "fm" ? m?.stores?.[k]?.[0] : undefined;
    const ps = paymentsOf(shop, k);
    return { ...d, delivery: k, storeId: k === d.delivery ? d.storeId : last?.id || "", storeName: k === d.delivery ? d.storeName : last?.name || "", payment: d.payment && ps.includes(d.payment) ? d.payment : ps.find((p) => p !== "cod") ?? ps[0] ?? null };
  });
  const bad = (f: FieldError) => errs.includes(f);
  if (!infos.length) return <div className="sfl-wrap" style={{ padding: 16 }}><div className="sfl-card" style={{ padding: 24, textAlign: "center" }}><div style={mutedText}>{t.rd_shop_cart_empty}</div><button type="button" className="sfl-btn sfl-btn-main" style={{ marginTop: 14, padding: "0 20px" }} onClick={() => go({ page: "home" })}>{t.rd_shop_keep_shopping}</button></div></div>;

  const place = async () => {
    if (preview || busy) return;
    const e = draftErrors(draft, { delivery: dels, payment: pays });
    setErrs(e); setFail("");
    if (e.length) { setFail(t.rd_shop_co_fix); return; }
    setBusy(true);
    const r: PlaceResult = await api.place(shop.sub, {
      name: draft.name.trim(), phone: draft.phone.trim(), contact: draft.contact.trim(), delivery: draft.delivery!, payment: draft.payment!,
      storeId: draft.storeId.trim(), storeName: draft.storeName.trim(), address: draft.address.trim(), note: draft.note.trim(),
      items: infos.map((x) => ({ pid: x.line.pid, vid: x.line.vid, qty: x.line.qty })),
    }, deviceId());
    setBusy(false);
    if (r.ok === true) { saveBuyer(draft); onPlaced(); go({ page: "sent", token: r.token }); return; }
    setFail(placeFailText(t, r, infos));
    if (r.error === "bad_name") setErrs(["name"]); else if (r.error === "bad_phone") setErrs(["phone"]); else if (r.error === "bad_store") setErrs(["store"]); else if (r.error === "bad_address") setErrs(["address"]); else if (r.error === "bad_payment") setErrs(["payment"]); else if (r.error === "bad_delivery") setErrs(["delivery"]);
  };

  const field = (on: boolean) => ({ width: "100%", minHeight: 46, borderRadius: 11, border: `1.5px solid ${on ? "#DC2626" : "#D1D5DB"}`, padding: "10px 12px", fontSize: 16, background: "#fff", color: "#111827", boxSizing: "border-box" as const });
  return (
    <div className="sfl-wrap" style={{ padding: "12px 12px 120px" }}>
      <h1 style={{ fontSize: 21, fontWeight: 800, margin: "4px 2px 12px" }}>{t.rd_shop_checkout}</h1>
      <div className="sfl-side">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card title={t.rd_shop_co_you} right={remembered ? <button type="button" data-testid="co-not-you" onClick={() => { forgetBuyer(); setRemembered(false); set({ name: "", phone: "", contact: "", address: "", storeId: "", storeName: "" }); }} style={linkBtn}>{t.rd_shop_co_not_you}</button> : null}>
            {remembered && <div style={{ ...mutedText, fontSize: 12, marginTop: -4, marginBottom: 8 }}>{t.rd_shop_co_saved}</div>}
            <Label text={t.rd_shop_co_name}><input data-testid="co-name" value={draft.name} maxLength={40} autoComplete="name" onChange={(e) => set({ name: e.target.value })} style={field(bad("name"))} /></Label>
            {bad("name") && <Err text={t.rd_shop_co_err_name} />}
            <Label text={t.rd_shop_co_phone}><input data-testid="co-phone" value={draft.phone} inputMode="tel" autoComplete="tel" maxLength={20} onChange={(e) => set({ phone: e.target.value })} style={field(bad("phone"))} /></Label>
            {bad("phone") && <Err text={t.rd_shop_co_err_phone} />}
            <Label text={t.rd_shop_co_contact}><input data-testid="co-contact" value={draft.contact} maxLength={60} onChange={(e) => set({ contact: e.target.value })} style={field(false)} /></Label>
          </Card>

          <Card title={t.rd_shop_delivery}>
            <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {dels.map((k) => (
                <Choice key={k} testid={`co-del-${k}`} on={draft.delivery === k} onPick={() => pickDelivery(k)} title={deliveryLabel(t, k)} right={feeOf(k) === 0 ? t.rd_shop_co_free : money(cur, feeOf(k))} bad={bad("delivery")} />
              ))}
            </div>
            {draft.delivery && draft.delivery !== "home" && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{t.rd_shop_co_store}</div>
                {/^\d{6}$/.test(draft.storeId)
                  ? <div data-testid="co-store" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid #E5E7EB", borderRadius: 11, padding: "10px 12px" }}>
                      <span style={{ minWidth: 0 }}><b>{draft.storeName || deliveryLabel(t, draft.delivery)}</b><span style={{ ...mutedText, display: "block" }}>#{draft.storeId}</span></span>
                      <button type="button" style={linkBtn} onClick={() => go({ page: "store" })}>{t.rd_shop_co_change}</button>
                    </div>
                  : <button type="button" data-testid="co-choose-store" className="sfl-btn sfl-btn-line" style={{ width: "100%", borderColor: bad("store") ? "#DC2626" : undefined }} onClick={() => go({ page: "store" })}>{t.rd_shop_co_choose_store}</button>}
                {bad("store") && <Err text={t.rd_shop_co_err_store} />}
              </div>
            )}
            {draft.delivery === "home" && (
              <div style={{ marginTop: 12 }}>
                <Label text={t.rd_shop_co_address}><textarea data-testid="co-address" value={draft.address} maxLength={200} rows={2} autoComplete="street-address" onChange={(e) => set({ address: e.target.value })} style={{ ...field(bad("address")), resize: "vertical" }} /></Label>
                {bad("address") && <Err text={t.rd_shop_co_err_address} />}
              </div>
            )}
          </Card>

          <Card title={t.rd_shop_payment}>
            <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(["bank", "qr", "cod"] as Payment[]).filter((p) => (p === "cod" ? !!shop.checkout.cod : pays.includes(p))).map((p) => {
                const off = p === "cod" && draft.delivery === "home";
                return <Choice key={p} testid={`co-pay-${p}`} on={draft.payment === p && !off} disabled={off} onPick={() => set({ payment: p })} title={paymentLabel(t, p)} sub={off ? t.rd_shop_co_cod_home : p === "cod" ? t.rd_shop_od_cod : t.rd_shop_co_pay_first} bad={bad("payment")} />;
              })}
            </div>
            {bad("payment") && <Err text={t.rd_shop_co_err_payment} />}
          </Card>

          <Card title={t.rd_shop_co_note}>
            <textarea data-testid="co-note" value={draft.note} maxLength={200} rows={2} onChange={(e) => set({ note: e.target.value })} style={{ ...field(false), resize: "vertical" }} />
          </Card>
        </div>

        <div>
          <div className="sfl-card" style={{ padding: 14, marginTop: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{t.rd_shop_co_summary}</div>
            {infos.map((x) => (
              <div key={`${x.line.pid}:${x.line.vid}`} style={{ display: "flex", gap: 10, padding: "6px 0", alignItems: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: 9, overflow: "hidden", background: "#F3F4F6", flexShrink: 0 }}>{x.photo && <SmallPhoto path={x.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}><div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.product.name}</div><div style={mutedText}>{[x.label, `×${x.line.qty}`].filter(Boolean).join(" · ")}</div></div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{money(cur, x.price * x.line.qty)}</div>
              </div>
            ))}
            <Row a={t.rd_shop_subtotal} b={money(cur, sub)} />
            <Row a={t.rd_shop_shipping} b={draft.delivery ? (fee === 0 ? t.rd_shop_co_free : money(cur, fee)) : "—"} />
            {free && free.remaining > 0 && <div style={{ ...mutedText, fontSize: 12.5 }}>{tpl(t.rd_shop_free_more, { amount: money(cur, free.remaining) })}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontWeight: 800, fontSize: 17 }}><span>{t.rd_shop_co_total}</span><span data-testid="co-total" style={{ color: "var(--sc)" }}>{money(cur, total)}</span></div>
            {fail && <div role="alert" data-testid="co-fail" style={{ marginTop: 12, color: "#B91C1C", background: "#FEF2F2", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, fontWeight: 700 }}>{fail}</div>}
            {preview && <div data-testid="co-preview" style={{ marginTop: 12, ...mutedText }}>{t.rd_shop_co_preview}</div>}
            <button type="button" data-testid="co-place" className="sfl-btn sfl-btn-main sfl-only-wide" style={{ width: "100%", marginTop: 14 }} disabled={busy || preview} onClick={() => void place()}>{busy ? t.rd_shop_co_placing : t.rd_shop_co_place}</button>
            <p data-testid="co-privacy" style={{ ...mutedText, fontSize: 12, marginTop: 12, marginBottom: 0 }}>🔒 {tpl(t.rd_shop_co_privacy, { shop: shop.shop.name || "" })}</p>
          </div>
        </div>
      </div>
      <div className="sfl-only-phone" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, background: "#fff", borderTop: "1px solid #ECECF1", padding: "10px 12px calc(10px + env(safe-area-inset-bottom))", gap: 12, alignItems: "center" }}>
        <div style={{ flexShrink: 0 }}><div style={{ ...mutedText, fontSize: 11.5 }}>{t.rd_shop_co_total}</div><div style={{ fontWeight: 800, fontSize: 18, color: "var(--sc)" }}>{money(cur, total)}</div></div>
        <button type="button" data-testid="co-place-phone" className="sfl-btn sfl-btn-main" style={{ flex: 1 }} disabled={busy || preview} onClick={() => void place()}>{busy ? t.rd_shop_co_placing : t.rd_shop_co_place}</button>
      </div>
    </div>
  );
}
// ── store pick ────────────────────────────────────────────────────────────────
function StorePick({ draft, setDraft, done }: { draft: OrderDraft; setDraft: (f: (d: OrderDraft) => OrderDraft) => void; done: () => void }) {
  const t = useT() as unknown as Record<string, string>;
  const k = draft.delivery === "fm" ? "fm" : "s711";
  const [id, setId] = useState(draft.storeId);
  const [name, setName] = useState(draft.storeName);
  const recent = useMemo(() => readBuyer()?.stores?.[k] || [], [k]);
  const okId = /^\d{6}$/.test(id);
  const use = (sid: string, sname: string) => { setDraft((d) => ({ ...d, storeId: sid, storeName: sname.trim().slice(0, 40) })); done(); };
  const field = { width: "100%", minHeight: 46, borderRadius: 11, border: "1.5px solid #D1D5DB", padding: "10px 12px", fontSize: 16, boxSizing: "border-box" as const, background: "#fff", color: "#111827" };
  return (
    <div className="sfl-wrap" style={{ padding: "12px 12px 40px", maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "4px 2px 12px" }}>{k === "fm" ? t.rd_shop_st_title_fm : t.rd_shop_st_title_s711}</h1>
      <div className="sfl-card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <Label text={t.rd_shop_st_number}><input data-testid="st-id" value={id} inputMode="numeric" maxLength={6} onChange={(e) => setId(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ ...field, letterSpacing: 2, fontWeight: 700 }} /></Label>
        <Label text={t.rd_shop_st_name}><input data-testid="st-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={field} /></Label>
        <a data-testid="st-map" href={STORE_MAPS[k]} target="_blank" rel="noreferrer noopener" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--sc)", minHeight: 32, display: "inline-flex", alignItems: "center" }}>🗺 {t.rd_shop_st_find} ↗</a>
        <button type="button" data-testid="st-use" className="sfl-btn sfl-btn-main" disabled={!okId} onClick={() => use(id, name)}>{t.rd_shop_st_use}</button>
      </div>
      {recent.length > 0 && (
        <div className="sfl-card" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{t.rd_shop_st_recent}</div>
          {recent.map((s) => (
            <button key={s.id} type="button" data-testid="st-recent" onClick={() => use(s.id, s.name)} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 4px", minHeight: 48, border: "none", borderTop: "1px solid #F1F1F4", background: "transparent", cursor: "pointer", textAlign: "left", color: "#111827" }}>
              <span><b>{s.name || (k === "fm" ? t.rd_shop_fm : "7-11")}</b> <span style={mutedText}>#{s.id}</span></span><span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── order sent + order link ─────────────────────────────────────────────────────
function OrderPage({ token, fresh, cur: shopCur, api, link, say, onShop }: { token: string; fresh: boolean; cur: string; api: OrderApi; link: string; say: (m: string) => void; onShop: () => void }) {
  const t = useT() as unknown as Record<string, string>;
  const [view, setView] = useState<OrderView | null | "loading">("loading");
  const [up, setUp] = useState<"" | "busy" | "ok" | "fail" | "big" | "bad">("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { let live = true; void api.load(token).then((v) => { if (live) setView(v); }); return () => { live = false; }; }, [api, token]);
  if (view === "loading") return <div className="sfl-wrap" style={{ padding: 30, textAlign: "center", ...mutedText }}>…</div>;
  if (!view) return <div className="sfl-wrap" style={{ padding: 30, textAlign: "center" }}><p data-testid="od-missing">{t.rd_shop_od_not_found}</p><button type="button" className="sfl-btn sfl-btn-main" style={{ padding: "0 18px" }} onClick={onShop}>{t.rd_shop_od_back_shop}</button></div>;
  const cur = view.shop.currency || shopCur;
  const text = orderMessage(t, view, cur, link);
  const waiting = view.status === "awaiting_payment" || view.status === "payment_sent";
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { setUp("bad"); return; }
    setUp("busy");
    const r = await api.uploadReceipt(token, f);
    if (r.ok === true) { setUp("ok"); const v = await api.load(token); if (v) setView(v); }
    else setUp(r.reason === "too_big" ? "big" : r.reason === "unreadable" ? "bad" : "fail");
  };
  const chats = Object.entries(view.shop.chats || {}).filter(([k, v]) => k in CHAT_APP_NAME && !!chatHref(k as keyof typeof CHAT_PREFILL, String(v || "")));
  const steps = view.payment === "cod" ? ["placed", "shipped"] : ["placed", "paid", "shipped"];
  const reached = (s: string) => s === "placed" || (s === "paid" && (view.status === "paid" || view.status === "shipped")) || (s === "shipped" && view.status === "shipped");
  return (
    <div className="sfl-wrap" style={{ padding: "12px 12px 60px", maxWidth: 720 }}>
      {fresh && (
        <div data-testid="od-sent" style={{ textAlign: "center", padding: "14px 0 6px" }}>
          <div aria-hidden="true" style={{ width: 58, height: 58, borderRadius: 29, background: "#ECFDF5", color: "#059669", fontSize: 30, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "10px 0 2px" }}>{t.rd_shop_od_sent}</h1>
        </div>
      )}
      <div className="sfl-card" style={{ padding: 14, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 data-testid="od-no" style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{tpl(t.rd_shop_od_order, { no: view.orderNo })}</h2>
          <span data-testid="od-status" style={{ fontSize: 12.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, background: view.status === "cancelled" ? "#F3F4F6" : view.status === "shipped" || view.status === "paid" ? "#ECFDF5" : "#FFF7ED", color: view.status === "cancelled" ? "#6B7280" : view.status === "shipped" || view.status === "paid" ? "#047857" : "#C2410C" }}>{t[`rd_shop_od_st_${view.status}`]}</span>
        </div>
        {view.status !== "cancelled" && (
          <div data-testid="od-steps" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 14 }}>
            {steps.map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, flex: i < steps.length - 1 ? 1 : "none" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: reached(s) ? "#047857" : "#9CA3AF", whiteSpace: "nowrap" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 10, background: reached(s) ? "#10B981" : "#E5E7EB", color: "#fff", fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{reached(s) ? "✓" : i + 1}</span>
                  {t[`rd_shop_od_step_${s}`]}
                </span>
                {i < steps.length - 1 && <span style={{ flex: 1, height: 2, background: reached(steps[i + 1]) ? "#10B981" : "#E5E7EB", minWidth: 12 }} />}
              </div>
            ))}
          </div>
        )}
        {view.paymentIssue && view.status === "awaiting_payment" && <Note tone="red" testid="od-issue">{t.rd_shop_od_issue}</Note>}
        {view.status === "cancelled" && <Note tone="grey" testid="od-cancelled">{view.cancelReason === "auto" ? t.rd_shop_od_cancel_auto : t.rd_shop_od_cancel_seller}</Note>}
      </div>

      {waiting && view.payment !== "cod" && (
        <div className="sfl-card" data-testid="od-pay" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{tpl(t.rd_shop_od_pay_now, { amount: money(cur, view.total) })}</div>
          {view.pay?.bank && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {view.pay.bank.bankName && <KV k={t.rd_shop_od_bank} v={view.pay.bank.bankName} />}
              {view.pay.bank.accountName && <KV k={t.rd_shop_od_acct_name} v={view.pay.bank.accountName} />}
              {view.pay.bank.accountNumber && <KV k={t.rd_shop_od_acct_no} v={view.pay.bank.accountNumber} copy={() => { void copyText(view.pay!.bank!.accountNumber!); say(t.rd_shop_od_copied); }} copyLabel={t.rd_shop_od_copy} />}
            </div>
          )}
          {view.pay?.qr && (
            <div style={{ marginTop: 10, textAlign: "center" }}>
              <div style={{ ...mutedText, marginBottom: 6 }}>{t.rd_shop_od_scan}{view.pay.qr.label ? ` · ${view.pay.qr.label}` : ""}</div>
              <img data-testid="od-qr" src={photoUrl(view.pay.qr.path)} alt={t.rd_shop_od_scan} style={{ width: "min(240px, 70vw)", aspectRatio: "1 / 1", objectFit: "contain", borderRadius: 12, border: "1px solid #E5E7EB", background: "#fff" }} />
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" data-testid="od-file" style={{ display: "none" }} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" data-testid="od-upload" className="sfl-btn sfl-btn-main" style={{ width: "100%", marginTop: 14 }} disabled={up === "busy"} onClick={() => fileRef.current?.click()}>
            {up === "busy" ? t.rd_shop_od_uploading : view.receipt ? t.rd_shop_od_upload_again : t.rd_shop_od_upload}
          </button>
          {(view.receipt || up === "ok") && <div data-testid="od-receipt-ok" style={{ marginTop: 8, color: "#047857", fontWeight: 700, fontSize: 13.5, textAlign: "center" }}>{t.rd_shop_od_receipt_ok}</div>}
          {up === "fail" && <Err text={t.rd_shop_od_receipt_fail} />}
          {up === "big" && <Err text={t.rd_shop_od_receipt_big} />}
          {up === "bad" && <Err text={t.rd_shop_od_receipt_bad} />}
          {fresh && !view.receipt && <div style={{ ...mutedText, fontSize: 12.5, marginTop: 8, textAlign: "center" }}>{t.rd_shop_od_later}</div>}
          {view.autoCancelAt && <div style={{ ...mutedText, fontSize: 12.5, marginTop: 4, textAlign: "center" }}>{tpl(t.rd_shop_od_autocancel, { n: String(hoursLeftLabel(view)) })}</div>}
        </div>
      )}
      {view.payment === "cod" && view.status === "confirmed" && <Note tone="green" testid="od-cod">{t.rd_shop_od_cod}</Note>}

      {chats.length > 0 && view.status !== "cancelled" && (
        <div className="sfl-card" data-testid="od-chat" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{fresh ? t.rd_shop_od_send_title : t.rd_shop_od_message}</div>
          <div style={{ ...mutedText, fontSize: 12.5, margin: "2px 0 10px" }}>{t.rd_shop_od_send_hint}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
            {chats.map(([k, v]) => {
              const key = k as keyof typeof CHAT_PREFILL;
              const href = chatHref(key, String(v), CHAT_PREFILL[key] ? text : undefined)!;
              return (
                <a key={k} data-testid={`od-chat-${k}`} href={href} target="_blank" rel="noreferrer noopener" className="sfl-btn sfl-btn-line"
                  onClick={() => { void copyText(text); say(tpl(t.rd_shop_od_copied_paste, { app: CHAT_APP_NAME[k] })); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none", lineHeight: "44px" }}><BrandIcon brand={k as BrandKey} size={18} />{CHAT_APP_NAME[k]}</a>
              );
            })}
          </div>
        </div>
      )}

      <div className="sfl-card" style={{ padding: 14, marginTop: 12 }}>
        {view.items.map((i, n) => (
          <div key={n} style={{ display: "flex", gap: 10, padding: "6px 0", alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 9, overflow: "hidden", background: "#F3F4F6", flexShrink: 0 }}>{i.photo && <SmallPhoto path={i.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}><div style={{ fontWeight: 700 }}>{i.name}</div><div style={mutedText}>{[i.label, i.code, `×${i.qty}`].filter(Boolean).join(" · ")}</div></div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{money(cur, i.price * i.qty)}</div>
          </div>
        ))}
        <Row a={t.rd_shop_subtotal} b={money(cur, view.subtotal)} />
        <Row a={t.rd_shop_shipping} b={view.shipFee ? money(cur, view.shipFee) : t.rd_shop_co_free} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontWeight: 800, fontSize: 16 }}><span>{t.rd_shop_co_total}</span><span data-testid="od-total" style={{ color: "var(--sc)" }}>{money(cur, view.total)}</span></div>
        <div style={{ borderTop: "1px solid #F1F1F4", marginTop: 12, paddingTop: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5 }}>
          <KV k={t.rd_shop_od_ship_to} v={`${deliveryLabel(t, view.delivery)} · ${view.delivery === "home" ? view.address || "" : `${view.storeName || ""} #${view.storeId || ""}`}`} />
          <KV k={t.rd_shop_payment} v={paymentLabel(t, view.payment)} />
          <KV k={t.rd_shop_msg_name} v={`${view.buyerName} · ***${view.phoneTail}`} />
        </div>
      </div>

      {link && (
        <div className="sfl-card" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{t.rd_shop_od_link}</div>
          <div style={{ ...mutedText, fontSize: 12.5, margin: "2px 0 8px" }}>{t.rd_shop_od_link_hint}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={link} aria-label={t.rd_shop_od_link} data-testid="od-link" style={{ flex: 1, minWidth: 0, minHeight: 44, borderRadius: 10, border: "1px solid #E5E7EB", padding: "0 10px", fontSize: 13, color: "#374151", background: "#F9FAFB" }} />
            <button type="button" className="sfl-btn sfl-btn-line" style={{ padding: "0 14px" }} onClick={() => { void copyText(link); say(t.rd_shop_od_copied); }}>{t.rd_shop_od_copy}</button>
          </div>
        </div>
      )}
      <div style={{ textAlign: "center", marginTop: 16 }}><button type="button" className="sfl-btn sfl-btn-line" style={{ padding: "0 20px" }} onClick={onShop}>{t.rd_shop_od_back_shop}</button></div>
    </div>
  );
}
function hoursLeftLabel(v: OrderView): number {
  const total = v.autoCancelAt && v.createdAt ? Math.round((Date.parse(v.autoCancelAt) - Date.parse(v.createdAt)) / 3600000) : 24;
  return Number.isFinite(total) && total > 0 ? total : 24;
}

// ── small pieces ────────────────────────────────────────────────────────────────
const linkBtn = { border: "none", background: "transparent", color: "var(--sc)", fontWeight: 800, fontSize: 13.5, cursor: "pointer", minHeight: 36, padding: "0 4px" } as const;
function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return <section className="sfl-card" style={{ padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{title}</h2>{right}</div>{children}</section>;
}
function Label({ text, children }: { text: string; children: ReactNode }) {
  return <label style={{ display: "block", marginBottom: 10 }}><span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#4B5563", marginBottom: 5 }}>{text}</span>{children}</label>;
}
function Err({ text }: { text: string }) { return <div role="alert" style={{ color: "#B91C1C", fontSize: 12.5, fontWeight: 700, margin: "-4px 0 8px" }}>{text}</div>; }
function Choice({ on, onPick, title, sub, right, testid, bad, disabled }: { on: boolean; onPick: () => void; title: string; sub?: string; right?: string; testid: string; bad?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={on} data-testid={testid} disabled={disabled} onClick={onPick}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 52, padding: "10px 12px", borderRadius: 12, textAlign: "left", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
        border: on ? "2px solid var(--sc)" : `1px solid ${bad ? "#DC2626" : "#D1D5DB"}`, background: on ? "#FFF7F5" : "#fff", color: "#111827" }}>
      <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 9, border: on ? "6px solid var(--sc)" : "2px solid #9CA3AF", flexShrink: 0, boxSizing: "border-box" }} />
      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontWeight: 800, fontSize: 14 }}>{title}</span>{sub && <span style={{ ...mutedText, fontSize: 12 }}>{sub}</span>}</span>
      {right && <span style={{ fontWeight: 800, fontSize: 13.5, flexShrink: 0 }}>{right}</span>}
    </button>
  );
}
function Row({ a, b }: { a: string; b: string }) { return <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13.5, color: "#4B5563", padding: "3px 0" }}><span>{a}</span><span>{b}</span></div>; }
function KV({ k, v, copy, copyLabel }: { k: string; v: string; copy?: () => void; copyLabel?: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><span style={{ color: "#6B7280", flexShrink: 0 }}>{k}</span><span style={{ fontWeight: 700, textAlign: "right", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 8 }}>{v}{copy && <button type="button" onClick={copy} style={{ ...linkBtn, fontSize: 12.5 }}>{copyLabel}</button>}</span></div>;
}
function Note({ tone, children, testid }: { tone: "red" | "grey" | "green"; children: ReactNode; testid: string }) {
  const c = tone === "red" ? ["#FEF2F2", "#B91C1C"] : tone === "green" ? ["#ECFDF5", "#047857"] : ["#F3F4F6", "#4B5563"];
  return <div data-testid={testid} style={{ marginTop: 12, background: c[0], color: c[1], borderRadius: 11, padding: "10px 12px", fontSize: 13.5, fontWeight: 700, lineHeight: 1.4 }}>{children}</div>;
}
