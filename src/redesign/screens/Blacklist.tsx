// BLACKLIST screen (sellers outside Taiwan, sql/190). 1 · pick a reason → 2 · scan the sticker QR
// (phone camera / photo; laptop = upload a photo) or type a TikTok @username / a Facebook name → saved.
// Undo right after an add; "Already added today" comes from the database. The list: one row per buyer,
// counts per reason, last added + platform, search, Remove (an in-app yes / no). Props-driven: every
// read / write goes through the callbacks (RedesignApp → adapters/blacklist useBlacklist).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle } from "../ui";
import { HeaderWithBack } from "../components/BackButton";
import { tpl, useT } from "../i18n";
import { useLang } from "../i18n/langContext";
import { readQrFromFile, warmQrReader, type QrOutcome } from "../adapters/qrDecode";
import { nativeQrScanner, runStickerScan, scannerTexts } from "../adapters/nativeQrScanner";
import {
  blacklistChipText, blacklistHandleFromQr, blacklistInputProblem, blacklistLabel, displayBuyer, filterBlacklist, formatBlacklistDay, groupBlacklist,
  type BlAddResult, type BlEntry, type BlPlatform, type BlReason, type BlRow,
} from "../adapters/blacklist";

const WIDE_AT = 900;
function useWide(): boolean {
  const read = () => (typeof window !== "undefined" ? window.innerWidth >= WIDE_AT : false);
  const [wide, setWide] = useState(read);
  useEffect(() => {
    const on = () => setWide(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return wide;
}

const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 14, boxShadow: "var(--shadow)" };
const label: CSSProperties = { fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "var(--text-muted)", margin: "0 2px 9px" };
const btnPrimary: CSSProperties = { minHeight: 48, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontSize: 15, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", padding: "0 14px" };
const input: CSSProperties = { minHeight: 48, borderRadius: 12, border: "1.5px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontSize: 16, padding: "0 12px", fontFamily: "var(--font-ui)", boxSizing: "border-box" };
const camIcon = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h1.5l1.2-1.8a1 1 0 0 1 .83-.45h4.94a1 1 0 0 1 .83.45L16.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="12.5" r="3.4" stroke="currentColor" strokeWidth="1.8" /></svg>;

type Note =
  | { kind: "added"; id: string; buyer: string; reason: BlReason }
  | { kind: "already"; buyer: string; reason: BlReason }
  | { kind: "undone"; buyer: string }
  | { kind: "noqr" } | { kind: "noqrfound" } | { kind: "many"; count: number } | { kind: "err" } | { kind: "failed" };

function ReasonButton({ on, text, icon, onClick, testid }: { on: boolean; text: string; icon: ReactNode; onClick: () => void; testid: string }) {
  return (
    <button type="button" aria-pressed={on} data-testid={testid} onClick={onClick} style={{ flex: 1, minWidth: 0, minHeight: 64, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, padding: "10px 8px", borderRadius: 13, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 800, lineHeight: 1.2, textAlign: "center",
      border: on ? "2px solid var(--danger)" : "1.5px solid var(--border-strong)", background: on ? "var(--danger-soft)" : "var(--surface)", color: on ? "var(--danger)" : "var(--text)" }}>
      <span aria-hidden="true" style={{ fontSize: 18 }}>{icon}</span>{text}
    </button>
  );
}
function NoteBox({ tone, children, testid }: { tone: "ok" | "warn" | "bad"; children: ReactNode; testid: string }) {
  const c = tone === "ok" ? { bg: "rgba(22,163,74,.12)", fg: "var(--ok)" } : tone === "warn" ? { bg: "var(--warn-soft)", fg: "var(--warn)" } : { bg: "var(--danger-soft)", fg: "var(--danger)" };
  return <div role="status" data-testid={testid} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 12px", borderRadius: 12, background: c.bg, color: c.fg, fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>{children}</div>;
}

export default function Blacklist({
  onBack, rows, error = false, onReload, onAdd, onUndo, onRemove,
}: {
  onBack: () => void;
  rows: BlRow[] | null;          // null = not read yet (shows "Loading…")
  error?: boolean;
  onReload: () => void;
  onAdd: (platform: BlPlatform, label: string, reason: BlReason) => Promise<BlAddResult>;
  onUndo: (id: string) => Promise<boolean>;
  onRemove: (entry: BlEntry) => Promise<boolean>;
}) {
  const t = useT();
  const lang = useLang();
  const wide = useWide();
  const [reason, setReason] = useState<BlReason | null>(null);
  const [pf, setPf] = useState<BlPlatform>("tiktok");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [q, setQ] = useState("");
  const [removing, setRemoving] = useState<BlEntry | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const entries = useMemo(() => groupBlacklist(rows ?? []), [rows]);
  const shown = useMemo(() => filterBlacklist(entries, q), [entries, q]);
  const reasonName = (r: BlReason) => (r === "returned" ? t.rd_bl_return : t.rd_bl_not_out);
  const on = reason != null;
  const problem = text.trim() ? blacklistInputProblem(pf, text) : "empty";

  const save = async (platform: BlPlatform, raw: string) => {
    if (!reason || busy) return;
    setBusy(true);
    const r = await onAdd(platform, raw, reason);
    if (!alive.current) return;
    setBusy(false);
    const buyer = displayBuyer(platform, blacklistLabel(platform, raw));
    if (r.kind === "added") { setNote({ kind: "added", id: r.id, buyer, reason }); setText(""); }
    else if (r.kind === "already") { setNote({ kind: "already", buyer, reason }); setText(""); }
    else setNote({ kind: "err" });
  };
  const onScanFile = async (files: FileList | null) => {
    const f = files && files[0];
    if (fileRef.current) fileRef.current.value = ""; // the same photo can be picked again
    if (!f || !reason) return;
    setReading(true); setNote(null);
    const read = await readQrFromFile(f);
    if (!alive.current) return;
    setReading(false);
    await applyRead(read);
  };
  const applyRead = async (read: QrOutcome) => {
    if (read.kind === "many") { setNote({ kind: "many", count: read.count }); return; } // 2+ stickers: never a guess
    if (read.kind === "none") { setNote({ kind: "noqrfound" }); return; }
    const handle = blacklistHandleFromQr(read.text);
    if (!handle) { setNote({ kind: "noqr" }); return; }
    await save("tiktok", handle);
  };
  // The Scan tap: the phone app's live scanner when this build has one (adapters/nativeQrScanner),
  // else today's photo picker, unchanged. The live read goes through the SAME applyRead.
  const onScanTap = () => {
    const native = nativeQrScanner();
    if (!native) { warmQrReader(); fileRef.current?.click(); return; }
    if (!reason) return;
    setReading(true); setNote(null);
    void runStickerScan(native, scannerTexts(t)).then(async (out) => {
      if (!alive.current) return;
      setReading(false);
      if (out.kind === "cancelled") return;
      if (out.kind === "failed") { setNote({ kind: "failed" }); return; }
      await applyRead(out);
    });
  };
  const undo = async (n: Extract<Note, { kind: "added" }>) => {
    setBusy(true);
    const ok = await onUndo(n.id);
    if (!alive.current) return;
    setBusy(false);
    setNote(ok ? { kind: "undone", buyer: n.buyer } : { kind: "err" });
  };
  const confirmRemove = async () => {
    if (!removing || removeBusy) return;
    setRemoveBusy(true); setRemoveFailed(false);
    const ok = await onRemove(removing);
    if (!alive.current) return;
    setRemoveBusy(false);
    if (ok) { setRemoving(null); setNote(null); } else setRemoveFailed(true);
  };

  const addPanel = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={card}>
        <div style={label}>{t.rd_bl_step1}</div>
        <div style={{ display: "flex", gap: 9 }}>
          <ReasonButton on={reason === "not_checked_out"} text={t.rd_bl_not_out} icon="🛒" onClick={() => setReason("not_checked_out")} testid="bl-reason-notout" />
          <ReasonButton on={reason === "returned"} text={t.rd_bl_return} icon="↩️" onClick={() => setReason("returned")} testid="bl-reason-return" />
        </div>
      </div>
      <div style={{ ...card, ...(on ? null : { opacity: 0.55 }) }} aria-disabled={!on}>
        <div style={label}>{t.rd_bl_step2}</div>
        {!on && <div data-testid="bl-pick-first" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", margin: "-2px 2px 10px" }}>{t.rd_bl_pick_first}</div>}
        <input ref={fileRef} type="file" accept="image/*" hidden data-testid="bl-file" onChange={(e) => void onScanFile(e.target.files)} />
        <button type="button" disabled={!on || reading || busy} onClick={onScanTap} data-testid="bl-scan"
          style={{ ...btnPrimary, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, opacity: reading ? 0.75 : 1, cursor: on ? "pointer" : "default" }}>
          {camIcon}{reading ? t.rd_bl_reading : wide ? t.rd_bl_upload : t.rd_bl_scan}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 2px 10px", color: "var(--text-muted)", fontSize: 11.5, fontWeight: 700 }}>
          <span style={{ flex: 1, height: 1, background: "var(--border)" }} />{t.rd_bl_or}<span style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
        <div role="radiogroup" style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {(["tiktok", "facebook"] as const).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={pf === p} disabled={!on} onClick={() => setPf(p)} data-testid={`bl-pf-${p === "tiktok" ? "tt" : "fb"}`}
              style={{ flex: 1, minHeight: 44, borderRadius: 10, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 800, cursor: on ? "pointer" : "default", border: pf === p ? "2px solid var(--accent)" : "1.5px solid var(--border-strong)", background: pf === p ? "var(--accent-soft)" : "var(--surface)", color: pf === p ? "var(--accent-fg)" : "var(--text-dim)" }}>
              {p === "tiktok" ? "TikTok" : "Facebook"}
            </button>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); if (!problem) void save(pf, text); }} style={{ display: "flex", gap: 8 }}>
          <input disabled={!on} value={text} onChange={(e) => setText(e.target.value)} placeholder={pf === "tiktok" ? t.rd_bl_ph_tt : t.rd_bl_ph_fb} data-testid="bl-type"
            autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={120} enterKeyHint="done" style={{ ...input, flex: 1, minWidth: 0 }} />
          {/* The app's main violet (red is only for removing). */}
          <button type="submit" disabled={!on || busy || !!problem} data-testid="bl-add"
            style={{ ...btnPrimary, minWidth: 72, ...(on && !problem ? null : { background: "var(--surface-2)", color: "var(--text-muted)", cursor: "default" }) }}>{t.rd_bl_add}</button>
        </form>
        {on && text.trim() !== "" && (problem === "space" || problem === "long") && (
          <div data-testid="bl-type-problem" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", marginTop: 7 }}>{problem === "space" ? t.rd_bl_tt_space : t.rd_bl_too_long}</div>
        )}
        {wide && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 9, lineHeight: 1.4 }}>{t.rd_bl_no_cam}</div>}
      </div>
      {note?.kind === "added" && (
        <NoteBox tone="ok" testid="bl-added">
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>✓ {tpl(t.rd_bl_added, { buyer: note.buyer, reason: reasonName(note.reason) })}</span>
          <button type="button" disabled={busy} onClick={() => void undo(note)} data-testid="bl-undo" style={{ minHeight: 44, padding: "0 14px", borderRadius: 10, border: "none", background: "var(--ok)", color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_bl_undo}</button>
        </NoteBox>
      )}
      {note?.kind === "already" && <NoteBox tone="warn" testid="bl-already"><span style={{ overflowWrap: "anywhere" }}>ⓘ {tpl(t.rd_bl_already, { buyer: note.buyer, reason: reasonName(note.reason) })}</span></NoteBox>}
      {note?.kind === "undone" && <NoteBox tone="ok" testid="bl-undone"><span style={{ overflowWrap: "anywhere" }}>↩ {tpl(t.rd_bl_undone, { buyer: note.buyer })}</span></NoteBox>}
      {note?.kind === "noqr" && <NoteBox tone="bad" testid="bl-noqr"><span><b style={{ display: "block" }}>✕ {t.rd_bl_no_qr}</b><span style={{ fontWeight: 600 }}>{t.rd_bl_no_qr_sub}</span></span></NoteBox>}
      {note?.kind === "noqrfound" && <NoteBox tone="bad" testid="bl-noqr-found"><span>✕ {t.rd_bl_no_qr_found}</span></NoteBox>}
      {note?.kind === "failed" && <NoteBox tone="bad" testid="bl-scan-failed"><span>✕ {t.rd_qrs_failed}</span></NoteBox>}
      {note?.kind === "many" && <NoteBox tone="bad" testid="bl-qr-many"><span>✕ {tpl(t.rd_qr_many, { n: String(note.count) })}</span></NoteBox>}
      {note?.kind === "err" && <NoteBox tone="bad" testid="bl-err"><span>✕ {t.rd_bl_save_err}</span></NoteBox>}
    </div>
  );

  const countsLine = (e: BlEntry) => blacklistChipText(e, t);
  const listBody = (() => {
    if (rows === null && error) return (
      <div data-testid="bl-load-err" style={{ padding: "18px 16px 22px", fontSize: 13, color: "var(--danger)", textAlign: "center", lineHeight: 1.45 }}>
        {t.rd_bl_load_err}
        <div><button type="button" onClick={onReload} data-testid="bl-retry" style={{ marginTop: 10, minHeight: 44, padding: "0 16px", borderRadius: 10, border: "1.5px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_bl_retry}</button></div>
      </div>
    );
    if (rows === null) return <div data-testid="bl-loading" style={{ padding: "18px 16px 22px", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>{t.rd_bl_loading}</div>;
    if (shown.length === 0) return <div data-testid="bl-empty" style={{ padding: "18px 16px 22px", fontSize: 13, color: "var(--text-muted)", textAlign: "center", lineHeight: 1.45 }}>{entries.length === 0 ? t.rd_bl_empty : t.rd_bl_no_match}</div>;
    if (wide) {
      const th: CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "var(--text-muted)", padding: "10px 12px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
      const td: CSSProperties = { fontSize: 13.5, color: "var(--text)", padding: "11px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
      return (
        <table data-testid="bl-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>{t.rd_bl_col_buyer}</th><th style={th}>{t.rd_bl_col_platform}</th><th style={{ ...th, textAlign: "center" }}>{t.rd_bl_ret_short}</th><th style={{ ...th, textAlign: "center" }}>{t.rd_bl_not_out_short}</th><th style={th}>{t.rd_bl_col_last}</th><th style={th} /></tr></thead>
          <tbody>{shown.map((e) => (
            <tr key={`${e.platform}:${e.key}`} data-testid="bl-row">
              <td style={{ ...td, fontWeight: 800, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={displayBuyer(e.platform, e.label)}>{displayBuyer(e.platform, e.label)}</td>
              <td style={{ ...td, color: "var(--text-dim)" }}>{e.platform === "tiktok" ? "TikTok" : "Facebook"}</td>
              <td style={{ ...td, textAlign: "center", fontWeight: 800, color: e.returned ? "var(--danger)" : "var(--text-muted)" }}>{e.returned || "—"}</td>
              <td style={{ ...td, textAlign: "center", fontWeight: 800, color: e.notCheckedOut ? "var(--danger)" : "var(--text-muted)" }}>{e.notCheckedOut || "—"}</td>
              <td style={{ ...td, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{formatBlacklistDay(e.lastDay, lang)}</td>
              <td style={{ ...td, textAlign: "right" }}><button type="button" onClick={() => { setRemoveFailed(false); setRemoving(e); }} data-testid="bl-remove" style={{ minHeight: 36, padding: "0 12px", borderRadius: 9, border: "1.5px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-dim)", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_bl_remove}</button></td>
            </tr>
          ))}</tbody>
        </table>
      );
    }
    return shown.map((e) => (
      <div key={`${e.platform}:${e.key}`} data-testid="bl-row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderTop: "1px solid var(--border)" }}>
        <span aria-hidden="true" style={{ width: 38, height: 38, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--danger-soft)", color: "var(--danger)", fontWeight: 800, fontSize: 14 }}>{e.label.slice(0, 1).toUpperCase()}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere", lineHeight: 1.3 }}>{displayBuyer(e.platform, e.label)}</div>
          <div data-testid="bl-counts" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", marginTop: 2 }}>{countsLine(e)}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }}>{e.platform === "tiktok" ? "TikTok" : "Facebook"} · {tpl(t.rd_bl_last, { date: formatBlacklistDay(e.lastDay, lang) })}</div>
        </div>
        <button type="button" onClick={() => { setRemoveFailed(false); setRemoving(e); }} data-testid="bl-remove" style={{ minHeight: 44, minWidth: 44, padding: "0 12px", borderRadius: 10, border: "1.5px solid var(--border-strong)", background: "var(--surface)", color: "var(--text-dim)", fontSize: 12.5, fontWeight: 800, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_bl_remove}</button>
      </div>
    ));
  })();

  const listPanel = (
    <div style={{ ...card, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "13px 14px 10px" }}>
        <div style={label} data-testid="bl-list-head">{tpl(t.rd_bl_list, { n: entries.length })}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.rd_bl_search} data-testid="bl-search" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          style={{ ...input, width: "100%", minHeight: 44, borderRadius: 11 }} />
      </div>
      {listBody}
    </div>
  );

  return (
    <div data-testid="bl-screen">
      <div style={headerBar}>
        <HeaderWithBack onBack={onBack}>
          <div style={headerTitle}>{t.rd_bl_title}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_bl_sub}</div>
        </HeaderWithBack>
      </div>
      <div style={{ padding: "14px 14px 26px", ...(wide ? { display: "grid", gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr)", gap: 16, alignItems: "start" } : { display: "flex", flexDirection: "column", gap: 12 }) }}>
        {addPanel}
        {listPanel}
      </div>
      {/* Portal into the [data-redesign] root (BlacklistSheet / ParcelScan pattern): rendered inside the screen it
          sat in the scroll box's stacking context, UNDER the bottom nav, so Cancel / Remove could not be tapped on a
          phone. The text scrolls inside the sheet; the buttons always stay on screen. */}
      {removing && createPortal(
        <div onClick={() => { if (!removeBusy) setRemoving(null); }} data-testid="bl-remove-sheet" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", alignItems: wide ? "center" : "flex-end", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-testid="bl-remove-panel" style={{ width: "100%", maxWidth: wide ? 420 : undefined, boxSizing: "border-box", background: "var(--surface-2)", borderRadius: wide ? 18 : "20px 20px 0 0", padding: "18px 16px calc(18px + env(safe-area-inset-bottom))", boxShadow: "0 -14px 40px rgba(0,0,0,.35)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
            <div data-testid="bl-remove-body" style={{ minHeight: 0, overflowY: "auto" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", lineHeight: 1.3, overflowWrap: "anywhere" }}>{tpl(t.rd_bl_remove_q, { buyer: displayBuyer(removing.platform, removing.label) })}</div>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6, lineHeight: 1.4 }}>{t.rd_bl_remove_sub}</div>
              {removeFailed && <div role="alert" data-testid="bl-remove-err" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)", marginTop: 8 }}>{t.rd_bl_save_err}</div>}
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 16, flexShrink: 0 }}>
              <button type="button" disabled={removeBusy} onClick={() => setRemoving(null)} data-testid="bl-remove-cancel" style={{ ...btnPrimary, flex: 1, background: "var(--surface)", color: "var(--text)", border: "1.5px solid var(--border-strong)" }}>{t.rd_bl_cancel}</button>
              <button type="button" disabled={removeBusy} onClick={() => void confirmRemove()} data-testid="bl-remove-ok" style={{ ...btnPrimary, flex: 1, background: "var(--danger)", color: "#fff", opacity: removeBusy ? 0.7 : 1 }}>{t.rd_bl_remove}</button>
            </div>
          </div>
        </div>,
        (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body,
      )}
    </div>
  );
}
