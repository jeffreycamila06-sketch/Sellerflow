// MULTI-SELLER CHECK (2026-09-27) — the ONE 賣貨便 config form, shared by the
// Settings card AND the Parcel Scan hard gate (single save-flow source, no
// drift). Flow: parse GM (shop link or bare id) → save with CLEARED
// shop_name/verified_at (audit MEDIUM-3) → Render validate (verify-optional)
// → re-save stamping the shop name ✓.
import { useEffect, useState } from "react";
import type { T } from "../../translations";
import { parseGmId, loadMyshipConfig, saveMyshipConfig, validateGm } from "../adapters/parcelCheck";

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
    // First save CLEARS shop_name/verified_at (audit MEDIUM-3: a changed GM
    // must never keep the OLD shop's verified badge); validate re-stamps below.
    const saved = await saveMyshipConfig(gmId, null);
    if (!saved.ok) { setState("error"); setErr(t.rd_mc_err_save); return; }
    setGm(gmId);
    const v = await validateGm(gmId);
    if (v.ok) {
      await saveMyshipConfig(gmId, v.shopName); // stamp shop_name + verified_at
      setShopName(v.shopName); setState("saved");
      onSaved?.();
    } else if (v.invalid) {
      setState("error"); setErr(t.rd_mc_invalid); // config kept; seller can re-check the id
    } else {
      setState("unverified"); // saved; honest "couldn't verify" note
      onSaved?.();
    }
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

// PARCEL SCAN HARD GATE: no seller_myship_config row → a blocking setup modal;
// no config = cannot encode. enabled=false (non-allowlisted / non-TW) →
// pass-through, screen byte-unchanged, config never even loaded. While the
// config read is in flight a transparent blocking overlay holds the gate
// closed (encoding must never proceed unconfigured, not even for a beat).
export function MyshipScanGate({ t, enabled, onExit, children }: {
  t: T; enabled: boolean; onExit: () => void; children: React.ReactNode;
}) {
  const [status, setStatus] = useState<"loading" | "missing" | "configured">("loading");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadMyshipConfig().then(
      (c) => { if (live) setStatus(c && c.gmId ? "configured" : "missing"); },
      () => { if (live) setStatus("missing"); }, // load failure = fail-closed (the gate's job)
    );
    return () => { live = false; };
  }, [enabled]);
  if (!enabled) return <>{children}</>;
  return (
    <>
      {children}
      {status !== "configured" && (
        <div data-testid="mc-gate" style={{ position: "fixed", inset: 0, zIndex: 1000, background: status === "missing" ? "rgba(15, 15, 40, 0.55)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
          {status === "missing" && (
            <div style={{ width: "100%", maxWidth: 420, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 18, boxShadow: "0 18px 50px rgba(0,0,0,0.35)" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>{t.rd_mc_title}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>{t.rd_mc_gate_note}</div>
              <MyshipConfigForm t={t} onSaved={() => setStatus("configured")} />
              <button data-testid="mc-gate-back" onClick={onExit} style={{ marginTop: 10, width: "100%", padding: "9px 0", borderRadius: 11, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                {t.rd_mc_gate_back}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
