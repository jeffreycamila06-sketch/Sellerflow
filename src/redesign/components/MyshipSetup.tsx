// MULTI-SELLER CHECK (2026-09-27) — the ONE 賣貨便 config form, shared by the
// Settings card AND the mandatory Parcel Scan setup modal (single save-flow source, no
// drift). Flow (Oct 1 audit M6): parse GM (shop link or bare id) → Render
// validate FIRST → ok: save stamping the shop name ✓ · invalid: NOTHING saved
// (the old config, if any, stays) · unreachable: save with CLEARED
// shop_name/verified_at (audit MEDIUM-3) + the honest unverified note.
import { useEffect, useState } from "react";
import type { RedesignT as T } from "../i18n";
import { parseGmId, loadMyshipConfig, saveMyshipConfig, validateGm } from "../adapters/parcelCheck";
import { notifyConfigured } from "../adapters/myshipStatus";

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
    notifyConfigured();
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
// as today. Used ONLY by the Settings card — the Parcel Scan setup modal embeds
// the raw form.
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

// MANDATORY SETUP before Parcel Scan (2026-10-01 — replaces the Oct 1 H4
// dismissible banner). A parcel-check seller with NO seller_myship_config row
// ("missing") gets a blocking modal BEFORE Parcel Scan opens: no ×, no
// tap-outside, no Escape — the only exits are a successful save (verified OR
// unverified → Parcel Scan opens) and Back (stays where they were). FAIL-OPEN:
// "loading"/"error" never block (Parcel Scan opens as before). The status hook +
// pure decision live in adapters/myshipStatus.ts.
export function MyshipSetupModal({ t, onSaved, onBack }: { t: T; onSaved: () => void; onBack: () => void }) {
  const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 16 };
  const card: React.CSSProperties = { width: "100%", maxWidth: 440, maxHeight: "calc(100dvh - 32px)", overflowY: "auto", boxSizing: "border-box", background: "var(--surface)", borderRadius: 22, padding: "22px 20px 18px", boxShadow: "0 24px 60px rgba(9,7,24,.5)", fontFamily: "var(--font-ui)", marginBottom: "max(8px, env(safe-area-inset-bottom))" };
  // NO onClick on the overlay and NO close button — not dismissable into Parcel Scan.
  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label={t.rd_mc_gate_title} data-testid="mc-gate">
      <div style={card}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 700, color: "var(--text)", letterSpacing: "-.01em" }}>{t.rd_mc_gate_title}</div>
        <p style={{ fontSize: 13.5, color: "var(--text-dim)", margin: "8px 0 16px", lineHeight: 1.5 }}>{t.rd_mc_gate_body}</p>
        <MyshipConfigForm t={t} onSaved={onSaved} />
        <button type="button" data-testid="mc-gate-back" onClick={onBack} style={{ display: "block", width: "100%", marginTop: 8, padding: "11px 0", borderRadius: 11, border: "none", background: "transparent", color: "var(--text-dim)", fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
          {t.rd_mc_gate_back}
        </button>
      </div>
    </div>
  );
}
