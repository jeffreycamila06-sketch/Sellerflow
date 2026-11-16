// Admin → 7-11 Login → Evidence (sql/172). Totals (after-mode and mirror apart; fresh vs remembered
// apart for phone and store; the "restricted" line; store answer age) + a list of checks with
// filters. A row opens to its FULL details (one read by id). Read on open / filter / page — never polled.
import { useEffect, useState, type CSSProperties } from "react";
import { useT, tpl } from "../i18n";
import { taipeiStamp } from "../adapters/pc711Login";
import { pc711EvidenceApi, pairsBySource, PC711_EV_FILTERS, type Pc711EvDay, type Pc711EvFilter, type Pc711EvPage, type Pc711EvRow, type Pc711EvSummary } from "../adapters/pc711Evidence";

const card: CSSProperties = { background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 14px", marginTop: 14 };
const ghost: CSSProperties = { minHeight: 44, padding: "10px 14px", border: "1px solid var(--border-strong)", borderRadius: 12, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const chip = (on: boolean): CSSProperties => ({ minHeight: 34, padding: "6px 10px", borderRadius: 999, border: `1px solid ${on ? "var(--accent)" : "var(--border-strong)"}`, background: on ? "var(--accent)" : "var(--surface)", color: on ? "var(--accent-text)" : "var(--text)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer" });
const line: CSSProperties = { fontSize: 12, color: "var(--text)", marginTop: 4, lineHeight: 1.45, overflowWrap: "anywhere" };
const head: CSSProperties = { fontSize: 12, fontWeight: 800, color: "var(--text-dim)", marginTop: 10 };
const stamp = (v: unknown) => (typeof v === "string" && v ? taipeiStamp(v) : "—");

function Details({ id }: { id: number }) {
  const t = useT();
  const [d, setD] = useState<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    pc711EvidenceApi.detail(id).then((x) => { if (alive) setD(x); }).catch(() => { if (alive) setD(null); });
    return () => { alive = false; };
  }, [id]);
  if (d === undefined) return <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "6px 4px" }}>{t.rd_pc711_loading}</div>;
  if (d === null) return <div data-testid="pc711-ev-detail-failed" style={{ fontSize: 12, color: "var(--text-dim)", padding: "6px 4px" }}>{t.rd_pc711_sh_failed}</div>;
  const src = (v: unknown) => (v === "fresh" ? t.rd_pc711_ev_fresh : v === "remembered" ? t.rd_pc711_ev_remembered : v === "unknown" ? t.rd_pc711_ev_unknown : "—");
  const txt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  const reask = (n: 1 | 2) => (d[`reask${n}_word`] ? `${txt(d[`reask${n}_word`])} · ${stamp(d[`reask${n}_at`])}` : "—");
  const rows: [string, string, string][] = [
    ["parcel", t.rd_pc711_ev_parcel, txt(d.scan_id)],
    ["seller", t.rd_pc711_ev_seller, txt(d.seller_id)],
    ["check", t.rd_pc711_ev_round, `${d.mode === "mirror" ? t.rd_pc711_ev_f_mirror : t.rd_pc711_ev_after} · #${txt(d.round)}`],
    ["store", t.rd_pc711_ev_store, txt(d.store_id)],
    ["phone", t.rd_pc711_ev_phone, txt(d.phone)],
    ["created", t.rd_pc711_ev_created, stamp(d.parcel_created_at)],
    ["ext_at", t.rd_pc711_ev_ext_at, stamp(d.ext_at)],
    ["ext", t.rd_pc711_ev_ext, txt(d.ext_verdict)],
    ["message", t.rd_pc711_ev_msg, txt(d.ext_message)],
    ["until", t.rd_pc711_ev_until, txt(d.ext_restricted_until)],
    ["source", t.rd_pc711_ev_source, src(d.ext_source)],
    ["cache", t.rd_pc711_ev_cache, stamp(d.ext_cache_at)],
    ["age", t.rd_pc711_ev_age, d.ext_age_s === null || d.ext_age_s === undefined ? "—" : tpl(t.rd_pc711_ev_secs, { s: String(d.ext_age_s) })],
    ["started", t.rd_pc711_ev_started, stamp(d.srv_started_at)],
    ["finished", t.rd_pc711_ev_finished, stamp(d.srv_finished_at)],
    ["srv", t.rd_pc711_ev_srv, `${txt(d.srv_verdict)}${d.srv_raw ? ` · ${d.srv_raw}` : ""}${d.srv_ms ? ` · ${d.srv_ms} ms` : ""}`],
    ["waiting", t.rd_pc711_ev_waiting, txt(d.queue_waiting)],
    ["first", t.rd_pc711_ev_first, d.first ? `${d.first === "server" ? t.rd_pc711_ev_srv : t.rd_pc711_ev_ext} · ${txt(d.first_by_ms)} ms` : "—"],
    ["late", t.rd_pc711_ev_late_l, d.ext_late ? t.rd_pc711_ev_late : d.ext_timeout ? t.rd_pc711_ev_noanswer : "—"],
    ["flag", t.rd_pc711_ev_flag, txt(d.flag)],
    ["reask1", `${t.rd_pc711_ev_reask} 1`, reask(1)],
    ["reask2", `${t.rd_pc711_ev_reask} 2`, reask(2)],
    ["input", t.rd_pc711_ev_badinput, txt(d.bad_input_rule)],
    ["error", t.rd_pc711_ev_error, d.fail_reason ? `${txt(d.fail_step)} · http ${txt(d.fail_http)} · ${txt(d.fail_reason)} · ${stamp(d.fail_at)}` : "—"],
  ];
  return (
    <div data-testid="pc711-ev-detail" style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 10px", padding: "6px 4px 10px 10px", fontSize: 11.5 }}>
      {rows.map(([k, label, value]) => (
        <div key={k} style={{ display: "contents" }}>
          <span style={{ color: "var(--text-dim)" }}>{label}</span>
          <span data-testid={`pc711-ev-d-${k}`} style={{ color: "var(--text)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Pc711EvidenceBlock() {
  const t = useT();
  const [day, setDay] = useState<Pc711EvDay>("today");
  const [filter, setFilter] = useState<Pc711EvFilter>("all");
  const [page, setPage] = useState(0);
  const [s, setS] = useState<Pc711EvSummary | null | undefined>(undefined);
  const [list, setList] = useState<Pc711EvPage | null | undefined>(undefined);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    pc711EvidenceApi.summary(day).then((x) => { if (alive) setS(x); }).catch(() => { if (alive) setS(null); });
    return () => { alive = false; };
  }, [day]);
  useEffect(() => {
    let alive = true;
    pc711EvidenceApi.list(day, filter, page).then((x) => { if (alive) { setList(x); setOpen(null); } }).catch(() => { if (alive) setList(null); });
    return () => { alive = false; };
  }, [day, filter, page]);
  const filterLabel: Record<Pc711EvFilter, string> = { all: t.rd_pc711_sh_f_all, mismatch: t.rd_pc711_sh_f_mis, recheck: t.rd_pc711_ev_f_recheck, mirror: t.rd_pc711_ev_f_mirror, error: t.rd_pc711_sh_f_err };
  const kindLabel = (k: string) => (k === "phone" ? t.rd_pc711_sh_phone : k === "frozen" ? t.rd_pc711_sh_frozen : t.rd_pc711_sh_store);
  const srcLine = (mode: "after" | "mirror", kind: "phone" | "store") => {
    const b = pairsBySource(s!.totals.pairs, mode, kind);
    const f = (x: { agree: number; compared: number }) => (x.compared ? `${x.agree}/${x.compared}` : "—");
    return tpl(t.rd_pc711_ev_srcline, { kind: kindLabel(kind), f: f(b.fresh), r: f(b.remembered), u: f(b.unknown) });
  };
  const rowText = (r: Pc711EvRow) => {
    const parts = [taipeiStamp(r.at), kindLabel(r.kind)];
    if (r.mode === "mirror") parts.push(t.rd_pc711_ev_f_mirror);
    if (r.round > 1) parts.push(`${t.rd_pc711_ev_f_recheck} #${r.round}`);
    if (r.result === "match") parts.push(t.rd_pc711_sh_r_match);
    else if (r.result === "mismatch") parts.push(`${t.rd_pc711_sh_r_mismatch} ext=${r.ext} srv=${r.srv}`);
    else if (r.result === "error") parts.push(`${tpl(t.rd_pc711_sh_r_error, { step: r.failStep || "?" })} http=${r.failHttp ?? 0} ${r.failReason ?? ""} ${r.failAt ? taipeiStamp(r.failAt) : ""}`.trim());
    else if (r.result === "waiting") parts.push(t.rd_pc711_ev_r_waiting);
    if (r.result === "mismatch" || r.result === "match") parts.push(r.source === "fresh" ? t.rd_pc711_ev_fresh : r.source === "remembered" ? t.rd_pc711_ev_remembered : t.rd_pc711_ev_unknown);
    if (r.result === "mismatch" && r.kind === "phone") parts.push(`${t.rd_pc711_ev_reask}: ${r.reask1 ?? "—"} / ${r.reask2 ?? "—"}`);
    if (r.late) parts.push(t.rd_pc711_ev_late);
    if (r.timeout && !r.late) parts.push(t.rd_pc711_ev_noanswer);
    if (r.flag) parts.push(r.flag);
    return parts.join(" · ");
  };
  const tot = s?.totals;
  return (
    <div data-testid="pc711-ev" style={card}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{t.rd_pc711_ev_title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {(["today", "7days"] as Pc711EvDay[]).map((d) => (
          <button key={d} type="button" data-testid={`pc711-ev-day-${d}`} aria-pressed={day === d} onClick={() => { setDay(d); setPage(0); setList(undefined); setS(undefined); }} style={chip(day === d)}>
            {d === "today" ? t.rd_pc711_sh_d_today : t.rd_pc711_sh_d_7days}
          </button>
        ))}
      </div>
      {s === undefined ? <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_pc711_loading}</div>
        : s === null || !tot ? <div data-testid="pc711-ev-failed" style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_pc711_sh_failed}</div>
        : <div data-testid="pc711-ev-totals">
          <div data-testid="pc711-ev-mirror-state" style={{ ...line, fontWeight: 700 }}>{s.mirrorEnabled ? t.rd_pc711_ev_mirror_on : t.rd_pc711_ev_mirror_off}</div>
          <div data-testid="pc711-ev-selfstop" style={{ ...line, color: s.selfStop.lastStop ? "var(--warn)" : "var(--text-dim)", fontWeight: s.selfStop.lastStop ? 700 : 400 }}>
            {s.selfStop.lastStop
              ? tpl(t.rd_pc711_ev_stop, { time: taipeiStamp(s.selfStop.lastStop.at), rule: s.selfStop.lastStop.rule === "phone_time" ? t.rd_pc711_ev_rule_phone : s.selfStop.lastStop.rule === "waited" ? t.rd_pc711_ev_rule_waited : t.rd_pc711_ev_rule_unknown, value: s.selfStop.lastStop.value === null ? "—" : String(s.selfStop.lastStop.value) })
              : t.rd_pc711_ev_stop_none}
          </div>
          {s.selfStop.silentSince && <div data-testid="pc711-ev-silent" role="status" style={{ ...line, color: "var(--warn)", fontWeight: 700 }}>{tpl(t.rd_pc711_ev_silent, { time: taipeiStamp(s.selfStop.silentSince) })}</div>}
          <div style={head}>{t.rd_pc711_ev_after}</div>
          <div data-testid="pc711-ev-after-phone" style={line}>{srcLine("after", "phone")}</div>
          <div data-testid="pc711-ev-after-store" style={line}>{srcLine("after", "store")}</div>
          <div style={head}>{t.rd_pc711_ev_f_mirror}</div>
          <div data-testid="pc711-ev-mirror-phone" style={line}>{srcLine("mirror", "phone")}</div>
          <div data-testid="pc711-ev-mirror-store" style={line}>{srcLine("mirror", "store")}</div>
          <div data-testid="pc711-ev-mirror-line" style={line}>{tpl(t.rd_pc711_ev_mirrorline, { s: String(tot.mirror.serverFirst), e: String(tot.mirror.extensionFirst), ms: tot.mirror.avgFirstByMs === null ? "—" : String(tot.mirror.avgFirstByMs), l: String(tot.mirror.late), n: String(tot.mirror.timeout) })}</div>
          <div style={head}>{t.rd_pc711_ev_other}</div>
          <div data-testid="pc711-ev-restricted" style={line}>{tpl(t.rd_pc711_ev_restricted, { a: String(tot.restricted.agree), d: String(tot.restricted.disagree) })}</div>
          <div data-testid="pc711-ev-storeage" style={line}>{tpl(t.rd_pc711_ev_storeage, { avg: tot.storeAge.avgS === null ? "—" : String(tot.storeAge.avgS), max: tot.storeAge.maxS === null ? "—" : String(tot.storeAge.maxS), n: String(tot.storeAge.n) })}</div>
          <div data-testid="pc711-ev-rechecks" style={line}>{tpl(t.rd_pc711_ev_rechecks, { n: String(tot.rechecks), f: String(tot.flags), r: String(tot.reasked) })}</div>
          <div data-testid="pc711-ev-errors" style={line}>{tpl(t.rd_pc711_ev_errors, { a: String(tot.errors.after), m: String(tot.errors.mirror) })}</div>
        </div>}

      <div data-testid="pc711-ev-filters" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        {PC711_EV_FILTERS.map((f) => <button key={f} type="button" data-testid={`pc711-ev-filter-${f}`} aria-pressed={filter === f} onClick={() => { setFilter(f); setPage(0); setList(undefined); }} style={chip(filter === f)}>{filterLabel[f]}</button>)}
      </div>
      {list === undefined ? <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_pc711_loading}</div>
        : list === null ? <div data-testid="pc711-ev-list-failed" style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_pc711_sh_failed}</div>
        : !list.rows.length ? <div data-testid="pc711-ev-empty" style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>{t.rd_pc711_sh_none}</div>
        : <div data-testid="pc711-ev-list" style={{ marginTop: 8 }}>
          {list.rows.map((r) => (
            <div key={r.id}>
              <button type="button" data-testid="pc711-ev-row" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}
                style={{ display: "block", width: "100%", textAlign: "left", minHeight: 44, padding: "7px 2px", border: "none", borderBottom: "1px solid var(--border)", background: "transparent",
                  color: r.result === "match" ? "var(--text)" : r.result === "mismatch" ? "var(--danger)" : r.result === "error" ? "var(--warn)" : "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11.5, cursor: "pointer", overflowWrap: "anywhere" }}>
                {rowText(r)}
              </button>
              {open === r.id && <Details id={r.id} />}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <button type="button" data-testid="pc711-ev-prev" disabled={page <= 0} onClick={() => { setPage((p) => Math.max(0, p - 1)); setList(undefined); }} style={{ ...ghost, flex: 1, opacity: page <= 0 ? 0.5 : 1 }}>{t.rd_pc711_sh_prev}</button>
            <span style={{ fontSize: 12, color: "var(--text-dim)", minWidth: 60, textAlign: "center" }}>{tpl(t.rd_pc711_sh_page, { p: page + 1 })}</span>
            <button type="button" data-testid="pc711-ev-next" disabled={!list.more} onClick={() => { setPage((p) => p + 1); setList(undefined); }} style={{ ...ghost, flex: 1, opacity: list.more ? 1 : 0.5 }}>{t.rd_pc711_sh_next}</button>
          </div>
        </div>}
    </div>
  );
}
