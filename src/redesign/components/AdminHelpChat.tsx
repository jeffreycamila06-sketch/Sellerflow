// Admin → Help chat (sql/116). Built so Jeff types as little as possible:
//   top: this month's numbers; Tab A "Approve" (batches of 10, ✅ + Save-as-FAQ on by default,
//   one button); Tab B "Needs your answer" (one box per question, empty = skip, one button);
//   FAQ list (on/off, edit, needs-re-check filter). Reads on open + after each save. Zero poll.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import {
  loadSupportStats, loadQueue, approveBatch, answerBatch, answerItems, loadFaqs, updateFaq, saveFaqDefault, pct,
  type SupportStats, type QueueRow, type FaqRow,
} from "../adapters/helpBot";

type Tab = "approve" | "answer" | "faq";
const card: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", padding: "10px 11px", marginBottom: 9 };
const label: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 3 };
const body: CSSProperties = { fontSize: 12.5, color: "var(--text)", lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" };
const area: CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 64, padding: "8px 9px", borderRadius: 9, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, resize: "vertical" };
const mainBtn: CSSProperties = { width: "100%", padding: "12px 0", border: "none", borderRadius: 11, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const smallBtn: CSSProperties = { padding: "4px 9px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer" };
const tabBtn = (on: boolean): CSSProperties => ({ flex: 1, padding: "7px 4px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "var(--font-ui)", background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-text)" : "var(--text-dim)" });
const check = (on: boolean, onChange: (v: boolean) => void, text: string, testid: string) => (
  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--text-dim)", cursor: "pointer" }}>
    <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />{text}
  </label>
);

export default function AdminHelpChat() {
  const t = useT();
  const [stats, setStats] = useState<SupportStats | null>(null);
  const [tab, setTab] = useState<Tab>("approve");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const refreshStats = useCallback(() => { void loadSupportStats().then(setStats); }, []);
  useEffect(refreshStats, [refreshStats]);

  return (
    <div data-testid="admin-helpchat">
      {stats && (
        <div style={{ ...card, background: "var(--surface-2)" }} data-testid="hc-stats">
          <div style={label}>{t.rd_hc_month}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px", fontSize: 12.5, color: "var(--text)" }}>
            <div>{t.rd_hc_questions}: <b>{stats.total}</b></div>
            <div>{t.rd_hc_saved}: <b>{stats.saved}</b></div>
            <div>{t.rd_hc_free}: <b>{pct(stats.faq, stats.total)}%</b></div>
            <div>{t.rd_hc_match}: <b>{pct(stats.faq_ai_match, stats.total)}%</b></div>
            <div>{t.rd_hc_full}: <b>{pct(stats.ai, stats.total)}%</b></div>
            <div>{t.rd_hc_handoff}: <b>{pct(stats.handoff, stats.total)}%</b></div>
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5, fontWeight: 700, color: stats.cost_usd >= stats.cap_usd * 0.8 ? "var(--danger)" : "var(--text)" }} data-testid="hc-cost">
            {tpl(t.rd_hc_cost, { cost: stats.cost_usd.toFixed(2), cap: stats.cap_usd.toFixed(2) })}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 4, background: "var(--surface-2)", borderRadius: 11, padding: 3, marginBottom: 10 }}>
        <button type="button" style={tabBtn(tab === "approve")} onClick={() => { setTab("approve"); setNote(null); }} data-testid="hc-tab-approve">{t.rd_hc_tab_approve}</button>
        <button type="button" style={tabBtn(tab === "answer")} onClick={() => { setTab("answer"); setNote(null); }} data-testid="hc-tab-answer">{t.rd_hc_tab_answer}</button>
        <button type="button" style={tabBtn(tab === "faq")} onClick={() => { setTab("faq"); setNote(null); }} data-testid="hc-tab-faq">{t.rd_hc_tab_faq}</button>
      </div>
      {note && <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: note.ok ? "var(--ok, #16a34a)" : "var(--danger)" }} data-testid="hc-note">{note.text}</div>}
      {tab === "approve" && <ApproveTab onDone={(n) => { setNote(n === null ? { ok: false, text: t.rd_hc_err } : { ok: true, text: tpl(t.rd_hc_done, { n }) }); refreshStats(); }} />}
      {tab === "answer" && <AnswerTab onDone={(n) => setNote(n === null ? { ok: false, text: t.rd_hc_err } : { ok: true, text: tpl(t.rd_hc_done, { n }) })} />}
      {tab === "faq" && <FaqTab onError={() => setNote({ ok: false, text: t.rd_hc_err })} />}
    </div>
  );
}

interface ApproveState { ok: boolean; saveFaq: boolean; editing: boolean; question: string; answer: string }

