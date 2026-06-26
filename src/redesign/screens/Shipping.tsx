// Screen 13 — Shipping. REAL manual shipment manager, ported from App.tsx Shipping
// (1508-1754): reads the SAME localStorage (sf_shipments / sf_shipping_customer_data
// per seller), groups orders into a daily-numbered shipment per buyer, edit/delete,
// 7-ELEVEN MyShip xlsx export → auto-closes (marks shipped). NOT courier tracking —
// production has none. Admin-only (gated by the caller, like App.tsx).
import { useState, type CSSProperties } from "react";
import { headerBar, headerTitle, card, mono } from "../ui";
import {
  loadShipments, saveShipments, loadShippingCustomers, today as shipToday,
  applyAddOrder, applyDeleteOrder, applyEditPrice, applyUpdateFee, applyMarkShipped,
  buildMyShipRows, shipmentSubtotal, shipmentGrandTotal, findOpenShipment, nextDailyNum, isNumericPrice,
  SHIP_MAX, MYSHIP_HEADERS, type Shipment, type ShippingCustomer,
} from "../adapters/shipping";

const input: CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, outline: "none" };
const lbl: CSSProperties = { fontSize: 11, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 4 };
const rid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function Shipping({ email = "", cur }: { email?: string; cur: string }) {
  const day = shipToday();
  const [shipments, setShipments] = useState<Shipment[]>(() => loadShipments(email));
  const [customers] = useState<ShippingCustomer[]>(() => loadShippingCustomers(email));
  const [sel, setSel] = useState("");
  const [product, setProduct] = useState("CLOTHING");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<{ shipmentId: string; orderId: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const persist = (next: Shipment[]) => { setShipments(next); saveShipments(email, next); };
  const todayShipments = shipments.filter((s) => s.dayId === day);
  const openToday = todayShipments.filter((s) => s.status === "open");
  const shippedToday = todayShipments.filter((s) => s.status === "shipped");
  const selected = customers.find((c) => c.username === sel) || null;
  const existingForSelected = selected ? findOpenShipment(shipments, selected.username, day) : null;
  const sorted = [...todayShipments].sort((a, b) => a.num - b.num);

  function addOrder(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setMsg("");
    if (!selected) { setErr("Select a registered customer first."); return; }
    const pr = product.trim(), pc = price.trim();
    if (!pr) { setErr("Product is required."); return; }
    if (!isNumericPrice(pc)) { setErr("Enter a valid price."); return; }
    if (!existingForSelected && openToday.length >= SHIP_MAX) { setErr(`Daily shipment limit reached (${SHIP_MAX}).`); return; }
    const r = applyAddOrder(shipments, selected, pr, pc, day, { shipment: rid(), order: rid() }, new Date().toISOString());
    persist(r.next);
    setMsg(r.existing ? `Added to existing #${r.num} ${selected.name}.` : `Created new #${r.num} ${selected.name}.`);
    setSel(""); setPrice("");
  }
  function deleteOrder(shipmentId: string, orderId: string) {
    if (!window.confirm("Remove this order?")) return;
    persist(applyDeleteOrder(shipments, shipmentId, orderId)); setMsg(""); setErr("");
  }
  function saveEdit() {
    if (!editing) return;
    const v = editing.value.trim();
    if (!isNumericPrice(v)) { setErr("Enter a valid price."); return; }
    persist(applyEditPrice(shipments, editing.shipmentId, editing.orderId, v));
    setEditing(null); setMsg("Amount updated."); setErr("");
  }
  function updateFee(shipmentId: string, fee: string) { persist(applyUpdateFee(shipments, shipmentId, fee)); }

  async function exportXlsx() {
    setErr(""); setMsg("");
    if (!openToday.length) { setErr("No open shipments to export."); return; }
    if (openToday.some((s) => !s.name.trim())) { setErr("A shipment is missing a customer name."); return; }
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const rows = buildMyShipRows(openToday);
      const ws = XLSX.utils.aoa_to_sheet([MYSHIP_HEADERS, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      XLSX.writeFile(wb, `myship-${day}.xlsx`);
      const ids = new Set(openToday.map((s) => s.id));
      persist(applyMarkShipped(shipments, ids));      // auto-close: open → shipped
      setMsg(`Exported ${openToday.length} buyer${openToday.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setErr(`Export failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally { setBusy(false); }
  }

  const stat = (l: string, v: number | string, c?: string) => (
    <div style={{ ...card, padding: "10px 12px", textAlign: "center" }}><div style={{ fontFamily: mono, fontWeight: 700, fontSize: 18, color: c || "var(--text)" }}>{v}</div><div style={{ fontSize: 10.5, color: "var(--text-muted)", fontWeight: 600 }}>{l}</div></div>
  );

  return (
    <div>
      <div style={headerBar}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={headerTitle}>Shipping</div>
          <button onClick={() => void exportXlsx()} disabled={busy || openToday.length === 0} style={{ fontSize: 12, fontWeight: 700, background: "rgba(255,255,255,.16)", color: "var(--on-header)", border: "none", padding: "7px 12px", borderRadius: 9, cursor: busy || !openToday.length ? "default" : "pointer", opacity: busy || !openToday.length ? 0.55 : 1, fontFamily: "var(--font-ui)" }}>⬇ Export 7-11</button>
        </div>
        <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 6 }}>Today's shipments · 7-ELEVEN MyShip export</div>
      </div>

      <div style={{ padding: "14px 14px 22px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          {stat("Open", openToday.length, "var(--accent-fg)")}
          {stat("Shipped", shippedToday.length, "var(--ok)")}
          {stat("Next #", nextDailyNum(shipments, day))}
          {stat("Remaining", SHIP_MAX - openToday.length, openToday.length >= SHIP_MAX ? "var(--danger)" : "var(--text)")}
        </div>

        {customers.length === 0 ? (
          <div style={{ ...card, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>No registered customers yet. Customers with a name, phone and 6-digit 7-ELEVEN store code appear here for shipping.</div>
        ) : (
          <form onSubmit={addOrder} style={{ ...card, display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
            <div><label style={lbl}>Customer</label>
              <select value={sel} onChange={(e) => { setSel(e.target.value); setErr(""); }} style={input}>
                <option value="">Select customer…</option>
                {customers.map((c) => <option key={c.username} value={c.username}>{c.name} · {c.phone} · {c.sevenCode}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <div style={{ flex: 2, minWidth: 0 }}><label style={lbl}>Product</label><input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="CLOTHING" style={input} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><label style={lbl}>Amount ({cur})</label><input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" style={{ ...input, fontFamily: mono }} /></div>
            </div>
            {selected && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{existingForSelected ? `Will add to open shipment #${existingForSelected.num}.` : "Will create a new shipment."}</div>}
            <button type="submit" style={{ padding: "11px 0", border: "none", borderRadius: 10, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Add order</button>
          </form>
        )}

        {err && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--danger)", marginBottom: 10 }}>{err}</div>}
        {msg && <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ok)", marginBottom: 10 }}>{msg}</div>}

        {sorted.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "16px 0" }}>No shipments yet today.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          {sorted.map((s) => (
            <div key={s.id} style={{ ...card, padding: "12px 14px", opacity: s.status === "shipped" ? 0.6 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontFamily: mono, fontSize: 17, fontWeight: 700, color: "var(--accent-fg)" }}>#{s.num}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{s.name}</div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.phone} · 7-11 {s.store}</div></div>
                {s.status === "shipped" && <span style={{ fontSize: 10, fontWeight: 800, color: "var(--ok)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "3px 8px", borderRadius: 6 }}>SHIPPED</span>}
                <div style={{ fontFamily: mono, fontSize: 14, fontWeight: 700, color: "var(--ok)" }}>{cur}{shipmentGrandTotal(s).toLocaleString()}</div>
              </div>
              <div style={{ marginTop: 9, paddingTop: 9, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
                {s.orders.map((o, i) => (
                  <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <span style={{ color: "var(--text-muted)", width: 16 }}>{i + 1}.</span>
                    <span style={{ flex: 1, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.product}</span>
                    {editing && editing.shipmentId === s.id && editing.orderId === o.id ? (
                      <>
                        <input value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value.replace(/[^\d.]/g, "") })} autoFocus style={{ width: 64, padding: "3px 7px", border: "1.3px solid var(--accent)", borderRadius: 7, background: "var(--surface)", color: "var(--text)", fontFamily: mono, fontSize: 12, fontWeight: 700, outline: "none" }} />
                        <button onClick={saveEdit} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}>Save</button>
                        <button onClick={() => setEditing(null)} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-dim)", background: "var(--surface-2)", border: "1px solid var(--border)", padding: "4px 8px", borderRadius: 6, cursor: "pointer" }}>×</button>
                      </>
                    ) : (
                      <>
                        <span style={{ fontFamily: mono, fontWeight: 700, color: "var(--text)" }}>{cur}{(Number(o.price) || 0).toLocaleString()}</span>
                        {s.status === "open" && <>
                          <button onClick={() => setEditing({ shipmentId: s.id, orderId: o.id, value: o.price })} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--accent-fg)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>edit</button>
                          <button onClick={() => deleteOrder(s.id, o.id)} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--danger)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>del</button>
                        </>}
                      </>
                    )}
                  </div>
                ))}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 11.5, color: "var(--text-muted)" }}>
                  <span style={{ flex: 1 }}>Subtotal {cur}{shipmentSubtotal(s).toLocaleString()}</span>
                  <span>Fee {cur}</span>
                  <input value={s.fee} disabled={s.status === "shipped"} onChange={(e) => updateFee(s.id, e.target.value)} style={{ width: 56, padding: "3px 7px", border: "1px solid var(--border-strong)", borderRadius: 7, background: "var(--surface-2)", color: "var(--text)", fontFamily: mono, fontSize: 11.5, fontWeight: 700, outline: "none" }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
