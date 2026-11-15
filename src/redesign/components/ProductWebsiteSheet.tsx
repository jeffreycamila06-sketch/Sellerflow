// Seller Website Part 1 — a product's website details + Shopee-style variants. A SEPARATE sheet from
// the add/edit form (that form is unchanged): category, description, show on website, photos 2..8,
// up to 2 option groups and one row per combination (code / stock / own price / photo).
// Saving returns a plan (productVariants.planVariants); the Products screen writes it.
import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { Product, VariantGroup } from "../adapters/products";
import { cleanGroups, combos, comboKey, editorRows, planVariants, childrenOf, MAX_GROUPS, type VariantPlan, type VariantRow } from "../adapters/productVariants";
import { freePhotoNumber, uploadExtraPhoto, removeExtraPhoto } from "../adapters/websitePhotos";
import { productImageUrl } from "../adapters/productImages";
import { useT, tpl } from "../i18n";

const lbl: CSSProperties = { fontSize: 11.5, fontWeight: 700, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 42, padding: "9px 11px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 16, outline: "none" };
const small: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.45 };
const btn: CSSProperties = { minHeight: 40, padding: "8px 12px", border: "1px solid var(--border-strong)", borderRadius: 10, background: "var(--surface)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const primary: CSSProperties = { ...btn, border: "none", background: "var(--accent)", color: "var(--accent-text)" };

export interface ProductWebsiteSheetProps {
  product: Product;
  all: Product[];
  photo1Url?: string;        // the product's photo 1 (image_path), when product pictures are on
  cur: string;
  onSave: (plan: VariantPlan) => void;
  onClose: () => void;
  nextId?: () => number;
}

export default function ProductWebsiteSheet({ product, all, photo1Url, cur, onSave, onClose, nextId }: ProductWebsiteSheetProps) {
  const t = useT();
  const [show, setShow] = useState(product.showOnWebsite !== false);
  const [category, setCategory] = useState(product.category || "");
  const [description, setDescription] = useState(product.description || "");
  const [photos, setPhotos] = useState<string[]>(product.photoPaths || []);
  const [busy, setBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState("");
  const [groups, setGroups] = useState<VariantGroup[]>(product.variant?.groups?.length ? product.variant.groups : []);
  const [valueText, setValueText] = useState<string[]>(() => (product.variant?.groups || []).map((g) => g.values.join(", ")));
  const children = useMemo(() => childrenOf(all, product.id), [all, product.id]);
  const [rows, setRows] = useState<VariantRow[]>(() => editorRows(product, product.variant?.groups || [], children));
  const [errors, setErrors] = useState<VariantPlan["errors"]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const idSeq = useRef(0);
  const categories = useMemo(() => [...new Set(all.map((p) => (p.category || "").trim()).filter(Boolean))].sort(), [all]);

  // groups changed → rebuild the rows, keeping what the seller typed for combinations that remain
  const applyGroups = (gs: VariantGroup[]) => {
    setGroups(gs);
    const clean = cleanGroups(gs);
    const typed = new Map(rows.map((r) => [comboKey(r.values), r]));
    const base = editorRows(product, clean, children);
    setRows(base.map((r) => typed.get(comboKey(r.values)) || r));
  };
  const setGroup = (i: number, patch: Partial<VariantGroup>, text?: string) => {
    const next = groups.map((g, k) => (k === i ? { ...g, ...patch } : g));
    if (text !== undefined) setValueText((v) => v.map((x, k) => (k === i ? text : x)));
    applyGroups(next);
  };
  const addGroup = () => { if (groups.length >= MAX_GROUPS) return; setValueText((v) => [...v, ""]); applyGroups([...groups, { name: "", values: [] }]); };
  const removeGroup = (i: number) => { setValueText((v) => v.filter((_, k) => k !== i)); applyGroups(groups.filter((_, k) => k !== i)); };
  const setRow = (i: number, patch: Partial<VariantRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const rowErr = (i: number) => errors.find((e) => e.index === i);
  const errText = (k: string) => (k === "code_empty" ? t.rd_web_err_code_empty : k === "code_dup" ? t.rd_web_err_code_dup : k === "code_taken" ? t.rd_web_err_code_taken : k === "stock_bad" ? t.rd_web_err_stock : t.rd_web_err_price);

  const addPhoto = async (file: File | undefined) => {
    if (!file || busy) return;
    const n = freePhotoNumber(photos);
    if (n === null) return;
    setBusy(true); setPhotoErr("");
    const r = await uploadExtraPhoto(product.id, n, file);
    setBusy(false);
    if (r.ok === true) { const path = r.path; setPhotos((p) => [...p, path]); }
    else setPhotoErr(r.reason === "too_big" ? t.rd_prd_pic_too_big : r.reason === "unreadable" ? t.rd_prd_pic_unreadable : t.rd_prd_pic_failed);
  };
  const dropPhoto = (path: string) => { setPhotos((p) => p.filter((x) => x !== path)); void removeExtraPhoto(path); };

  const save = () => {
    const base: Product = { ...product, showOnWebsite: show, category: category.trim(), description: description.trim(), photoPaths: photos };
    const plan = planVariants(base, groups, rows, all, nextId || (() => Date.now() + ++idSeq.current));
    setErrors(plan.errors);
    if (plan.errors.length) return;
    onSave(plan);
  };
  const photoOptions = [t.rd_web_photo_none, ...(photo1Url ? ["1"] : []), ...photos.map((_, i) => String(i + 2))];
  const comboCount = combos(groups).length;

  return (
    <div data-testid="pws" role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(8,6,24,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", background: "var(--surface)", borderRadius: "18px 18px 0 0", padding: "16px 16px 22px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: "var(--text)" }}>{t.rd_web_prd_title}</div>
            <div style={{ ...small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{product.name}</div>
          </div>
          <button type="button" aria-label={t.rd_prt_close} onClick={onClose} style={{ ...btn, minWidth: 44 }}>✕</button>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 12 }}>
          <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_web_show}</span><span style={small}>{t.rd_web_show_sub}</span></span>
          <input data-testid="pws-show" type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} style={{ width: 22, height: 22 }} />
        </label>

        <div>
          <label style={lbl} htmlFor="pws-cat">{t.rd_web_category}</label>
          <input id="pws-cat" data-testid="pws-category" list="pws-cats" value={category} maxLength={40} onChange={(e) => setCategory(e.target.value)} placeholder={t.rd_web_category_ph} style={input} />
          <datalist id="pws-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div>
          <label style={lbl} htmlFor="pws-desc">{t.rd_web_description}</label>
          <textarea id="pws-desc" data-testid="pws-description" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} rows={4} style={{ ...input, resize: "vertical" }} />
        </div>

        <div>
          <div style={lbl}>{tpl(t.rd_web_photos, { n: String((photo1Url ? 1 : 0) + photos.length) })}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 8 }}>
            {photo1Url && <div style={{ position: "relative" }}><img src={photo1Url} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }} /><span style={{ position: "absolute", left: 4, top: 4, fontSize: 10, fontWeight: 800, background: "rgba(0,0,0,.55)", color: "#fff", borderRadius: 6, padding: "2px 5px" }}>1</span></div>}
            {photos.map((p, i) => (
              <div key={p} style={{ position: "relative" }}>
                <img src={productImageUrl(p)} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10, border: "1px solid var(--border)" }} />
                <span style={{ position: "absolute", left: 4, top: 4, fontSize: 10, fontWeight: 800, background: "rgba(0,0,0,.55)", color: "#fff", borderRadius: 6, padding: "2px 5px" }}>{i + 2}</span>
                <button type="button" aria-label={t.rd_web_photo_remove} onClick={() => dropPhoto(p)} style={{ position: "absolute", right: 2, top: 2, width: 28, height: 28, borderRadius: 14, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", cursor: "pointer" }}>✕</button>
              </div>
            ))}
            {freePhotoNumber(photos) !== null && (
              <button type="button" data-testid="pws-add-photo" disabled={busy} onClick={() => fileRef.current?.click()} style={{ ...btn, aspectRatio: "1", height: "auto", borderStyle: "dashed" }}>{busy ? "…" : "+"}</button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { void addPhoto(e.target.files?.[0]); e.target.value = ""; }} />
          {!photo1Url && <div style={{ ...small, marginTop: 6 }}>{t.rd_web_photo1_hint}</div>}
          {photoErr && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)", marginTop: 6 }}>{photoErr}</div>}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)" }}>{t.rd_web_variants}</div>
          <div style={small}>{t.rd_web_variants_sub}</div>
          {groups.map((g, i) => (
            <div key={i} data-testid="pws-group" style={{ marginTop: 10, padding: 10, border: "1px solid var(--border)", borderRadius: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input data-testid="pws-group-name" aria-label={t.rd_web_group_name} value={g.name} maxLength={20} placeholder={i === 0 ? t.rd_web_group_ph1 : t.rd_web_group_ph2} onChange={(e) => setGroup(i, { name: e.target.value })} style={input} />
                <button type="button" aria-label={t.rd_web_group_remove} onClick={() => removeGroup(i)} style={{ ...btn, minWidth: 44 }}>✕</button>
              </div>
              <input data-testid="pws-group-values" aria-label={t.rd_web_group_values} value={valueText[i] ?? ""} placeholder={i === 0 ? "S, M, L" : "Pink, Blue"}
                onChange={(e) => setGroup(i, { values: e.target.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean) }, e.target.value)} style={input} />
            </div>
          ))}
          {groups.length < MAX_GROUPS && <button type="button" data-testid="pws-add-group" onClick={addGroup} style={{ ...btn, marginTop: 10, width: "100%" }}>+ {t.rd_web_group_add}</button>}
          {comboCount > 0 && (
            <div data-testid="pws-rows" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={small}>{tpl(t.rd_web_rows_hint, { n: String(comboCount) })}</div>
              {rows.map((r, i) => {
                const e = rowErr(i);
                return (
                  <div key={comboKey(r.values)} data-testid="pws-row" style={{ padding: 10, border: `1px solid ${e ? "var(--danger)" : "var(--border)"}`, borderRadius: 12, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                    <div style={{ gridColumn: "1 / -1", fontSize: 13, fontWeight: 800, color: "var(--text)" }}>{r.values.join(" · ")}</div>
                    <label style={{ ...small, display: "flex", flexDirection: "column", gap: 3, gridColumn: "1 / -1" }}>{t.rd_web_row_code}
                      <input data-testid="pws-row-code" value={r.code} maxLength={40} onChange={(ev) => setRow(i, { code: ev.target.value })} style={{ ...input, fontFamily: "var(--font-mono)" }} />
                    </label>
                    <label style={{ ...small, display: "flex", flexDirection: "column", gap: 3 }}>{t.rd_web_row_stock}
                      <input data-testid="pws-row-stock" inputMode="numeric" value={String(r.stock)} onChange={(ev) => setRow(i, { stock: parseInt(ev.target.value.replace(/\D/g, "") || "0", 10) })} style={input} />
                    </label>
                    <label style={{ ...small, display: "flex", flexDirection: "column", gap: 3 }}>{tpl(t.rd_web_row_price, { cur })}
                      <input data-testid="pws-row-price" inputMode="decimal" value={r.price === null ? "" : String(r.price)} placeholder={String(product.price)} onChange={(ev) => setRow(i, { price: ev.target.value.trim() === "" ? null : Number(ev.target.value) })} style={input} />
                    </label>
                    <label style={{ ...small, display: "flex", flexDirection: "column", gap: 3, gridColumn: "1 / -1" }}>{t.rd_web_row_photo}
                      <select data-testid="pws-row-photo" value={r.photo === null ? "" : String(r.photo + 1)} onChange={(ev) => setRow(i, { photo: ev.target.value ? Number(ev.target.value) - 1 : null })} style={input}>
                        {photoOptions.map((o, k) => <option key={o} value={k === 0 ? "" : o}>{o}</option>)}
                      </select>
                    </label>
                    {e && <div data-testid="pws-row-err" style={{ gridColumn: "1 / -1", fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>{errText(e.kind)}</div>}
                  </div>
                );
              })}
              {(product.liveCode || "").trim() && <div data-testid="pws-parent-hint" style={{ ...small, padding: "8px 10px", background: "var(--warn-soft)", borderRadius: 10, color: "var(--text)" }}>{tpl(t.rd_web_parent_hint, { code: product.liveCode || "" })}</div>}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, position: "sticky", bottom: 0, background: "var(--surface)", paddingTop: 8 }}>
          <button type="button" onClick={onClose} style={{ ...btn, flex: 1, minHeight: 46 }}>{t.rd_prt_cancel}</button>
          <button type="button" data-testid="pws-save" onClick={save} style={{ ...primary, flex: 2, minHeight: 46 }}>{t.rd_prt_save}</button>
        </div>
      </div>
    </div>
  );
}
