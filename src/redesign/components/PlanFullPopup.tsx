// "Plan full" popup (sql/199, Jeff's approved design 2026-11-22: claude.ai/artifact/Cq7XpuK1ApT4EN9QS5AkRT).
// ONE popup for TikTok add, Facebook Page connect, Shopee new shop, Instagram, and live start with an account
// outside the plan. States: list (Remove on each account; "End your live first" for the one live now) →
// confirm ("Remove X?") → removed. Remove on an account that took a removed account's place less than 4 hours
// ago → wait ("Wait a little" + live countdown) instead of the confirm (sql/205). The button under the list
// is "Upgrade plan" (Android / web → Subscription) or "Contact Admin" on iPhone (a real link, App Store rule).
// A phone gets a bottom sheet; a wide screen (≥ 900 px) a centred card. Drawn in a portal into
// [data-redesign] so it sits above the bottom nav and keeps the theme tokens.
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT, tpl } from "../i18n";
import { TELEGRAM_URL } from "../../lib/telegram";
import {
  loadMyAccountList, accountName, platformName, isAccountLive, waitMs, lockMs, countdownText, planFullTexts, waitLead, removeBodyText,
  type AccountList, type AccountRow, type PlanFullTarget, type LiveAccounts,
} from "../adapters/planFull";

export type RemoveResult = { ok: true } | { ok: false; error: "cooldown" | "failed" };

