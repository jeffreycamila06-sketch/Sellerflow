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
  SHIP_TEMP_AMBIENT, SHIP_TEMP_FROZEN, SHIP_DEFAULT_FEE, SHIP_MAX_DESC, STORE_LOOKUP_URL,
  type BuyerGroup, type ShippingEntry, type EntryErrors,
} from "../adapters/shipping";
import { loadShippingEntries, upsertShippingEntry } from "../adapters/shippingDb";
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

export default function Shipping({ cur, buyers = [], sessionKey, windowDays = 1 }: {
  cur: string; buyers?: Buyer[]; sessionKey: string; windowDays?: number;
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

  // READ-ON-LOAD ONLY — one select for this session window's entries; no poll.
  useEffect(() => {
    let active = true;
    void loadShippingEntries(sessionKey).then((rows) => { if (active) { setEntries(rows); setLoading(false); } });
    return () => { active = false; };
  }, [sessionKey]);

  const entryFor = (bNum: number): ShippingEntry | null =>
    entries.find((e) => e.buyerNumber === bNum && e.bagNumber === 1) || null;
  const encodedCount = groups.filter((g) => { const e = entryFor(g.bNum); return e && e.status !== "draft"; }).length;

  // Open the encode form: saved fields kept; amount/items ALWAYS refreshed from
  // the live group (order sums are source-of-truth; manual splits = P3).
  const openForm = (g: BuyerGroup) => {
    const saved = entryFor(g.bNum);
    const base = saved ?? draftEntryFor(g, sessionKey, newId());
    setForm({ ...base, includedOrderIds: g.orderIds, orderAmount: g.total });
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
    setEntries((list) => [...list.filter((e) => !(e.buyerNumber === encoded.buyerNumber && e.bagNumber === 1)), encoded]);
    closeForm();
  };

  const errs = form ? validateEntry(form) : null;
  const F = (patch: Partial<ShippingEntry>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>{t.rd_sh_shipping}</div>
          <span style={{ fontSize: 11.5, fontWeight: 700, background: "rgba(255,255,255,.16)", padding: "5px 10px", borderRadius: 8 }}>
            {tpl(t.rd_shp_encoded_of, { done: encodedCount, total: groups.length })}
          </span>
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 6 }}>
          {t.rd_shp_sub} · {windowDays > 1 ? tpl(t.rd_shp_window_nd, { n: windowDays }) : t.rd_shp_window_today}
        </div>
      </div>

      <div style={{ padding: "14px 14px 22px" }}>
        {loading && <div style={{ fontSize: 12.5, color: "var(--text-muted)", textAlign: "center", padding: "14px 0" }}>{t.rd_shp_loading}</div>}
        {!loading && groups.length === 0 && (
          <div style={{ ...card, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{t.rd_shp_empty}</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {groups.map((g) => {
            const saved = entryFor(g.bNum);
            const isOpen = openB === g.bNum && form;
            const done = saved && saved.status !== "draft";
            return (
              <div key={g.bNum} style={{ ...card, padding: "12px 14px" }}>
                {/* Group row — mirrors the physical bag: Buyer # is the anchor */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, color: "var(--accent-fg)", flexShrink: 0 }}>#{g.bNum}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.handle ? `@${g.handle}` : g.name || `#${g.bNum}`}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{tpl(t.rd_shp_items, { n: g.items })} · {cur}{g.total.toLocaleString()}</div>
                  </div>
                  {done ? (
                    <button onClick={() => (isOpen ? closeForm() : openForm(g))} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 800, color: "var(--ok)", background: "rgba(16,185,129,.12)", border: "1px solid rgba(16,185,129,.35)", padding: "6px 11px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
                      ✓ {t.rd_shp_encoded}
                    </button>
                  ) : (
                    <button onClick={() => (isOpen ? closeForm() : openForm(g))} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "7px 12px", borderRadius: 8, cursor: "pointer", fontFamily: "var(--font-ui)", flexShrink: 0 }}>
                      {t.rd_shp_add_info}
                    </button>
                  )}
                </div>

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
                      <button onClick={() => F({ shippingFee: form.shippingFee === 0 ? SHIP_DEFAULT_FEE : 0 })} style={{ flexShrink: 0, padding: "9px 11px", borderRadius: 9, fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: form.shippingFee === 0 ? "1.4px solid var(--ok)" : "1px solid var(--border-strong)", background: form.shippingFee === 0 ? "rgba(16,185,129,.12)" : "var(--surface-2)", color: form.shippingFee === 0 ? "var(--ok)" : "var(--text-dim)" }}>
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

        {/* Export (.xlsm) lands in P2 — encoded entries are already persisted. */}
        {!loading && groups.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 14, lineHeight: 1.5 }}>{t.rd_shp_export_soon}</div>
        )}
      </div>
    </div>
  );
}
