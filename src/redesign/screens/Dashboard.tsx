// Screen 1 — Dashboard / Live (hero). dc.html L101–160.
import type { CSSProperties } from "react";
import { avColor, initials, fmt, type Comment } from "../data";

const headerBar: CSSProperties = { position: "sticky", top: 0, zIndex: 5, background: "var(--header-bg)", backdropFilter: "saturate(1.5) blur(14px)", color: "var(--on-header)", padding: "12px 16px 13px" };
const chip: CSSProperties = { display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,.16)", padding: "5px 10px", borderRadius: 9, fontSize: 11.5, fontWeight: 600 };
const greenDot: CSSProperties = { width: 7, height: 7, borderRadius: "50%", background: "#4ade80" };

export default function Dashboard({ comments, viewers, liveClaims }: { comments: Comment[]; viewers: number; liveClaims: number }) {
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
        <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
          <div style={chip}><span style={greenDot} /> TikTok · @maria_shops</div>
          <div style={chip}><span style={greenDot} /> Facebook</div>
        </div>
      </div>

      <div style={{ padding: "14px 14px 18px", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9, padding: "0 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14.5, color: "var(--text)" }}>Live comments</span>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#e11d48", animation: "sflDot 1s infinite" }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>Auto-detecting "mine"</span>
        </div>

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
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
