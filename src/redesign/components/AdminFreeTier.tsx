// Admin → Free tier list (2026-11-26). Three groups (Using now · Finished · No orders yet), filter
// chips (All · Active 7 days · Look-alike), last order time per seller (sql/228, ONE read when the
// panel opens, no timer) and the look-alike warning sheet. A warning only — nothing is written.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useT, tpl, type RedesignT } from "../i18n";
import { mono } from "../ui";
import type { AccountUser } from "../../accountDb";
import type { FreeUserRow } from "../adapters/useReadData";
import { CountryTag } from "./AdminCountry";
import {
  RECENT_MS, agoParts, filterFreeRows, groupFreeRows, joinedDay, lastOf, loadFreeLastOrders, lookalikeGroups, usernamesOf,
  type FreeFilter,
} from "../adapters/freeTierList";

const ellip: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const small: CSSProperties = { fontSize: 11, color: "var(--text-muted)" };

function agoText(t: RedesignT, ms: number, now: number): string {
  const a = agoParts(ms, now);
  return a.kind === "now" ? t.rd_adm_ft_ago_now : tpl(a.kind === "m" ? t.rd_adm_ft_ago_m : a.kind === "h" ? t.rd_adm_ft_ago_h : t.rd_adm_ft_ago_d, { n: a.n });
}

/** "Last order 3h ago" (green within 24 h) / "No orders yet" / over 3 months / unknown. */
function LastLine({ row, last, now, testid }: { row: FreeUserRow; last: Map<string, number | null> | null; now: number; testid?: string }) {
  const t = useT();
  const ms = lastOf(last, row.email);
  const recent = ms !== null && now - ms <= RECENT_MS;
  const text = last === null ? t.rd_adm_ft_last_unknown
    : ms !== null ? tpl(t.rd_adm_ft_last, { t: agoText(t, ms, now) })
    : (Number(row.count) || 0) > 0 ? t.rd_adm_ft_last_old : t.rd_adm_ft_last_none;
  return <div data-testid={testid} data-recent={recent ? "1" : "0"} style={{ fontSize: 10.5, fontWeight: recent ? 700 : 500, color: recent ? "var(--ok)" : "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap" }}>{text}</div>;
}

function usedColor(u: FreeUserRow): string { return u.capped ? "var(--danger)" : u.near_cap ? "var(--warn)" : "var(--ok)"; }

