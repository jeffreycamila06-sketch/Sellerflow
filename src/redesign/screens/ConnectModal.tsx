// Connect modal — faithful to App.tsx ConnectModal (3759-3817): pick a registered
// account (capped to the plan) or add a new one (when slots remain), then connect.
// ⚠️ PREVIEW-UNVERIFIABLE: connect POSTs to the Render live server (see connect.ts).
import { useState, type CSSProperties } from "react";
import { registeredAccountsFor, canConnectMore, type Platform, type ConnectResult } from "../adapters/connect";
import type { AccountUser } from "../../accountDb";
import { useT, tpl } from "../i18n";
import { isIOS } from "../adapters/platform";

const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const lbl: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const tabBtn = (on: boolean): CSSProperties => ({ flex: 1, padding: "10px 0", borderRadius: 9, border: "none", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-text)" : "var(--text-dim)" });

export default function ConnectModal({ profile, initialTab = "TikTok", onClose, onConnect }: {
  profile: AccountUser;
  initialTab?: Platform;
  onClose: () => void;
  onConnect: (platform: Platform, data: Record<string, string>) => Promise<ConnectResult>;
}) {
  const t = useT();
  const [tab, setTab] = useState<Platform>(initialTab);
  const [ttu, setTtu] = useState("");
  const [fbId, setFbId] = useState("");
  const [fbTok, setFbTok] = useState("");
  const [selTT, setSelTT] = useState("");
  const [selFB, setSelFB] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const registered = registeredAccountsFor(profile, tab);
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
    if (!r.ok) { setErr(r.error || t.rd_cm_conn_failed); return; }
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
          {!canConnect && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--warn)", background: "rgba(217,119,6,.12)", border: "1px solid var(--warn)", borderRadius: 10, padding: "9px 11px", marginBottom: 12 }}>{isIOS() ? t.rd_ios_cm_limit : t.rd_cm_limit}</div>}
          <div style={{ display: "flex", gap: 6, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11, padding: 4, marginBottom: 13 }}>
            {(["TikTok", "Facebook"] as const).map((tb) => <button key={tb} onClick={() => { setTab(tb); setErr(""); }} style={tabBtn(tab === tb)}>{tb}</button>)}
          </div>

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
              {canAdd && tab === "Facebook" && <div><label style={lbl}>{t.rd_cm_add_fb}</label><input value={fbId} onChange={(e) => { setSelFB(""); setFbId(e.target.value); }} style={input} /></div>}
            </div>
          ) : tab === "TikTok" ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, color: "var(--warn)", background: "rgba(217,119,6,.1)", border: "1px solid var(--warn)", borderRadius: 9, padding: "8px 10px", marginBottom: 9 }}>{t.rd_cm_tt_warn}</div>
              <label style={lbl}>{t.rd_pp_tiktok_user}</label>
              <input value={ttValue} onChange={(e) => setTtu(e.target.value)} placeholder={t.rd_cm_tt_ph} disabled={!canAdd} style={input} />
            </div>
          ) : (
            <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 9 }}>
              <div><label style={lbl}>{t.rd_cm_fb_id}</label><input value={fbValue} onChange={(e) => setFbId(e.target.value)} disabled={!canAdd} style={input} /></div>
              <div><label style={lbl}>{t.rd_cm_access_token}</label><input value={fbTok} onChange={(e) => setFbTok(e.target.value)} type="password" disabled={!canConnect} style={input} /></div>
            </div>
          )}

          {err && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", marginBottom: 10 }}>{err}</div>}
          <button onClick={() => void connect()} disabled={busy || !canConnect || !current.trim()} style={{ width: "100%", padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: busy || !canConnect ? "default" : "pointer", opacity: busy || !canConnect || !current.trim() ? 0.6 : 1, boxShadow: "0 4px 14px var(--accent-soft)" }}>{busy ? t.rd_cm_connecting : tpl(t.rd_cm_connect_x, { tab })}</button>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", textAlign: "center", marginTop: 9, lineHeight: 1.45 }}>{t.rd_cm_footer}</div>
        </div>
      </div>
    </div>
  );
}
