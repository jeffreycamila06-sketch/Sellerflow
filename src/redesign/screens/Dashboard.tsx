// Screen 1 — Dashboard / Live (hero). dc.html v3 L101–234.
// v3 header: "SellerFlowLive" title + live-session-length pill (Session · Nd),
// TikTok/Facebook account pickers with connect flow. Each comment row carries
// the 1-Click / Enterprise order flow (printed / Enterprise price-entry), all
// visual-only — real account switching / order creation is Phase 5.
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { avColor, initials, TT_ACCOUNTS, FB_ACCOUNTS, type Comment, type AutoWord } from "../data";
import { sessionSummary, type SessionState } from "../adapters/useLiveSession";
import type { RebuiltSession } from "../../lib/orderLogic";

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
const printerIcon = <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.9" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.9" /><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.9" /></svg>;
const calIcon = <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;

// Connection-flow visuals per platform (dc.html v3 L2009–2028). Visual only.
const conn = (connected: boolean, connecting: boolean) => ({
  chipBg: connected ? "rgba(74,222,128,.22)" : "rgba(255,255,255,.14)",
  chipShadow: connected ? "inset 0 0 0 1.3px rgba(74,222,128,.6)" : "inset 0 0 0 1px rgba(255,255,255,.22)",
  dotBg: connected ? "#4ade80" : connecting ? "#fbbf24" : "rgba(255,255,255,.45)",
  dotGlow: connected ? "0 0 6px rgba(74,222,128,.9)" : "none",
  dotAnim: connected ? "sflDot 1.1s ease-in-out infinite" : connecting ? "sflDot .7s ease-in-out infinite" : "none",
  title: connected ? "Connected to live stream" : "Not connected — pick an account, then Connect",
  label: connecting ? "Connecting…" : connected ? "Disconnect" : "Connect",
  bg: connected ? "var(--surface-2)" : "var(--accent)",
  fg: connected ? "var(--danger)" : "var(--accent-text)",
  border: connected ? "1px solid var(--border-strong)" : "none",
});
const refreshIcon = <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M20 11a8 8 0 0 0-14-4.5L4 8m0 0V4m0 4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M4 13a8 8 0 0 0 14 4.5L20 16m0 0v4m0-4h-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const refreshBtn: CSSProperties = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: "1px solid var(--border-strong)", borderRadius: 9, background: "var(--surface-2)", color: "var(--text)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" };
const connFooterWrap: CSSProperties = { display: "flex", gap: 6, padding: "7px 4px 3px", marginTop: 4, borderTop: "1px solid var(--border)" };

const SESSION_OPTS = [1, 2, 3];