export function FreeTierList({ list, rawByEmail, nowMs }: { list: FreeUserRow[]; rawByEmail: Record<string, AccountUser>; nowMs?: number }) {
  const t = useT();
  const [last, setLast] = useState<Map<string, number | null> | null | "loading">("loading");
  const [filter, setFilter] = useState<FreeFilter>("all");
  const [sheet, setSheet] = useState<string | null>(null); // email of the tapped row
  // ONE read when the panel opens. No timer.
  useEffect(() => {
    let live = true;
    void loadFreeLastOrders().then((m) => { if (live) setLast(m); });
    return () => { live = false; };
  }, []);
  const [now] = useState(() => nowMs ?? Date.now());
  const lastMap = last === "loading" ? new Map<string, number | null>() : last;
  const groups = useMemo(() => lookalikeGroups(list, rawByEmail), [list, rawByEmail]);
  const counts = {
    all: list.length,
    active: filterFreeRows(list, "active", lastMap, groups, now).length,
    look: groups.size,
  };
  const shown = filterFreeRows(list, filter, lastMap, groups, now);
  const g = groupFreeRows(shown, lastMap, rawByEmail);
  const cap = list[0]?.cap ?? 150;

  const chip = (k: FreeFilter, label: string) => {
    const on = filter === k;
    const warn = k === "look";
    return (
      <button key={k} type="button" data-testid={`ft-chip-${k}`} aria-pressed={on} onClick={() => setFilter(k)}
        style={{ minHeight: 44, padding: "0 13px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)", whiteSpace: "nowrap",
          border: `1.5px solid ${on ? (warn ? "var(--warn)" : "var(--accent)") : "var(--border)"}`,
          background: on ? (warn ? "var(--warn-soft)" : "var(--accent-soft, var(--surface))") : "var(--surface)",
          color: on ? (warn ? "var(--warn)" : "var(--accent-fg)") : "var(--text-dim)" }}>{label}</button>
    );
  };

  const row = (u: FreeUserRow) => {
    const grp = groups.get(u.email);
    const raw = rawByEmail[u.email];
    const names = usernamesOf(raw);
    const inner = (
      <>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", ...ellip }}>{u.store_name || u.full_name || u.email}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", ...ellip }}>{names.length ? `@${names.join(" @")} · ${u.email}` : u.email}</div>
          <CountryTag email={u.email} suffix={tpl(t.rd_adm_joined, { d: joinedDay(raw?.createdAt) })} />
          {grp && <span data-testid="ft-badge" style={{ display: "inline-block", marginTop: 4, fontSize: 10.5, fontWeight: 800, color: "var(--warn)", border: "1px solid var(--warn)", borderRadius: 999, padding: "1px 8px" }}>{tpl(t.rd_adm_ft_badge, { n: grp.length })}</span>}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 12.5, fontWeight: 700, color: usedColor(u) }}>{u.count} / {u.cap}</div>
          <LastLine row={u} last={last === "loading" ? null : last} now={now} testid="ft-last" />
        </div>
      </>
    );
    const box: CSSProperties = { display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 12, width: "100%", boxSizing: "border-box", textAlign: "left", fontFamily: "var(--font-ui)",
      border: `1px solid ${grp ? "var(--warn)" : "var(--border)"}`, background: grp ? "var(--warn-soft)" : "var(--surface-2)" };
    return grp
      ? <button key={u.email} type="button" data-testid="ft-row" data-email={u.email} data-look="1" onClick={() => setSheet(u.email)} style={{ ...box, cursor: "pointer", minHeight: 44 }}>{inner}</button>
      : <div key={u.email} data-testid="ft-row" data-email={u.email} data-look="0" style={box}>{inner}</div>;
  };

  const section = (id: string, title: string, rows: FreeUserRow[]) => rows.length === 0 ? null : (
    <div key={id} data-testid={`ft-group-${id}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div data-testid={`ft-group-${id}-head`} style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text)", margin: "6px 2px 0", textTransform: "uppercase", letterSpacing: ".04em" }}>{title}</div>
      {rows.map(row)}
    </div>
  );

  return (
    <div data-testid="ft-list" style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 2 }}>{tpl(list.length === 1 ? t.rd_adm_free_shops_one : t.rd_adm_free_shops_many, { n: list.length })}</div>
      {list.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_adm_no_free}</div>}
      {list.length > 0 && (
        <div data-testid="ft-chips" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {chip("all", tpl(t.rd_adm_ft_chip_all, { n: counts.all }))}
          {chip("active", tpl(t.rd_adm_ft_chip_active, { n: counts.active }))}
          {chip("look", tpl(t.rd_adm_ft_chip_look, { n: counts.look }))}
        </div>
      )}
      {last === null && <div data-testid="ft-unread" style={{ ...small, color: "var(--warn)" }}>{t.rd_adm_ft_unread}</div>}
      {list.length > 0 && shown.length === 0 && <div data-testid="ft-empty" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "8px 2px" }}>{t.rd_adm_ft_empty}</div>}
      {section("using", tpl(t.rd_adm_ft_g_using, { n: g.using.length }), g.using)}
      {section("finished", tpl(t.rd_adm_ft_g_finished, { cap, n: g.finished.length }), g.finished)}
      {section("none", tpl(t.rd_adm_ft_g_none, { n: g.none.length }), g.none)}
      {sheet && groups.get(sheet) && (
        <LookalikeSheet emails={groups.get(sheet)!} list={list} rawByEmail={rawByEmail} last={last === "loading" ? null : last} now={now} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}

function LookalikeSheet({ emails, list, rawByEmail, last, now, onClose }: { emails: string[]; list: FreeUserRow[]; rawByEmail: Record<string, AccountUser>; last: Map<string, number | null> | null; now: number; onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const rows = emails.map((e) => list.find((r) => r.email === e)).filter((r): r is FreeUserRow => !!r);
  const sum = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const node = (
    <div onClick={onClose} data-testid="ft-sheet-overlay" style={{ position: "fixed", inset: 0, zIndex: 1300, background: "rgba(9,7,24,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tpl(t.rd_adm_ft_sheet_title, { n: rows.length })} data-testid="ft-sheet"
        style={{ width: "100%", maxWidth: 720, boxSizing: "border-box", background: "var(--surface-2)", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: "10px 14px calc(18px + env(safe-area-inset-bottom))", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 -14px 40px rgba(0,0,0,.35)" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--border-strong)", margin: "0 auto 10px" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 2px 4px" }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: "var(--warn)", minWidth: 0 }}>⚠ {tpl(t.rd_adm_ft_sheet_title, { n: rows.length })}</span>
          <button type="button" onClick={onClose} data-testid="ft-sheet-close" style={{ marginLeft: "auto", minHeight: 44, minWidth: 44, border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>{t.rd_adm_ft_close}</button>
        </div>
        <div style={{ ...small, lineHeight: 1.4, margin: "0 2px 10px" }}>{t.rd_adm_ft_sheet_note}</div>
        <div data-testid="ft-sheet-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 8 }}>
          {rows.map((r) => {
            const raw = rawByEmail[r.email];
            const names = usernamesOf(raw);
            return (
              <div key={r.email} data-testid="ft-sheet-card" style={{ minWidth: 0, border: "1px solid var(--warn)", borderRadius: 12, background: "var(--surface)", padding: "10px 11px", display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", overflowWrap: "anywhere" }}>{r.store_name || r.full_name || "—"}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", overflowWrap: "anywhere" }}>{names.length ? names.map((n) => `@${n}`).join(" ") : "—"}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", overflowWrap: "anywhere" }}>{r.email}</div>
                <div style={small}>{tpl(t.rd_adm_ft_joined, { d: joinedDay(raw?.createdAt) })}</div>
                <LastLine row={r} last={last} now={now} />
                <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 800, color: usedColor(r), marginTop: 2 }}>{r.count} / {r.cap}</div>
              </div>
            );
          })}
        </div>
        <div data-testid="ft-together" style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "var(--warn-soft)", border: "1px solid var(--warn)", fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
          {tpl(t.rd_adm_ft_together, { n: sum })}
        </div>
      </div>
    </div>
  );
  return createPortal(node, (typeof document !== "undefined" && document.querySelector("[data-redesign]")) || document.body);
}

