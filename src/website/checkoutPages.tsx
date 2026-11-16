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
import { useLang } from "../redesign/i18n/langContext";
import { orderParcel, parcelWhen, parcelDay, daysLeft, PARCEL_CSS } from "./parcelView";
import type { ShopPage } from "./route";
import type { Shop } from "./shopApi";
import { money, photoUrl } from "./shopApi";
import { freeShipping, subtotalOf, type LineInfo } from "./cart";
import { mutedText } from "./shopStyle";
import { countdown } from "./pricing";
import { chatHref, CHAT_PREFILL } from "./shopLinks";
import { BrandIcon, type BrandKey } from "./brandIcons";
import { SmallPhoto } from "./ui";
import {
  realOrderApi, readBuyer, saveBuyer, forgetBuyer, deviceId, draftErrors,
  type OrderApi, type OrderDraft, type FieldError, type OrderView, type PlaceResult, type PriceNow,
} from "./orderApi";
import { checkoutOf, deliveryOfNeeds, freeOverOf, shipLabel, payLabel, type PayOpt, type ShipOpt } from "./shipPay";
import { addrFormOf, composeAddress, cleanPost, phoneHintOf, CA_PROVINCES, AU_STATES, EMPTY_ADDR, type AddrParts } from "./addressForm";
import { orderMessage, deliveryLabel, deliveryWhere, paymentLabel, orderTimeline, CHAT_APP_NAME } from "./orderText";
import { STORE_MAPS, deliveriesOf, paymentsOf, placeFailText, copyText } from "./checkoutLogic";

export interface CheckoutFlowProps {
  shop: Shop; cur: string; route: ShopPage; go: (r: ShopPage) => void; infos: LineInfo[]; preview: boolean; onPlaced: (o?: { token: string; orderNo: string; total: number }) => void;
  api?: OrderApi; linkFor?: (r: ShopPage) => string;
}

