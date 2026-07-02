// Raffle Roleta — FULL-SCREEN game overlay (opened from the Dashboard 🎮 button).
// Rendered via createPortal(document.body), so it must NOT depend on the app's
// scoped CSS variables: the old version used var(--bg) — a token that DOESN'T
// EXIST (the real one is --app-bg) → invalid background → the dashboard bled
// through; and dark-theme --surface is intentionally translucent. Everything here
// therefore uses a FIXED premium indigo palette + explicit font stacks (the same
// approach as the marketing Landing) — solid on every theme, every host.
//
// CSS-only wheel per the audit verdict: conic-gradient slices + ONE GPU rotate
// transition — no canvas, no rAF. The winner is picked FIRST (weighted pure
// draw), then the wheel lands deterministically on their slice. Winner/excluded
// state live in the PARENT (Dashboard) so they survive close/reopen.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { pickWeightedWinner, spinTarget, wheelGradient, RAFFLE_COLORS, type RaffleEntry } from "../adapters/raffle";
import { useT, tpl } from "../i18n";

const SPIN_MS = 4200;

// Fixed palette (portal-safe — never var()). Deep-indigo backdrop, white cards.
const P = {
  bgGrad: "linear-gradient(165deg, #14122B 0%, #221D53 42%, #3A32A0 100%)",
  card: "#FFFFFF", ink: "#1C1A35", body: "#4A4860", muted: "#8A88A0",
  border: "#E5E2F5", soft: "#EFEEFE",
  indigo: "#534AB7", indigoFg: "#3730A3",
  btnGrad: "linear-gradient(135deg, #4F46E5, #6366F1)",
  ok: "#10B981",
};
const FD = "'Space Grotesk', 'Plus Jakarta Sans', sans-serif";
const FU = "'Plus Jakarta Sans', system-ui, sans-serif";
const FM = "'JetBrains Mono', monospace";

