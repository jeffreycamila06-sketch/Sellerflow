// MULTI-SELLER CHECK (2026-09-27) — the ONE 賣貨便 config form, shared by the
// Settings card AND the Parcel Scan setup banner (single save-flow source, no
// drift). Flow (Oct 1 audit M6): parse GM (shop link or bare id) → Render
// validate FIRST → ok: save stamping the shop name ✓ · invalid: NOTHING saved
// (the old config, if any, stays) · unreachable: save with CLEARED
// shop_name/verified_at (audit MEDIUM-3) + the honest unverified note.
import { useEffect, useState } from "react";
import type { RedesignT as T } from "../i18n";
import { parseGmId, loadMyshipConfig, saveMyshipConfig, validateGm, probeMyshipConfig } from "../adapters/parcelCheck";

// onSaved fires once a config row EXISTS (saved-verified OR saved-unverified) —
// that is the gate's open condition.
export function MyshipConfigForm({ t, onSaved }: { t: T; onSaved?: () => void }) {
  const [gm, setGm] = useState("");
  const [shopName, setShopName] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "unverified" | "error">("idle");
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    void loadMyshipConfig().then((c) => {
      if (!live || !c) return;
      setGm(c.gmId); setShopName(c.shopName);
      if (c.shopName) setState("saved");
    });
    return () => { live = false; };
  }, []);
  const save = async () => {
    if (state === "saving") return;
    const gmId = parseGmId(gm);
    if (!gmId) { setState("error"); setErr(t.rd_mc_err_gm); return; }
    // GM is the ONLY field — checks run through the shared CHECK_SENDER_PHONE.
    setState("saving"); setErr(""); setShopName(null);
    const v = await validateGm(gmId);
    if ("invalid" in v && v.invalid) {
      // M6: a GM that 7-11 says is no shop is NEVER saved (nothing written —
      // an existing good config is left exactly as it was).
      setState("error"); setErr(t.rd_mc_invalid);
      return;
    }
    // ok → stamp shop_name + verified_at in the one save. Unreachable → save
    // with CLEARED shop_name/verified_at (MEDIUM-3: a changed GM must never
    // keep the OLD shop's verified badge) and say so honestly.
    const saved = await saveMyshipConfig(gmId, v.ok ? v.shopName : null);
    if (!saved.ok) { setState("error"); setErr(t.rd_mc_err_save); return; }
    setGm(gmId);
    if (v.ok) { setShopName(v.shopName); setState("saved"); }
    else setState("unverified");
    onSaved?.();
  };
  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13, fontFamily: "var(--font-ui)" };
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>{t.rd_mc_sub}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{t.rd_mc_gm_label}</div>
      <input data-testid="mc-gm" value={gm} onChange={(e) => setGm(e.target.value)} placeholder={t.rd_mc_gm_ph} style={inp} />
      <button onClick={save} disabled={state === "saving"} style={{ marginTop: 12, width: "100%", padding: "10px 0", borderRadius: 11, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)", opacity: state === "saving" ? 0.6 : 1 }}>
        {state === "saving" ? t.rd_mc_saving : t.rd_mc_save}
      </button>
      {state === "saved" && shopName && <div data-testid="mc-verified" style={{ marginTop: 9, fontSize: 12.5, fontWeight: 700, color: "var(--ok)" }}>{shopName} ✓</div>}
      {state === "unverified" && <div style={{ marginTop: 9, fontSize: 12, color: "var(--warn, #b45309)" }}>{t.rd_mc_unverified}</div>}
      {state === "error" && err && <div style={{ marginTop: 9, fontSize: 12, color: "var(--danger, #dc2626)" }}>{err}</div>}
    </div>
  );
}

