// Seller Website — Payment & shipping (Website → Payment & shipping). Saved in seller_websites.settings;
// buyers see only what website_checkout_public lets through (fees, free-over, bank details, QR, COD).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { headerBar, headerTitle, card } from "../ui";
import { useT } from "../i18n";
import { HeaderWithBack } from "../components/BackButton";
import { productImageUrl } from "../adapters/productImages";
import { DEFAULT_SETTINGS, settingsProblems } from "../adapters/websiteEditor";
import type { WebsiteSettings } from "../adapters/websiteSeller";
import { realPayShipApi, type PayShipApi } from "../adapters/websiteEditorApi";

type ShipKey = "s711" | "fm" | "home";

export default function WebsitePayShip({ onBack, onToast, cur = "NT$", api = realPayShipApi }: { onBack?: () => void; onToast: (m: string) => void; cur?: string; api?: PayShipApi }) {
  const t = useT() as unknown as Record<string, string>;
  const [st, setSt] = useState<WebsiteSettings | null | "error">(null);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "qr">("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  useEffect(() => {
    let live = true;
    void api.load().then((w) => {
      if (!live) return;
      if (w === "error") { setSt("error"); return; }
      setExists(!!w);
      setSt({ ...DEFAULT_SETTINGS, ...(w?.settings || {}), ship: { ...DEFAULT_SETTINGS.ship, ...(w?.settings?.ship || {}) } });
    });
    return () => { live = false; };
  }, [api]);
  if (st === null) return <Frame t={t} onBack={onBack}><div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>…</div></Frame>;
  if (st === "error") return <Frame t={t} onBack={onBack}><div style={{ ...card, margin: 14, color: "var(--danger)" }}>{t.rd_wor_load_failed}</div></Frame>;
  const s = st;
  const setShip = (k: ShipKey, p: { enabled?: boolean; fee?: number }) => setSt({ ...s, ship: { ...s.ship, [k]: { ...s.ship?.[k], ...p } } });
  const problems = settingsProblems(s);
  const save = async () => {
    setMsg(null);
    if (!exists) { setMsg({ text: t.rd_wed_need_name, tone: "bad" }); return; }
    if (problems.length) { setMsg({ text: problems.includes("ship") ? t.rd_wps_need_ship : t.rd_wps_need_pay, tone: "bad" }); return; }
    setBusy("save");
    const ok = await api.save(s);
    setBusy("");
    setMsg(ok ? { text: t.rd_wed_saved, tone: "ok" } : { text: t.rd_wed_save_failed, tone: "bad" });
  };
  const qr = async (f: File | undefined) => {
    if (!f) return;
    setBusy("qr");
    const path = await api.uploadQr(f);
    setBusy("");
    if (path) setSt({ ...s, qr: { ...s.qr, enabled: true, path } }); else onToast(t.rd_wed_pic_failed);
  };
  const num = (v: string) => { const n = Number(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };
  const input: CSSProperties = { width: "100%", minHeight: 44, borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", padding: "9px 11px", fontSize: 16, boxSizing: "border-box", fontFamily: "var(--font-ui)" };
  const ships: [ShipKey, string][] = [["s711", t.rd_wps_s711], ["fm", t.rd_wps_fm], ["home", t.rd_shop_home]];
  return (
    <Frame t={t} onBack={onBack}>
      <div style={{ padding: "14px 14px 110px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, margin: "0 auto" }}>
        <section style={card} data-testid="wps-ship">
          <Title>{t.rd_shop_delivery}</Title>
          {ships.map(([k, label]) => {
            const on = k === "home" ? s.ship?.home?.enabled === true : s.ship?.[k]?.enabled !== false;
            return (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: "1px solid var(--border)" }}>
                <Switch on={on} testid={`wps-ship-${k}`} label={label} onTap={() => setShip(k, { enabled: !on })} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{label}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_wps_fee}</span>
                <input data-testid={`wps-fee-${k}`} inputMode="decimal" disabled={!on} value={String(s.ship?.[k]?.fee ?? (k === "home" ? 120 : 60))} onChange={(e) => setShip(k, { fee: num(e.target.value) })} aria-label={`${label} ${t.rd_wps_fee}`} style={{ ...input, width: 92, minWidth: 0, textAlign: "right", opacity: on ? 1 : 0.5 }} />
              </div>
            );
          })}
          <Field label={`${t.rd_wps_free_over} (${cur})`}><input data-testid="wps-free" inputMode="decimal" value={String(s.freeOver || 0)} onChange={(e) => setSt({ ...s, freeOver: num(e.target.value) })} style={input} /></Field>
        </section>

        <section style={card} data-testid="wps-pay">
          <Title>{t.rd_shop_payment}</Title>
          <Row label={t.rd_shop_pay_bank} on={!!s.bank?.enabled} testid="wps-bank" onTap={() => setSt({ ...s, bank: { ...s.bank, enabled: !s.bank?.enabled } })} />
          {s.bank?.enabled && (
            <div style={{ paddingLeft: 2 }}>
              <Field label={t.rd_wps_bank_name}><input data-testid="wps-bank-name" value={s.bank.bankName || ""} maxLength={60} onChange={(e) => setSt({ ...s, bank: { ...s.bank, bankName: e.target.value } })} style={input} /></Field>
              <Field label={t.rd_shop_od_acct_name}><input data-testid="wps-acct-name" value={s.bank.accountName || ""} maxLength={60} onChange={(e) => setSt({ ...s, bank: { ...s.bank, accountName: e.target.value } })} style={input} /></Field>
              <Field label={t.rd_shop_od_acct_no}><input data-testid="wps-acct-no" value={s.bank.accountNumber || ""} maxLength={40} inputMode="numeric" onChange={(e) => setSt({ ...s, bank: { ...s.bank, accountNumber: e.target.value } })} style={input} /></Field>
            </div>
          )}
          <Row label={t.rd_shop_pay_qr} on={!!s.qr?.enabled} testid="wps-qr" onTap={() => setSt({ ...s, qr: { ...s.qr, enabled: !s.qr?.enabled } })} />
          {s.qr?.enabled && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
              <label data-testid="wps-qr-pic" style={{ width: 96, height: 96, borderRadius: 12, border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", cursor: "pointer", flexShrink: 0, background: "var(--chip-bg)" }}>
                {s.qr.path ? <img src={productImageUrl(s.qr.path)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }} /> : <span style={{ fontSize: 11.5, textAlign: "center", padding: 6, color: "var(--text-muted)" }}>{busy === "qr" ? "…" : t.rd_wps_qr_upload}</span>}
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void qr(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <Field label={t.rd_wps_qr_label}><input data-testid="wps-qr-label" value={s.qr.label || ""} maxLength={60} onChange={(e) => setSt({ ...s, qr: { ...s.qr, label: e.target.value } })} style={input} /></Field>
            </div>
          )}
          <Row label={t.rd_shop_pay_cod} on={!!s.cod?.enabled} testid="wps-cod" onTap={() => setSt({ ...s, cod: { enabled: !s.cod?.enabled } })} />
          <div data-testid="wps-cod-note" style={{ fontSize: 12, color: "var(--text-muted)", margin: "-2px 0 4px" }}>{t.rd_wps_cod_note}</div>
        </section>

        <section style={card}>
          <Field label={t.rd_wps_auto}><input data-testid="wps-auto" inputMode="numeric" value={String(s.autoCancelHours ?? 24)} onChange={(e) => setSt({ ...s, autoCancelHours: Math.min(168, Math.max(1, Math.round(num(e.target.value)) || 1)) })} style={{ ...input, width: 120 }} /></Field>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_wps_auto_hint}</div>
        </section>
        {msg && <div role="status" data-testid="wps-msg" style={{ fontSize: 13, fontWeight: 700, color: msg.tone === "ok" ? "var(--ok)" : "var(--danger)", textAlign: "center" }}>{msg.text}</div>}
      </div>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, padding: "10px 14px calc(10px + env(safe-area-inset-bottom))", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <button type="button" data-testid="wps-save" disabled={!!busy} onClick={() => void save()} style={{ width: "100%", minHeight: 46, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 800, fontSize: 14.5, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{busy === "save" ? t.rd_wed_saving : t.rd_wed_save}</button>
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
function Row({ label, on, onTap, testid }: { label: string; on: boolean; onTap: () => void; testid: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid var(--border)", padding: "4px 0" }}><Switch on={on} onTap={onTap} testid={testid} label={label} /><span style={{ fontSize: 14, fontWeight: 700 }}>{label}</span></div>;
}