export default function Dashboard({
  comments, cur,
  ttOpen, fbOpen, ttIdx, fbIdx, onToggleTT, onToggleFB, onPickTT, onPickFB,
  ttConnected, fbConnected, ttConnecting, fbConnecting, onConnectTT, onConnectFB,
  sessionDays, sessionOpen, onToggleSession, onPickSession,
  autoDetect, autoWords, printed, entId, entPrice, onOneClick, onOpenEnt, onEntPrice, onEntKey,
  session = { buyers: [], orders: [] }, sessionState = "idle",
  canInject = false, onInjectSynthetic,
}: {
  comments: Comment[]; cur: string;
  session?: RebuiltSession; sessionState?: SessionState;
  canInject?: boolean; onInjectSynthetic?: () => void;
  ttOpen: boolean; fbOpen: boolean; ttIdx: number; fbIdx: number;
  onToggleTT: () => void; onToggleFB: () => void;
  onPickTT: (i: number) => void; onPickFB: (i: number) => void;
  ttConnected: boolean; fbConnected: boolean; ttConnecting: boolean; fbConnecting: boolean;
  onConnectTT: () => void; onConnectFB: () => void;
  sessionDays: number; sessionOpen: boolean; onToggleSession: () => void; onPickSession: (n: number) => void;
  autoDetect: boolean; autoWords: AutoWord[];
  printed: Record<string, string>; entId: string | null; entPrice: string;
  onOneClick: (id: string) => void; onOpenEnt: (id: string) => void;
  onEntPrice: (v: string) => void; onEntKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const tt = conn(ttConnected, ttConnecting);
  const fb = conn(fbConnected, fbConnecting);
  const sessionLabel = sessionDays + (sessionDays > 1 ? " days" : " day");
  const summary = sessionSummary(session); // Phase 5c — today's hydrated session
  // Phase 5d — feed scroll (tangled-zone #3). Newest is prepended at the top, so
  // we scroll the feed container to top when a new comment arrives. useLayoutEffect
  // (not setTimeout) so it runs after DOM mutation, before paint.
  const feedRef = useRef<HTMLDivElement>(null);
  const newestId = comments[0]?.id;
  useLayoutEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [newestId]);
  return (
    <div style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#e11d48", padding: "4px 9px 4px 7px", borderRadius: 20, animation: "sflLive 1.8s ease-out infinite" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", animation: "sflDot 1s ease-in-out infinite" }} />
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "#fff" }}>LIVE</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, letterSpacing: "-.01em" }}>SellerFlowLive</div>
          </div>
          {/* Live-session-length pill (dc.html v3 L112) */}
          <div style={{ position: "relative", zIndex: 7 }}>
            <button onClick={onToggleSession} title="Set how many days this live runs before shipping" style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.18)", border: "none", padding: "6px 10px", borderRadius: 9, fontSize: 12, fontWeight: 700, color: "var(--on-header)", cursor: "pointer", fontFamily: "var(--font-ui)" }}>
              {calIcon}
              Session · {sessionLabel}
              <span style={{ fontSize: 9, opacity: 0.85 }}>▾</span>
            </button>
            {sessionOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 7px)", right: 0, width: 212, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, boxShadow: "0 16px 38px rgba(0,0,0,.3)", padding: 6, zIndex: 30 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "7px 9px 6px" }}>LIVE SESSION LENGTH</div>
                {SESSION_OPTS.map((n) => {
                  const active = n === sessionDays;
                  return (
                    <button key={n} onClick={() => onPickSession(n)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 9px", border: "none", borderRadius: 9, background: active ? "var(--accent-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--accent-fg)", flexShrink: 0 }}>{n}</span>
                      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{n + (n > 1 ? " days" : " day")}</span><span style={{ display: "block", fontSize: 10.5, color: "var(--text-muted)" }}>{n === 1 ? "Ship same day" : `${n}-day live before sending`}</span></span>
                      <span style={{ color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, width: 12, flexShrink: 0 }}>{active ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.4, padding: "7px 9px 4px" }}>Orders from this live stay open until the session ends, then ship together.</div>
              </div>
            )}
          </div>
        </div>

        {/* Account pickers (TikTok / Facebook) with connect/connecting/connected states */}
        <div style={{ display: "flex", gap: 8, marginTop: 11, position: "relative", zIndex: 6 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleTT} title={tt.title} style={{ ...pickerBtn, background: tt.chipBg, boxShadow: tt.chipShadow }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>t</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{TT_ACCOUNTS[ttIdx].handle}</span>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: tt.dotBg, flexShrink: 0, animation: tt.dotAnim, boxShadow: tt.dotGlow }} />
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
                <div style={connFooterWrap}>
                  <button style={refreshBtn} title="Refresh connected accounts">{refreshIcon}Refresh</button>
                  <button onClick={onConnectTT} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: tt.border, borderRadius: 9, background: tt.bg, color: tt.fg, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{tt.label}</button>
                </div>
              </div>
            )}
          </div>
          <div style={{ position: "relative", flex: 1 }}>
            <button onClick={onToggleFB} title={fb.title} style={{ ...pickerBtn, background: fb.chipBg, boxShadow: fb.chipShadow }}>
              <span style={{ width: 16, height: 16, borderRadius: 5, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: "var(--font-display)" }}>f</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{FB_ACCOUNTS[fbIdx].handle}</span>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: fb.dotBg, flexShrink: 0, animation: fb.dotAnim, boxShadow: fb.dotGlow }} />
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
                <div style={connFooterWrap}>
                  <button style={refreshBtn} title="Refresh connected pages">{refreshIcon}Refresh</button>
                  <button onClick={onConnectFB} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "8px 0", border: fb.border, borderRadius: 9, background: fb.bg, color: fb.fg, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{fb.label}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 14px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
        {/* Phase 5c — today's cross-device session summary (read-only). Shows
            when a session exists for today; stays hidden when empty. */}
        {sessionState === "loading" && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "0 2px 9px" }}>Loading today’s session…</div>
        )}
        {summary.orders > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 13, padding: "10px 13px", marginBottom: 11, boxShadow: "var(--shadow)" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: "var(--accent-fg)", background: "var(--accent-soft)", padding: "4px 9px", borderRadius: 7 }}>TODAY</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{summary.buyers} buyers · {summary.orders} orders</span>
            <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{cur}{summary.total.toLocaleString("en-US")}</span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9, padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>Live comments</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e11d48", animation: "sflDot 1s infinite" }} />
          </div>
          {/* Preview-only synthetic comment injector (F2) — hidden on the real
              production domain (isPreviewEnv). Lets us verify feed/dedup/scroll
              without a real socket. */}
          {canInject && (
            <button onClick={onInjectSynthetic} title="Preview only — inject a synthetic test comment" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-fg)", background: "var(--accent-soft)", border: "1px dashed var(--accent)", padding: "4px 9px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>+ Test comment</button>
          )}
        </div>

        <div ref={feedRef} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 7, boxShadow: "var(--shadow)", flex: 1, minHeight: 0, overflowY: "auto" }}>
          {comments.length === 0 && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, height: "100%", minHeight: 160, color: "var(--text-muted)", textAlign: "center", padding: "0 24px" }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Waiting for live comments…</span>
              <span style={{ fontSize: 11.5 }}>Connect an account to start your live session.{canInject ? " (Preview: tap “+ Test comment”.)" : ""}</span>
            </div>
          )}
          {comments.map((c) => {
            const lc = (c.text || "").toLowerCase();
            const hit = autoWords.find((w) => w.word && lc.includes(w.word));
            const manP = printed[c.id];
            const isPrinted = (autoDetect && !!hit) || !!manP;
            let printedLabel = "";
            if (manP) printedLabel = manP === "order" ? "" : manP;
            else if (hit && hit.price) printedLabel = cur + hit.price;
            const entOpen = entId === c.id;
            const isAuto = autoDetect && !!hit && !manP;
            const showActions = !isPrinted && !entOpen;
            const printedTag = isAuto ? "Auto-printed" : "Printed";
            const printedBg = isAuto ? "var(--accent-soft)" : "var(--surface-3)";
            const printedFg = isAuto ? "var(--accent-fg)" : "var(--text-dim)";
            return (
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
                  {/* Order flow (dc.html v3 L210–227): printed badge · Enterprise
                      price-entry · 1-Click / Enterprise actions. */}
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 8, minHeight: 27 }}>
                    {isPrinted && (
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, letterSpacing: ".02em", color: printedFg, background: printedBg, padding: "5px 10px", borderRadius: 7 }}>{printerIcon}{printedTag} {printedLabel}</span>
                    )}
                    {entOpen && (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)" }}>Type price, Enter to print</span>
                        <span style={{ display: "flex", alignItems: "center", gap: 3, border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface-2)", padding: "0 9px" }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{cur}</span>
                          <input value={entPrice} onChange={(e) => onEntPrice(e.target.value)} onKeyDown={onEntKey} inputMode="numeric" autoFocus style={{ width: 48, border: "none", background: "transparent", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, padding: "5px 0", outline: "none" }} />
                        </span>
                      </span>
                    )}
                    {showActions && (
                      <>
                        <button onClick={() => onOpenEnt(c.id)} title="Enterprise — type a price, then Enter to auto-print" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-fg)", background: "transparent", border: "1.3px solid var(--accent)", padding: "5px 11px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{bolt}Enterprise</button>
                        <button onClick={() => onOneClick(c.id)} title="1-Click — auto-print order now" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 800, letterSpacing: ".02em", color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)", boxShadow: "0 2px 8px var(--accent-soft)" }}>{bolt12}1-Click</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
