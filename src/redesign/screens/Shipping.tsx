// Screen 13 — Shipping (7-11 交貨便, P1). REPLACES the old localStorage shipment
// manager (Jeff 2026-07-03): groups the CURRENT session window's orders per
// buyer# (one bag = one buyer group = one row), encode form (recipient / phone /
// 7-11 store) with live 賣貨便 validation, entries persisted to shipping_entries
// (RLS, cross-device). Export (.xlsm template round-trip + plan quota RPC) = P2;
// split bags / free-shipping auto-rule = P3.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import type { Buyer } from "../../lib/orderTypes";
import {
  buyerGroupsFrom, draftEntryFor, validateEntry, entryIsValid, codTotal,
  mustSplit, splitSummary, buildBagEntries, validateSplit, splitIsValid, defaultProductDesc,
  lateOrdersFor, lateFormEntry,
  SHIP_TEMP_AMBIENT, SHIP_TEMP_FROZEN, SHIP_DEFAULT_FEE, SHIP_MAX, SHIP_MAX_DESC, STORE_LOOKUP_URL, SPLIT_MAX_BAGS,
  type BuyerGroup, type ShippingEntry, type EntryErrors, type SharedRecipient,
} from "../adapters/shipping";
import { loadShippingEntries, upsertShippingEntry, deleteShippingEntry } from "../adapters/shippingDb";
import {
  quotaForPlan, callExportRpc, loadExportedCount, entryToXlsRow, exportFilename,
  fetchShipTemplate, buildXlsmFromTemplate, deliverXlsm, hasNativeFileShare, markBatchShipped,
} from "../adapters/shippingExport";
import {
  defaultFeeFor, legacyLocalSettings, mirrorLegacyFee, loadShippingSettings, saveShippingSettings,
  clampThreshold, type ShippingSettings,
} from "../adapters/shippingSettings";
import { isAppShell } from "../adapters/appShell";
import { useT, tpl, type RedesignT } from "../i18n";

const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none", boxSizing: "border-box" };
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 };
const errTxt: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "var(--danger)", marginTop: 3 };
const newId = (): string => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

// Error-code → localized message (validators return codes, not copy).
const nameErrText = (t: RedesignT, e: EntryErrors["name"]): string =>
  e === "required" ? t.rd_shp_err_required : e === "too_long" ? t.rd_shp_err_name_len : e === "forbidden" ? t.rd_shp_err_name_chars : "";
const amountErrText = (t: RedesignT, e: EntryErrors["amounts"]): string =>
  e === "fee_range" ? t.rd_shp_err_fee : e === "order_range" ? t.rd_shp_err_order : e === "total_low" ? t.rd_shp_err_total_low : e === "total_high" ? t.rd_shp_err_total_high : "";

