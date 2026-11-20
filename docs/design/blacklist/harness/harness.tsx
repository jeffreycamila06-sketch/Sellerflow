// BLACKLIST — STEP 0 pictures only (nothing here ships). The Settings screen and the Live screen are
// the REAL components (SettingsHub, Dashboard) on made-up data; the new parts (the Blacklist tile, the
// chip on a live row, the dates sheet) are drawn into them by this page only. The Blacklist screen is
// a proposal built from the app's own tokens, header and Back button.
//   ?view=settings|bl|live|livesheet&state=pick|ready|reading|added|already|noqr|list|search|remove|empty&lang=en|fil
import { createRoot } from "react-dom/client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider, normalizeLang, buildT } from "../../../../src/redesign/i18n";
import SettingsHub from "../../../../src/redesign/screens/SettingsHub";
import Dashboard from "../../../../src/redesign/screens/Dashboard";
import { headerBar, headerTitle } from "../../../../src/redesign/ui";
import { HeaderWithBack } from "../../../../src/redesign/components/BackButton";
import type { Comment } from "../../../../src/redesign/data";

const qs = new URLSearchParams(location.search);
const lang = normalizeLang(qs.get("lang") || "en");
const view = qs.get("view") || "bl";
const state = qs.get("state") || "ready";
const wide = window.innerWidth >= 900;
const T = buildT(lang);

// ── proposed words (en + fil) ────────────────────────────────────────────────
const W = {
  en: {
    tile: "Blacklist", new: "NEW", title: "Blacklist", sub: "Only you can see this list",
    step1: "1 · Reason", step2: "2 · Buyer", notOut: "Not checked out", ret: "Return item",
    pickFirst: "Pick a reason first", scan: "Scan sticker QR", upload: "Upload sticker photo", reading: "Reading the QR…",
    or: "or type", tt: "TikTok", fb: "Facebook", phTT: "@username", phFB: "Facebook name (exact)", add: "Add",
    noCam: "No camera? Type the TikTok @username or the Facebook name.",
    added: (b: string, r: string) => `Added ${b} — ${r}`, undo: "Undo",
    already: (b: string, r: string) => `Already added today — ${b} (${r}).`,
    noqr: "This QR has no buyer", noqrSub: "Scan the QR on a SellerFlowLive sticker, or type the username.",
    list: (n: number) => `YOUR LIST · ${n}`, search: "Search buyer", remove: "Remove",
    last: (d: string) => `last added ${d}`, cnt: (n: number, r: string) => `${n}× ${r}`, retShort: "Return", notOutShort: "Not checked out",
    empty: "No buyers yet. Pick a reason, then scan or type a buyer.",
    removeQ: (b: string) => `Remove ${b} from your blacklist?`, removeSub: "Their counts are deleted. You can add them again later.", cancel: "Cancel",
    chip: "Blacklist", alertOnly: "Alert only — the order still prints as usual.", close: "Close",
    colBuyer: "Buyer", colPlatform: "Platform", colReturn: "Return", colNotOut: "Not checked out", colLast: "Last added", noMatch: "No buyer matches",
  },
  fil: {
    tile: "Blacklist", new: "BAGO", title: "Blacklist", sub: "Ikaw lang ang nakakakita ng listahang ito",
    step1: "1 · Dahilan", step2: "2 · Buyer", notOut: "Hindi nag-check out", ret: "Nag-return ng item",
    pickFirst: "Pumili muna ng dahilan", scan: "I-scan ang QR ng sticker", upload: "Mag-upload ng litrato ng sticker", reading: "Binabasa ang QR…",
    or: "o i-type", tt: "TikTok", fb: "Facebook", phTT: "@username", phFB: "Pangalan sa Facebook (eksakto)", add: "Idagdag",
    noCam: "Walang camera? I-type ang TikTok @username o ang pangalan sa Facebook.",
    added: (b: string, r: string) => `Naidagdag si ${b} — ${r}`, undo: "I-undo",
    already: (b: string, r: string) => `Naidagdag na ngayong araw — nasa listahan mo na si ${b} (${r}).`,
    noqr: "Walang buyer sa QR na ito", noqrSub: "I-scan ang QR sa sticker ng SellerFlowLive, o i-type ang username.",
    list: (n: number) => `LISTAHAN MO · ${n}`, search: "Hanapin ang buyer", remove: "Alisin",
    last: (d: string) => `huling idinagdag ${d}`, cnt: (n: number, r: string) => `${n}× ${r}`, retShort: "Nag-return", notOutShort: "Hindi nag-check out",
    empty: "Wala pang buyer. Pumili ng dahilan, tapos i-scan o i-type ang buyer.",
    removeQ: (b: string) => `Alisin si ${b} sa blacklist mo?`, removeSub: "Mabubura ang bilang niya. Puwede mo siyang idagdag ulit.", cancel: "Kanselahin",
    chip: "Blacklist", alertOnly: "Paalala lang — nagpi-print pa rin ang order gaya ng dati.", close: "Isara",
    colBuyer: "Buyer", colPlatform: "Platform", colReturn: "Nag-return", colNotOut: "Hindi nag-check out", colLast: "Huling idinagdag", noMatch: "Walang buyer na tugma",
  },
} as const;
const w = W[lang === "fil" ? "fil" : "en"];
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_FIL = ["Ene", "Peb", "Mar", "Abr", "May", "Hun", "Hul", "Ago", "Set", "Okt", "Nob", "Dis"];
const day = (m: number, d: number) => `${(lang === "fil" ? MON_FIL : MON_EN)[m - 1]} ${d}`;