// SETTINGS-ONLY collapse: once a GM is saved, show a compact one-liner
// "賣貨便: GM260909… ✓ · Change" instead of the full form; Change expands the
// SAME MyshipConfigForm inline (saving collapses back). No GM yet → full form,
// as today. Used ONLY by the Settings card — the Parcel Scan banner embeds the
// raw form.
export function MyshipConfigCard({ t }: { t: T }) {
  const [gm, setGm] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [changing, setChanging] = useState(false);
  const reload = () => loadMyshipConfig().then((c) => setGm(c && c.gmId ? c.gmId : null));
  useEffect(() => {
    let live = true;
    void loadMyshipConfig().then((c) => { if (!live) return; setGm(c && c.gmId ? c.gmId : null); setLoaded(true); });
    return () => { live = false; };
  }, []);
  if (!loaded) return null; // don't flash the full form before we know a GM is saved
  if (gm && !changing) {
    return (
      <div data-testid="mc-compact" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 600 }}>
          賣貨便: <span style={{ fontFamily: "var(--font-mono)" }}>{gm.slice(0, 8)}…</span>{" "}
          <span aria-label={t.rd_mc_set} title={t.rd_mc_set} style={{ color: "var(--ok)", fontWeight: 800 }}>✓</span>
        </span>
        <button data-testid="mc-change" onClick={() => setChanging(true)} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", padding: 0, fontFamily: "var(--font-ui)" }}>· {t.rd_mc_change}</button>
      </div>
    );
  }
  return <MyshipConfigForm t={t} onSaved={() => { setChanging(false); void reload(); }} />;
}

// PARCEL SCAN SETUP BANNER (Oct 1 audit H4 — replaces the blocking modal).
// Parcel Scan is ALWAYS usable; a seller without a 賣貨便 GM just has no
// store/phone checks (the pending RPC's INNER JOIN on seller_myship_config
// already skips their rows), so the screen's checkOn is off for them and a
// dismissible banner offers the setup. States:
//   enabled=false  → pass-through, config never loaded, no banner, checkOn off
//   loading        → checkOn on (most allowlisted sellers are configured), no banner
//   configured     → checkOn on, no banner
//   missing        → checkOn OFF, banner (unless dismissed this session)
//   error          → FAIL-OPEN: checkOn on, no banner, nothing blocked
// Children is a render-prop: (checkOn, banner) → the screen.
const BANNER_DISMISS_KEY = "sfl_rd_mc_banner_dismissed";
const readDismissed = (): boolean => {
  try { return sessionStorage.getItem(BANNER_DISMISS_KEY) === "1"; } catch { return false; }
};
export function MyshipScanGate({ t, enabled, children }: {
  t: T; enabled: boolean; children: (checkOn: boolean, banner: React.ReactNode) => React.ReactNode;
}) {
  const [status, setStatus] = useState<"loading" | "missing" | "configured" | "error">("loading");
  const [dismissed, setDismissed] = useState(readDismissed);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void probeMyshipConfig().then(
      (s) => { if (live) setStatus(s); },
      () => { if (live) setStatus("error"); }, // fail-OPEN
    );
    return () => { live = false; };
  }, [enabled]);
  if (!enabled) return <>{children(false, null)}</>;
  const checkOn = status !== "missing";
  const dismiss = () => {
    setDismissed(true); setOpen(false);
    try { sessionStorage.setItem(BANNER_DISMISS_KEY, "1"); } catch { /* per-session nicety only */ }
  };
  const banner = status === "missing" && !dismissed ? (
    <div data-testid="mc-banner" role="status" style={{ border: "1px solid var(--border)", background: "var(--surface-2)", borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{t.rd_mc_banner}</div>
        {!open && (
          <button type="button" data-testid="mc-banner-setup" onClick={() => setOpen(true)} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 800, fontSize: 12, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
            {t.rd_mc_banner_setup}
          </button>
        )}
        <button type="button" data-testid="mc-banner-close" aria-label={t.rd_mc_banner_close} onClick={dismiss} style={{ flexShrink: 0, background: "none", border: "none", color: "var(--text-muted)", fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 4 }}>×</button>
      </div>
      {open && <div style={{ marginTop: 10 }}><MyshipConfigForm t={t} onSaved={() => { setStatus("configured"); setOpen(false); }} /></div>}
    </div>
  ) : null;
  return <>{children(checkOn, banner)}</>;
}
