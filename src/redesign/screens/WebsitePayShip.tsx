// Seller Website — Payment & shipping (Website → Payment & shipping). Saved in seller_websites.settings;
// buyers see only what website_checkout_public lets through (fees, free-over, bank details, QR, COD).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import SaveButton from "../components/SaveButton";
import type { SaveOutcome } from "../adapters/buttonFeedback";
import { useScreenTimers } from "../adapters/useScreenTimers";
import { headerBar, headerTitle, card } from "../ui";
import { useT } from "../i18n";
import { HeaderWithBack } from "../components/BackButton";
import { productImageUrl } from "../adapters/productImages";
import { DEFAULT_SETTINGS, settingsProblems } from "../adapters/websiteEditor";
import type { WebsiteSettings } from "../adapters/websiteSeller";
import { realPayShipApi, type PayShipApi } from "../adapters/websiteEditorApi";
import { editorShipOptions, withShipOptions, newShipOption, shipProblems, MAX_SHIP_OPTIONS, editorPayMethods, withPayMethods, newPayMethod, payProblems, MAX_PAY_METHODS, type ShipSetting, type PaySetting } from "../adapters/websiteShipPay";
import { shipLabel, payLabel, type PayKind, type ShipNeeds } from "../../website/shipPay";

export default function WebsitePayShip({ onBack, onToast, cur = "NT$", country = "TW", api = realPayShipApi }: { onBack?: () => void; onToast: (m: string) => void; cur?: string; country?: string; api?: PayShipApi }) {
  const t = useT() as unknown as Record<string, string>;
  const [st, setSt] = useState<WebsiteSettings | null | "error">(null);
  const [ships, setShips] = useState<ShipSetting[]>([]);
  const [openShip, setOpenShip] = useState<string | null>(null);
  const [pays, setPays] = useState<PaySetting[]>([]);
  const [qrFor, setQrFor] = useState("");
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "qr">("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  // what was last saved (the same shape the Save sends) — the Save button says "Saved" while the form equals it
  const [savedKey, setSavedKey] = useState("");
  const msgAt = useRef<HTMLDivElement | null>(null);
  const later = useScreenTimers();
  useEffect(() => {
    let live = true;
    void api.load().then((w) => {
      if (!live) return;
      if (w === "error") { setSt("error"); return; }
      setExists(!!w);
      const merged = { ...DEFAULT_SETTINGS, ...(w?.settings || {}), ship: { ...DEFAULT_SETTINGS.ship, ...(w?.settings?.ship || {}) } };
      setSt(merged);
      const ships0 = editorShipOptions(merged, country), pays0 = editorPayMethods(merged, country);
      setShips(ships0);
      setPays(pays0);
      setSavedKey(JSON.stringify(withPayMethods(withShipOptions(merged, ships0), pays0)));
    });
    return () => { live = false; };
  }, [api, country]);
  if (st === null) return <Frame t={t} onBack={onBack}><div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>…</div></Frame>;
  if (st === "error") return <Frame t={t} onBack={onBack}><div style={{ ...card, margin: 14, color: "var(--danger)" }}>{t.rd_wor_load_failed}</div></Frame>;
  const s = st;
  const setShip = (id: string, p: Partial<ShipSetting>) => setShips((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const setPay = (id: string, p: Partial<PaySetting>) => setPays((l) => l.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const full = withPayMethods(withShipOptions(s, ships), pays);
  const problems = settingsProblems(full, country);
  const fullKey = JSON.stringify(full);
  // "Saved" (not tappable) only when the form is what was last saved AND has nothing left to fix — a form that
  // still needs a delivery or a payment keeps its Save so the tap can say what is missing
  const dirty = !exists || fullKey !== savedKey || problems.length > 0 || shipProblems(ships).length > 0 || payProblems(pays).length > 0;
  // nothing was sent: the message says what to fix and is brought into view (components/SaveButton.tsx "blocked")
  const blocked = (text: string): SaveOutcome => {
    setMsg({ text, tone: "bad" });
    later(() => { try { msgAt.current?.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* no scrolling here */ } }, 0);
    return "blocked";
  };
  const save = async (): Promise<SaveOutcome> => {
    setMsg(null);
    if (!exists) return blocked(t.rd_wed_need_name);
    if (shipProblems(ships).includes("name")) return blocked(t.rd_wps_ship_need_name);
    const pp = payProblems(pays);
    if (pp.includes("name")) return blocked(t.rd_wps_pay_need_name);
    if (pp.includes("empty")) return blocked(t.rd_wps_pay_need_info);
    if (problems.length) return blocked(problems.includes("ship") ? t.rd_wps_need_ship : t.rd_wps_need_pay);
    setBusy("save");
    const ok = await api.save(full);
    setBusy("");
    setMsg(ok ? { text: t.rd_wed_saved, tone: "ok" } : { text: t.rd_wed_save_failed, tone: "bad" });
    if (ok) setSavedKey(fullKey);
    return ok;
  };
  const qr = async (id: string, f: File | undefined) => {
    if (!f) return;
    setBusy("qr"); setQrFor(id);
    const path = await api.uploadQr(f);
    setBusy(""); setQrFor("");
    if (path) setPay(id, { qr: path }); else onToast(t.rd_wed_pic_failed);
  };
  const num = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };
  const input: CSSProperties = { width: "100%", minHeight: 44, borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", padding: "9px 11px", fontSize: 16, boxSizing: "border-box", fontFamily: "var(--font-ui)" };
  const custom = (x: ShipSetting) => /^c[0-9a-z]{5}$/.test(x.id);
  const needsChoices: [ShipNeeds, string][] = [["address", t.rd_wps_needs_address], ["store", t.rd_wps_needs_store], ["none", t.rd_wps_needs_none]];
  const needsText = (n: ShipNeeds) => (n === "store711" || n === "storefm" ? t.rd_wps_needs_store_tw : needsChoices.find(([k]) => k === n)?.[1] || "");
  return (
    <Frame t={t} onBack={onBack}>
      <div style={{ padding: "14px 14px 110px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, margin: "0 auto" }}>
        <section style={card} data-testid="wps-ship">
          <Title>{t.rd_shop_delivery}</Title>
          {ships.map((x) => {
            const label = x.name.trim() || (x.id === "s711" ? t.rd_wps_s711 : x.id === "fm" ? t.rd_wps_fm : shipLabel(t, x));
            const open = openShip === x.id;
            return (
              <div key={x.id} data-testid="wps-ship-row" style={{ borderTop: "1px solid var(--border)", padding: "6px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Switch on={x.on} testid={`wps-ship-${x.id}`} label={label} onTap={() => setShip(x.id, { on: !x.on })} />
                  <button type="button" data-testid={`wps-ship-edit-${x.id}`} aria-expanded={open} onClick={() => setOpenShip(open ? null : x.id)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", padding: "6px 0", cursor: "pointer", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label || t.rd_wps_ship_new}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)" }}>{needsText(x.needs)}{x.cod ? ` · ${t.rd_wps_ship_cod_short}` : ""} · {open ? "▴" : "✎"}</span>
                  </button>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_wps_fee}</span>
                  <input data-testid={`wps-fee-${x.id}`} inputMode="decimal" disabled={!x.on} value={String(x.fee)} onChange={(e) => setShip(x.id, { fee: num(e.target.value) })} aria-label={`${label} ${t.rd_wps_fee}`} style={{ ...input, width: 88, minWidth: 0, textAlign: "right", opacity: x.on ? 1 : 0.5 }} />
                </div>
                {open && (
                  <div data-testid={`wps-ship-more-${x.id}`} style={{ padding: "2px 0 8px 58px" }}>
                    <Field label={t.rd_wps_ship_name}><input data-testid={`wps-ship-name-${x.id}`} value={x.name} maxLength={40} placeholder={custom(x) ? "" : label} onChange={(e) => setShip(x.id, { name: e.target.value })} style={input} /></Field>
                    <Field label={t.rd_wps_ship_note}><input data-testid={`wps-ship-note-${x.id}`} value={x.note} maxLength={80} placeholder={t.rd_wps_ship_note_ph} onChange={(e) => setShip(x.id, { note: e.target.value })} style={input} /></Field>
                    <Field label={`${t.rd_wps_free_over} (${cur})`}><input data-testid={`wps-ship-free-${x.id}`} inputMode="decimal" value={String(x.freeOver || 0)} onChange={(e) => setShip(x.id, { freeOver: num(e.target.value) })} style={{ ...input, width: 140 }} /></Field>
                    {custom(x) && (
                      <Field label={t.rd_wps_needs}>
                        <select data-testid={`wps-ship-needs-${x.id}`} value={x.needs} onChange={(e) => setShip(x.id, { needs: e.target.value as ShipNeeds })} style={input}>
                          {needsChoices.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </Field>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Switch on={x.cod} testid={`wps-ship-cod-${x.id}`} label={t.rd_wps_ship_cod} onTap={() => setShip(x.id, { cod: !x.cod })} />
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t.rd_wps_ship_cod}</span>
                    </div>
                    {custom(x) && <button type="button" data-testid={`wps-ship-remove-${x.id}`} onClick={() => { setShips((l) => l.filter((y) => y.id !== x.id)); setOpenShip(null); }} style={{ marginTop: 6, minHeight: 40, border: "none", background: "transparent", color: "var(--danger)", fontWeight: 800, cursor: "pointer", padding: 0, fontFamily: "var(--font-ui)" }}>{t.rd_wps_ship_remove}</button>}
                  </div>
                )}
              </div>
            );
          })}
          {ships.length < MAX_SHIP_OPTIONS + 3 && ships.filter(custom).length < MAX_SHIP_OPTIONS && (
            <button type="button" data-testid="wps-ship-add" onClick={() => { const n = newShipOption(); setShips((l) => [...l, n]); setOpenShip(n.id); }} style={{ marginTop: 8, width: "100%", minHeight: 44, borderRadius: 11, border: "1px dashed var(--border)", background: "transparent", color: "var(--accent-fg)", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "var(--font-ui)" }}>＋ {t.rd_wps_ship_add}</button>
          )}
        </section>

        <section style={card} data-testid="wps-pay">
          <Title>{t.rd_shop_payment}</Title>
          <div style={{ fontSize: 12, color: "var(--text-muted)", margin: "-4px 0 6px" }}>{t.rd_wps_pay_direct}</div>
          {pays.map((m) => {
            const label = m.name.trim() || payLabel(t, m);
            const sw = m.id === "bank" ? "wps-bank" : m.id === "qr" ? "wps-qr" : m.id === "cod" ? "wps-cod" : `wps-pay-${m.id}`;
            const isNew = /^c[0-9a-z]{5}$/.test(m.id);
            return (
              <div key={m.id} data-testid="wps-pay-row" style={{ borderTop: "1px solid var(--border)", padding: "4px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Switch on={m.on} onTap={() => setPay(m.id, { on: !m.on })} testid={sw} label={label} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 700 }}>{label || t.rd_wps_pay_new}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)" }}>{m.kind === "delivery" ? t.rd_wps_kind_delivery : t.rd_wps_kind_first}</span>
                  </span>
                </div>
                {m.kind === "delivery" && country.toUpperCase() === "TW" && <div data-testid="wps-cod-note" style={{ fontSize: 12, color: "var(--text-muted)", margin: "-2px 0 4px 58px" }}>{t.rd_wps_cod_note}</div>}
                {m.on && (
                  <div data-testid={`wps-pay-more-${m.id}`} style={{ padding: "0 0 8px 58px" }}>
                    <Field label={t.rd_wps_ship_name}><input data-testid={m.id === "qr" ? "wps-qr-label" : `wps-pay-name-${m.id}`} value={m.name} maxLength={40} placeholder={isNew ? "" : payLabel(t, { id: m.id, kind: m.kind })} onChange={(e) => setPay(m.id, { name: e.target.value })} style={input} /></Field>
                    {isNew && (
                      <Field label={t.rd_wps_kind}>
                        <select data-testid={`wps-pay-kind-${m.id}`} value={m.kind} onChange={(e) => setPay(m.id, { kind: e.target.value as PayKind })} style={input}>
                          <option value="first">{t.rd_wps_kind_first}</option><option value="delivery">{t.rd_wps_kind_delivery}</option>
                        </select>
                      </Field>
                    )}
                    {m.bank && (
                      <>
                        <Field label={t.rd_wps_bank_name}><input data-testid="wps-bank-name" value={m.bank.bankName} maxLength={60} onChange={(e) => setPay(m.id, { bank: { ...m.bank!, bankName: e.target.value } })} style={input} /></Field>
                        <Field label={t.rd_shop_od_acct_name}><input data-testid="wps-acct-name" value={m.bank.accountName} maxLength={60} onChange={(e) => setPay(m.id, { bank: { ...m.bank!, accountName: e.target.value } })} style={input} /></Field>
                        <Field label={t.rd_shop_od_acct_no}><input data-testid="wps-acct-no" value={m.bank.accountNumber} maxLength={40} inputMode="numeric" onChange={(e) => setPay(m.id, { bank: { ...m.bank!, accountNumber: e.target.value } })} style={input} /></Field>
                      </>
                    )}
                    {m.kind === "first" && (
                      <>
                        <Field label={t.rd_wps_pay_info}><textarea data-testid={`wps-pay-info-${m.id}`} value={m.info} maxLength={300} rows={2} placeholder={t.rd_wps_pay_info_ph} onChange={(e) => setPay(m.id, { info: e.target.value })} style={{ ...input, resize: "vertical" }} /></Field>
                        <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "4px 0" }}>
                          <label data-testid={m.id === "qr" ? "wps-qr-pic" : `wps-pay-qr-${m.id}`} style={{ width: 84, height: 84, borderRadius: 12, border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer", flexShrink: 0, background: "var(--chip-bg)" }}>
                            {m.qr ? <img src={productImageUrl(m.qr)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }} /> : <span style={{ fontSize: 11, textAlign: "center", padding: 6, color: "var(--text-muted)" }}>{busy === "qr" && qrFor === m.id ? "…" : t.rd_wps_qr_upload}</span>}
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void qr(m.id, e.target.files?.[0]); e.target.value = ""; }} />
                          </label>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_wps_pay_qr_hint}</span>
                          {m.qr && <button type="button" data-testid={`wps-pay-qr-clear-${m.id}`} onClick={() => setPay(m.id, { qr: "" })} style={{ border: "none", background: "transparent", color: "var(--danger)", fontWeight: 800, cursor: "pointer", minHeight: 40, fontFamily: "var(--font-ui)" }}>✕</button>}
                        </div>
                      </>
                    )}
                    {m.kind === "delivery" && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t.rd_wps_pay_delivery_hint}</div>}
                    {isNew && <button type="button" data-testid={`wps-pay-remove-${m.id}`} onClick={() => setPays((l) => l.filter((y) => y.id !== m.id))} style={{ marginTop: 6, minHeight: 40, border: "none", background: "transparent", color: "var(--danger)", fontWeight: 800, cursor: "pointer", padding: 0, fontFamily: "var(--font-ui)" }}>{t.rd_wps_ship_remove}</button>}
                  </div>
                )}
              </div>
            );
          })}
          {pays.filter((m) => /^c[0-9a-z]{5}$/.test(m.id)).length < MAX_PAY_METHODS && (
            <button type="button" data-testid="wps-pay-add" onClick={() => setPays((l) => [...l, newPayMethod()])} style={{ marginTop: 8, width: "100%", minHeight: 44, borderRadius: 11, border: "1px dashed var(--border)", background: "transparent", color: "var(--accent-fg)", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "var(--font-ui)" }}>＋ {t.rd_wps_pay_add}</button>
          )}
        </section>

        <section style={card}>
          <Field label={t.rd_wps_auto}><input data-testid="wps-auto" inputMode="numeric" value={String(s.autoCancelHours ?? 24)} onChange={(e) => setSt({ ...s, autoCancelHours: Math.min(168, Math.max(1, Math.round(num(e.target.value)) || 1)) })} style={{ ...input, width: 120 }} /></Field>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_wps_auto_hint}</div>
        </section>
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Switch on={s.taxIncluded === true} testid="wps-tax" label={t.rd_wps_tax} onTap={() => setSt({ ...s, taxIncluded: !s.taxIncluded })} />
            <span style={{ fontSize: 14, fontWeight: 700 }}>{t.rd_wps_tax}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_wps_tax_hint}</div>
        </section>
        {msg && <div role="status" data-testid="wps-msg" ref={msgAt} style={{ fontSize: 13, fontWeight: 700, color: msg.tone === "ok" ? "var(--ok)" : "var(--danger)", textAlign: "center" }}>{msg.text}</div>}
      </div>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, padding: "10px 14px calc(10px + env(safe-area-inset-bottom))", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <SaveButton testid="wps-save" label={t.rd_wed_save} t={t} dirty={dirty} disabled={!!busy} onSave={save} style={{ width: "100%", minHeight: 46, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 800, fontSize: 14.5, cursor: "pointer", fontFamily: "var(--font-ui)" }} />
        </div>
      </div>
    </Frame>
  );
}

function Frame({ t, onBack, children }: { t: Record<string, string>; onBack?: () => void; children: ReactNode }) {
  return <div><div style={headerBar}><HeaderWithBack onBack={onBack}><div className="sfl-anim-beat" style={headerTitle}>{t.rd_wed_payship}</div></HeaderWithBack></div>{children}</div>;
}
function Title({ children }: { children: ReactNode }) { return <div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: 8 }}>{children}</div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: "block", margin: "8px 0", flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", marginBottom: 5 }}>{label}</span>{children}</label>; }
function Switch({ on, onTap, testid, label }: { on: boolean; onTap: () => void; testid: string; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} data-testid={testid} onClick={onTap} style={{ width: 48, height: 44, border: "none", background: "transparent", padding: 0, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center" }}>
      <span aria-hidden="true" style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--accent)" : "var(--chip-bg)", position: "relative" }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 10, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} /></span>
    </button>
  );
}
