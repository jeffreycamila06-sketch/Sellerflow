// Raffle Roleta — FULL-SCREEN game overlay (opened from the Dashboard collecting
// indicator). CSS-only wheel per the audit verdict: conic-gradient slices + ONE
// GPU-composited rotate transition (cubic-bezier deceleration) — no canvas, no
// rAF loop → light in the APK WebView. The winner is picked FIRST (weighted pure
// draw), then the wheel lands deterministically on their slice (spinTarget).
// Winner + excluded state live in the PARENT (Dashboard) so they survive
// close/reopen — the WINNER BOX stays visible until the next spin/Reset (the
// seller must never lose the result).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { pickWeightedWinner, spinTarget, wheelGradient, RAFFLE_COLORS, type RaffleEntry } from "../adapters/raffle";
import { useT, tpl } from "../i18n";

const SPIN_MS = 4200;

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
  const btn: CSSProperties = { padding: "12px 18px", borderRadius: 12, border: "none", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1300, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header (indigo gradient) */}
      <div style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "#fff", padding: "calc(12px + env(safe-area-inset-top)) 16px 12px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>🎡 {t.rd_raffle_title}</div>
          <button onClick={onClose} aria-label={t.rd_close} style={{ width: 30, height: 30, borderRadius: 9, border: "none", background: "rgba(255,255,255,.18)", color: "#fff", fontSize: 16, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.9, marginTop: 2 }}>{t.rd_raffle_collecting} {sinceLabel && `· ${sinceLabel}`}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, background: "rgba(255,255,255,.16)", padding: "4px 10px", borderRadius: 99 }}>{tpl(t.rd_raffle_entries, { n: totalEntries, b: pool.length })}</span>
          <span style={{ fontSize: 11, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "4px 10px", borderRadius: 99, opacity: 0.9 }}>{t.rd_raffle_max_note}</span>
        </div>
      </div>

      <div className="sfl-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        {pool.length === 0 ? (
          <div style={{ marginTop: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.6, maxWidth: 280 }}>{t.rd_raffle_no_entries}</div>
        ) : (
          <>
            {/* Wheel + top pointer + gift hub */}
            <div style={{ position: "relative", width: "min(78vw, 320px)", aspectRatio: "1", flexShrink: 0, marginTop: 6 }}>
              <div style={{ position: "absolute", top: -6, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "11px solid transparent", borderRight: "11px solid transparent", borderTop: "16px solid var(--text)", zIndex: 3, filter: "drop-shadow(0 2px 2px rgba(0,0,0,.3))" }} />
              <div
                data-testid="raffle-wheel"
                onTransitionEnd={undefined /* settle handled by the one-shot timer (reliable in WebView + tests) */}
                style={{ width: "100%", height: "100%", borderRadius: "50%", background: wheelGradient(pool), border: "6px solid var(--surface)", boxShadow: "0 18px 44px -14px rgba(23,21,48,.45), inset 0 0 0 1px rgba(0,0,0,.08)", transform: `rotate(${rotation}deg)`, transition: spinning ? `transform ${SPIN_MS}ms cubic-bezier(.17,.67,.12,.99)` : "none", position: "relative" }}
              >
                {pool.map((e, i) => (
                  <span key={e.key} style={{ position: "absolute", left: "50%", top: "50%", transform: `rotate(${(i + 0.5) * slice}deg) translateY(-31%)`, transformOrigin: "0 0", fontSize: showNames ? 9.5 : 12, fontWeight: 800, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,.45)", whiteSpace: "nowrap", maxWidth: 86, overflow: "hidden", textOverflow: "ellipsis", marginLeft: -28, width: 56, textAlign: "center", display: "block" }}>
                    #{e.bNum}{showNames ? ` ${e.label}` : ""}
                  </span>
                ))}
              </div>
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 52, height: 52, borderRadius: "50%", background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 6px 16px rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, zIndex: 2 }}>🎁</div>
            </div>

            {/* Winner box — PERSISTENT until the next spin/Reset */}
            {winner && (
              <div style={{ width: "100%", maxWidth: 340, background: "var(--accent-soft)", border: "1.5px solid var(--accent)", borderRadius: 14, padding: "12px 15px", textAlign: "center" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".1em", color: "var(--accent-fg)" }}>{t.rd_raffle_winner.toUpperCase()}</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, color: "var(--text)", marginTop: 3 }}>#{winner.bNum} {winner.label} 🎉</div>
              </div>
            )}

            {/* Controls */}
            <div style={{ display: "flex", gap: 9, flexWrap: "wrap", justifyContent: "center" }}>
              <button onClick={spin} disabled={spinning || pool.length === 0} style={{ ...btn, background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 6px 18px var(--accent-soft)", opacity: spinning ? 0.6 : 1 }}>
                🎡 {spinning ? t.rd_raffle_spinning : t.rd_raffle_spin}
              </button>
              {winner && !spinning && (
                <button onClick={() => onExclude(winner.key)} style={{ ...btn, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border-strong)" }}>{t.rd_raffle_exclude}</button>
              )}
              {(winner || excluded.length > 0) && !spinning && (
                <button onClick={onReset} style={{ ...btn, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}>{t.rd_raffle_reset}</button>
              )}
            </div>

            {/* Participants (color dot matches the buyer's slice color) */}
            <div style={{ width: "100%", maxWidth: 340 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text-dim)", margin: "4px 2px 7px" }}>{t.rd_raffle_participants}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {pool.map((e) => (
                  <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 9, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 11px" }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: RAFFLE_COLORS[e.colorIndex], flexShrink: 0 }} />
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text)", flexShrink: 0 }}>#{e.bNum}</span>
                    <span style={{ fontSize: 12, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{e.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--accent-fg)", background: "var(--accent-softer)", padding: "2px 8px", borderRadius: 99, flexShrink: 0 }}>×{e.entries}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Winner toast — celebratory, auto-fades; the winner BOX above persists. */}
      {toast && winner && (
        <div style={{ position: "absolute", top: "calc(74px + env(safe-area-inset-top))", left: "50%", transform: "translateX(-50%)", zIndex: 5, background: "var(--text)", color: "var(--surface)", padding: "10px 18px", borderRadius: 12, fontSize: 13.5, fontWeight: 800, boxShadow: "0 12px 30px rgba(0,0,0,.35)", whiteSpace: "nowrap", animation: "sflRise .3s ease-out" }}>
          🎉 {t.rd_raffle_winner}: #{winner.bNum} {winner.label}
        </div>
      )}
    </div>
  );
}
