// Screen 1 — Dashboard / Live (hero). dc.html v2 L101–203.
// v2 additions: TikTok/Facebook account-picker dropdowns in the header, and
// Enterprise + 1-Click action buttons on each MINE comment row. Visual only
// (sample data; dropdown open/selected via local state in RedesignApp) — real
// account switching / order creation is Phase 5.
import type { CSSProperties } from "react";
import { avColor, initials, fmt, TT_ACCOUNTS, FB_ACCOUNTS, type Comment } from "../data";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "12px 16px 13px" };
const pickerBtn: CSSProperties = { width: "100%", display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.18)", padding: "6px 9px", border: "none", borderRadius: 9, fontSize: 11.5, fontWeight: 600, color: "var(--on-header)", cursor: "pointer", fontFamily: "var(--font-ui)" };
const dropdown = (side: "left" | "right"): CSSProperties => ({ position: "absolute", top: "calc(100% + 7px)", [side]: 0, width: 220, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, boxShadow: "0 16px 38px rgba(0,0,0,.3)", padding: 6, zIndex: 30 });
const ddHeading: CSSProperties = { fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "6px 8px 7px" };
const ddRow = (active: boolean): CSSProperties => ({ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: 8, border: "none", borderRadius: 9, background: active ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" });
const ddName: CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const ddMeta: CSSProperties = { display: "block", fontSize: 10.5, color: "var(--text-muted)" };
const ddCheck: CSSProperties = { color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, width: 12, flexShrink: 0 };
const bolt = <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5L13 2Z" /></svg>;
const bolt12 = <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5 9-12h-6.5L13 2Z" /></svg>;

// Auto-detect keyword controls (visual only).
export interface AutoControls {
  detect: boolean;
  setupOpen: boolean;
  action: "slip" | "sticker";
  words: string[];
  input: string;
  toggle: () => void;
  toggleSetup: () => void;
  setAction: (a: "slip" | "sticker") => void;
  removeWord: (i: number) => void;
  setInput: (v: string) => void;
  addWord: () => void;
}

const wordChip: CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--accent-fg)", padding: "6px 8px 6px 11px", borderRadius: 9, fontSize: 12, fontWeight: 700 };
const wordX: CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "var(--accent-fg)", fontSize: 15, lineHeight: 1, padding: 0, display: "flex", alignItems: "center" };
const addWordInput: CSSProperties = { background: "transparent", border: "1.3px dashed var(--border-strong)", color: "var(--text)", padding: "6px 11px", borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: "var(--font-ui)", outline: "none", width: 168 };