export default function Shipping({ cur, buyers = [], sessionKey, windowDays = 1, plan, onUpgrade }: {
  cur: string; buyers?: Buyer[]; sessionKey: string; windowDays?: number;
  plan?: string; onUpgrade?: () => void; // upgrade prompt hidden on iOS (no prop)
}) {
  const t = useT();
  const groups = useMemo(() => buyerGroupsFrom(buyers), [buyers]);
  const [entries, setEntries] = useState<ShippingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openB, setOpenB] = useState<number | null>(null); // expanded buyer group
  const [form, setForm] = useState<ShippingEntry | null>(null);
  const [showErr, setShowErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // P3b shipping defaults — DB-BACKED (cross-device, seller_shipping_settings).
  // Starts from the legacy per-device preset (sfl_rd_ship_fee) / factory NT$38;
  // the DB row overrides once loaded. defaultFee feeds NEW entries + the Free
  // toggle pair (0 ↔ defaultFee); freeThreshold = free-shipping auto-rule
  // (null = off). Per-entry edit stays; validator range 0–100 unchanged.
  const [settings, setSettings] = useState<ShippingSettings>(() => legacyLocalSettings());
  const [thrDraft, setThrDraft] = useState<string>("");
  const applySettings = (patch: Partial<ShippingSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    mirrorLegacyFee(next.defaultFee);              // offline fallback stays fresh
    void saveShippingSettings(next);               // one upsert per change
  };
  const pickDefaultFee = (v: number) => applySettings({ defaultFee: v });
  // P3b mark-as-shipped — per-batch RPC; status stays 'exported' (quota-safe).
  const [markBusy, setMarkBusy] = useState<string | null>(null);
  // P2 export — quota meter (ONE count read on mount), selection, RPC-then-file.
  const [exportedCount, setExportedCount] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [exNote, setExNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // P3a split bags — item-assignment editor state (one open group at a time).
  const [splitB, setSplitB] = useState<number | null>(null);
  const [nBags, setNBags] = useState(2);
  const [assign, setAssign] = useState<Record<number, number>>({});
  const [sShared, setSShared] = useState<SharedRecipient>({ recipientName: "", phone: "", storeId: "", tempLayer: SHIP_TEMP_AMBIENT });
  const [sFee, setSFee] = useState<number>(SHIP_DEFAULT_FEE);
  const [sShowErr, setSShowErr] = useState(false);
  const [sBusy, setSBusy] = useState(false);
  const [sNote, setSNote] = useState("");

  // READ-ON-LOAD ONLY — one entries select + one count + one settings read for
  // this screen open; no poll.
  useEffect(() => {
    let active = true;
    void loadShippingEntries(sessionKey).then((rows) => {
      if (!active) return;
      setEntries(rows); setLoading(false);
      setSel(new Set(rows.filter((e) => e.status === "encoded").map((e) => e.id))); // default: all encoded
    });
    void loadExportedCount().then((n) => { if (active) setExportedCount(n); });
    void loadShippingSettings().then((s) => {
      if (!active || !s) return; // no row yet → keep legacy/factory
      setSettings(s);
      setThrDraft(s.freeThreshold != null ? String(s.freeThreshold) : "");
    });
    return () => { active = false; };
  }, [sessionKey]);

  const entryFor = (bNum: number): ShippingEntry | null =>
    entries.find((e) => e.buyerNumber === bNum && e.bagNumber === 1) || null;
  const bagsFor = (bNum: number): ShippingEntry[] =>
    entries.filter((e) => e.buyerNumber === bNum).sort((a, b) => a.bagNumber - b.bagNumber);
  const encodedCount = groups.filter((g) => { const bs = bagsFor(g.bNum); return bs.length > 0 && bs.every((e) => e.status !== "draft"); }).length;
  const bagCountFor = (bNum: number): number => bagsFor(bNum).length;

  // Open the encode form: saved fields kept; amount/items ALWAYS refreshed from
  // the live group (order sums are source-of-truth). New drafts take the
  // configured default fee — or 0 when the free-shipping auto-rule qualifies.
  const openForm = (g: BuyerGroup) => {
    const saved = entryFor(g.bNum);
    const base = saved ?? { ...draftEntryFor(g, sessionKey, newId()), shippingFee: defaultFeeFor(g.total, settings) };
    setForm({ ...base, includedOrderIds: g.orderIds, orderAmount: g.total });
    setOpenB(g.bNum); setShowErr(false); setNote("");
  };
  // Late orders (P3b): the buyer mined MORE after export — open the SAME encode
  // form on the remainder entry (new/next bag, recipient prefilled from the
  // exported bag). Exported rows stay immutable; this saves a NEW row.
  const openLate = (g: BuyerGroup) => {
    const late = lateFormEntry(g, bagsFor(g.bNum), sessionKey, newId(), defaultFeeFor(g.total, settings));
    if (!late) return;
    setForm(late);
    setOpenB(g.bNum); setShowErr(false); setNote("");
  };
  const closeForm = () => { setOpenB(null); setForm(null); setShowErr(false); };

  const save = async () => {
    if (!form || busy) return;
    if (!entryIsValid(form)) { setShowErr(true); return; }
    setBusy(true);
    const encoded: ShippingEntry = { ...form, status: "encoded" };
    const r = await upsertShippingEntry(encoded);
    setBusy(false);
    if (!r.ok) { setNote(tpl(t.rd_shp_save_failed, { err: r.error || "?" })); return; }
    setEntries((list) => [...list.filter((e) => !(e.buyerNumber === encoded.buyerNumber && e.bagNumber === encoded.bagNumber)), encoded]);
    setSel((old) => new Set([...old, encoded.id]));
    closeForm();
  };

  const errs = form ? validateEntry(form) : null;
  const F = (patch: Partial<ShippingEntry>) => setForm((f) => (f ? { ...f, ...patch } : f));

  // ── P3a split bags — open/prefill, save (upsert N + delete shrunk), remove. ──
  const openSplit = (g: BuyerGroup) => {
    const bags = bagsFor(g.bNum);
    if (bags.length > 1) {
      setNBags(Math.min(bags.length, SPLIT_MAX_BAGS));
      const a: Record<number, number> = {};
      bags.forEach((b) => b.includedOrderIds.forEach((oid) => { a[oid] = b.bagNumber; }));
      setAssign(a);
      setSShared({ recipientName: bags[0].recipientName, phone: bags[0].phone, storeId: bags[0].storeId, tempLayer: bags[0].tempLayer });
      setSFee(bags[0].shippingFee);
    } else {
      const single = bags[0] ?? null;
      setNBags(2);
      setAssign({});
      setSShared({ recipientName: single?.recipientName ?? "", phone: single?.phone ?? "", storeId: single?.storeId ?? "", tempLayer: single?.tempLayer ?? SHIP_TEMP_AMBIENT });
      setSFee(single?.shippingFee ?? defaultFeeFor(g.total, settings));
    }
    setSplitB(g.bNum); setSShowErr(false); setSNote(""); closeForm();
  };
  const closeSplit = () => { setSplitB(null); setSShowErr(false); setSNote(""); };
  const saveSplit = async (g: BuyerGroup) => {
    if (sBusy) return;
    const errsS = validateSplit(g.orderList, assign, nBags, sShared, sFee);
    if (!splitIsValid(errsS)) { setSShowErr(true); return; }
    setSBusy(true);
    try {
      const existing = bagsFor(g.bNum);
      const { bags } = splitSummary(g.orderList, assign, nBags);
      const ids = bags.map((_, i) => existing.find((e) => e.bagNumber === i + 1)?.id ?? newId());
      const rows = buildBagEntries(g, sessionKey, bags, sShared, sFee, ids);
      for (const row of rows) {
        const r = await upsertShippingEntry(row);
        if (!r.ok) { setSNote(tpl(t.rd_shp_save_failed, { err: r.error || "?" })); return; }
      }
      for (const old of existing.filter((e) => e.bagNumber > nBags)) await deleteShippingEntry(old.id);
      setEntries((list) => [...list.filter((e) => e.buyerNumber !== g.bNum), ...rows]);
      setSel((old) => new Set([...old, ...rows.map((r) => r.id)]));
      closeSplit();
    } finally { setSBusy(false); }
  };
  const removeSplit = async (g: BuyerGroup) => {
    if (sBusy || mustSplit(g.total)) return; // >20k must stay split
    setSBusy(true);
    try {
      const bags = bagsFor(g.bNum);
      const first = bags[0];
      if (!first) { closeSplit(); return; }
      const merged: ShippingEntry = { ...first, includedOrderIds: g.orderIds, orderAmount: g.total, productDesc: defaultProductDesc(g.bNum, g.items), status: entryIsValid({ ...first, includedOrderIds: g.orderIds, orderAmount: g.total, productDesc: defaultProductDesc(g.bNum, g.items) }) ? "encoded" : "draft" };
      const r = await upsertShippingEntry(merged);
      if (!r.ok) { setSNote(tpl(t.rd_shp_save_failed, { err: r.error || "?" })); return; }
      for (const old of bags.filter((e) => e.bagNumber > 1)) await deleteShippingEntry(old.id);
      setEntries((list) => [...list.filter((e) => e.buyerNumber !== g.bNum), merged]);
      closeSplit();
    } finally { setSBusy(false); }
  };

  // ── P2 export — RPC first (server-side quota, atomic stamping), THEN the file.
  const encodedEntries = entries.filter((e) => e.status === "encoded").sort((a, b) => a.buyerNumber - b.buyerNumber);
  const quota = quotaForPlan(plan);
  // Encode works everywhere; the FILE needs a browser (or a future APK with
  // Filesystem+Share). Current APK shell → guidance card instead of a dead button.
  const canExportHere = !isAppShell() || hasNativeFileShare();
  const toggleSel = (id: string) => setSel((old) => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doExport = async () => {
    if (exporting) return;
    const chosen = encodedEntries.filter((e) => sel.has(e.id));
    if (chosen.length === 0) return;
    setExNote(null);
    // 賣貨便 importer hard limit: max 500 rows per file (Batch D / audit #6 —
    // SHIP_MAX existed but was never enforced; an oversized file would be built
    // fine here and rejected only by the importer, after quota was spent).
    if (chosen.length > SHIP_MAX) {
      setExNote({ kind: "err", text: tpl(t.rd_shp_max_rows, { max: SHIP_MAX, n: chosen.length }) });
      return;
    }
    // client pre-check (UX only — the RPC re-checks atomically server-side)
    if (quota != null && exportedCount != null && exportedCount + chosen.length > quota) {
      setExNote({ kind: "err", text: tpl(t.rd_shp_quota_block, { used: exportedCount, quota, n: chosen.length }) });
      return;
    }
    setExporting(true);
    try {
      const r = await callExportRpc(chosen.map((e) => e.id));
      if (!r.ok) {
        if (r.error === "quota_exceeded") setExNote({ kind: "err", text: tpl(t.rd_shp_quota_block, { used: r.used ?? 0, quota: r.quota ?? 0, n: r.selected ?? chosen.length }) });
        else if (r.error === "nothing_to_export") {
          // Stale selection (another device already exported these rows — the
          // sql/10 stamped=0 guard). Refresh once so the list matches the DB.
          setExNote({ kind: "err", text: t.rd_shp_none_encoded });
          const rows = await loadShippingEntries(sessionKey);
          setEntries(rows);
          setSel(new Set(rows.filter((e) => e.status === "encoded").map((e) => e.id)));
        } else setExNote({ kind: "err", text: tpl(t.rd_shp_export_failed, { err: r.error || "?" }) });
        return;
      }
      // server has stamped exported — reflect locally regardless of file outcome
      const ids = new Set(chosen.map((e) => e.id));
      const nowIso = new Date().toISOString();
      setEntries((list) => list.map((e) => (ids.has(e.id) ? { ...e, status: "exported" as const, exportBatchId: r.batchId ?? e.exportBatchId, exportedAt: nowIso } : e)));
      setSel(new Set());
      if (r.used != null) setExportedCount(r.used);
      try {
        const bytes = await buildXlsmFromTemplate(await fetchShipTemplate(), chosen.map(entryToXlsRow));
        const file = exportFilename(Date.now());
        const d = await deliverXlsm(bytes, file);
        if (!d.ok) throw new Error(d.error || d.via);
        setExNote({ kind: "ok", text: tpl(t.rd_shp_export_ok, { n: r.count ?? chosen.length, file }) });
      } catch (fileErr) {
        // entries are already exported server-side — say so honestly
        setExNote({ kind: "err", text: tpl(t.rd_shp_dl_failed, { err: fileErr instanceof Error ? fileErr.message : String(fileErr) }) });
      }
    } finally {
      setExporting(false);
    }
  };

  // ── P3b: exported batches (mark-as-shipped). Derived from the already-loaded
  // entries — zero new reads; one RPC per tap. Status stays 'exported'.
  const batches = useMemo(() => {
    const m = new Map<string, { id: string; exportedAt: string; count: number; shipped: boolean }>();
    for (const e of entries) {
      if (e.status !== "exported" || !e.exportBatchId) continue;
      const b = m.get(e.exportBatchId);
      if (b) {
        b.count++;
        b.shipped = b.shipped && !!e.shippedAt;
        if (e.exportedAt && e.exportedAt > b.exportedAt) b.exportedAt = e.exportedAt;
      } else m.set(e.exportBatchId, { id: e.exportBatchId, exportedAt: e.exportedAt ?? "", count: 1, shipped: !!e.shippedAt });
    }
    return [...m.values()].sort((a, b) => (a.exportedAt < b.exportedAt ? 1 : -1));
  }, [entries]);
  const batchDate = (iso: string): string =>
    iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—";
  const doMarkShipped = async (batchId: string, shipped: boolean) => {
    if (markBusy) return;
    setMarkBusy(batchId);
    try {
      const r = await markBatchShipped(batchId, shipped);
      if (r.ok) {
        const nowIso = new Date().toISOString();
        setEntries((list) => list.map((e) => (e.exportBatchId === batchId && e.status === "exported" ? { ...e, shippedAt: shipped ? nowIso : null } : e)));
      }
    } finally { setMarkBusy(null); }
  };

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_sh_shipping}</div>
          <span style={{ fontSize: 11.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "5px 10px", borderRadius: 8 }}>
            {tpl(t.rd_shp_encoded_of, { done: encodedCount, total: groups.length })}
          </span>
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 6 }}>
          {t.rd_shp_sub} · {windowDays > 1 ? tpl(t.rd_shp_window_nd, { n: windowDays }) : t.rd_shp_window_today}
        </div>
      </div>

      <div style={{ padding: "14px 14px 22px" }}>
        {/* P3b shipping defaults — DB-backed (cross-device): default fee presets +
            the free-shipping auto-rule threshold. Applies to NEW entries;
            per-entry edit stays. */}
        <div style={{ ...card, padding: "10px 13px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", flexShrink: 0 }}>{t.rd_shp_default_fee}</span>
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              {[38, 60, 100, 0].map((v) => (
                <button key={v} onClick={() => pickDefaultFee(v)} style={{ minWidth: 44, padding: "6px 0", borderRadius: 8, fontFamily: mono, fontSize: 12, fontWeight: 700, cursor: "pointer", border: settings.defaultFee === v ? "1.4px solid var(--accent)" : "1px solid var(--border-strong)", background: settings.defaultFee === v ? "var(--accent-soft)" : "var(--surface-2)", color: settings.defaultFee === v ? "var(--accent-fg)" : "var(--text-dim)" }}>
                  {v === 0 ? t.rd_shp_free : `$${v}`}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", flexShrink: 0 }}>{t.rd_shp_free_rule}</span>
            <div style={{ display: "flex", gap: 6, marginLeft: "auto", alignItems: "center" }}>
              <button onClick={() => { setThrDraft(""); applySettings({ freeThreshold: null }); }} style={{ minWidth: 44, padding: "6px 8px", borderRadius: 8, fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: settings.freeThreshold == null ? "1.4px solid var(--accent)" : "1px solid var(--border-strong)", background: settings.freeThreshold == null ? "var(--accent-soft)" : "var(--surface-2)", color: settings.freeThreshold == null ? "var(--accent-fg)" : "var(--text-dim)" }}>
                {t.rd_shp_off}
              </button>
              <input
                value={thrDraft}
                onChange={(e) => setThrDraft(e.target.value.replace(/[^\d]/g, ""))}
                onBlur={() => {
                  const v = clampThreshold(thrDraft);
                  setThrDraft(v != null ? String(v) : "");
                  if (v !== settings.freeThreshold) applySettings({ freeThreshold: v });
                }}
                inputMode="numeric" placeholder="≥ 1000"
                style={{ ...input, width: 88, padding: "6px 9px", fontFamily: mono, fontSize: 12, borderColor: settings.freeThreshold != null ? "var(--accent)" : "var(--border-strong)" }}
              />
            </div>
          </div>
          {settings.freeThreshold != null && (
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.45 }}>{tpl(t.rd_shp_free_rule_hint, { amt: `${cur}${settings.freeThreshold.toLocaleString()}` })}</div>
          )}
        </div>
        {loading && <div style={{ fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", padding: "14px 0" }}>{t.rd_shp_loading}</div>}
        {!loading && groups.length === 0 && (
          <div style={{ ...card, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{t.rd_shp_empty}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {groups.map((g) => {
            const bags = bagsFor(g.bNum);
            const isSplit = bags.length > 1;
            const isOpen = openB === g.bNum && form;
            const isSplitOpen = splitB === g.bNum;
            const done = bags.length > 0 && bags.every((e) => e.status !== "draft");
            const isExported = bags.some((e) => e.status === "exported"); // immutable — no re-edit
            const needsSplit = mustSplit(g.total) && !isSplit;
            // P3b: shipped = every exported bag carries the mark-as-shipped stamp;
            // lateN = orders mined AFTER export (not covered by any exported bag).
            const isShipped = isExported && bags.filter((e) => e.status === "exported").every((e) => e.shippedAt);
            const lateN = isExported ? lateOrdersFor(g, bags).length : 0;
            return (
              <div key={g.bNum} style={{ ...card, padding: "12px 14px" }}>
                {/* Group row — mirrors the physical bag: Buyer # is the anchor */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, color: "var(--accent-fg)", flexShrink: 0 }}>#{g.bNum}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.handle ? `@${g.handle}` : g.name || `#${g.bNum}`}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{tpl(t.rd_shp_items, { n: g.items })} · {cur}{g.total.toLocaleString()}</div>
                  </div>
                  {isExported ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: isShipped ? "var(--ok)" : "var(--accent-fg)", background: isShipped ? "rgba(16,185,129,.12)" : "var(--accent-soft)", padding: "6px 11px", borderRadius: 8, flexShrink: 0 }}>
                      ✓ {isShipped ? t.rd_shp_shipped : t.rd_shp_exported}{isSplit ? ` · ${tpl(t.rd_shp_bags_n, { n: bags.length })}` : ""}
                    </span>
                  ) : needsSplit ? (
                    <button onClick={() => (isSplitOpen ? closeSplit() : openSplit(g))} style={{ fontSize: 11.5, fontWeight: 700, color: "#fff", background: "var(--danger)", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
                      {t.rd_shp_split}
                    </button>
                  ) : isSplit ? (
                    <button onClick={() => (isSplitOpen ? closeSplit() : openSplit(g))} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: "var(--ok)", background: "rgba(16,185,129,.12)", border: "1px solid rgba(16,185,129,.35)", padding: "6px 11px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
                      ✓ {t.rd_shp_encoded} · {tpl(t.rd_shp_bags_n, { n: bags.length })}
                    </button>
                  ) : done ? (
                    <button onClick={() => (isOpen ? closeForm() : openForm(g))} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: "var(--ok)", background: "rgba(16,185,129,.12)", border: "1px solid rgba(16,185,129,.35)", padding: "6px 11px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
                      ✓ {t.rd_shp_encoded}
                    </button>
                  ) : (
                    <button onClick={() => (isOpen ? closeForm() : openForm(g))} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
                      {t.rd_shp_add_info}
                    </button>
                  )}
                </div>

                {/* Mandatory split banner (> NT$20,000 can never ship as one row) */}
                {needsSplit && (
                  <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--danger)", lineHeight: 1.45 }}>{t.rd_shp_split_must}</div>
                )}
                {/* Optional split entry point (2+ items, not exported, not yet split) */}
                {!isExported && !isSplit && !needsSplit && g.items >= 2 && !isSplitOpen && (
                  <button onClick={() => openSplit(g)} style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", background: "transparent", border: "none", padding: 0, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_shp_split} ›</button>
                )}
                {/* P3b late orders: mined AFTER export → encode the remainder as a
                    NEW bag (exported rows stay immutable). Chip stays until the
                    remainder itself is exported (re-tap = re-edit). */}
                {lateN > 0 && !isOpen && (
                  <button onClick={() => openLate(g)} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: "var(--warn, #b45309)", background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.4)", padding: "6px 11px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                    + {tpl(t.rd_shp_late_chip, { n: lateN })} ›
                  </button>
                )}

                {/* ── Split editor: N bags, item assignment, shared recipient ── */}
                {isSplitOpen && (() => {
                  const sum = splitSummary(g.orderList, assign, nBags);
                  const errsS = validateSplit(g.orderList, assign, nBags, sShared, sFee);
                  const maxBags = Math.min(SPLIT_MAX_BAGS, Math.max(2, g.items));
                  return (
                    <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div>
                        <label style={lbl}>{t.rd_shp_split_bags_lbl}</label>
                        <div style={{ display: "flex", gap: 6 }}>
                          {Array.from({ length: maxBags - 1 }, (_, i) => i + 2).map((n) => (
                            <button key={n} onClick={() => { setNBags(n); setAssign((a) => { const c: Record<number, number> = {}; for (const [k, v] of Object.entries(a)) if (v <= n) c[Number(k)] = v; return c; }); }} style={{ minWidth: 40, padding: "7px 0", borderRadius: 8, fontFamily: mono, fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: nBags === n ? "1.4px solid var(--accent)" : "1px solid var(--border-strong)", background: nBags === n ? "var(--accent-soft)" : "var(--surface-2)", color: nBags === n ? "var(--accent-fg)" : "var(--text-dim)" }}>{n}</button>
                          ))}
                        </div>
                      </div>
                      {/* item → bag assignment */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {g.orderList.map((o) => (
                          <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.item || "—"}</span>
                            <span style={{ fontFamily: mono, fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", flexShrink: 0 }}>{cur}{o.total.toLocaleString()}</span>
                            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                              {Array.from({ length: nBags }, (_, i) => i + 1).map((b) => (
                                <button key={b} onClick={() => setAssign((a) => ({ ...a, [o.id]: b }))} style={{ width: 26, height: 24, borderRadius: 6, fontFamily: mono, fontSize: 11, fontWeight: 700, cursor: "pointer", border: assign[o.id] === b ? "1.4px solid var(--accent)" : "1px solid var(--border-strong)", background: assign[o.id] === b ? "var(--accent-soft)" : "var(--surface-2)", color: assign[o.id] === b ? "var(--accent-fg)" : "var(--text-dim)" }}>{b}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* per-bag summary + validation */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {sum.bags.map((b, i) => {
                          const amtErr = errsS.bagAmounts.find((x) => x.bag === i + 1)?.err ?? "";
                          const empty = errsS.emptyBags.includes(i + 1);
                          const bad = sShowErr && (amtErr || empty);
                          return (
                            <div key={i} style={{ fontSize: 11.5, fontWeight: 600, color: bad ? "var(--danger)" : "var(--text-muted)" }}>
                              {tpl(t.rd_shp_bag_sum, { i: i + 1, n: nBags, k: b.items, amt: `${cur}${b.amount.toLocaleString()}`, fee: `${cur}${sFee}` })}
                              {sShowErr && empty ? ` — ${tpl(t.rd_shp_split_empty, { i: i + 1 })}` : sShowErr && amtErr ? ` — ${amountErrText(t, amtErr)}` : ""}
                            </div>
                          );
                        })}
                        {sShowErr && sum.unassigned > 0 && <div style={{ ...errTxt, marginTop: 2 }}>{tpl(t.rd_shp_split_unassigned, { n: sum.unassigned })}</div>}
                      </div>
                      {/* shared recipient (copied to every bag) */}
                      <div>
                        <label style={lbl}>{t.rd_shp_name}</label>
                        <input value={sShared.recipientName} onChange={(e) => setSShared((x) => ({ ...x, recipientName: e.target.value }))} placeholder={t.rd_shp_name_ph} style={input} />
                        {sShowErr && errsS.name && <div style={errTxt}>{nameErrText(t, errsS.name)}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 9 }}>
                        <div style={{ flex: 1.2, minWidth: 0 }}>
                          <label style={lbl}>{t.rd_shp_phone}</label>
                          <input value={sShared.phone} onChange={(e) => setSShared((x) => ({ ...x, phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) }))} inputMode="numeric" placeholder="09xxxxxxxx" style={{ ...input, fontFamily: mono }} />
                          {sShowErr && errsS.phone && <div style={errTxt}>{t.rd_shp_err_phone}</div>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <label style={lbl}>{t.rd_shp_store}</label>
                          <input value={sShared.storeId} onChange={(e) => setSShared((x) => ({ ...x, storeId: e.target.value.replace(/[^\d]/g, "").slice(0, 6) }))} inputMode="numeric" placeholder="123456" style={{ ...input, fontFamily: mono }} />
                          {sShowErr && errsS.store && <div style={errTxt}>{t.rd_shp_err_store}</div>}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <label style={lbl}>{t.rd_shp_temp}</label>
                          <div style={{ display: "flex", gap: 7 }}>
                            {([SHIP_TEMP_AMBIENT, SHIP_TEMP_FROZEN] as const).map((tl) => (
                              <button key={tl} onClick={() => setSShared((x) => ({ ...x, tempLayer: tl }))} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: sShared.tempLayer === tl ? "1.4px solid var(--accent)" : "1px solid var(--border-strong)", background: sShared.tempLayer === tl ? "var(--accent-soft)" : "var(--surface-2)", color: sShared.tempLayer === tl ? "var(--accent-fg)" : "var(--text-dim)" }}>{tl}</button>
                            ))}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <label style={lbl}>{t.rd_shp_fee}</label>
                          <input value={String(sFee)} onChange={(e) => setSFee(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} inputMode="numeric" style={{ ...input, fontFamily: mono }} />
                        </div>
                      </div>
                      {sNote && <div style={errTxt}>{sNote}</div>}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => void saveSplit(g)} disabled={sBusy} style={{ flex: 1, padding: "11px 0", border: "none", borderRadius: 10, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: sBusy ? 0.6 : 1 }}>{sBusy ? "…" : tpl(t.rd_shp_split_save, { n: nBags })}</button>
                        {isSplit && !mustSplit(g.total) && (
                          <button onClick={() => void removeSplit(g)} disabled={sBusy} style={{ padding: "11px 12px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--danger)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{t.rd_shp_split_remove}</button>
                        )}
                        <button onClick={closeSplit} style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t.rd_shp_cancel}</button>
                      </div>
                    </div>
                  );
                })()}

                {/* Encode form — live 賣貨便 validation; save blocked until clean */}
                {isOpen && form && errs && (
                  <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={lbl}>{t.rd_shp_name}</label>
                      <input value={form.recipientName} onChange={(e) => F({ recipientName: e.target.value })} placeholder={t.rd_shp_name_ph} style={input} />
                      {showErr && errs.name && <div style={errTxt}>{nameErrText(t, errs.name)}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 9 }}>
                      <div style={{ flex: 1.2, minWidth: 0 }}>
                        <label style={lbl}>{t.rd_shp_phone}</label>
                        <input value={form.phone} onChange={(e) => F({ phone: e.target.value.replace(/[^\d]/g, "").slice(0, 10) })} inputMode="numeric" placeholder="09xxxxxxxx" style={{ ...input, fontFamily: mono }} />
                        {showErr && errs.phone && <div style={errTxt}>{t.rd_shp_err_phone}</div>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={lbl}>{t.rd_shp_store}</label>
                        <input value={form.storeId} onChange={(e) => F({ storeId: e.target.value.replace(/[^\d]/g, "").slice(0, 6) })} inputMode="numeric" placeholder="123456" style={{ ...input, fontFamily: mono }} />
                        {showErr && errs.store && <div style={errTxt}>{t.rd_shp_err_store}</div>}
                      </div>
                    </div>
                    <a href={STORE_LOOKUP_URL} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: "var(--accent-fg)", textDecoration: "none" }}>{t.rd_shp_store_lookup} ↗</a>
                    <div>
                      <label style={lbl}>{t.rd_shp_temp}</label>
                      <div style={{ display: "flex", gap: 7 }}>
                        {([SHIP_TEMP_AMBIENT, SHIP_TEMP_FROZEN] as const).map((tl) => (
                          <button key={tl} onClick={() => F({ tempLayer: tl })} style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: form.tempLayer === tl ? "1.4px solid var(--accent)" : "1px solid var(--border-strong)", background: form.tempLayer === tl ? "var(--accent-soft)" : "var(--surface-2)", color: form.tempLayer === tl ? "var(--accent-fg)" : "var(--text-dim)" }}>{tl}</button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={lbl}>{t.rd_shp_desc} ({form.productDesc.length}/{SHIP_MAX_DESC})</label>
                      <textarea value={form.productDesc} onChange={(e) => F({ productDesc: e.target.value })} rows={2} style={{ ...input, resize: "vertical" }} />
                      {showErr && errs.desc && <div style={errTxt}>{t.rd_shp_err_desc}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={lbl}>{t.rd_shp_amount}</label>
                        <div style={{ ...input, fontFamily: mono, background: "var(--surface)", color: "var(--text-muted)" }}>{cur}{form.orderAmount.toLocaleString()}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={lbl}>{t.rd_shp_fee}</label>
                        <input value={String(form.shippingFee)} onChange={(e) => F({ shippingFee: Number(e.target.value.replace(/[^\d]/g, "")) || 0 })} inputMode="numeric" style={{ ...input, fontFamily: mono }} />
                      </div>
                      <button onClick={() => F({ shippingFee: form.shippingFee === 0 ? settings.defaultFee : 0 })} style={{ flexShrink: 0, padding: "9px 11px", borderRadius: 9, fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: form.shippingFee === 0 ? "1.4px solid var(--ok)" : "1px solid var(--border-strong)", background: form.shippingFee === 0 ? "rgba(16,185,129,.12)" : "var(--surface-2)", color: form.shippingFee === 0 ? "var(--ok)" : "var(--text-dim)" }}>
                        {t.rd_shp_free}
                      </button>
                    </div>
                    {showErr && errs.amounts && <div style={errTxt}>{amountErrText(t, errs.amounts)}</div>}
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{tpl(t.rd_shp_cod, { amt: `${cur}${codTotal(form.orderAmount, form.shippingFee).toLocaleString()}` })}</div>
                    {note && <div style={errTxt}>{note}</div>}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => void save()} disabled={busy} style={{ flex: 1, padding: "11px 0", border: "none", borderRadius: 10, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>{busy ? "…" : t.rd_shp_save}</button>
                      <button onClick={closeForm} style={{ padding: "11px 16px", borderRadius: 10, border: "1px solid var(--border-strong)", background: "var(--surface-2)", color: "var(--text-dim)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t.rd_shp_cancel}</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── P2: Ready to export — meter + selection + RPC-then-file ── */}
        {!loading && groups.length > 0 && (
          <div style={{ ...card, marginTop: 14, padding: "13px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
              <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text)", flex: 1 }}>{t.rd_shp_ready}</span>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--accent-fg)", background: "var(--accent-soft)", padding: "3px 9px", borderRadius: 99 }}>
                {exportedCount == null ? "…" : quota == null ? tpl(t.rd_shp_meter_unl, { used: exportedCount }) : tpl(t.rd_shp_meter, { used: exportedCount, quota })}
              </span>
            </div>
            {!canExportHere ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55, background: "var(--surface-2)", border: "1px dashed var(--border-strong)", borderRadius: 11, padding: "11px 12px" }}>
                {t.rd_shp_export_browser}
              </div>
            ) : encodedEntries.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_shp_none_encoded}</div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 11 }}>
                  {encodedEntries.map((e) => (
                    <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--text)", cursor: "pointer" }}>
                      <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggleSel(e.id)} style={{ accentColor: "var(--accent)", width: 15, height: 15 }} />
                      <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--accent-fg)", flexShrink: 0 }}>#{e.buyerNumber}{bagCountFor(e.buyerNumber) > 1 ? ` · ${tpl(t.rd_shp_bag_chip, { i: e.bagNumber, n: bagCountFor(e.buyerNumber) })}` : ""}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{e.recipientName} · 7-11 {e.storeId}</span>
                      <span style={{ fontFamily: mono, fontWeight: 700, flexShrink: 0 }}>{cur}{codTotal(e.orderAmount, e.shippingFee).toLocaleString()}</span>
                    </label>
                  ))}
                </div>
                <button onClick={() => void doExport()} disabled={exporting || sel.size === 0} style={{ width: "100%", padding: "12px 0", border: "none", borderRadius: 11, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", opacity: exporting || sel.size === 0 ? 0.55 : 1 }}>
                  {exporting ? "…" : tpl(t.rd_shp_export, { n: sel.size })}
                </button>
              </>
            )}
            {exNote && (
              <div style={{ marginTop: 9, fontSize: 12, fontWeight: 600, lineHeight: 1.5, color: exNote.kind === "ok" ? "var(--ok)" : "var(--danger)" }}>
                {exNote.text}
                {exNote.kind === "err" && onUpgrade && quota != null && exNote.text.includes(String(quota)) && (
                  <button onClick={onUpgrade} style={{ display: "block", marginTop: 7, fontSize: 11.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_shp_upgrade}</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── P3b: exported batches — one-tap mark-as-shipped (optional/manual;
            status stays 'exported', quota untouched; tap again to undo) ── */}
        {batches.length > 0 && (
          <div style={{ ...card, marginTop: 14, padding: "13px 14px" }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 14, color: "var(--text)", marginBottom: 9 }}>{t.rd_shp_batches}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {batches.map((b) => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    📦 {batchDate(b.exportedAt)} · {tpl(t.rd_shp_bags_n, { n: b.count })}
                  </span>
                  <button onClick={() => void doMarkShipped(b.id, !b.shipped)} disabled={markBusy === b.id} style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "6px 11px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", opacity: markBusy === b.id ? 0.6 : 1, border: b.shipped ? "1px solid rgba(16,185,129,.35)" : "none", background: b.shipped ? "rgba(16,185,129,.12)" : "var(--accent)", color: b.shipped ? "var(--ok)" : "var(--accent-text)" }}>
                    {markBusy === b.id ? "…" : b.shipped ? `✓ ${t.rd_shp_shipped}` : t.rd_shp_mark_shipped}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