// ── made-up list ────────────────────────────────────────────────────────────
type Row = { label: string; platform: "TikTok" | "Facebook"; ret: number; notOut: number; last: string; dates: { r: "ret" | "notOut"; d: string }[] };
const ROWS: Row[] = [
  { label: "@maria_shop", platform: "TikTok", ret: 2, notOut: 1, last: day(11, 18), dates: [{ r: "ret", d: day(11, 18) }, { r: "ret", d: day(11, 2) }, { r: "notOut", d: day(10, 30) }] },
  { label: "Ana Reyes", platform: "Facebook", ret: 0, notOut: 1, last: day(11, 16), dates: [{ r: "notOut", d: day(11, 16) }] },
  { label: "@jhunbelle.ukay", platform: "TikTok", ret: 1, notOut: 0, last: day(11, 12), dates: [{ r: "ret", d: day(11, 12) }] },
  { label: "@kikay_mommy23", platform: "TikTok", ret: 0, notOut: 3, last: day(11, 9), dates: [] },
  { label: "Ma. Cristina Dela Cruz-Villanueva", platform: "Facebook", ret: 1, notOut: 1, last: day(10, 28), dates: [] },
];

// ── shared look (the app's tokens) ──────────────────────────────────────────
const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" };
const label: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "0 2px 9px" };
const btnPrimary: CSSProperties = { minHeight: 48, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", padding: "0 14px" };
const blIcon = (size = 20) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="2" /><path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
const camIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h1.5l1.2-1.8a1 1 0 0 1 .83-.45h4.94a1 1 0 0 1 .83.45L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="12.5" r="3.4" stroke="currentColor" strokeWidth="1.8" /></svg>;
const reasonName = (r: "ret" | "notOut", short = false) => (r === "ret" ? (short ? w.retShort : w.ret) : (short ? w.notOutShort : w.notOut));
const counts = (r: Row) => [r.ret ? w.cnt(r.ret, w.retShort) : "", r.notOut ? w.cnt(r.notOut, w.notOutShort) : ""].filter(Boolean).join(" · ");

// ── 1. the Settings tile, drawn into the REAL SettingsHub right after Customers ─────────────────
function BlacklistTile() {
  return (
    <button type="button" data-testid="tile-blacklist" style={{ display: "flex", alignItems: "center", gap: 11, padding: "15px 13px", border: "1px solid var(--border)", borderRadius: 15, background: "var(--surface)", boxShadow: "var(--shadow)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)", minWidth: 0, width: "100%" }}>
      <span style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: "rgba(225,29,72,.13)", color: "var(--danger)" }}>{blIcon()}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.15, whiteSpace: "nowrap", flexShrink: 0 }}>{w.tile}</span>
      <span data-testid="tile-blacklist-new" style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, letterSpacing: ".05em", color: "#fff", background: "var(--danger)", padding: "3px 7px", borderRadius: 6, flexShrink: 0 }}>{w.new}</span>
    </button>
  );
}
function SettingsView() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === T.rd_cus_title);
    if (!btn || slot) return;
    const d = document.createElement("div");
    d.style.display = "contents";
    btn.after(d);
    setSlot(d);
  }, [slot]);
  const noop = () => {};
  return (
    <>
      <SettingsHub onGeneral={noop} onCustomers={noop} onAdmin={noop} onCustomerData={noop} onLegal={noop} onDelete={noop} onLogout={noop} onInvite={noop} />
      {slot && createPortal(<BlacklistTile />, slot)}
    </>
  );
}

