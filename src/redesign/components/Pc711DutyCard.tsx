// Admin → 7-11 Login → "Who is checking" (approved pictures: docs/design/pc711-duty-card).
// Four states: the checker laptop is checking (green) · the server is checking now (orange) · the
// server is checking but logged out of 7-11 (red) · backup off (grey). Under the card, one small line
// about the last finished take-over (nothing when there was none). Counts and times only.
// While the backup is on: one line "Store session: ready / opening / not ready" (the server's kept E-Map session).
// The card asks nothing itself: the answer comes from usePc711Duty (the panel owns it). The only
// timer here counts the "… ago" numbers up once a second, and it is stopped when the card goes away.
import { useEffect, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { dutyState, spanWords, taipeiMinute, taipeiRange, type Pc711Duty, type Pc711DutyState, type Pc711StoreSession } from "../adapters/pc711Duty";

// the panel's own card (Pc711Panel.tsx `card`); orange and red reuse the app's existing tints —
// red is exactly the panel's "Logged out of 7-11" card
const card: CSSProperties = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 14px" };
const TINT: Record<Pc711DutyState, CSSProperties> = {
  normal: card,
  off: card,
  duty: { ...card, background: "var(--warn-soft)", border: "1.5px solid var(--warn)" },
  duty_out: { ...card, background: "var(--danger-soft)", border: "1.5px solid var(--danger)" },
};
const COLOUR: Record<Pc711DutyState, string> = { normal: "var(--ok)", duty: "var(--warn)", duty_out: "var(--danger)", off: "var(--text-muted)" };
// "Store session" line (Jeff 2026-11-20): the server's kept E-Map session — words only
const SESSION_COLOUR: Record<Pc711StoreSession, string> = { ready: "var(--ok)", opening: "var(--warn)", not_ready: "var(--danger)" };
const dim: CSSProperties = { color: "var(--text-dim)" };
const val: CSSProperties = { color: "var(--text)", fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" };
const title: CSSProperties = { fontSize: 13, fontWeight: 800, color: "var(--text)" };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export default function Pc711DutyCard({ duty }: { duty: Pc711Duty | null | undefined }) {
  const t = useT();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { if (typeof document === "undefined" || document.visibilityState !== "hidden") setNowMs(Date.now()); }, 1000);
    return () => clearInterval(id);
  }, []);

  if (!duty) {
    return (
      <div data-testid="pc711-duty-wrap" style={{ marginTop: 14 }}>
        <div data-testid="pc711-duty" data-state={duty === null ? "failed" : "loading"} style={card}>
          <div style={title}>{t.rd_pc711_duty_title}</div>
          <div data-testid={duty === null ? "pc711-duty-failed" : "pc711-duty-loading"} style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.45 }}>{duty === null ? t.rd_pc711_duty_failed : t.rd_pc711_loading}</div>
        </div>
      </div>
    );
  }

  const state = dutyState(duty);
  const onDuty = state === "duty" || state === "duty_out";
  const serverNow = nowMs + duty.skewMs;
  const name = duty.label ? tpl(t.rd_pc711_duty_name, { label: duty.label }) : t.rd_pc711_duty_name_none; // "the Lenovo"
  const why = duty.reason === "silent" ? cap(tpl(t.rd_pc711_duty_why_silent, { name })) : duty.reason === "degraded" ? cap(tpl(t.rd_pc711_duty_why_degraded, { name })) : "—";
  const parcels = duty.answered === null ? "—" : duty.answered === 1 && !duty.answeredMore ? t.rd_pc711_duty_parcel_1 : tpl(t.rd_pc711_duty_parcels, { n: `${duty.answered}${duty.answeredMore ? "+" : ""}` });
  const last = duty.last;
  const lastWhy = last ? (last.reason === "silent" ? tpl(t.rd_pc711_duty_was_silent, { name }) : last.reason === "degraded" ? tpl(t.rd_pc711_duty_was_degraded, { name }) : "") : "";
  const lastParts = last ? { range: taipeiRange(last.start, last.end), dur: spanWords(Date.parse(last.end) - Date.parse(last.start)) } : null;

  return (
    <div data-testid="pc711-duty-wrap" style={{ marginTop: 14 }}>
      <div data-testid="pc711-duty" data-state={state} style={TINT[state]}>
        <div style={title}>{t.rd_pc711_duty_title}</div>
        <div data-testid="pc711-duty-line" style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, fontSize: 15, fontWeight: 800, color: state === "off" ? "var(--text-dim)" : COLOUR[state], lineHeight: 1.3 }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 9, background: COLOUR[state], flex: "0 0 9px", marginTop: 6 }} />
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {state === "normal" ? <>{cap(tpl(t.rd_pc711_duty_normal, { name }))} <span data-testid="pc711-duty-standby" style={{ color: "var(--text-dim)", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap" }}>{t.rd_pc711_duty_standby}</span></>
              : state === "off" ? t.rd_pc711_duty_off : t.rd_pc711_duty_on}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", marginTop: 10, fontSize: 12.5 }}>
          {onDuty ? <>
            <span style={dim}>{t.rd_pc711_duty_since}</span>
            <span data-testid="pc711-duty-since" style={val}>{duty.since ? tpl(t.rd_pc711_duty_since_val, { time: taipeiMinute(duty.since), dur: spanWords(serverNow - Date.parse(duty.since)) }) : "—"}</span>
            <span style={dim}>{t.rd_pc711_duty_why}</span>
            <span data-testid="pc711-duty-why" style={val}>{why}</span>
            <span style={dim}>{t.rd_pc711_duty_answered}</span>
            <span data-testid="pc711-duty-answered" style={val}>{parcels}</span>
          </> : <>
            <span style={dim}>{tpl(t.rd_pc711_duty_last_call, { name })}</span>
            <span data-testid="pc711-duty-last-call" style={val}>{duty.lastCallAt ? tpl(t.rd_pc711_duty_ago, { t: spanWords(serverNow - Date.parse(duty.lastCallAt)) }) : "—"}</span>
          </>}
          {state !== "off" && duty.storeSession ? <>
            <span style={dim}>{t.rd_pc711_duty_store}</span>
            <span data-testid="pc711-duty-store" data-session={duty.storeSession} style={{ ...val, color: SESSION_COLOUR[duty.storeSession] }}>{duty.storeSession === "ready" ? t.rd_pc711_duty_store_ready : duty.storeSession === "opening" ? t.rd_pc711_duty_store_opening : t.rd_pc711_duty_store_not_ready}</span>
          </> : null}
        </div>
        {state === "duty_out" ? <div role="alert" data-testid="pc711-duty-out" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 13, fontWeight: 800, color: "var(--danger)", lineHeight: 1.4 }}>{t.rd_pc711_duty_out}</div> : null}
      </div>
      {lastParts ? (
        <div data-testid="pc711-duty-history" style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.45, overflowWrap: "anywhere" }}>
          {lastWhy ? tpl(t.rd_pc711_duty_hist, { range: lastParts.range, dur: lastParts.dur, why: lastWhy }) : tpl(t.rd_pc711_duty_hist_nowhy, { range: lastParts.range, dur: lastParts.dur })}
        </div>
      ) : null}
    </div>
  );
}