function initialDraft(shop: Shop): OrderDraft {
  const m = readBuyer();
  const dels = deliveriesOf(shop);
  const delivery = dels[0] ?? null;
  const last = delivery === "s711" || delivery === "fm" ? m?.stores?.[delivery]?.[0] : undefined;
  const pays = paymentsOf(shop, delivery);
  const methods = checkoutOf(shop).methods;
  return {
    name: m?.name || "", phone: m?.phone || "", contact: m?.contact || "", delivery,
    storeId: last?.id || "", storeName: last?.name || "", address: m?.address || "",
    payment: pays.find((p) => methods.find((x) => x.id === p)?.kind === "first") ?? pays[0] ?? null, note: "",
    ...(addrFormOf(shop.country) !== "free" ? { addr: m?.addr ?? { ...EMPTY_ADDR } } : {}),
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
      {toast && <div role="status" data-testid="co-toast" style={{ position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", background: "var(--s-fg)", color: "#fff", padding: "10px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 700, zIndex: 60, maxWidth: "calc(100vw - 32px)", textAlign: "center" }}>{toast}</div>}
    </>
  );
}
function emptyDraft(shop: Shop): OrderDraft {
  const c = checkoutOf(shop);
  const d = c.options[0]?.id ?? null; const p = paymentsOf(shop, d);
  const first = p.find((x) => c.methods.find((m) => m.id === x)?.kind === "first");
  return { name: "", phone: "", contact: "", delivery: d, storeId: "", storeName: "", address: "", payment: first ?? p[0] ?? null, note: "" };
}

// ── checkout ──────────────────────────────────────────────────────────────────
function Checkout({ shop, cur, infos, draft, setDraft, preview, api, go, onPlaced }: {
  shop: Shop; cur: string; infos: LineInfo[]; draft: OrderDraft; setDraft: (f: (d: OrderDraft) => OrderDraft) => void; preview: boolean; api: OrderApi; go: (r: ShopPage) => void; onPlaced: (o?: { token: string; orderNo: string; total: number }) => void;
}) {
  const t = useT() as unknown as Record<string, string>;
  const [errs, setErrs] = useState<FieldError[]>([]);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const [remembered, setRemembered] = useState(() => !preview && !!readBuyer());
  const ck = checkoutOf(shop);
  const dels = deliveriesOf(shop);
  const pays = paymentsOf(shop, draft.delivery);
  const opt: ShipOpt | null = ck.options.find((o) => o.id === draft.delivery) ?? null;
  const localSub = subtotalOf(infos);
  const feeOf = (o: ShipOpt) => (o.freeOver && localSub >= o.freeOver ? 0 : o.fee);
  const free = freeShipping(localSub, opt ? opt.freeOver : freeOverOf(ck) ?? undefined);
  // audit fix 1: when the database answered 'price_changed', the page shows ITS prices + total until the
  // buyer changes the cart or the delivery (then the page's own numbers apply again)
  const [priceNow, setPriceNow] = useState<{ key: string; now: PriceNow } | null>(null);
  const priceKey = JSON.stringify([draft.delivery, infos.map((x) => [x.line.pid, x.line.vid, x.line.qty])]);
  const pn = priceNow && priceNow.key === priceKey ? priceNow.now : null;
  const lineAmount = (x: LineInfo) => (pn?.items.find((i) => i.pid === x.line.pid && (i.vid ?? null) === (x.line.vid ?? null))?.price ?? x.price) * x.line.qty;
  const sub = pn ? pn.subtotal : localSub;
  const fee = pn ? pn.shipFee : opt ? feeOf(opt) : 0;
  const total = pn ? pn.total : localSub + fee;
  const set = (patch: Partial<OrderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const pickDelivery = (k: string) => setDraft((d) => {
    const m = readBuyer(); const last = k === "s711" || k === "fm" ? m?.stores?.[k]?.[0] : undefined;
    const ps = paymentsOf(shop, k);
    const firstPay = ps.find((p) => ck.methods.find((x) => x.id === p)?.kind === "first");
    const same = k === d.delivery;
    return { ...d, delivery: k, storeId: same ? d.storeId : last?.id || "", storeName: same ? d.storeName : last?.name || "", payment: d.payment && ps.includes(d.payment) ? d.payment : firstPay ?? ps[0] ?? null };
  });
  const bad = (f: FieldError) => errs.includes(f);
  const form = addrFormOf(shop.country);
  const addr = draft.addr ?? EMPTY_ADDR;
  const setAddr = (p: Partial<AddrParts>) => setDraft((d) => ({ ...d, addr: { ...(d.addr ?? EMPTY_ADDR), ...p } }));
  if (!infos.length) return <div className="v-wrap" style={{ padding: 16 }}><div className="v-box" style={{ padding: 24, textAlign: "center" }}><div style={mutedText}>{t.rd_shop_cart_empty}</div><button type="button" className="v-btn" style={{ marginTop: 14, padding: "0 20px" }} onClick={() => go({ page: "home" })}>{t.rd_shop_keep_shopping}</button></div></div>;

  const place = async () => {
    if (preview || busy) return;
    const e = draftErrors(draft, { delivery: dels, payment: pays, options: ck.options, methods: ck.methods, country: shop.country });
    setErrs(e); setFail("");
    if (e.length) { setFail(t.rd_shop_co_fix); return; }
    setBusy(true);
    const meth = ck.methods.find((m) => m.id === draft.payment)!;
    const r: PlaceResult = await api.place(shop.sub, {
      name: draft.name.trim(), phone: draft.phone.trim(), contact: draft.contact.trim(),
      // the option + method ids (sql/167) AND the kinds (what sql/163 reads, so an older database still works)
      ship: opt!.id, pay: meth.id, delivery: deliveryOfNeeds(opt!.needs), payment: meth.kind === "delivery" ? "cod" : meth.qr ? "qr" : "bank",
      storeId: draft.storeId.trim(), storeName: draft.storeName.trim(),
      address: opt!.needs === "address" ? composeAddress(form, draft.addr ?? EMPTY_ADDR, draft.address) : draft.address.trim(), note: draft.note.trim(),
      items: infos.map((x) => ({ pid: x.line.pid, vid: x.line.vid, qty: x.line.qty })),
      shownTotal: total, // the total on the screen — a different total in the database places nothing
    }, deviceId());
    setBusy(false);
    if (r.ok === false && r.error === "price_changed" && r.priceNow) { setPriceNow({ key: priceKey, now: r.priceNow }); return; }
    if (r.ok === true) { saveBuyer(draft); onPlaced({ token: r.token, orderNo: r.orderNo, total: r.total }); go({ page: "sent", token: r.token }); return; }
    setFail(placeFailText(t, r, infos));
    if (r.error === "bad_name") setErrs(["name"]); else if (r.error === "bad_phone") setErrs(["phone"]); else if (r.error === "bad_store") setErrs(["store"]); else if (r.error === "bad_address") setErrs(["address"]); else if (r.error === "bad_payment") setErrs(["payment"]); else if (r.error === "bad_delivery") setErrs(["delivery"]);
  };

  const field = (on: boolean) => ({ width: "100%", minHeight: 46, borderRadius: 8, border: `1.5px solid ${on ? "#DC2626" : "var(--s-line)"}`, padding: "10px 12px", fontSize: 16, background: "var(--s-bg)", color: "var(--s-fg)", boxSizing: "border-box" as const });
  return (
    <div data-testid="co-page">
    <div className="v-wrap" style={{ paddingBottom: 20 }}>
      <Steps at={2} t={t} />
      <h1 className="v-hide">{t.rd_shop_checkout}</h1>
      <div className="v-two">
        <div style={{ display: "grid", gap: 12 }}>
          <Card title={t.rd_shop_co_you} right={remembered ? <button type="button" data-testid="co-not-you" onClick={() => { forgetBuyer(); setRemembered(false); set({ name: "", phone: "", contact: "", address: "", storeId: "", storeName: "" }); }} style={linkBtn}>{t.rd_shop_co_not_you}</button> : null}>
            <div style={{ ...mutedText, fontSize: 12, marginTop: -4, marginBottom: 8 }}>{remembered ? t.rd_shop_co_saved : t.rd_co_no_account}</div>
            <Label text={t.rd_shop_co_name}><input data-testid="co-name" value={draft.name} maxLength={40} autoComplete="name" onChange={(e) => set({ name: e.target.value })} style={field(bad("name"))} /></Label>
            {bad("name") && <Err text={t.rd_shop_co_err_name} />}
            <Label text={t.rd_shop_co_phone}><input data-testid="co-phone" value={draft.phone} inputMode="tel" autoComplete="tel" maxLength={20} placeholder={phoneHintOf(shop.country)} onChange={(e) => set({ phone: e.target.value })} style={field(bad("phone"))} /></Label>
            {bad("phone") && <Err text={t.rd_shop_co_err_phone} />}
            <Label text={t.rd_shop_co_contact}><input data-testid="co-contact" value={draft.contact} maxLength={60} onChange={(e) => set({ contact: e.target.value })} style={field(false)} /></Label>
          </Card>

          <Card title={t.rd_shop_delivery}>
            <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ck.options.map((o) => (
                <Choice key={o.id} testid={`co-del-${o.id}`} on={draft.delivery === o.id} onPick={() => pickDelivery(o.id)} title={shipLabel(t, o)} sub={o.note} right={feeOf(o) === 0 ? t.rd_shop_co_free : money(cur, feeOf(o))} bad={bad("delivery")} />
              ))}
            </div>
            {opt && (opt.needs === "store711" || opt.needs === "storefm") && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 6 }}>{t.rd_shop_co_store}</div>
                {/^\d{6}$/.test(draft.storeId)
                  ? <div data-testid="co-store" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, border: "1px solid var(--s-line)", borderRadius: 11, padding: "10px 12px" }}>
                      <span style={{ minWidth: 0 }}><b>{draft.storeName || shipLabel(t, opt)}</b><span style={{ ...mutedText, display: "block" }}>#{draft.storeId}</span></span>
                      <button type="button" style={linkBtn} onClick={() => go({ page: "store" })}>{t.rd_shop_co_change}</button>
                    </div>
                  : <button type="button" data-testid="co-choose-store" className="v-btn v-o" style={{ width: "100%", borderColor: bad("store") ? "#DC2626" : undefined }} onClick={() => go({ page: "store" })}>{t.rd_shop_co_choose_store}</button>}
                {bad("store") && <Err text={t.rd_shop_co_err_store} />}
              </div>
            )}
            {opt?.needs === "store" && (
              <div style={{ marginTop: 12 }}>
                <Label text={t.rd_shop_co_store_typed}><input data-testid="co-store-name" value={draft.storeName} maxLength={40} onChange={(e) => set({ storeName: e.target.value })} style={field(bad("store"))} /></Label>
                {bad("store") && <Err text={t.rd_shop_co_err_store_typed} />}
              </div>
            )}
            {opt?.needs === "address" && form !== "free" && (
              <div data-testid="co-addr-form" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 2 }}>
                <Label text={t.rd_shop_addr_street}><input data-testid="co-addr-street" value={addr.street} maxLength={100} autoComplete="address-line1" onChange={(e) => setAddr({ street: e.target.value })} style={field(bad("address") && addr.street.trim().length < 3)} /></Label>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1.4, minWidth: 0 }}><Label text={form === "AU" ? t.rd_shop_addr_suburb : t.rd_shop_addr_city}><input data-testid="co-addr-city" value={addr.city} maxLength={50} autoComplete="address-level2" onChange={(e) => setAddr({ city: e.target.value })} style={field(bad("address") && !addr.city.trim())} /></Label></div>
                  <div style={{ flex: 1, minWidth: 0 }}><Label text={form === "AU" ? t.rd_shop_addr_state : t.rd_shop_addr_province}>
                    <select data-testid="co-addr-region" value={addr.region} autoComplete="address-level1" onChange={(e) => setAddr({ region: e.target.value })} style={field(bad("address") && !addr.region)}>
                      <option value="">—</option>
                      {(form === "AU" ? AU_STATES : CA_PROVINCES).map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </Label></div>
                </div>
                <Label text={form === "AU" ? t.rd_shop_addr_postcode : t.rd_shop_addr_postal}><input data-testid="co-addr-post" value={addr.post} maxLength={8} inputMode={form === "AU" ? "numeric" : "text"} autoComplete="postal-code" placeholder={form === "AU" ? "2000" : "A1A 1A1"} onChange={(e) => setAddr({ post: e.target.value })} onBlur={() => setAddr({ post: cleanPost(form, addr.post) })} style={{ ...field(bad("postal")), maxWidth: 180, textTransform: "uppercase" }} /></Label>
                {bad("address") && <Err text={t.rd_shop_co_err_address_parts} />}
                {bad("postal") && <Err text={form === "AU" ? t.rd_shop_co_err_postcode : t.rd_shop_co_err_postal} />}
              </div>
            )}
            {opt?.needs === "address" && form === "free" && (
              <div style={{ marginTop: 12 }}>
                <Label text={t.rd_shop_co_address}><textarea data-testid="co-address" value={draft.address} maxLength={200} rows={2} autoComplete="street-address" onChange={(e) => set({ address: e.target.value })} style={{ ...field(bad("address")), resize: "vertical" }} /></Label>
                {bad("address") && <Err text={t.rd_shop_co_err_address} />}
              </div>
            )}
            {opt?.needs === "none" && <div data-testid="co-pickup-note" style={{ ...mutedText, fontSize: 12.5, marginTop: 10 }}>{t.rd_shop_co_pickup_note}</div>}
          </Card>

          <Card title={t.rd_shop_payment}>
            <div role="radiogroup" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ck.methods.map((m) => {
                const off = m.kind === "delivery" && !opt?.cod;
                return <Choice key={m.id} testid={`co-pay-${m.id}`} on={draft.payment === m.id && !off} disabled={off} onPick={() => set({ payment: m.id })} title={payLabel(t, m)} sub={off ? (opt?.needs === "address" ? t.rd_shop_co_cod_home : t.rd_shop_co_cod_not_here) : m.kind === "delivery" ? t.rd_shop_od_cod : t.rd_shop_co_pay_first} bad={bad("payment")} />;
              })}
            </div>
            {bad("payment") && <Err text={t.rd_shop_co_err_payment} />}
            {draft.payment && (() => { const m = ck.methods.find((x) => x.id === draft.payment); return m ? <div className="v-note" data-testid="co-pay-note" style={{ marginTop: 4 }}>{m.kind === "delivery" ? tpl(t.rd_co_pay_later, { amount: money(cur, total) }) : tpl(t.rd_co_pay_first, { n: String(ck.autoCancelHours) })}</div> : null; })()}
          </Card>

          <Card title={t.rd_shop_co_note}>
            <textarea data-testid="co-note" value={draft.note} maxLength={200} rows={2} onChange={(e) => set({ note: e.target.value })} style={{ ...field(false), resize: "vertical" }} />
          </Card>
        </div>

        <div className="v-side">
          <div className="v-box">
            <div className="v-lbl">{t.rd_shop_co_summary}</div>
            {infos.map((x) => (
              <div key={`${x.line.pid}:${x.line.vid}`} style={{ display: "flex", gap: 10, padding: "6px 0", alignItems: "center" }}>
                <div style={{ width: 44, height: 44, borderRadius: 9, overflow: "hidden", background: "var(--s-bg)", flexShrink: 0 }}>{x.photo && <SmallPhoto path={x.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
                <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}><div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.product.name}</div><div style={mutedText}>{[x.label, `×${x.line.qty}`].filter(Boolean).join(" · ")}</div></div>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{money(cur, lineAmount(x))}</div>
              </div>
            ))}
            <div className="v-sum" style={{ marginTop: 6 }}>
              <Row a={tpl(t.rd_shop_items_n, { n: String(infos.reduce((a, x) => a + x.line.qty, 0)) })} b={money(cur, sub)} />
              <div><span>{t.rd_shop_shipping}{opt ? ` · ${shipLabel(t, opt)}` : ""}</span><b className={opt && fee === 0 ? "v-g" : ""}>{opt ? (fee === 0 ? t.rd_shop_co_free : money(cur, fee)) : "—"}</b></div>
              <div className="v-t"><span>{t.rd_shop_co_total}</span><span data-testid="co-total">{money(cur, total)}</span></div>
            </div>
            {free && free.remaining > 0 && <div style={{ ...mutedText, fontSize: 12.5, marginTop: 6 }}>{tpl(t.rd_shop_free_more, { amount: money(cur, free.remaining) })}</div>}
            {ck.taxIncluded && <div data-testid="co-tax" style={{ ...mutedText, fontSize: 12.5, marginTop: 4 }}>{t.rd_shop_tax_incl}</div>}
            {pn && <div role="alert" data-testid="co-price-changed" className="v-note" style={{ marginTop: 12, fontSize: 13.5, fontWeight: 700 }}>{tpl(t.rd_co_price_changed, { amount: money(cur, pn.total) })}</div>}
            {fail && <div role="alert" data-testid="co-fail" style={{ marginTop: 12, color: "#B91C1C", background: "#FEF2F2", borderRadius: 10, padding: "10px 12px", fontSize: 13.5, fontWeight: 700 }}>{fail}</div>}
            {preview && <div data-testid="co-preview" style={{ marginTop: 12, ...mutedText }}>{t.rd_shop_co_preview}</div>}
            <div className="v-dbuy" style={{ marginTop: 12 }}><button type="button" data-testid="co-place" className="v-btn" disabled={busy || preview} onClick={() => void place()}>{busy ? t.rd_shop_co_placing : `${t.rd_shop_co_place} · ${money(cur, total)}`}</button></div>
            <p data-testid="co-privacy" style={{ ...mutedText, fontSize: 11.5, marginTop: 10, marginBottom: 0, textAlign: "center" }}>🔒 {tpl(t.rd_shop_co_privacy, { shop: shop.shop.name || "" })}</p>
          </div>
        </div>
      </div>
    </div>
      <div className="v-buy">
        <div className="v-tot">{t.rd_shop_co_total}<b>{money(cur, total)}</b></div>
        <button type="button" data-testid="co-place-phone" className="v-btn" disabled={busy || preview} onClick={() => void place()}>{busy ? t.rd_shop_co_placing : t.rd_shop_co_place}</button>
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
  const field = { width: "100%", minHeight: 46, borderRadius: 8, border: "1.5px solid var(--s-line)", padding: "10px 12px", fontSize: 16, boxSizing: "border-box" as const, background: "var(--s-bg)", color: "var(--s-fg)" };
  return (
    <div className="v-wrap" style={{ padding: "12px 12px 40px", maxWidth: 640 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: "4px 2px 12px" }}>{k === "fm" ? t.rd_shop_st_title_fm : t.rd_shop_st_title_s711}</h1>
      <div className="v-box" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <Label text={t.rd_shop_st_number}><input data-testid="st-id" value={id} inputMode="numeric" maxLength={6} onChange={(e) => setId(e.target.value.replace(/\D/g, "").slice(0, 6))} style={{ ...field, letterSpacing: 2, fontWeight: 700 }} /></Label>
        <Label text={t.rd_shop_st_name}><input data-testid="st-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={field} /></Label>
        <a data-testid="st-map" href={STORE_MAPS[k]} target="_blank" rel="noreferrer noopener" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--s-acc)", minHeight: 32, display: "inline-flex", alignItems: "center" }}>🗺 {t.rd_shop_st_find} ↗</a>
        <button type="button" data-testid="st-use" className="v-btn" disabled={!okId} onClick={() => use(id, name)}>{t.rd_shop_st_use}</button>
      </div>
      {recent.length > 0 && (
        <div className="v-box" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>{t.rd_shop_st_recent}</div>
          {recent.map((s) => (
            <button key={s.id} type="button" data-testid="st-recent" onClick={() => use(s.id, s.name)} style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 4px", minHeight: 48, border: "none", borderTop: "1px solid var(--s-line)", background: "transparent", cursor: "pointer", textAlign: "left", color: "var(--s-fg)" }}>
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
  const lang = useLang();
  const [view, setView] = useState<OrderView | null | "loading">("loading");
  const [up, setUp] = useState<"" | "busy" | "ok" | "fail" | "big" | "bad">("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { let live = true; void api.load(token).then((v) => { if (live) setView(v); }); return () => { live = false; }; }, [api, token]);
  if (view === "loading") return <div className="v-wrap" style={{ padding: 30, textAlign: "center", ...mutedText }}>…</div>;
  if (!view) return <div className="v-wrap" style={{ padding: 30, textAlign: "center" }}><p data-testid="od-missing">{t.rd_shop_od_not_found}</p><button type="button" className="v-btn" style={{ padding: "0 18px" }} onClick={onShop}>{t.rd_shop_od_back_shop}</button></div>;
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
  // order tracking (sql/171): the parcel from Pickup Status — only a shipped 7-ELEVEN / FamilyMart order, one match
  const parcel = orderParcel(view);
  const timeline = orderTimeline(t, view, parcel ? { parcel, when: (iso) => parcelWhen(iso, lang), store: timelineStore(t, view) } : undefined);
  return (
    <div className="v-wrap" style={{ paddingBottom: 40 }} data-testid="od-page">
      {parcel && <style>{PARCEL_CSS}</style>}
      <Steps at={3} t={t} />
      <div className="v-two"><div style={{ display: "grid", gap: 12, alignContent: "start" }}>
      {fresh && (
        <div data-testid="od-sent" style={{ textAlign: "center", padding: "14px 0 6px" }}>
          <div aria-hidden="true" style={{ width: 58, height: 58, borderRadius: 29, background: "#ECFDF5", color: "#059669", fontSize: 30, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>✓</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "10px 0 2px" }}>{t.rd_shop_od_sent}</h1>
        </div>
      )}
      <div className="v-box" style={{ padding: 14, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 data-testid="od-no" style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{tpl(t.rd_shop_od_order, { no: view.orderNo })}</h2>
          <span data-testid="od-status" style={{ fontSize: 12.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, background: view.status === "cancelled" ? "var(--s-bg)" : view.status === "shipped" || view.status === "paid" ? "#ECFDF5" : "#FFF7ED", color: view.status === "cancelled" ? "var(--s-mut)" : view.status === "shipped" || view.status === "paid" ? "#047857" : "#C2410C" }}>{t[`rd_shop_od_st_${view.status}`]}</span>
        </div>
        {parcel?.state === "returned" && (
          <div className="v-pnote v-bad" data-testid="od-returned">
            <b>{t.rd_pk_ret_title}</b>
            <span>{t.rd_pk_ret_text}</span>
            {chats.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                {chats.map(([k, v]) => {
                  const key = k as keyof typeof CHAT_PREFILL;
                  return (
                    <a key={k} data-testid={`od-ret-chat-${k}`} href={chatHref(key, String(v), CHAT_PREFILL[key] ? text : undefined)!} target="_blank" rel="noreferrer noopener" className="v-btn v-o"
                      onClick={() => { void copyText(text); say(tpl(t.rd_shop_od_copied_paste, { app: CHAT_APP_NAME[k] })); }}
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", minHeight: 40, padding: "0 12px", fontSize: 13 }}><BrandIcon brand={k as BrandKey} size={16} />{CHAT_APP_NAME[k]}</a>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {parcel?.state === "at_store" && parcel.deadline && <PickupBox day={parcel.deadline} lang={lang} t={t} store={timelineStore(t, view)} pay={view.payment === "cod" ? money(cur, view.total) : ""} />}
        {view.status !== "cancelled" && (
          <div className="v-tl" data-testid="od-steps" style={{ marginTop: 14 }}>
            {timeline.map((x, i) => <div key={i} className={x.st ? `v-${x.st}` : ""} data-state={x.st || "next"}>{x.sub ? <span className="v-sub2">{x.label}<small>{x.sub}</small></span> : x.label}</div>)}
          </div>
        )}
        {parcel?.checkedAt && <div data-testid="od-updated" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--s-line)", fontSize: 12, color: "var(--s-mut)" }}>{tpl(t.rd_pk_updated, { time: parcelWhen(parcel.checkedAt, lang) })}</div>}
        {view.paymentIssue && view.status === "awaiting_payment" && <Note tone="red" testid="od-issue">{t.rd_shop_od_issue}</Note>}
        {view.status === "cancelled" && <Note tone="grey" testid="od-cancelled">{view.cancelReason === "auto" ? t.rd_shop_od_cancel_auto : t.rd_shop_od_cancel_seller}</Note>}
      </div>

      {waiting && view.payment !== "cod" && (
        <div className="v-box" data-testid="od-pay" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>{tpl(t.rd_shop_od_pay_now, { amount: money(cur, view.total) })}</div>
          {view.pay?.method && <PayMethodBox m={view.pay.method} t={t} say={say} />}
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
              <img data-testid="od-qr" src={photoUrl(view.pay.qr.path)} alt={t.rd_shop_od_scan} style={{ width: "min(240px, 70vw)", aspectRatio: "1 / 1", objectFit: "contain", borderRadius: 12, border: "1px solid var(--s-line)", background: "#fff" }} />
            </div>
          )}
          {view.status === "awaiting_payment" && view.autoCancelAt && <div style={{ marginTop: 12, ...mutedText, fontSize: 12.5 }}><AutoCancelIn end={view.autoCancelAt} label={t.rd_od_autocancel_in} /></div>}
          <input ref={fileRef} type="file" accept="image/*" data-testid="od-file" style={{ display: "none" }} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" data-testid="od-upload" className="v-btn" style={{ width: "100%", marginTop: 14 }} disabled={up === "busy"} onClick={() => fileRef.current?.click()}>
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
        <div className="v-box" data-testid="od-chat" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{fresh ? t.rd_shop_od_send_title : t.rd_shop_od_message}</div>
          <div style={{ ...mutedText, fontSize: 12.5, margin: "2px 0 10px" }}>{t.rd_shop_od_send_hint}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
            {chats.map(([k, v]) => {
              const key = k as keyof typeof CHAT_PREFILL;
              const href = chatHref(key, String(v), CHAT_PREFILL[key] ? text : undefined)!;
              return (
                <a key={k} data-testid={`od-chat-${k}`} href={href} target="_blank" rel="noreferrer noopener" className="v-btn v-o"
                  onClick={() => { void copyText(text); say(tpl(t.rd_shop_od_copied_paste, { app: CHAT_APP_NAME[k] })); }}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, textDecoration: "none", minHeight: 44, padding: "0 12px" }}><BrandIcon brand={k as BrandKey} size={18} />{CHAT_APP_NAME[k]}</a>
              );
            })}
          </div>
        </div>
      )}

      </div><div className="v-side" style={{ display: "grid", gap: 12, alignContent: "start" }}>
      <div className="v-box">
        <div className="v-lbl">{t.rd_shop_co_summary}</div>
        {view.items.map((i, n) => (
          <div key={n} style={{ display: "flex", gap: 10, padding: "6px 0", alignItems: "center" }}>
            <div style={{ width: 44, height: 44, borderRadius: 9, overflow: "hidden", background: "var(--s-bg)", flexShrink: 0 }}>{i.photo && <SmallPhoto path={i.photo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}><div style={{ fontWeight: 700 }}>{i.name}</div><div style={mutedText}>{[i.label, i.code, `×${i.qty}`].filter(Boolean).join(" · ")}</div></div>
            <div style={{ fontWeight: 700, fontSize: 13.5 }}>{money(cur, i.price * i.qty)}</div>
          </div>
        ))}
        <div className="v-sum" style={{ marginTop: 6 }}>
          <Row a={t.rd_shop_subtotal} b={money(cur, view.subtotal)} />
          <Row a={t.rd_shop_shipping} b={view.shipFee ? money(cur, view.shipFee) : t.rd_shop_co_free} />
          <div className="v-t"><span>{t.rd_shop_co_total}</span><span data-testid="od-total">{money(cur, view.total)}</span></div>
        </div>
        <div style={{ borderTop: "1px solid var(--s-line)", marginTop: 12, paddingTop: 10, display: "flex", flexDirection: "column", gap: 4, fontSize: 13.5 }}>
          <KV k={t.rd_shop_od_ship_to} v={[deliveryLabel(t, view.delivery, view.shipId, view.shipName), deliveryWhere(view)].filter(Boolean).join(" · ")} />
          {view.status === "shipped" && view.courier && <KV k={t.rd_wor_courier} v={<span data-testid="od-courier">{view.courier}</span>} />}
          {view.status === "shipped" && view.tracking && <KV k={t.rd_wor_tracking} v={<span data-testid="od-tracking">{view.tracking}</span>} copy={() => { void copyText(view.tracking!); say(t.rd_shop_od_copied); }} copyLabel={t.rd_shop_od_copy} />}
          <KV k={t.rd_shop_payment} v={paymentLabel(t, view.payment, view.payId, view.payName)} />
          <KV k={t.rd_shop_msg_name} v={`${view.buyerName} · ***${view.phoneTail}`} />
        </div>
      </div>

      {link && (
        <div className="v-box" style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{t.rd_shop_od_link}</div>
          <div style={{ ...mutedText, fontSize: 12.5, margin: "2px 0 8px" }}>{t.rd_shop_od_link_hint}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={link} aria-label={t.rd_shop_od_link} data-testid="od-link" style={{ flex: 1, minWidth: 0, minHeight: 44, borderRadius: 10, border: "1px solid var(--s-line)", padding: "0 10px", fontSize: 13, color: "#374151", background: "var(--s-bg)" }} />
            <button type="button" className="v-btn v-o" style={{ padding: "0 14px" }} onClick={() => { void copyText(link); say(t.rd_shop_od_copied); }}>{t.rd_shop_od_copy}</button>
          </div>
        </div>
      )}
      <div style={{ textAlign: "center" }}><button type="button" className="v-btn v-o" style={{ padding: "11px 20px" }} onClick={onShop}>{t.rd_shop_od_back_shop}</button></div>
      </div></div>
    </div>
  );
}
// order tracking: the order's own store ("FamilyMart Xinyi #151003")
function timelineStore(t: Record<string, string>, v: OrderView): string {
  const w = deliveryWhere(v);
  return w ? `${deliveryLabel(t, v.delivery, v.shipId, v.shipName)} ${w}` : "";
}
// order tracking item 4: the parcel is at the store — the deadline, days left (on this device), the store, and the
// amount to pay at pickup (pay-on-delivery only). Past the deadline (not yet returned): the date only.
function PickupBox({ day, lang, t, store, pay }: { day: string; lang: string; t: Record<string, string>; store: string; pay: string }) {
  const n = daysLeft(day);
  const left = n === null || n < 0 ? "" : n === 0 ? t.rd_pk_today : n === 1 ? t.rd_pk_day1 : tpl(t.rd_pk_days, { n: String(n) });
  const line = [left, store, pay ? tpl(t.rd_pk_pay, { amount: pay }) : ""].filter(Boolean).join(" · ");
  return (
    <div className="v-pnote v-warn" data-testid="od-pickup">
      <b>{tpl(t.rd_pk_by, { date: parcelDay(day, lang) })}</b>
      {line && <span>{line}</span>}
    </div>
  );
}
function hoursLeftLabel(v: OrderView): number {
  const total = v.autoCancelAt && v.createdAt ? Math.round((Date.parse(v.autoCancelAt) - Date.parse(v.createdAt)) / 3600000) : 24;
  return Number.isFinite(total) && total > 0 ? total : 24;
}

// ── small pieces ────────────────────────────────────────────────────────────────
const linkBtn = { border: "none", background: "transparent", color: "var(--s-acc)", fontWeight: 800, fontSize: 13.5, cursor: "pointer", minHeight: 36, padding: "0 4px" } as const;
function Card({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return <section className="v-box"><div className="v-lbl"><span>{title}</span>{right}</div>{children}</section>;
}
function Label({ text, children }: { text: string; children: ReactNode }) {
  return <label className="v-fld"><span>{text}</span>{children}</label>;
}
function Err({ text }: { text: string }) { return <div role="alert" className="v-err">{text}</div>; }
function Choice({ on, onPick, title, sub, right, testid, bad, disabled }: { on: boolean; onPick: () => void; title: string; sub?: string; right?: string; testid: string; bad?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="radio" aria-checked={on} data-testid={testid} disabled={disabled} onClick={onPick} className={`v-radio${on ? " v-on" : ""}${bad ? " v-bad" : ""}`}>
      <i aria-hidden="true" /><span style={{ minWidth: 0 }}><b>{title}</b>{sub && <small>{sub}</small>}</span>{right && <em>{right}</em>}
    </button>
  );
}
function Row({ a, b }: { a: string; b: string }) { return <div><span>{a}</span><b>{b}</b></div>; }
function KV({ k, v, copy, copyLabel }: { k: string; v: ReactNode; copy?: () => void; copyLabel?: string }) {
  return <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}><span style={{ color: "var(--s-mut)", flexShrink: 0 }}>{k}</span><span style={{ fontWeight: 700, textAlign: "right", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: 8 }}>{v}{copy && <button type="button" onClick={copy} style={{ ...linkBtn, fontSize: 12.5 }}>{copyLabel}</button>}</span></div>;
}
/** A v2 payment method on the order link: its name, bank details, instructions (copy) and QR. */
/** "Auto-cancels in HH:MM:SS" — runs down to the order's real auto-cancel time (the device clock), stops at 00:00:00. */
function AutoCancelIn({ end, label }: { end: string; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return <span className="v-cd" data-testid="od-countdown">{label} {countdown(end, now).split(":").map((x, k) => <span key={k}>{k ? ":" : ""}<i>{x}</i></span>)}</span>;
}

function PayMethodBox({ m, t, say }: { m: PayOpt; t: Record<string, string>; say: (s: string) => void }) {
  return (
    <div data-testid="od-method" style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>{payLabel(t, m)}</div>
      {m.bank?.bankName && <KV k={t.rd_shop_od_bank} v={m.bank.bankName} />}
      {m.bank?.accountName && <KV k={t.rd_shop_od_acct_name} v={m.bank.accountName} />}
      {m.bank?.accountNumber && <KV k={t.rd_shop_od_acct_no} v={m.bank.accountNumber} copy={() => { void copyText(m.bank!.accountNumber!); say(t.rd_shop_od_copied); }} copyLabel={t.rd_shop_od_copy} />}
      {m.info && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "var(--s-bg)", borderRadius: 10, padding: "10px 12px" }}>
          <span data-testid="od-method-info" style={{ flex: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13.5 }}>{m.info}</span>
          <button type="button" onClick={() => { void copyText(m.info!); say(t.rd_shop_od_copied); }} style={{ ...linkBtn, fontSize: 12.5 }}>{t.rd_shop_od_copy}</button>
        </div>
      )}
      {m.qr && (
        <div style={{ textAlign: "center", marginTop: 4 }}>
          <div style={{ ...mutedText, marginBottom: 6 }}>{t.rd_shop_od_scan}</div>
          <img data-testid="od-method-qr" src={photoUrl(m.qr)} alt={t.rd_shop_od_scan} style={{ width: "min(240px, 70vw)", aspectRatio: "1 / 1", objectFit: "contain", borderRadius: 12, border: "1px solid var(--s-line)", background: "#fff" }} />
        </div>
      )}
    </div>
  );
}
function Note({ tone, children, testid }: { tone: "red" | "grey" | "green"; children: ReactNode; testid: string }) {
  const c = tone === "red" ? { background: "#FEF2F2", color: "#B91C1C" } : tone === "green" ? { background: "var(--s-acc2)", color: "var(--s-ok)" } : { background: "var(--s-bg)", color: "var(--s-mut)" };
  return <div data-testid={testid} className="v-note" style={{ marginTop: 12, fontWeight: 700, ...c }}>{children}</div>;
}
/** "1 Cart › 2 Details › 3 Done" (as the preview). */
export function Steps({ at, t }: { at: 1 | 2 | 3; t: Record<string, string> }) {
  return <div className="v-stp" data-testid="shop-steps-bar"><span className={at === 1 ? "v-on" : ""}>1 {t.rd_shop_cart}</span>›<span className={at === 2 ? "v-on" : ""}>2 {t.rd_co_details}</span>›<span className={at === 3 ? "v-on" : ""}>3 {t.rd_co_done}</span></div>;
}
