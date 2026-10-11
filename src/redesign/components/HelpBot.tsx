// Help bot — the draggable bubble on the Settings screen + the chat panel (sql/116,
// POST /support/ask). Rendered only when the switch is on and the seller is in preview
// (SettingsHub decides). Reads on demand: Admin answers when Settings opens, quick
// questions when the chat opens. Zero poll.
//
// The bubble renders into the [data-redesign] root (portal) so the screen's slide-in
// transform never becomes its containing block, and the design tokens still resolve.
// Contact buttons are REAL anchors (the iOS WKWebView rule — no window.open).
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { useLang } from "../i18n/langContext";
import { TELEGRAM_URL, LINE_URL } from "../../lib/telegram";
import {
  askHelpBot, rateChat, loadQuickQuestions, loadAdminAnswers, markAdminAnswersSeen, STARTER_KEYS,
  BUBBLE, TAP_SLOP, snapPos, defaultPos, loadBubblePos, saveBubblePos, clampY,
  hintDue, recordHintShown, recordChatOpened, HINT_DELAY_MS, HINT_SHOW_MS,
  type Box, type BubblePos, type HelpSource, type AdminAnswer,
} from "../adapters/helpBot";

// Screen box: the bubble stays below the header and above the bottom bar (both already
// include the safe areas, so measuring them covers the notch and the home indicator).
function measureBox(): Box {
  const w = window.innerWidth, h = window.innerHeight;
  const head = document.querySelector("[data-hb-top]")?.getBoundingClientRect();
  const nav = document.querySelector(".sfl-nav")?.getBoundingClientRect();
  const top = head ? Math.max(0, head.bottom) : 72;
  const bottom = nav && nav.top > h / 2 ? Math.max(0, h - nav.top) : 16;
  return { w, h, top, bottom };
}
const motionOff = (): boolean => {
  try {
    if (document.querySelector('[data-redesign][data-motion="off"]')) return true;
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const chatIcon = <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5v-8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><path d="M8.5 9.5h7M8.5 12.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;

export default function HelpBot() {
  const t = useT();
  const [box, setBox] = useState<Box>(() => (typeof window === "undefined" ? { w: 375, h: 700, top: 72, bottom: 80 } : measureBox()));
  const [pos, setPos] = useState<BubblePos>(() => {
    const saved = loadBubblePos();
    return saved ? { ...saved, y: clampY(saved.y, box) } : defaultPos(box);
  });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [pulse] = useState(() => !motionOff());
  const [answers, setAnswers] = useState<AdminAnswer[]>([]);
  const unseen = answers.some((a) => !a.seen);
  // "Do you have a question?" hint: ~1 s after Settings opens, 5 s on screen, then a fade.
  const [hint, setHint] = useState<"off" | "on" | "leaving">("off");

  useEffect(() => {
    const onResize = () => {
      const b = measureBox();
      setBox(b);
      setPos((p) => ({ ...p, y: clampY(p.y, b) }));
    };
    onResize(); // header is mounted now
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    let alive = true;
    void loadAdminAnswers().then((a) => { if (alive) setAnswers(a); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!hintDue()) return;
    const t = setTimeout(() => { recordHintShown(); setHint("on"); }, HINT_DELAY_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (hint === "off") return;
    const t = setTimeout(() => setHint(hint === "on" && pulse ? "leaving" : "off"), hint === "on" ? HINT_SHOW_MS : 300);
    return () => clearTimeout(t);
  }, [hint, pulse]);
  const openChat = () => { setHint("off"); setOpen(true); recordChatOpened(); };

  const left = (p: BubblePos) => (p.side === "left" ? 12 : box.w - BUBBLE - 12);
  const onDown = (e: RPointerEvent<HTMLButtonElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
    start.current = { px: e.clientX, py: e.clientY, x: left(pos), y: pos.y, moved: false };
  };
  const onMove = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.px, dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    s.moved = true;
    setDrag({ x: Math.min(Math.max(s.x + dx, 0), box.w - BUBBLE), y: clampY(s.y + dy, box) });
  };
  const onUp = (e: RPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) { setDrag(null); openChat(); return; }
    const next = snapPos(s.x + (e.clientX - s.px), s.y + (e.clientY - s.py), box);
    setDrag(null);
    setPos(next);
    saveBubblePos(next);
  };

  const style: CSSProperties = {
    position: "fixed", zIndex: 1250, width: BUBBLE, height: BUBBLE, borderRadius: "50%", border: "none",
    left: drag ? drag.x : left(pos), top: drag ? drag.y : pos.y, touchAction: "none",
    background: "var(--accent)", color: "var(--accent-text)", boxShadow: "0 8px 22px rgba(9,7,24,.28)",
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
    transition: drag ? "none" : "left .18s ease, top .18s ease",
  };
  // The hint sits beside the bubble on the side facing the screen centre, vertically centred on
  // it (the bubble's y is already kept between the header and the bottom bar).
  const bx = left(pos);
  const hintWrap: CSSProperties = {
    position: "fixed", zIndex: 1250, top: pos.y, height: BUBBLE, display: "flex", alignItems: "center",
    ...(pos.side === "right" ? { right: box.w - bx + 10, maxWidth: bx - 22 } : { left: bx + BUBBLE + 10, maxWidth: box.w - bx - BUBBLE - 22 }),
  };
  const showHint = hint !== "off" && !open && !drag;
  const root = (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || (typeof document !== "undefined" ? document.body : null);
  if (!root) return null;
  return createPortal(
    <>
      {!open && (
        <button type="button" aria-label={unseen ? `${t.rd_hb_open} — ${t.rd_hb_new_reply}` : t.rd_hb_open}
          data-testid="helpbot-bubble" data-side={pos.side} className={pulse ? "sfl-hb-pulse" : undefined} style={style}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDrag(null); }}>
          <span className={hint === "on" && pulse ? "sfl-hb-wave" : undefined} style={{ display: "flex" }} data-testid="helpbot-icon">{chatIcon}</span>
          {unseen && <span data-testid="helpbot-dot" style={{ position: "absolute", top: 4, right: 4, width: 12, height: 12, borderRadius: "50%", background: "var(--danger)", border: "2px solid var(--surface)" }} />}
        </button>
      )}
      {showHint && (
        <div style={hintWrap} data-testid="helpbot-hint-wrap" data-side={pos.side}>
          <div className={pulse ? (hint === "leaving" ? "sfl-hb-hint sfl-hb-hint-out" : "sfl-hb-hint") : undefined} data-testid="helpbot-hint-box"
            style={{ position: "relative", display: "flex", alignItems: "center", gap: 2, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, boxShadow: "0 6px 18px rgba(9,7,24,.18)", padding: "2px 2px 2px 4px", transformOrigin: pos.side === "right" ? "right center" : "left center" }}>
            <span aria-hidden style={{ position: "absolute", top: "50%", [pos.side === "right" ? "right" : "left"]: -6, width: 10, height: 10, marginTop: -5, background: "var(--surface)", borderTop: "1px solid var(--border)", borderRight: "1px solid var(--border)", transform: pos.side === "right" ? "rotate(45deg)" : "rotate(-135deg)" }} />
            <button type="button" onClick={openChat} data-testid="helpbot-hint"
              style={{ position: "relative", border: "none", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, lineHeight: 1.3, padding: "7px 4px 7px 8px", cursor: "pointer", textAlign: "left" }}>
              {t.rd_hb_hint}
            </button>
            <button type="button" onClick={() => setHint("off")} aria-label={t.rd_hb_close} data-testid="helpbot-hint-close"
              style={{ position: "relative", border: "none", background: "transparent", color: "var(--text-dim)", fontSize: 17, lineHeight: 1, padding: "6px 8px", cursor: "pointer" }}>×</button>
          </div>
        </div>
      )}
      {open && (
        <HelpChat
          adminAnswers={answers.filter((a) => !a.seen)}
          onClose={() => setOpen(false)}
          onSeen={() => { if (unseen) { void markAdminAnswersSeen(); setAnswers((a) => a.map((x) => ({ ...x, seen: true }))); } }}
        />
      )}
    </>,
    root,
  );
}

interface Msg { key: string; who: "me" | "bot" | "admin"; text: string; question?: string; id?: string; source?: HelpSource; saved?: boolean; rating?: -1 | 0 | 1 }

const sheet: CSSProperties = { position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.45)", display: "flex", alignItems: "flex-end", justifyContent: "center" };
const panel: CSSProperties = { width: "100%", maxWidth: 480, height: "min(88vh, 720px)", background: "var(--app-bg)", borderRadius: "20px 20px 0 0", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)", paddingBottom: "env(safe-area-inset-bottom)", boxSizing: "border-box" };
const bubbleBase: CSSProperties = { maxWidth: "85%", padding: "9px 12px", borderRadius: 14, fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
const chipBtn: CSSProperties = { padding: "8px 11px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", textAlign: "left" };
const contactBtn: CSSProperties = { flex: 1, padding: "9px 0", borderRadius: 10, textDecoration: "none", color: "#fff", fontSize: 12.5, fontWeight: 700, textAlign: "center" };

export function HelpChat({ adminAnswers, onClose, onSeen }: { adminAnswers: AdminAnswer[]; onClose: () => void; onSeen: () => void }) {
  const t = useT();
  const lang = useLang();
  const [quick, setQuick] = useState<string[] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>(() => adminAnswers.map((a) => ({ key: `adm-${a.id}`, who: "admin" as const, text: a.admin_answer, question: a.question })));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    let alive = true;
    void loadQuickQuestions(lang).then((q) => { if (alive) setQuick(q); });
    return () => { alive = false; };
  }, [lang]);
  useEffect(() => { onSeen(); }, [onSeen]);
  useEffect(() => {
    const el = listRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [msgs, busy]);

  const starters = quick && quick.length ? quick : STARTER_KEYS.map((k) => t[k]);
  const send = async (raw: string) => {
    const q = raw.trim().slice(0, 500);
    if (!q || busy) return;
    setText("");
    setMsgs((m) => [...m, { key: `me-${++seq.current}`, who: "me", text: q }]);
    setBusy(true);
    const r = await askHelpBot(q, lang);
    setBusy(false);
    let reply: Msg;
    if (!r.ok) {
      const txt = r.error === "unreachable" ? t.rd_hb_err_net : r.error === "too_fast" ? t.rd_hb_too_fast : t.rd_hb_err;
      reply = { key: `bot-${++seq.current}`, who: "bot", text: txt };
    } else if (r.source === "handoff") {
      reply = { key: `bot-${++seq.current}`, who: "bot", text: t.rd_hb_handoff, source: "handoff" };
    } else if (r.source === "limit") {
      reply = { key: `bot-${++seq.current}`, who: "bot", text: t.rd_hb_limit, source: "limit" };
    } else {
      reply = { key: `bot-${++seq.current}`, who: "bot", text: r.answer || t.rd_hb_err, id: r.id, source: r.source, saved: r.saved, rating: 0 };
    }
    setMsgs((m) => [...m, reply]);
  };
  const rate = (m: Msg, v: -1 | 1) => {
    if (!m.id) return;
    const next = m.rating === v ? 0 : v;
    setMsgs((all) => all.map((x) => (x.key === m.key ? { ...x, rating: next } : x)));
    void rateChat(m.id, next);
  };
  const lastBot = [...msgs].reverse().find((m) => m.who === "bot");
  const empty = msgs.length === 0;

  return (
    <div style={sheet} role="dialog" aria-modal="true" aria-label={t.rd_hb_title} data-testid="helpbot-chat" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--accent)", color: "var(--accent-text)", display: "flex", alignItems: "center", justifyContent: "center" }}>{chatIcon}</span>
          <div style={{ flex: 1, fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{t.rd_hb_title}</div>
          <button type="button" onClick={onClose} aria-label={t.rd_hb_close} data-testid="helpbot-close" style={{ border: "none", background: "transparent", color: "var(--text-dim)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "14px 14px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...bubbleBase, alignSelf: "flex-start", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>{t.rd_hb_greeting}</div>
          {empty && (
            <div data-testid="helpbot-quick">
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", margin: "4px 2px 7px" }}>{t.rd_hb_quick}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7, alignItems: "flex-start" }}>
                {starters.slice(0, 6).map((q, i) => (
                  <button key={i} type="button" style={chipBtn} data-testid="helpbot-quick-q" onClick={() => void send(q)}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.key} style={{ display: "flex", flexDirection: "column", alignItems: m.who === "me" ? "flex-end" : "flex-start", gap: 5 }} data-testid={`helpbot-msg-${m.who}`}>
              {m.who === "admin" && (
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-fg)" }}>
                  {t.rd_hb_admin_answered}
                  <span style={{ fontWeight: 500, color: "var(--text-muted)" }}> ({t.rd_hb_you_asked} {m.question})</span>
                </div>
              )}
              <div style={{ ...bubbleBase, ...(m.who === "me" ? { background: "var(--accent)", color: "var(--accent-text)" } : { background: "var(--surface)", border: `1px solid ${m.who === "admin" ? "var(--accent)" : "var(--border)"}`, color: "var(--text)" }) }}>{m.text}</div>
              {m.who === "bot" && m.id && (
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {m.saved && <span data-testid="helpbot-saved" style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ok, #16a34a)", border: "1px solid currentColor", borderRadius: 6, padding: "1px 6px" }}>{t.rd_hb_saved}</span>}
                  <button type="button" aria-label={t.rd_hb_up} aria-pressed={m.rating === 1} data-testid="helpbot-up" onClick={() => rate(m, 1)} style={{ border: "1px solid var(--border)", borderRadius: 8, background: m.rating === 1 ? "var(--accent-soft)" : "transparent", cursor: "pointer", padding: "2px 7px" }}>👍</button>
                  <button type="button" aria-label={t.rd_hb_down} aria-pressed={m.rating === -1} data-testid="helpbot-down" onClick={() => rate(m, -1)} style={{ border: "1px solid var(--border)", borderRadius: 8, background: m.rating === -1 ? "var(--accent-soft)" : "transparent", cursor: "pointer", padding: "2px 7px" }}>👎</button>
                </div>
              )}
              {m === lastBot && (
                <div data-testid="helpbot-contact" style={{ width: "85%", marginTop: 2 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", marginBottom: 5 }}>{t.rd_hb_still}</div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" data-testid="helpbot-telegram" style={{ ...contactBtn, background: "#0088cc" }}>Telegram</a>
                    {LINE_URL && <a href={LINE_URL} target="_blank" rel="noreferrer noopener" data-testid="helpbot-line" style={{ ...contactBtn, background: "#06c755" }}>LINE</a>}
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy && <div data-testid="helpbot-typing" style={{ ...bubbleBase, alignSelf: "flex-start", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontStyle: "italic" }}>{t.rd_hb_typing}</div>}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(text); }} style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--border)" }}>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 500))} placeholder={t.rd_hb_placeholder} maxLength={500} aria-label={t.rd_hb_placeholder} data-testid="helpbot-input"
            style={{ flex: 1, minWidth: 0, padding: "11px 12px", borderRadius: 12, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 16 }} />
          <button type="submit" disabled={busy || !text.trim()} data-testid="helpbot-send" style={{ padding: "0 16px", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 700, fontFamily: "var(--font-ui)", cursor: "pointer", opacity: busy || !text.trim() ? 0.55 : 1 }}>{t.rd_hb_send}</button>
        </form>
      </div>
    </div>
  );
}
