// Settings → Channels → Shopee: the seller's registered Shopee shops (sql/199 preview). Each one counts as one
// account. Remove (confirm sheet, the same words as the "Plan full" popup) → the server stops its read and
// removes it; a different shop can be added right away (sql/205). A shop that took a removed account's place
// less than 4 hours ago is locked: Remove shows "Wait a little" with the time left. A shop is added by
// connecting its live on the Live screen (paste the share link) — this screen never adds one.
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT, tpl } from "../i18n";
import { useLang } from "../i18n/langContext";
import { BackButton } from "../components/BackButton";
import AccountQuotaLine from "../components/AccountQuotaLine";
import { accountName, isAccountLive, waitMs, lockMs, countdownText, type AccountList, type AccountRow, type LiveAccounts } from "../adapters/planFull";
import type { RemoveResult } from "../components/PlanFullPopup";

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: "12px 14px", marginBottom: 10, boxShadow: "var(--shadow)" };

function addedDay(iso: string | null, lang: string): string | null {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString(lang, { month: "short", day: "numeric", year: "numeric" }); } catch { return null; }
}

export default function ShopeeShops({ list, live, onRemove, onReload, onBack, now = () => Date.now() }: {
  list: AccountList | null;          // my_account_list (null = still loading / could not be read)
  live: LiveAccounts;
  onRemove: (a: AccountRow) => Promise<RemoveResult>;
  onReload: () => void | Promise<void>;
  onBack: () => void;
  now?: () => number;
}) {
  const t = useT();
  const lang = useLang();
  const [pick, setPick] = useState<AccountRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locked, setLocked] = useState<AccountRow | null>(null);   // Remove was tapped on a locked shop
  const [, setTick] = useState(0);
  const shops = (list?.accounts || []).filter((a) => a.platform === "shopee" && a.link);
  const wait = waitMs(list, { kind: "shopee" }, now());

  const counting = wait !== null || locked !== null;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const confirmRemove = async () => {
    if (!pick || busy) return;
    setBusy(true); setErr(null);
    const r = await onRemove(pick);
    setBusy(false); setPick(null);
    if (r.ok === false) { setErr(t.rd_pf_rm_failed); return; }
    await onReload();
  };

  const sheet = pick && createPortal(
    <div className="sfl-pf-overlay" data-testid="ss-confirm-overlay" onClick={() => { if (!busy) setPick(null); }}>
      <div className="sfl-pf-sheet" role="dialog" aria-modal="true" aria-label={tpl(t.rd_pf_rm_title, { name: accountName(pick, t) })} data-testid="ss-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="sfl-pf-grab" aria-hidden="true" />
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{tpl(t.rd_pf_rm_title, { name: accountName(pick, t) })}</h2>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.45, color: "var(--text-dim)" }}>{t.rd_pf_rm_body}</p>
        <button type="button" onClick={() => void confirmRemove()} disabled={busy} data-testid="ss-confirm-remove" style={{ minHeight: 50, borderRadius: 14, border: "none", background: "var(--danger)", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 800, cursor: "pointer", opacity: busy ? 0.7 : 1 }}>{busy ? t.rd_pf_removing : t.rd_pf_remove}</button>
        <button type="button" onClick={() => setPick(null)} disabled={busy} data-testid="ss-keep" style={{ minHeight: 48, borderRadius: 14, border: "1.5px solid var(--border-strong)", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>{t.rd_pf_rm_keep}</button>
      </div>
    </div>,
    (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body,
  );

  const lockedSheet = locked && createPortal(
    <div className="sfl-pf-overlay" data-testid="ss-locked-overlay" onClick={() => setLocked(null)}>
      <div className="sfl-pf-sheet" role="dialog" aria-modal="true" aria-label={t.rd_pf_wait_title} data-testid="ss-locked" onClick={(e) => e.stopPropagation()}>
        <div className="sfl-pf-grab" aria-hidden="true" />
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{t.rd_pf_wait_title}</h2>
        <p data-testid="ss-locked-lead" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.45, color: "var(--text-dim)" }}>{tpl(t.rd_pf_wait_locked, { name: accountName(locked, t) })}</p>
        <div data-testid="ss-locked-countdown" role="timer" aria-live="off" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--accent-softer)", borderRadius: 14, padding: 14, color: "var(--accent-fg)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{countdownText(lockMs(locked, list, now()) ?? 0, t)}</span>
        </div>
        <button type="button" onClick={() => setLocked(null)} data-testid="ss-locked-ok" style={{ minHeight: 50, borderRadius: 14, border: "none", background: "var(--accent)", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 800, cursor: "pointer", width: "100%" }}>{t.rd_pf_ok}</button>
      </div>
    </div>,
    (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body,
  );

  return (
    <div>
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <BackButton onClick={onBack} />
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, background: "#ee4d2d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0 }} aria-hidden="true">S</span>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, letterSpacing: "-.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.rd_ss_title}</div>
        </div>
      </div>

      <div style={{ padding: "16px 14px 24px" }}>
        <AccountQuotaLine reloadKey={shops.map((s) => s.key).join(",") + (list ? `:${list.used}:${list.locked}` : "")} />
        {list === null ? (
          <div data-testid="ss-loading" style={{ ...card, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>…</div>
        ) : shops.length === 0 ? (
          <div data-testid="ss-empty" style={{ ...card, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, textAlign: "center" }}>{t.rd_ss_empty}</div>
        ) : (
          shops.map((s) => {
            const isLive = isAccountLive(s, live);
            const day = addedDay(s.addedAt, lang);
            return (
              <div key={s.key} data-testid="ss-row" style={{ ...card, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: "#ee4d2d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff", flexShrink: 0 }} aria-hidden="true">S</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div data-testid="ss-row-name" style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accountName(s, t)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                    {isLive ? tpl(t.rd_pf_live_now, { platform: t.rd_cg_shopee }) : day ? tpl(t.rd_ss_added, { date: day }) : t.rd_pf_plat_shopee}
                  </div>
                  {!s.covered && <div data-testid="ss-not-covered" style={{ fontSize: 11, fontWeight: 700, color: "var(--warn)", marginTop: 2 }}>{t.rd_pf_not_covered}</div>}
                </div>
                {isLive
                  ? <span data-testid="ss-end-live" style={{ fontSize: 12, fontWeight: 800, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 9, padding: "8px 10px", whiteSpace: "nowrap", flexShrink: 0 }}>{t.rd_pf_end_live_first}</span>
                  : <button type="button" onClick={() => { setErr(null); if (lockMs(s, list, now()) !== null) { setLocked(s); return; } setPick(s); }} data-testid="ss-remove" style={{ minHeight: 44, borderRadius: 10, border: "1.5px solid var(--danger)", background: "var(--surface)", color: "var(--danger)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 800, padding: "0 14px", cursor: "pointer", flexShrink: 0 }}>{t.rd_pf_remove}</button>}
              </div>
            );
          })
        )}
        {err && <div data-testid="ss-error" role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", background: "var(--danger-soft)", padding: "8px 10px", borderRadius: 9, marginBottom: 10 }}>{err}</div>}
        {wait !== null && (
          <div data-testid="ss-wait" role="timer" style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--accent-softer)", color: "var(--accent-fg)", borderRadius: 12, padding: "10px 12px", fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>{tpl(t.rd_ss_wait, { time: countdownText(wait, t) })}</span>
          </div>
        )}
        <div data-testid="ss-lock-note" style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: "4px 2px 8px" }}>{t.rd_pf_lock_note}</div>
        <div data-testid="ss-add-hint" style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: "0 2px" }}>{t.rd_ss_add_hint}</div>
      </div>
      {sheet}
      {lockedSheet}
    </div>
  );
}