// ── 2. the Blacklist screen (proposal) ───────────────────────────────────────
function ReasonButton({ on, text, icon, onClick, testid }: { on: boolean; text: string; icon: ReactNode; onClick: () => void; testid: string }) {
  return (
    <button type="button" aria-pressed={on} data-testid={testid} onClick={onClick} style={{ flex: 1, minWidth: 0, minHeight: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, padding: "10px 8px", borderRadius: 13, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 800, lineHeight: 1.2, textAlign: "center",
      border: on ? "2px solid var(--danger)" : "1.5px solid var(--border-strong)", background: on ? "var(--danger-soft)" : "var(--surface)", color: on ? "var(--danger)" : "var(--text)" }}>
      <span aria-hidden="true" style={{ fontSize: 18 }}>{icon}</span>{text}
    </button>
  );
}
function Note({ tone, children, testid }: { tone: "ok" | "warn" | "bad"; children: ReactNode; testid: string }) {
  const c = tone === "ok" ? { bg: "rgba(22,163,74,.12)", fg: "var(--ok)" } : tone === "warn" ? { bg: "var(--warn-soft)", fg: "var(--warn)" } : { bg: "var(--danger-soft)", fg: "var(--danger)" };
  return <div role="status" data-testid={testid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 12, background: c.bg, color: c.fg, fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{children}</div>;
}
function ListRow({ r, onRemove }: { r: Row; onRemove: () => void }) {
  const fb = r.platform === "Facebook";
  return (
    <div data-testid="bl-row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderTop: "1px solid var(--border)" }}>
      <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--danger-soft)", color: "var(--danger)", fontWeight: 800, fontSize: 14 }}>{r.label.replace("@", "").slice(0, 1).toUpperCase()}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere", lineHeight: 1.3 }}>{r.label}</div>
        <div data-testid="bl-counts" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", marginTop: 2 }}>{counts(r)}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }}>{fb ? w.fb : w.tt} · {w.last(r.last)}</div>
      </div>
      <button type="button" onClick={onRemove} data-testid="bl-remove" style={{ minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 10, border: "1.5px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-dim)", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{w.remove}</button>
    </div>
  );
}
function ListTable({ rows }: { rows: Row[] }) {
  const th: CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--text-muted)", padding: "10px 12px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const td: CSSProperties = { fontSize: 13.5, color: "var(--text)", padding: "11px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
  return (
    <table data-testid="bl-table" style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr><th style={th}>{w.colBuyer}</th><th style={th}>{w.colPlatform}</th><th style={{ ...th, textAlign: "center" }}>{w.colReturn}</th><th style={{ ...th, textAlign: "center" }}>{w.colNotOut}</th><th style={th}>{w.colLast}</th><th style={th} /></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.label} data-testid="bl-row">
          <td style={{ ...td, fontWeight: 800, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</td>
          <td style={{ ...td, color: "var(--text-dim)" }}>{r.platform}</td>
          <td style={{ ...td, textAlign: "center", fontWeight: 800, color: r.ret ? "var(--danger)" : "var(--text-muted)" }}>{r.ret || "—"}</td>
          <td style={{ ...td, textAlign: "center", fontWeight: 800, color: r.notOut ? "var(--danger)" : "var(--text-muted)" }}>{r.notOut || "—"}</td>
          <td style={{ ...td, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{r.last}</td>
          <td style={{ ...td, textAlign: "right" }}><button type="button" data-testid="bl-remove" style={{ minHeight: 36, padding: "0 12px", borderRadius: 9, border: "1.5px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-dim)", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{w.remove}</button></td>
        </tr>
      ))}</tbody>
    </table>
  );
}
function BlacklistScreen() {
  const [reason, setReason] = useState<"ret" | "notOut" | null>(state === "pick" || state === "empty" ? null : "ret");
  const [pf, setPf] = useState<"tt" | "fb">("tt");
  const [q, setQ] = useState(state === "search" ? "maria" : "");
  const [removeOpen, setRemoveOpen] = useState(state === "remove");
  const rows = state === "empty" ? [] : q ? ROWS.filter((r) => r.label.toLowerCase().includes(q.toLowerCase())) : ROWS;
  const on = reason != null;
  const addPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={card}>
        <div style={label}>{w.step1}</div>
        <div style={{ display: "flex", gap: 9 }}>
          <ReasonButton on={reason === "notOut"} text={w.notOut} icon="🛒" onClick={() => setReason("notOut")} testid="bl-reason-notout" />
          <ReasonButton on={reason === "ret"} text={w.ret} icon="↩️" onClick={() => setReason("ret")} testid="bl-reason-return" />
        </div>
      </div>
      <div style={{ ...card, ...(on ? null : { opacity: 0.55 }) }} aria-disabled={!on}>
        <div style={label}>{w.step2}</div>
        {!on && <div data-testid="bl-pick-first" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", margin: "-2px 2px 10px" }}>{w.pickFirst}</div>}
        <button type="button" disabled={!on || state === "reading"} data-testid="bl-scan" style={{ ...btnPrimary, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, opacity: state === "reading" ? 0.75 : 1, cursor: on ? "pointer" : "default" }}>
          {camIcon}{state === "reading" ? w.reading : wide ? w.upload : w.scan}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 2px 10px", color: "var(--text-muted)", fontSize: 11.5, fontWeight: 700 }}>
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />{w.or}<span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
        <div role="radiogroup" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {(["tt", "fb"] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={pf === p} disabled={!on} onClick={() => setPf(p)} data-testid={`bl-pf-${p}`} style={{ flex: 1, minHeight: 44, borderRadius: 10, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 800, cursor: on ? "pointer" : "default", border: pf === p ? "2px solid var(--accent)" : "1.5px solid var(--border-strong)", background: pf === p ? "var(--accent-soft)" : "var(--surface)", color: pf === p ? "var(--accent-fg)" : "var(--text-dim)" }}>{p === "tt" ? w.tt : w.fb}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input disabled={!on} placeholder={pf === "tt" ? w.phTT : w.phFB} data-testid="bl-type" defaultValue={state === "already" ? "" : ""} style={{ flex: 1, minWidth: 0, minHeight: 48, borderRadius: 12, border: "1.5px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 16, padding: "0 12px", fontFamily: "var(--font-ui)" }} />
          <button type="button" disabled={!on} data-testid="bl-add" style={{ ...btnPrimary, minWidth: 72, background: on ? "var(--danger)" : "var(--surface-2)", color: on ? "#fff" : "var(--text-muted)" }}>{w.add}</button>
        </div>
        {wide && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 9, lineHeight: 1.4 }}>{w.noCam}</div>}
      </div>
      {state === "added" && (
        <Note tone="ok" testid="bl-added"><span style={{ flex: 1, minWidth: 0 }}>✓ {w.added("@maria_shop", w.ret)}</span>
          <button type="button" data-testid="bl-undo" style={{ minHeight: 44, padding: "0 14px", borderRadius: 10, border: "none", background: "var(--ok)", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{w.undo}</button></Note>
      )}
      {state === "already" && <Note tone="warn" testid="bl-already"><span>ⓘ {w.already("@maria_shop", w.ret)}</span></Note>}
      {state === "noqr" && <Note tone="bad" testid="bl-noqr"><span><b style={{ display: "block" }}>✕ {w.noqr}</b><span style={{ fontWeight: 600 }}>{w.noqrSub}</span></span></Note>}
    </div>
  );
  const listPanel = (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "13px 14px 10px" }}>
        <div style={label}>{w.list(rows.length)}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={w.search} data-testid="bl-search" style={{ width: "100%", boxSizing: "border-box", minHeight: 44, borderRadius: 11, border: "1.5px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 16, padding: "0 12px", fontFamily: "var(--font-ui)" }} />
      </div>
      {rows.length === 0 && <div data-testid="bl-empty" style={{ padding: "18px 16px 22px", fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.45 }}>{state === "empty" ? w.empty : w.noMatch}</div>}
      {rows.length > 0 && (wide ? <ListTable rows={rows} /> : rows.map((r) => <ListRow key={r.label} r={r} onRemove={() => setRemoveOpen(true)} />))}
    </div>
  );
  return (
    <div>
      <div style={headerBar}>
        <HeaderWithBack onBack={() => {}}>
          <div style={headerTitle}>{w.title}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{w.sub}</div>
        </HeaderWithBack>
      </div>
      <div style={{ padding: "14px 14px 26px", ...(wide ? { display: "grid", gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr)", gap: 16, alignItems: "start" } : { display: "flex", flexDirection: "column", gap: 12 }) }}>
        {addPanel}
        {listPanel}
      </div>
      {removeOpen && (
        <div data-testid="bl-remove-sheet" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", alignItems: wide ? "center" : "flex-end", justifyContent: "center" }}>
          <div role="dialog" style={{ width: "100%", maxWidth: wide ? 420 : undefined, background: "var(--surface-2)", borderRadius: wide ? 18 : "20px 20px 0 0", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.3 }}>{w.removeQ("@maria_shop")}</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.4 }}>{w.removeSub}</div>
            <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
              <button type="button" style={{ ...btnPrimary, flex: 1, background: "var(--surface)", color: "var(--text)", border: "1.5px solid var(--border-strong)" }}>{w.cancel}</button>
              <button type="button" data-testid="bl-remove-ok" style={{ ...btnPrimary, flex: 1, background: "var(--danger)", color: "#fff" }}>{w.remove}</button>
            </div>
          </div>
        </div>)}
    </div>
  );
}

// ── 3. the REAL Live screen with the chip drawn on blacklisted rows ─────────
const C = (id: string, name: string, handle: string, text: string, platform: string, time: string, mine = false): Comment => ({ id, name, handle, text, mine, time, platform } as Comment);
const FEED: Comment[] = [
  C("c1", "Liza Mae", "@lizamae.ph", "magkano po ito?", "TikTok", "9:42:10 PM"),
  C("c2", "Maria Shop", "@maria_shop", "mine A", "TikTok", "9:41:58 PM", true),
  C("c3", "Ana Reyes", "Ana Reyes", "mine 2", "Facebook", "9:41:40 PM", true),
  C("c4", "Jessa", "@jessa_tiangge", "pa reserve po", "TikTok", "9:41:22 PM"),
  C("c5", "Rhea", "@rhea.ukay", "mine B", "TikTok", "9:41:05 PM", true),
];
const BL: Record<string, Row> = { "@maria_shop": ROWS[0], "Ana Reyes": ROWS[1] };
function decorate() {
  for (const row of document.querySelectorAll<HTMLElement>(".sfl-comm-row")) {
    if (row.dataset.blDone) continue;
    const spans = [...row.querySelectorAll<HTMLElement>("span")];
    const key = Object.keys(BL).find((k) => spans.some((s) => s.textContent === k));
    if (!key) continue;
    const r = BL[key];
    row.dataset.blDone = "1";
    row.dataset.blacklist = "1";
    row.style.background = "var(--danger-soft)";
    row.style.boxShadow = "inset 3px 0 0 var(--risk-risky-bg)";
    const col = row.children[1] as HTMLElement | undefined; // [avatar, content column]
    const head = col?.children[0] as HTMLElement | undefined; // name · @handle · chips · time
    const nameEl = head?.querySelector<HTMLElement>("span");
    if (nameEl) { nameEl.style.textDecoration = "underline dotted"; nameEl.style.textUnderlineOffset = "3px"; nameEl.style.cursor = "pointer"; }
    const chip = document.createElement("div");
    chip.dataset.testid = "bl-chip";
    chip.textContent = `⛔ ${counts(r)}`;
    Object.assign(chip.style, { display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "10.5px", fontWeight: "800", letterSpacing: ".02em", padding: "3px 7px", borderRadius: "6px", lineHeight: "1.25", marginTop: "5px", maxWidth: "100%", background: "var(--risk-risky-bg)", color: "var(--risk-risky-fg)" });
    const textRow = head?.nextElementSibling;
    if (textRow) textRow.after(chip);
  }
}
function LiveView({ sheet }: { sheet: boolean }) {
  useEffect(() => { const iv = setInterval(decorate, 100); decorate(); return () => clearInterval(iv); }, []);
  const noop = () => {};
  const r = ROWS[0];
  return (
    <>
      <Dashboard comments={FEED} cur="₱" historyReady ttOpen={false} fbOpen={false} ttIdx={0} fbIdx={0}
        onToggleTT={noop} onToggleFB={noop} onPickTT={noop} onPickFB={noop} ttConnected fbConnected={false} ttConnecting={false} fbConnecting={false}
        ttAccounts={["@rheasukayshop"]} fbAccounts={["Rhea Ukay Shop"]} onConnectTT={noop} onConnectFB={noop} printed={{}} entId={null} entPrice="" onOneClick={noop} onOpenEnt={noop} onEntPrice={noop} onEntKey={noop} />
      {sheet && (
        <div data-testid="bl-sheet-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
          <div role="dialog" data-testid="bl-sheet" style={{ width: "100%", maxWidth: wide ? 520 : undefined, background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "10px 14px calc(18px + env(safe-area-inset-bottom))", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 12px" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 12px" }}>
              <span style={{ color: "var(--danger)", display: "flex" }}>{blIcon(18)}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{r.label}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{w.tt}</span>
              <button type="button" style={{ marginLeft: "auto", minHeight: 44, border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{w.close}</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {(["ret", "notOut"] as const).map((k) => (
                <div key={k} data-testid={`bl-stat-${k}`} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "var(--danger)", fontFamily: "var(--font-display)" }}>{k === "ret" ? r.ret : r.notOut}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", marginTop: 2 }}>{reasonName(k)}</div>
                </div>
              ))}
            </div>
            {r.dates.map((x, i) => (
              <div key={i} data-testid="bl-date" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", marginBottom: 8 }}>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{reasonName(x.r)}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{x.d}, 2026</span>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "4px 2px 0", lineHeight: 1.4 }}>{w.alertOnly}</div>
          </div>
        </div>)}
    </>
  );
}

function App() {
  return (
    <div data-redesign="" data-theme="light" style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      {view === "settings" ? <SettingsView /> : view === "live" ? <LiveView sheet={false} /> : view === "livesheet" ? <LiveView sheet /> : <BlacklistScreen />}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<TProvider lang={lang}><App /></TProvider>);
