// Connect modal — faithful to App.tsx ConnectModal (3759-3817): pick a registered
// account (capped to the plan) or add a new one (when slots remain), then connect.
// ⚠️ PREVIEW-UNVERIFIABLE: connect POSTs to the Render live server (see connect.ts).
import { useState, type CSSProperties } from "react";
import { registeredAccountsFor, canConnectMore, type Platform, type ConnectResult } from "../adapters/connect";
import type { AccountUser } from "../../accountDb";
import { useT, tpl } from "../i18n";
import { isIOS } from "../adapters/platform";
import { TELEGRAM_URL } from "../../lib/telegram";

const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const lbl: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const tabBtn = (on: boolean): CSSProperties => ({ flex: 1, padding: "10px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-text)" : "var(--text-dim)" });

// P3 — the modal's tab can be a TikTok/FB Platform OR "Shopee" (a LOCAL widening;
// connect.ts's exported Platform is untouched). Shopee props are optional so the
// modal is byte-identical when Shopee is disabled (no tab, no branch).
export type ConnectTab = Platform | "Shopee";
export interface ShopeeShopOpt { shopId: number; shopName: string }
export interface ShopeeConnectOutcome { ok: boolean; reason?: string; error?: string; unreachable?: boolean }

export default function ConnectModal({ profile, initialTab = "TikTok", onClose, onConnect, shopeeEnabled = false, shopeeShops = [], shopeeSelectedId, onShopeeConnect }: {
  profile: AccountUser;
  initialTab?: ConnectTab;
  onClose: () => void;
  onConnect: (platform: Platform, data: Record<string, string>) => Promise<ConnectResult>;
  // P3 — Shopee tab (rendered only when shopeeEnabled). onShopeeConnect POSTs to
  // /shopee/connect via the shopee.ts adapter (RedesignApp owns eligibility + join).
  shopeeEnabled?: boolean;
  shopeeShops?: ShopeeShopOpt[];
  shopeeSelectedId?: number;
  onShopeeConnect?: (shopId: number, sessionId: string) => Promise<ShopeeConnectOutcome>;
}) {
  const t = useT();
  const [tab, setTab] = useState<ConnectTab>(initialTab);
  // P3 — Shopee tab local state: chosen shop + the pasted Live session ID.
  const [shShopId, setShShopId] = useState<number>(shopeeSelectedId ?? shopeeShops[0]?.shopId ?? 0);
  const [shSession, setShSession] = useState("");
  const [ttu, setTtu] = useState("");
  // FB tab is gated (honest gate, addendum 2026-07-23): no FB inputs render, so
  // these are read-only now (still referenced by fbValue/connect, which stay
  // byte-unchanged for the untouched TikTok path). Their setters were dropped
  // with the removed FB input fields.
  const [fbId] = useState("");
  const [fbTok] = useState("");
  const [selTT, setSelTT] = useState("");
  const [selFB, setSelFB] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // P3 — the TikTok/FB helpers only apply to those tabs; the Shopee tab has its own
  // branch, so narrow tab away from "Shopee" here (registered stays [] on Shopee).
  const registered = tab === "Shopee" ? [] : registeredAccountsFor(profile, tab);
  const canAdd = canConnectMore(profile);
  const canUseExisting = registered.length > 0;
  const canConnect = canUseExisting || canAdd;
  const ttValue = selTT || ttu;
  const fbValue = selFB || fbId;
  const current = tab === "TikTok" ? ttValue : fbValue;

  const choose = (v: string) => (tab === "TikTok" ? setSelTT(v) : setSelFB(v));
  const connect = async () => {
    if (!canConnect || busy) return;
    setBusy(true); setErr("");
    const r = tab === "TikTok"
      ? await onConnect("TikTok", { username: ttValue })
      : await onConnect("Facebook", { liveVideoId: fbValue, accessToken: fbTok });
    setBusy(false);
    // F-batch i18n: a client network failure shows the localized "can't reach"
    // copy; a real server reason still passes through verbatim.
    if (!r.ok) { setErr(r.unreachable ? t.rd_cm_cant_reach : (r.error || t.rd_cm_conn_failed)); return; }
    onClose();
  };

  return (
    <div onClick={(e) => e.target === e.currentTarget && !busy && onClose()} style={{ position: "absolute", inset: 0, zIndex: 1000, background: "rgba(8,6,24,.5)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
      <div style={{ width: "100%", maxWidth: 360, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, boxShadow: "0 24px 60px rgba(0,0,0,.4)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 16px 12px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{t.rd_cm_title}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 15, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: 16 }}>
          {tab !== "Shopee" && !canConnect && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", background: "rgba(217,119,6,.12)", border: "1px solid var(--warn)", borderRadius: 10, padding: "9px 11px", marginBottom: 12 }}>{isIOS() ? t.rd_ios_cm_limit : t.rd_cm_limit}</div>}
          <div style={{ display: "flex", gap: 6, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11, padding: 4, marginBottom: 13 }}>
            {(["TikTok", "Facebook", ...(shopeeEnabled ? (["Shopee"] as const) : [])] as ConnectTab[]).map((tb) => <button key={tb} onClick={() => { setTab(tb); setErr(""); }} style={tabBtn(tab === tb)}>{tb}</button>)}
          </div>

          {/* HONEST GATE (addendum 2026-07-23): the Facebook TAB stays visible +
              selectable (deliberate sales hook — sellers should see FB exists and
              ask about it), but its CONNECT UI is replaced with the same
              activation gate as the Live dropdown. No onConnect("Facebook") path
              is reachable from this modal. iOS-safe real <a> (never window.open);
              closes the modal on click (the modal's dismiss convention). Reuses
              rd_dash_fb_activation / rd_dash_fb_contact — no duplicate keys. */}
          {tab === "Shopee" ? (
            /* P3 — Shopee connect: choose an authorized shop + paste the Live session
               ID. ⚠️ TEMPORARY session-ID paste (no confirmed detect endpoint) —
               isolated here so removing it later is a one-component change. */
            <div style={{ marginBottom: 4 }}>
              {shopeeShops.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5, padding: "2px 2px 8px" }}>{t.rd_shp_no_shops}</div>
              ) : (
                <>
                  {shopeeShops.length > 1 && (
                    <div style={{ marginBottom: 11 }}>
                      <label style={lbl}>{t.rd_shp_pick_shop}</label>
                      <select value={shShopId} onChange={(e) => setShShopId(Number(e.target.value))} style={input}>
                        {shopeeShops.map((s) => <option key={s.shopId} value={s.shopId}>{s.shopName || `${t.rd_shp_shop_name_fallback} ${s.shopId}`}</option>)}
                      </select>
                    </div>
                  )}
                  <div style={{ marginBottom: 6 }}>
                    <label style={lbl}>{t.rd_shp_session_label}</label>
                    <input value={shSession} onChange={(e) => setShSession(e.target.value)} placeholder={t.rd_shp_session_ph} style={input} />
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 2px 12px" }}>{t.rd_shp_session_help}</div>
                  {err && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", marginBottom: 10 }}>{err}</div>}
                  <button
                    onClick={async () => {
                      if (busy || !onShopeeConnect || !shShopId || !shSession.trim()) return;
                      setBusy(true); setErr("");
                      const r = await onShopeeConnect(shShopId, shSession.trim());
                      setBusy(false);
                      if (!r.ok) { setErr(r.reason === "not_live" ? t.rd_shp_not_live : r.unreachable ? t.rd_cm_cant_reach : (r.error || t.rd_shp_connect_failed)); return; }
                      onClose();
                    }}
                    disabled={busy || shopeeShops.length === 0 || !shShopId || !shSession.trim()}
                    style={{ width: "100%", padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy || !shShopId || !shSession.trim() ? 0.6 : 1, boxShadow: "0 4px 14px var(--accent-soft)" }}
                  >{busy ? t.rd_shp_connecting : t.rd_shp_connect}</button>
                </>
              )}
            </div>
          ) : tab === "Facebook" ? (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.5, padding: "2px 2px 13px" }}>{t.rd_dash_fb_activation}</div>
              <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={onClose} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "12px 0", background: "#0088cc", color: "#fff", borderRadius: 12, fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, textDecoration: "none" }}>{t.rd_dash_fb_contact}<span style={{ fontSize: 15 }}>→</span></a>
            </div>
          ) : (
            <>
              {canUseExisting ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{tpl(t.rd_cm_choose, { tab })}</div>
                  {registered.map((a) => {
                    const on = a === current;
                    return (
                      <button key={a} onClick={() => choose(a)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 13px", border: `1.5px solid ${on ? "var(--accent)" : "var(--border-strong)"}`, borderRadius: 11, background: on ? "var(--accent-softer)" : "var(--surface-2)", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                        <strong style={{ fontSize: 13, color: "var(--text)" }}>{a}</strong>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{tab}</span>
                      </button>
                    );
                  })}
                  {canAdd && tab === "TikTok" && <div><label style={lbl}>{t.rd_cm_add_tt}</label><input value={ttu} onChange={(e) => { setSelTT(""); setTtu(e.target.value); }} placeholder={t.rd_cm_tt_ph} style={input} /></div>}
                </div>
              ) : (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11.5, color: "var(--warn)", background: "rgba(217,119,6,.1)", border: "1px solid var(--warn)", borderRadius: 9, padding: "8px 10px", marginBottom: 9 }}>{t.rd_cm_tt_warn}</div>
                  <label style={lbl}>{t.rd_pp_tiktok_user}</label>
                  <input value={ttValue} onChange={(e) => setTtu(e.target.value)} placeholder={t.rd_cm_tt_ph} disabled={!canAdd} style={input} />
                </div>
              )}

              {err && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", marginBottom: 10 }}>{err}</div>}
              <button onClick={() => void connect()} disabled={busy || !canConnect || !current.trim()} style={{ width: "100%", padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: busy || !canConnect ? "default" : "pointer", opacity: busy || !canConnect || !current.trim() ? 0.6 : 1, boxShadow: "0 4px 14px var(--accent-soft)" }}>{busy ? t.rd_cm_connecting : tpl(t.rd_cm_connect_x, { tab })}</button>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", textAlign: "center", marginTop: 9, lineHeight: 1.45 }}>{t.rd_cm_footer}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