const ICON: Record<AccountRow["platform"], { bg: string; ch: string }> = {
  tiktok: { bg: "#111111", ch: "t" }, facebook: { bg: "#2F6FEB", ch: "f" }, instagram: { bg: "#C13584", ch: "ig" }, shopee: { bg: "#EE4D2D", ch: "S" },
};
const iconStyle = (bg: string): CSSProperties => ({ width: 34, height: 34, flexShrink: 0, borderRadius: 10, background: bg, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800 });
const primary = (bg: string): CSSProperties => ({ minHeight: 50, borderRadius: 14, border: "none", background: bg, color: "#fff", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none", width: "100%" });
const secondary: CSSProperties = { minHeight: 48, borderRadius: 14, border: "1.5px solid var(--border-strong)", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, cursor: "pointer", width: "100%" };

type Phase = "loading" | "list" | "confirm" | "wait" | "live_ok" | "room" | "error";

export default function PlanFullPopup({ target, ios, planName, live, onRemove, onUpgrade, onClose, load = loadMyAccountList, now = () => Date.now() }: {
  target: PlanFullTarget;
  ios: boolean;
  planName: string;                       // the seller's plan name in their language (not shown on iPhone)
  live: LiveAccounts;                     // the accounts live right now
  onRemove: (a: AccountRow) => Promise<RemoveResult>;
  onUpgrade: () => void;                  // Android / web: open Subscription
  onClose: () => void;
  load?: () => Promise<AccountList | null>;
  now?: () => number;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("loading");
  const [list, setList] = useState<AccountList | null>(null);
  const [pick, setPick] = useState<AccountRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waitFor, setWaitFor] = useState<PlanFullTarget>(target);
  const [lockedPick, setLockedPick] = useState<AccountRow | null>(null);   // Remove was tapped on a locked account
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    void load().then((l) => {
      if (!alive) return;
      setList(l);
      if (waitMs(l, target, now()) !== null) setPhase("wait");
      else setPhase(l ? "list" : "error");
    });
    return () => { alive = false; };
    // opened once per target (the popup is mounted fresh for each one)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the live countdown: once a second while it shows
  useEffect(() => {
    if (phase !== "wait") return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Escape closes (never while a removal is under way)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);

  const doRemove = async () => {
    if (!pick || busy) return;
    setBusy(true); setErr(null);
    const r = await onRemove(pick);
    if (r.ok === false) {
      setBusy(false); setPhase("list");
      setErr(r.error === "cooldown" ? t.rd_ch_cooldown_err : t.rd_pf_rm_failed);
      return;
    }
    const removed = pick;
    const l = await load();
    setBusy(false); setList(l); setPick(null);
    if (target.kind === "live") { setPhase("live_ok"); return; }
    const after: PlanFullTarget = { kind: target.kind };          // the wait comes from the new numbers now
    if (waitMs(l, after, now()) !== null) { setWaitFor(after); setPhase("wait"); return; }
    if (l && l.used < l.limit) { setPhase("room"); return; }
    setPhase(l ? "list" : "error");
    void removed;
  };

  const upgradeButton = ios
    ? <a href={TELEGRAM_URL} target="_blank" rel="noreferrer" data-testid="pf-contact" style={primary("var(--accent)")}>{t.rd_pf_contact}</a>
    : <button type="button" onClick={onUpgrade} data-testid="pf-upgrade" style={primary("var(--accent)")}>{t.rd_pf_upgrade}</button>;
  const closeButton = (label: string, testid = "pf-cancel") => <button type="button" onClick={onClose} disabled={busy} data-testid={testid} style={secondary}>{label}</button>;
  const title = (s: string) => <h2 data-testid="pf-title" style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{s}</h2>;
  const lead = (s: string, testid = "pf-lead") => <p data-testid={testid} style={{ margin: 0, fontSize: 14.5, lineHeight: 1.45, color: "var(--text-dim)" }}>{s}</p>;

  let body: React.ReactNode = null;
  if (phase === "loading") {
    body = <div data-testid="pf-loading" style={{ padding: "22px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>…</div>;
  } else if (phase === "error") {
    body = (<>
      {title(ios ? t.rd_pf_title_ios : t.rd_pf_title)}
      {lead(t.rd_pf_load_failed)}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{upgradeButton}{closeButton(t.rd_pf_cancel)}</div>
    </>);
  } else if (phase === "confirm" && pick) {
    const name = accountName(pick, t);
    body = (<>
      {title(tpl(t.rd_pf_rm_title, { name }))}
      {lead(removeBodyText(list, t))}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" onClick={() => void doRemove()} disabled={busy} data-testid="pf-confirm-remove" style={{ ...primary("var(--danger)"), opacity: busy ? 0.7 : 1 }}>{busy ? t.rd_pf_removing : t.rd_pf_remove}</button>
        <button type="button" onClick={() => { setPick(null); setPhase("list"); }} disabled={busy} data-testid="pf-keep" style={secondary}>{t.rd_pf_rm_keep}</button>
      </div>
    </>);
  } else if (phase === "wait") {
    const ms = lockedPick ? lockMs(lockedPick, list, now()) : waitMs(list, waitFor, now());
    body = (<>
      {title(t.rd_pf_wait_title)}
      {lockedPick ? lead(tpl(t.rd_pf_wait_locked, { name: accountName(lockedPick, t) }), "pf-lead-locked") : lead(waitLead(waitFor, t))}
      <div data-testid="pf-countdown" role="timer" aria-live="off" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--accent-softer)", borderRadius: 14, padding: 14, color: "var(--accent-fg)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        <span style={{ fontSize: 22, fontWeight: 800 }}>{countdownText(ms ?? 0, t)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button type="button" onClick={onClose} data-testid="pf-ok" style={primary("var(--accent)")}>{t.rd_pf_ok}</button>
        {list && list.accounts.length > 0
          ? <button type="button" onClick={() => { setLockedPick(null); setPhase("list"); }} data-testid="pf-back" style={secondary}>{t.rd_pf_back}</button>
          : closeButton(t.rd_pf_back, "pf-back")}
      </div>
    </>);
  } else if (phase === "live_ok" || phase === "room") {
    body = (<>
      {title(t.rd_pf_live_ok_title)}
      {lead(phase === "live_ok" ? tpl(t.rd_pf_live_ok_body, { name: target.name || "" }) : t.rd_pf_room_now)}
      <button type="button" onClick={onClose} data-testid="pf-ok" style={primary("var(--accent)")}>{t.rd_pf_ok}</button>
    </>);
  } else if (list) {
    const tx = planFullTexts({ list, target, ios, planName, t });
    body = (<>
      {title(tx.title)}
      {lead(tx.lead)}
      <div data-testid="pf-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.accounts.map((a) => {
          const isLive = isAccountLive(a, live);
          const ic = ICON[a.platform];
          const plat = platformName(a.platform, t);
          return (
            <div key={`${a.platform}:${a.key}`} data-testid="pf-row" style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface-2)", borderRadius: 14, padding: "10px 12px" }}>
              <span style={iconStyle(ic.bg)} aria-hidden="true">{ic.ch}</span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span data-testid="pf-row-name" style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{accountName(a, t)}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {isLive ? tpl(t.rd_pf_live_now, { platform: plat }) : plat}
                  {!a.covered && <span data-testid="pf-row-not-covered" style={{ marginLeft: 6, fontWeight: 700, color: "var(--warn)" }}>· {t.rd_pf_not_covered}</span>}
                </span>
              </span>
              {isLive
                ? <span data-testid="pf-end-live" style={{ fontSize: 12, fontWeight: 800, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 9, padding: "8px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>{t.rd_pf_end_live_first}</span>
                : <button type="button" onClick={() => { setErr(null); if (lockMs(a, list, now()) !== null) { setLockedPick(a); setPhase("wait"); return; } setPick(a); setPhase("confirm"); }} data-testid="pf-remove" style={{ minHeight: 44, borderRadius: 10, border: "1.5px solid var(--danger)", background: "var(--surface)", color: "var(--danger)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 800, padding: "0 14px", cursor: "pointer", flexShrink: 0 }}>{t.rd_pf_remove}</button>}
            </div>
          );
        })}
      </div>
      {tx.note && <p data-testid="pf-note" style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--text-muted)" }}>{tx.note}</p>}
      {err && <div data-testid="pf-error" role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", background: "var(--danger-soft)", padding: "8px 10px", borderRadius: 9 }}>{err}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>{upgradeButton}{closeButton(t.rd_pf_cancel)}</div>
    </>);
  }

  const node = (
    <div className="sfl-pf-overlay" data-testid="pf-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="sfl-pf-sheet" role="dialog" aria-modal="true" aria-label={ios ? t.rd_pf_title_ios : t.rd_pf_title} data-testid="pf-sheet" data-phase={phase} onClick={(e) => e.stopPropagation()}>
        <div className="sfl-pf-grab" aria-hidden="true" />
        {body}
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}
