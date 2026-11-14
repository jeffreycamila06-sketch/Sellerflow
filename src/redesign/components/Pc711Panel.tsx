// Admin → 7-11 Login (the body of the AdminPanel bottom-sheet). The server logs in to 7-11 once;
// the admin types phone + password + 驗證碼 + SMS code here. Status is read when the panel opens
// (no polling). The password is sent once and cleared from this screen right after.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { pc711Api, usePc711Status, fillSmsBoxes, type Pc711Status } from "../adapters/pc711Login";

type View = "status" | "step1" | "step2";

const field: CSSProperties = { width: "100%", padding: "11px 12px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 16, fontWeight: 600, outline: "none", boxSizing: "border-box", minHeight: 44 };
const lbl: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", margin: "12px 2px 6px" };
const primary: CSSProperties = { width: "100%", minHeight: 46, padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 16 };
const ghost: CSSProperties = { minHeight: 44, padding: "10px 14px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const card: CSSProperties = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 14px" };
const stepTag: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: "var(--accent-fg)", textTransform: "uppercase" };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function Pc711Panel({ onChanged }: { onChanged?: (s: Pc711Status | null) => void }) {
  const t = useT();
  const { status, refresh } = usePc711Status(true);
  const [view, setView] = useState<View>("status");
  const [flowId, setFlowId] = useState("");
  const [picture, setPicture] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState("");
  const [boxes, setBoxes] = useState<string[]>(["", "", "", "", "", ""]);
  const [tail, setTail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [resendLeft, setResendLeft] = useState(0);
  const boxRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => { if (onChanged) onChanged(status); }, [status, onChanged]);
  // the 60 s "Send again" timer (runs only on step 2)
  useEffect(() => {
    if (view !== "step2" || resendLeft <= 0) return;
    const id = setTimeout(() => setResendLeft((n) => Math.max(0, n - 1)), 1000);
    return () => clearTimeout(id);
  }, [view, resendLeft]);

  const words: Record<string, string> = {
    flow_expired: t.rd_pc711_err_expired, bad_mobile: t.rd_pc711_err_mobile, bad_password: t.rd_pc711_err_password,
    bad_code: t.rd_pc711_err_code, bad_sms: t.rd_pc711_err_sms, unreachable: t.rd_pc711_err_unreachable,
    login_failed: t.rd_pc711_err_login, sms_failed: t.rd_pc711_err_login, captcha_not_found: t.rd_pc711_err_no_picture,
    rate_limited: t.rd_pc711_err_busy, unknown_page: t.rd_pc711_err_generic, login_form_missing: t.rd_pc711_err_generic,
    config_missing: t.rd_pc711_err_generic, logged_out: t.rd_pc711_err_login, failed: t.rd_pc711_err_generic,
    refused_host: t.rd_pc711_err_generic, key_missing: t.rd_pc711_key_missing,
  };
  const say = (w: unknown) => { const s = String(w || ""); return words[s] || s || t.rd_pc711_err_generic; };

  const begin = async () => {
    setBusy(true); setErr(""); setNote(""); setPw(""); setCode(""); setBoxes(["", "", "", "", "", ""]);
    const a = await pc711Api.start();
    setBusy(false);
    if (a.data.error === "key_missing") { await refresh(); setView("status"); return; }
    if (typeof a.data.flowId !== "string") { setErr(say(a.data.error)); return; }
    setFlowId(a.data.flowId);
    setPicture(typeof a.data.captcha === "string" ? a.data.captcha : null);
    if (a.data.error) setErr(say(a.data.error));
    setView("step1");
  };
  const newPicture = async () => {
    if (!flowId) return;
    setCode("");
    const a = await pc711Api.captcha(flowId);
    if (typeof a.data.captcha === "string") setPicture(a.data.captcha);
    else setErr(say(a.data.error));
  };
  const sendSms = async () => {
    setBusy(true); setErr("");
    const a = await pc711Api.submit(flowId, phone, pw, code);
    setBusy(false);
    setPw(""); // used once: gone from this screen
    if (a.data.step === "sms") { setTail(String(a.data.phoneTail || "")); setResendLeft(60); setView("step2"); setTimeout(() => boxRefs.current[0]?.focus(), 0); return; }
    if (a.data.step === "connected") { await refresh(); setView("status"); return; }
    setErr(say(a.data.message ?? a.data.error));
    void newPicture();
  };
  const connect = async () => {
    setBusy(true); setErr("");
    const a = await pc711Api.sms(flowId, boxes.join(""));
    setBusy(false);
    setBoxes(["", "", "", "", "", ""]);
    if (a.data.step === "connected") { setFlowId(""); setPicture(null); await refresh(); setView("status"); return; }
    setErr(say(a.data.message ?? a.data.error));
  };
  const testNow = async () => {
    setBusy(true); setNote("");
    const a = await pc711Api.test();
    setBusy(false);
    if (a.status === 404) { setNote(t.rd_pc711_test_off); return; }
    if (a.status === 429) { setNote(t.rd_pc711_err_busy); return; }
    const store = (a.data.result as { store?: { verdict?: string; kind?: string } } | undefined)?.store;
    setNote(store ? tpl(t.rd_pc711_test_result, { r: `${store.verdict || "unknown"}${store.kind ? ` · ${store.kind}` : ""}` }) : t.rd_pc711_err_generic);
    await refresh();
  };
  const disconnect = async () => {
    if (!window.confirm(t.rd_pc711_disconnect_q)) return;
    setBusy(true);
    await pc711Api.disconnect();
    setBusy(false);
    await refresh();
  };

  const errLine = err ? <div data-testid="pc711-err" style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: "var(--danger)", lineHeight: 1.4 }}>{err}</div> : null;

  if (view === "step1") {
    return (
      <div data-testid="pc711-step1">
        <div style={stepTag}>{t.rd_pc711_step1}</div>
        <div style={lbl}>{t.rd_pc711_phone}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ ...field, width: 72, flex: "0 0 72px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>+886</span>
          <input data-testid="pc711-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="off" style={{ ...field, flex: 1, minWidth: 0 }} />
        </div>
        <div style={lbl}>{t.rd_pc711_password}</div>
        <div style={{ position: "relative" }}>
          <input data-testid="pc711-password" type={showPw ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" style={{ ...field, paddingRight: 60 }} />
          <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t.rd_pc711_hide : t.rd_pc711_show} style={{ position: "absolute", right: 4, top: 0, bottom: 0, minWidth: 48, border: "none", background: "transparent", color: "var(--text-dim)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{showPw ? t.rd_pc711_hide : t.rd_pc711_show}</button>
        </div>
        <div style={lbl}>{t.rd_pc711_captcha}</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: "0 0 auto", height: 44, minWidth: 110, borderRadius: 10, border: "1px solid var(--border)", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {picture ? <img data-testid="pc711-picture" src={picture} alt={t.rd_pc711_captcha} style={{ height: 44, display: "block" }} /> : <span style={{ fontSize: 11, color: "#888" }}>—</span>}
          </div>
          <button type="button" data-testid="pc711-new-picture" onClick={() => void newPicture()} aria-label={t.rd_pc711_new_picture} title={t.rd_pc711_new_picture} style={{ ...ghost, width: 44, padding: 0, fontSize: 18 }}>↻</button>
          <input data-testid="pc711-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, "").slice(0, 5))} inputMode="numeric" maxLength={5} autoComplete="off" style={{ ...field, flex: 1, minWidth: 0, letterSpacing: ".2em", textAlign: "center" }} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          <input type="checkbox" checked readOnly disabled style={{ width: 18, height: 18 }} />{t.rd_pc711_remember}
        </label>
        {errLine}
        <button type="button" data-testid="pc711-send-sms" disabled={busy || !phone || !pw || !code} onClick={() => void sendSms()} style={{ ...primary, opacity: busy || !phone || !pw || !code ? 0.55 : 1 }}>{t.rd_pc711_send_sms}</button>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 }}><span aria-hidden>🔒</span><span>{t.rd_pc711_lock}</span></div>
      </div>
    );
  }

  if (view === "step2") {
    return (
      <div data-testid="pc711-step2">
        <div style={stepTag}>{t.rd_pc711_step2}</div>
        <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{tpl(t.rd_pc711_sms_sent, { tail })}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 14, justifyContent: "space-between" }}>
          {boxes.map((d, i) => (
            <input key={i} ref={(el) => { boxRefs.current[i] = el; }} data-testid={`pc711-box-${i}`} value={d} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"}
              onChange={(e) => {
                const next = fillSmsBoxes(boxes, i, e.target.value);
                setBoxes(next);
                const firstEmpty = next.findIndex((x) => !x);
                if (e.target.value && firstEmpty >= 0) boxRefs.current[firstEmpty]?.focus();
              }}
              onPaste={(e) => { const txt = e.clipboardData.getData("text"); if (/\d{6}/.test(txt.replace(/\D/g, ""))) { e.preventDefault(); setBoxes(fillSmsBoxes(boxes, 0, txt)); } }}
              style={{ ...field, width: "100%", minWidth: 0, flex: "1 1 0", textAlign: "center", padding: "11px 0", fontSize: 20 }} />
          ))}
        </div>
        {errLine}
        <button type="button" data-testid="pc711-connect" disabled={busy || boxes.some((x) => !x)} onClick={() => void connect()} style={{ ...primary, opacity: busy || boxes.some((x) => !x) ? 0.55 : 1 }}>{t.rd_pc711_connect}</button>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" onClick={() => { setErr(""); setView("step1"); void newPicture(); }} style={{ ...ghost, flex: 1 }}>{t.rd_pc711_back}</button>
          <button type="button" data-testid="pc711-send-again" disabled={resendLeft > 0} onClick={() => { setErr(""); setView("step1"); void newPicture(); }} style={{ ...ghost, flex: 1, opacity: resendLeft > 0 ? 0.55 : 1 }}>{resendLeft > 0 ? tpl(t.rd_pc711_send_again_in, { s: resendLeft }) : t.rd_pc711_send_again}</button>
        </div>
      </div>
    );
  }

  // status view
  if (!status) return <div data-testid="pc711-loading" style={{ fontSize: 13, color: "var(--text-dim)" }}>{t.rd_pc711_loading}</div>;
  if (status.state === "key_missing") return <div data-testid="pc711-key-missing" style={{ ...card, fontSize: 13, color: "var(--text)", lineHeight: 1.45 }}>{t.rd_pc711_key_missing}</div>;
  if (status.state === "not_connected") {
    return (
      <div data-testid="pc711-not-connected">
        <div style={card}><div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{t.rd_pc711_not_connected}</div><div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 5, lineHeight: 1.45 }}>{t.rd_pc711_not_connected_sub}</div></div>
        {errLine}
        <button type="button" data-testid="pc711-begin" disabled={busy} onClick={() => void begin()} style={{ ...primary, opacity: busy ? 0.55 : 1 }}>{t.rd_pc711_connect}</button>
      </div>
    );
  }
  if (status.state === "needs_login") {
    return (
      <div data-testid="pc711-needs-login">
        <div role="alert" style={{ background: "rgba(217,119,6,.14)", border: "1px solid rgba(217,119,6,.45)", color: "var(--text)", borderRadius: 14, padding: "13px 14px", fontSize: 13, fontWeight: 600, lineHeight: 1.45 }}>{t.rd_pc711_needs}</div>
        {errLine}
        <button type="button" data-testid="pc711-begin" disabled={busy} onClick={() => void begin()} style={{ ...primary, opacity: busy ? 0.55 : 1 }}>{t.rd_pc711_connect_again}</button>
      </div>
    );
  }
  return (
    <div data-testid="pc711-connected">
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 800, color: "var(--ok)" }}><span style={{ width: 9, height: 9, borderRadius: 9, background: "var(--ok)" }} />{t.rd_pc711_connected}{status.phoneTail ? <span style={{ color: "var(--text-dim)", fontWeight: 700, fontSize: 12.5 }}>…{status.phoneTail}</span> : null}</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", marginTop: 10, fontSize: 12.5 }}>
          <span style={{ color: "var(--text-dim)" }}>{t.rd_pc711_since}</span><span style={{ color: "var(--text)", fontWeight: 600 }}>{when(status.since)}</span>
          <span style={{ color: "var(--text-dim)" }}>{t.rd_pc711_last_check}</span><span style={{ color: "var(--text)", fontWeight: 600 }}>{when(status.lastOkAt)}</span>
          <span style={{ color: "var(--text-dim)" }}>{t.rd_pc711_auto}</span><span style={{ color: "var(--text)", fontWeight: 600 }}>{status.autoLogins}</span>
        </div>
      </div>
      {note ? <div data-testid="pc711-note" style={{ marginTop: 12, fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{note}</div> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button type="button" data-testid="pc711-test" disabled={busy} onClick={() => void testNow()} style={{ ...ghost, flex: 1 }}>{t.rd_pc711_test}</button>
        <button type="button" data-testid="pc711-disconnect" disabled={busy} onClick={() => void disconnect()} style={{ ...ghost, flex: 1, color: "var(--danger)" }}>{t.rd_pc711_disconnect}</button>
      </div>
    </div>
  );
}