export default function Dashboard({
  comments, viewers, liveClaims,
  ttOpen, fbOpen, ttIdx, fbIdx, onToggleTT, onToggleFB, onPickTT, onPickFB, onGoOrders,
  auto,
}: {
  comments: Comment[]; viewers: number; liveClaims: number;
  ttOpen: boolean; fbOpen: boolean; ttIdx: number; fbIdx: number;
  onToggleTT: () => void; onToggleFB: () => void;
  onPickTT: (i: number) => void; onPickFB: (i: number) => void;
  onGoOrders: () => void;
  auto: AutoControls;
}) {
  // derived toggle visuals (dc.html v2 L1471–1478)
  const autoLabel = auto.detect ? "Auto-detect" : "Manual mode";
  const autoLabelColor = auto.detect ? "var(--accent-fg)" : "var(--text-muted)";
  const autoTrack = auto.detect ? "var(--accent)" : "var(--border-strong)";
  const autoKnob = auto.detect ? 17 : 2;
  const autoChevron = auto.setupOpen ? "rotate(180deg)" : "rotate(0deg)";
  const segStyle = (a: "slip" | "sticker"): CSSProperties => ({
    flex: 1, padding: "9px 0", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 700,
    ...(auto.action === a
      ? { background: "var(--accent)", color: "var(--accent-text)", border: "1px solid var(--accent)" }
      : { background: "var(--surface-2)", color: "var(--text-dim)", border: "1px solid var(--border)" }),
  });
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#e11d48", padding: "4px 9px 4px 7px", borderRadius: 20, animation: "sflLive 1.8s ease-out infinite" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "sflDot 1s ease-in-out infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "#fff" }}>LIVE</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-.01em" }}>Tonight's Live</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 12, fontWeight: 700, opacity: 0.95 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 4.5C7 4.5 3 8 3 12s4 7.5 9 7.5 9-3.5 9-7.5-4-7.5-9-7.5Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="2.6" fill="currentColor" /></svg>
              {fmt(viewers)}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 7h12l-1 12a2 2 0 0 1-2 1.8H9A2 2 0 0 1 7 19L6 7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M9 7a3 3 0 0 1 6 0" stroke="currentColor" strokeWidth="1.6" /></svg>
              {liveClaims}
            </span>
          </div>
        </div>

        {/* Account pickers (TikTok / Facebook) */}
        <div style={{ display: "flex", gap: 8, marginTop: 11, position: "relative", zIndex: 6 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleTT} style={pickerBtn}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>t</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{TT_ACCOUNTS[ttIdx].handle}</span>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
              <span style={{ fontSize: 9, opacity: 0.85 }}>▾</span>
            </button>
            {ttOpen && (
              <div style={dropdown("left")}>
                <div style={ddHeading}>TIKTOK ACCOUNT</div>
                {TT_ACCOUNTS.map((a, i) => (
                  <button key={a.handle} onClick={() => onPickTT(i)} style={ddRow(i === ttIdx)}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(a.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={ddName}>{a.handle}</span><span style={ddMeta}>{a.meta}</span></span>
                    <span style={ddCheck}>{i === ttIdx ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleFB} style={pickerBtn}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" }}>f</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{FB_ACCOUNTS[fbIdx].handle}</span>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
              <span style={{ fontSize: 9, opacity: 0.85 }}>▾</span>
            </button>
            {fbOpen && (
              <div style={dropdown("right")}>
                <div style={ddHeading}>FACEBOOK PAGE / GROUP</div>
                {FB_ACCOUNTS.map((a, i) => (
                  <button key={a.handle} onClick={() => onPickFB(i)} style={ddRow(i === fbIdx)}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" }}>f</span>
                    <span style={{ flex: 1, minWidth: 0 }}><span style={ddName}>{a.handle}</span><span style={ddMeta}>{a.meta}</span></span>
                    <span style={ddCheck}>{i === fbIdx ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 14px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9, padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>Live comments</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e11d48", animation: "sflDot 1s infinite" }} />
          </div>
          {/* auto-detect: tappable label+chevron opens setup; switch toggles on/off */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={auto.toggleSetup} title="Set up trigger words" style={{ display: "flex", alignItems: "center", gap: 5, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "var(--font-ui)" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: autoLabelColor }}>{autoLabel}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 10, transition: "transform .2s", transform: autoChevron, display: "inline-block" }}>▾</span>
            </button>
            <button onClick={auto.toggle} title="Toggle auto-detect / manual mode" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
              <span style={{ width: 34, height: 19, borderRadius: 11, background: autoTrack, position: "relative", transition: "background .15s", flexShrink: 0, display: "block" }}>
                <span style={{ position: "absolute", top: 2, left: autoKnob, width: 15, height: 15, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.3)", transition: "left .15s" }} />
              </span>
            </button>
          </div>
        </div>

        {/* auto-detect setup panel (dc.html v2 L535–549 + action selector L1480–1481) */}
        {auto.setupOpen && (
          <div className="sfl-comm-row" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 15, boxShadow: "var(--shadow)", marginBottom: 11 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Trigger word sets</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{auto.words.length} / 20</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {auto.words.map((w, i) => (
                <span key={w} style={wordChip}>{w}<button onClick={() => auto.removeWord(i)} title="Remove" style={wordX}>×</button></span>
              ))}
              {auto.words.length < 20 && (
                <input
                  value={auto.input}
                  onChange={(e) => auto.setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); auto.addWord(); } }}
                  placeholder="Type word, press Enter"
                  style={addWordInput}
                />
              )}
            </div>
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>Auto action</div>
              <div style={{ display: "flex", gap: 7 }}>
                <button onClick={() => auto.setAction("slip")} style={segStyle("slip")}>Slip</button>
                <button onClick={() => auto.setAction("sticker")} style={segStyle("sticker")}>Sticker</button>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: autoLabelColor }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: autoLabelColor }}>{autoLabel}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>currently active</span>
            </div>
          </div>
        )}

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 7, boxShadow: "var(--shadow)", flex: 1 }}>
          {comments.map((c) => (
            <div key={c.id} className="sfl-comm-row" style={{ display: "flex", gap: 10, padding: "9px 8px", borderRadius: 11 }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: avColor(c.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{initials(c.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.name}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)" }}>{c.handle}</span>
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)", marginLeft: "auto", flexShrink: 0 }}>{c.time}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2 }}>
                  <span style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.3 }}>{c.text}</span>
                  {c.mine && (
                    <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", color: "var(--accent-text)", background: "var(--accent)", padding: "2px 6px", borderRadius: 5, flexShrink: 0 }}>MINE</span>
                  )}
                </div>
                {c.mine && (
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 8 }}>
                    <button onClick={onGoOrders} title="Enterprise auto-order" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-fg)", background: "transparent", border: "1.3px solid var(--accent)", padding: "5px 11px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{bolt}Enterprise</button>
                    <button onClick={onGoOrders} title="Create order in 1 click" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)", boxShadow: "0 2px 8px var(--accent-soft)" }}>{bolt12}1-Click</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
