// Admin → Controls → "Free sharing" (sql/208): free logins that share a live account or a device,
// with their free order counts, and "Reset free orders" per live account (a mistake, or a victim).
// The confirm is a step inside the page (no confirm()).
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { mono } from "../ui";
import { loadFreeSharing, resetFreeAccount, type FreeSharing, type SharedAccount, type SharingLogin } from "../adapters/freeAccountCap";

const small: CSSProperties = { fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 };
const btn: CSSProperties = { fontSize: 12, fontWeight: 700, color: "var(--accent-fg)", background: "var(--surface)", border: "1px solid var(--accent)", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", minHeight: 44 };
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 11, background: "var(--surface-2)", padding: 10 };
const head: CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--text)", margin: "14px 0 8px" };
const PLATFORM: Record<string, string> = { tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", shopee: "Shopee" };

function Logins({ rows }: { rows: SharingLogin[] }) {
  const t = useT();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
      {rows.map((l) => (
        <div key={l.userId} data-testid="fs-login" style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, color: "var(--text)" }}>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontWeight: 600 }}>{l.email || "—"}</span>
          <span style={{ ...small, fontWeight: 700, whiteSpace: "nowrap" }}>{l.plan || "—"}</span>
          <span style={{ fontFamily: mono, fontWeight: 700, whiteSpace: "nowrap" }}>{tpl(t.rd_adm_fs_orders, { n: l.freeOrders })}</span>
        </div>
      ))}
    </div>
  );
}

export function FreeSharingPanel({ onToast }: { onToast?: (m: string, k: "ok" | "err") => void }) {
  const t = useT();
  const [data, setData] = useState<FreeSharing | null | "error">(null);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await loadFreeSharing(); setData(r ?? "error"); }, []);
  useEffect(() => { void load(); }, [load]);
  const idOf = (a: SharedAccount) => `${a.platform}:${a.key}`;
  const reset = async (a: SharedAccount) => {
    setBusy(true);
    const r = await resetFreeAccount(a.platform, a.key);
    setBusy(false); setAsk("");
    if (r.ok) { onToast?.(tpl(t.rd_adm_fs_reset_done, { n: r.was ?? 0 }), "ok"); void load(); }
    else onToast?.(t.rd_adm_fs_reset_failed, "err");
  };
  if (data === null) return <div style={small} data-testid="fs-loading">{t.rd_ref_loading}</div>;
  if (data === "error") return <div style={{ ...small, color: "var(--danger)" }} data-testid="fs-error">{t.rd_adm_fs_failed}</div>;
  return (
    <div data-testid="fs-panel">
      <div style={small} data-testid="fs-mode">{data.enforce ? t.rd_adm_fs_mode_on : tpl(t.rd_adm_fs_mode_off, { n: data.wouldRefuse })}</div>
      <div style={head}>{tpl(t.rd_adm_fs_accounts, { n: data.accounts.length })}</div>
      {data.accounts.length === 0 && <div style={small}>{t.rd_adm_fs_none}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.accounts.map((a) => (
          <div key={idOf(a)} data-testid="fs-account" style={card}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 7px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--text-dim)" }}>{PLATFORM[a.platform] || a.platform}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}>{a.platform === "tiktok" ? `@${a.label}` : a.label}</span>
              <span data-testid="fs-count" style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 800, color: a.orders >= data.cap ? "var(--danger)" : "var(--text)" }}>{tpl(t.rd_adm_fs_used, { n: a.orders, cap: data.cap })}</span>
            </div>
            <Logins rows={a.logins} />
            {ask !== idOf(a) && a.orders > 0 && (
              <button type="button" data-testid="fs-reset" onClick={() => setAsk(idOf(a))} style={{ ...btn, marginTop: 9 }}>{t.rd_adm_fs_reset}</button>
            )}
            {ask === idOf(a) && (
              <div data-testid="fs-confirm" style={{ marginTop: 9, border: "1px solid var(--danger)", borderRadius: 8, padding: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", overflowWrap: "anywhere" }}>{tpl(t.rd_adm_fs_reset_q, { n: a.orders })}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                  <button type="button" disabled={busy} onClick={() => setAsk("")} style={btn}>{t.rd_ref_cancel}</button>
                  <button type="button" data-testid="fs-confirm-yes" disabled={busy} onClick={() => void reset(a)} style={{ ...btn, background: "var(--danger)", borderColor: "var(--danger)", color: "#fff" }}>{t.rd_adm_fs_reset}</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={head}>{tpl(t.rd_adm_fs_devices, { n: data.devices.length })}</div>
      {data.devices.length === 0 && <div style={small}>{t.rd_adm_fs_none}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.devices.map((d) => (
          <div key={d.device} data-testid="fs-device" style={card}>
            <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{d.device}…</div>
            <Logins rows={d.logins} />
          </div>
        ))}
      </div>
    </div>
  );
}