export function ApproveTab({ onDone }: { onDone: (n: number | null) => void }) {
  const t = useT();
  const [rows, setRows] = useState<QueueRow[] | null | undefined>(undefined);
  const [st, setSt] = useState<Record<string, ApproveState>>({});
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadQueue("approve", 0).then((r) => {
      if (!alive) return;
      setRows(r);
      setSt(Object.fromEntries((r || []).map((x) => [x.id, { ok: true, saveFaq: true, editing: false, question: x.question, answer: x.answer || "" }])));
    });
    return () => { alive = false; };
  }, [tick]);
  const set = (id: string, p: Partial<ApproveState>) => setSt((s) => ({ ...s, [id]: { ...s[id], ...p } }));

  if (rows === undefined) return <div style={label}>{t.rd_hc_loading}</div>;
  if (rows === null) return <div style={{ ...label, color: "var(--danger)" }}>{t.rd_hc_load_err}</div>;
  if (!rows.length) return <div style={label} data-testid="hc-empty">{t.rd_hc_empty}</div>;
  const submit = async () => {
    setBusy(true);
    const items = rows.map((r) => {
      const s = st[r.id];
      const edited = s.question.trim() !== r.question || s.answer.trim() !== (r.answer || "");
      return { id: r.id, ok: s.ok, save_faq: s.saveFaq, ...(edited ? { question: s.question.trim(), answer: s.answer.trim() } : {}) };
    });
    const n = await approveBatch(items);
    setBusy(false);
    onDone(n);
    if (n !== null) setTick((x) => x + 1); // next batch
  };
  return (
    <div>
      {rows.map((r, i) => {
        const s = st[r.id];
        if (!s) return null;
        return (
          <div key={r.id} style={{ ...card, opacity: s.ok ? 1 : 0.6 }} data-testid="hc-approve-row">
            <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 4 }}>
              <b style={{ fontSize: 12.5 }}>{i + 1}.</b>
              {r.seller_rating === 1 && <span title="👍">👍</span>}
              <div style={{ ...body, fontWeight: 700, flex: 1 }}>{s.editing ? null : s.question}</div>
            </div>
            {s.editing ? (
              <>
                <textarea style={{ ...area, minHeight: 40, marginBottom: 6 }} value={s.question} onChange={(e) => set(r.id, { question: e.target.value })} data-testid="hc-edit-q" />
                <textarea style={area} value={s.answer} onChange={(e) => set(r.id, { answer: e.target.value })} data-testid="hc-edit-a" />
              </>
            ) : (
              <><div style={label}>{t.rd_hc_bot_answer}</div><div style={body}>{s.answer}</div></>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <button type="button" style={{ ...smallBtn, minWidth: 40 }} onClick={() => set(r.id, { ok: !s.ok })} aria-pressed={s.ok} data-testid="hc-ok">{s.ok ? "✅" : "❌"}</button>
              <button type="button" style={smallBtn} onClick={() => set(r.id, { editing: !s.editing })} aria-label={t.rd_hc_edit} data-testid="hc-edit">✏️</button>
              {check(s.saveFaq, (v) => set(r.id, { saveFaq: v }), t.rd_hc_save_faq, "hc-savefaq")}
            </div>
          </div>
        );
      })}
      <button type="button" style={{ ...mainBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void submit()} data-testid="hc-approve-batch">{t.rd_hc_approve_batch}</button>
    </div>
  );
}

const reasonKey = (r: QueueRow) =>
  r.needs_admin === "billing" ? "rd_hc_reason_billing" : r.needs_admin === "not_covered" ? "rd_hc_reason_not_covered" : r.needs_admin === "ai_error" ? "rd_hc_reason_ai_error" : r.needs_admin === "blocked" ? "rd_hc_reason_blocked" : "rd_hc_reason_down";