export default function RaffleWheel({ entries, sinceLabel, winner, excluded, onWinner, onExclude, onReset, onClose }: {
  entries: RaffleEntry[];
  sinceLabel: string;                       // "since HH:MM" (pre-localized by the caller)
  winner: RaffleEntry | null;               // persistent (parent state)
  excluded: string[];                       // buyer keys removed from the pool
  onWinner: (w: RaffleEntry | null) => void;
  onExclude: (key: string) => void;         // exclude current winner → pool shrinks
  onReset: () => void;                       // clear winner + excluded
  onClose: () => void;
}) {
  const t = useT();
  const pool = entries.filter((e) => !excluded.includes(e.key));
  const totalEntries = pool.reduce((s, e) => s + e.entries, 0);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [toast, setToast] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // Body scroll lock while the raffle is open (the overlay owns its own scroll).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const spin = () => {
    if (spinning || pool.length === 0) return;
    const winIdx = pickWeightedWinner(pool, Math.random());
    if (winIdx < 0) return;
    const target = spinTarget(rotation, winIdx, pool.length, Math.random());
    onWinner(null); setToast(false);
    setSpinning(true);
    setRotation(target);
    // one-shot settle timer (matches the CSS transition; no polling)
    timerRef.current = setTimeout(() => {
      setSpinning(false);
      onWinner(pool[winIdx]);
      setToast(true);
      timerRef.current = setTimeout(() => setToast(false), 3000);
    }, SPIN_MS + 100);
  };

  const slice = 360 / Math.max(1, pool.length);
  const showNames = pool.length <= 20;
  const btn: CSSProperties = { padding: "12px 18px", borderRadius: 12, border: "none", fontFamily: FU, fontSize: 13.5, fontWeight: 700, cursor: "pointer" };

  return createPortal(
    // SOLID full-viewport backdrop — deep indigo gradient + soft floating glow
    // blobs (reuses the landing's .sfl-lp-blob classes: global + reduced-motion
    // aware). Nothing behind ever shows through.
    <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: P.bgGrad, display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: FU }}>
      <div className="sfl-lp-blob sfl-lp-blob-a" style={{ opacity: 0.6 }} />
      <div className="sfl-lp-blob sfl-lp-blob-b" style={{ opacity: 0.5 }} />

      {/* Header — sits directly on the gradient (white text) */}
      <div style={{ position: "relative", zIndex: 1, color: "#fff", padding: "calc(14px + env(safe-area-inset-top)) 18px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 19 }}>🎡 {t.rd_raffle_title}</div>
          <button onClick={onClose} aria-label={t.rd_close} style={{ width: 32, height: 32, borderRadius: 10, border: "none", background: "rgba(255,255,255,.16)", color: "#fff", fontSize: 17, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2 }}>{t.rd_raffle_collecting} {sinceLabel && `· ${sinceLabel}`}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.18)", padding: "4px 10px", borderRadius: 99 }}>{tpl(t.rd_raffle_entries, { n: totalEntries, b: pool.length })}</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.18)", padding: "4px 10px", borderRadius: 99, opacity: 0.9 }}>{t.rd_raffle_max_note}</span>
        </div>
      </div>

      <div className="sfl-scroll" style={{ position: "relative", zIndex: 1, flex: 1, overflowY: "auto", padding: "16px 16px calc(20px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {pool.length === 0 ? (
          <div style={{ marginTop: 46, textAlign: "center", color: "rgba(255,255,255,.85)", fontSize: 13.5, lineHeight: 1.6, maxWidth: 280 }}>{t.rd_raffle_no_entries}</div>
        ) : (
          <>
            {/* Wheel + top pointer + gift hub — white ring so it pops on the dark bg */}
            <div style={{ position: "relative", width: "min(78vw, 300px)", aspectRatio: "1", flexShrink: 0, marginTop: 4 }}>
              <div style={{ position: "absolute", top: -7, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "11px solid transparent", borderRight: "11px solid transparent", borderTop: "16px solid #fff", zIndex: 3, filter: "drop-shadow(0 2px 3px rgba(0,0,0,.45))" }} />
              <div
                data-testid="raffle-wheel"
                style={{ width: "100%", height: "100%", borderRadius: "50%", background: wheelGradient(pool), border: "7px solid rgba(255,255,255,.95)", boxShadow: "0 22px 60px -14px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.15)", transform: `rotate(${rotation}deg)`, transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(.17,.67,.12,.99)` : "none", position: "relative" }}
              >
                {/* Slice labels — SPOKE pattern: full-size container rotated to the
                    slice CENTER angle, label pinned near the outer edge (~0.8R). */}
                {pool.map((e, i) => (
                  <div key={e.key} style={{ position: "absolute", inset: 0, transform: `rotate(${pool.length === 1 ? 0 : (i + 0.5) * slice}deg)`, pointerEvents: "none" }}>
                    <div style={{ position: "absolute", top: "6.5%", left: "50%", transform: "translateX(-50%)", width: "38%", textAlign: "center", color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
                      <div style={{ fontFamily: FM, fontWeight: 800, fontSize: showNames ? 14 : 12, lineHeight: 1 }}>#{e.bNum}</div>
                      {showNames && <div style={{ fontSize: 8.5, fontWeight: 700, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</div>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 52, height: 52, borderRadius: "50%", background: "#fff", boxShadow: "0 6px 18px rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, zIndex: 2 }}>🎁</div>
            </div>

            {/* Winner box — SOLID white card, PERSISTENT until the next spin/Reset */}
            {winner && (
              <div style={{ width: "100%", maxWidth: 340, background: P.card, border: `2px solid ${P.indigo}`, borderRadius: 14, padding: "12px 15px", textAlign: "center", boxShadow: "0 14px 34px rgba(0,0,0,.35)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".1em", color: P.indigoFg }}>{t.rd_raffle_winner.toUpperCase()}</div>
                <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 21, color: P.ink, marginTop: 3 }}>#{winner.bNum} {winner.label} 🎉</div>
              </div>
            )}

            {/* Controls */}
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={spin} disabled={spinning || pool.length === 0} style={{ ...btn, background: P.btnGrad, color: "#fff", boxShadow: "0 10px 24px -8px rgba(99,102,241,.7)", opacity: spinning ? 0.6 : 1 }}>
                🎡 {spinning ? t.rd_raffle_spinning : t.rd_raffle_spin}
              </button>
              {winner && !spinning && (
                <button onClick={() => onExclude(winner.key)} style={{ ...btn, background: P.card, color: P.ink }}>{t.rd_raffle_exclude}</button>
              )}
              {(winner || excluded.length > 0) && !spinning && (
                <button onClick={onReset} style={{ ...btn, background: "transparent", color: "rgba(255,255,255,.85)", border: "1px solid rgba(255,255,255,.4)" }}>{t.rd_raffle_reset}</button>
              )}
            </div>

            {/* Participants — SOLID white card list (its own visual block on the dark bg) */}
            <div style={{ width: "100%", maxWidth: 340 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "rgba(255,255,255,.8)", margin: "4px 2px 7px", letterSpacing: ".04em" }}>{t.rd_raffle_participants}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pool.map((e) => (
                  <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 9, background: P.card, borderRadius: 10, padding: "9px 12px", boxShadow: "0 4px 14px rgba(0,0,0,.25)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: RAFFLE_COLORS[e.colorIndex], flexShrink: 0 }} />
                    <span style={{ fontFamily: FM, fontSize: 12, fontWeight: 700, color: P.ink, flexShrink: 0 }}>#{e.bNum}</span>
                    <span style={{ fontSize: 12, color: P.body, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{e.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: P.indigoFg, background: P.soft, padding: "2px 8px", borderRadius: 99, flexShrink: 0 }}>×{e.entries}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Winner toast — celebratory, auto-fades; the winner BOX above persists. */}
      {toast && winner && (
        <div style={{ position: "absolute", top: "calc(78px + env(safe-area-inset-top))", left: "50%", transform: "translateX(-50%)", zIndex: 5, background: "#fff", color: P.ink, padding: "10px 18px", borderRadius: 12, fontSize: 13.5, fontWeight: 800, boxShadow: "0 14px 34px rgba(0,0,0,.5)", whiteSpace: "nowrap", animation: "sflRise .3s ease-out" }}>
          🎉 {t.rd_raffle_winner}: #{winner.bNum} {winner.label}
        </div>
      )}
    </div>,
    document.body,
  );
}