export function AnswerTab({ onDone }: { onDone: (n: number | null) => void }) {
  const t = useT();
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<QueueRow[] | null | undefined>(undefined);
  const [st, setSt] = useState<Record<string, { answer: string; saveFaq: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadQueue("answer", offset).then((r) => {
      if (!alive) return;
      setRows(r);
      setSt(Object.fromEntries((r || []).map((x) => [x.id, { answer: "", saveFaq: saveFaqDefault(x) }])));
    });
    return () => { alive = false; };
  }, [offset, tick]);
  if (rows === undefined) return <div style={label}>{t.rd_hc_loading}</div>;
  if (rows === null) return <div style={{ ...label, color: "var(--danger)" }}>{t.rd_hc_load_err}</div>;
  if (!rows.length) return <div style={label} data-testid="hc-empty">{t.rd_hc_empty}</div>;
  const total = Number(rows[0].total) || rows.length;
  const submit = async () => {
    const items = answerItems(rows.map((r) => ({ id: r.id, answer: st[r.id]?.answer || "", save_faq: !!st[r.id]?.saveFaq })));
    if (!items.length) return;
    setBusy(true);
    const n = await answerBatch(items);
    setBusy(false);
    onDone(n);
    if (n !== null) setTick((x) => x + 1);
  };
  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.id} style={card} data-testid="hc-answer-row">
          <div style={{ display: "flex", gap: 6, alignItems: "baseline", marginBottom: 4 }}>
            <b style={{ fontSize: 12.5 }}>{offset + i + 1}.</b>
            <div style={{ ...body, fontWeight: 700, flex: 1 }}>{r.question}</div>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{t[reasonKey(r)]}</span>
          </div>
          {r.answer && r.source !== "handoff" && r.source !== "limit" && <><div style={label}>{t.rd_hc_bot_answer}</div><div style={{ ...body, color: "var(--text-dim)", marginBottom: 6 }}>{r.answer}</div></>}
          <textarea style={area} placeholder={t.rd_hc_answer_ph} value={st[r.id]?.answer || ""} onChange={(e) => setSt((s) => ({ ...s, [r.id]: { ...s[r.id], answer: e.target.value } }))} data-testid="hc-answer-box" />
          <div style={{ marginTop: 6 }}>{check(!!st[r.id]?.saveFaq, (v) => setSt((s) => ({ ...s, [r.id]: { ...s[r.id], saveFaq: v } })), t.rd_hc_save_faq, "hc-answer-savefaq")}</div>
        </div>
      ))}
      <button type="button" style={{ ...mainBtn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void submit()} data-testid="hc-save-answers">{t.rd_hc_save_answers}</button>
      {offset + 10 < total && <button type="button" style={{ ...smallBtn, width: "100%", marginTop: 8, padding: "9px 0" }} onClick={() => setOffset(offset + 10)} data-testid="hc-next">›</button>}
      {offset > 0 && <button type="button" style={{ ...smallBtn, width: "100%", marginTop: 8, padding: "9px 0" }} onClick={() => setOffset(Math.max(0, offset - 10))} data-testid="hc-prev">‹</button>}
    </div>
  );
}

export function FaqTab({ onError }: { onError: () => void }) {
  const t = useT();
  const [rows, setRows] = useState<FaqRow[] | null | undefined>(undefined);
  const [onlyRecheck, setOnlyRecheck] = useState(false);
  const [edit, setEdit] = useState<{ id: number; question: string; answer: string } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadFaqs().then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [tick]);
  if (rows === undefined) return <div style={label}>{t.rd_hc_loading}</div>;
  if (rows === null) return <div style={{ ...label, color: "var(--danger)" }}>{t.rd_hc_load_err}</div>;
  const shown = onlyRecheck ? rows.filter((r) => r.needs_recheck) : rows;
  const run = async (p: Promise<boolean>) => { if (!(await p)) onError(); setEdit(null); setTick((x) => x + 1); };
  return (
    <div>
      <div style={{ marginBottom: 8 }}>{check(onlyRecheck, setOnlyRecheck, `${t.rd_hc_recheck} (${rows.filter((r) => r.needs_recheck).length})`, "hc-recheck-filter")}</div>
      {!shown.length && <div style={label} data-testid="hc-empty">{t.rd_hc_empty}</div>}
      {shown.map((r) => (
        <div key={r.id} style={{ ...card, opacity: r.enabled ? 1 : 0.6 }} data-testid="hc-faq-row">
          {edit?.id === r.id ? (
            <>
              <textarea style={{ ...area, minHeight: 40, marginBottom: 6 }} value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} data-testid="hc-faq-edit-q" />
              <textarea style={area} value={edit.answer} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} data-testid="hc-faq-edit-a" />
              <button type="button" style={{ ...smallBtn, marginTop: 6 }} onClick={() => void run(updateFaq(r.id, { question: edit.question, answer: edit.answer }))} data-testid="hc-faq-save">{t.rd_hc_save}</button>
            </>
          ) : (
            <>
              <div style={{ ...body, fontWeight: 700 }}>{r.question}</div>
              <div style={{ ...body, color: "var(--text-dim)", marginTop: 3 }}>{r.answer}</div>
            </>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 7 }}>
            {r.needs_recheck && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--danger)" }} data-testid="hc-recheck-tag">{t.rd_hc_recheck}</span>}
            <button type="button" style={smallBtn} onClick={() => void run(updateFaq(r.id, { enabled: !r.enabled }))} aria-pressed={r.enabled} data-testid="hc-faq-toggle">{r.enabled ? t.rd_hc_on : t.rd_hc_off}</button>
            {edit?.id !== r.id && <button type="button" style={smallBtn} onClick={() => setEdit({ id: r.id, question: r.question, answer: r.answer })} aria-label={t.rd_hc_edit} data-testid="hc-faq-edit">✏️</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
