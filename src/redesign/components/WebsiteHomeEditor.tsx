// Seller Website v2 — item 1, the editor side: every home page part has an on/off switch, and the
// parts with words or pictures open to edit them (banner slides, trust badges, promo banner, how to
// order steps, FAQ, category pictures). Empty parts hide on the shop by themselves.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { ShopDesign, SectionKey, ShopSlide, ShopFaq } from "../../website/shopApi";
import { productImageUrl } from "../adapters/productImages";

type T = Record<string, string>;
type Kind = "slide" | "promo" | "cat";
/** The home page parts, top to bottom (the preview's order). */
const HOME_SECTIONS: SectionKey[] = ["announcement", "slides", "trust", "categories", "live", "flash", "best", "promo", "newest", "about", "steps", "faq", "policy", "socials"];
const EDITABLE: Partial<Record<SectionKey, true>> = { slides: true, trust: true, categories: true, promo: true, steps: true, faq: true };
const MAX_SLIDES = 5;
const MAX_FAQ = 8;

export default function WebsiteHomeEditor({ draft, set, t, cats, upload, input }: {
  draft: ShopDesign; set: (p: Partial<ShopDesign>) => void; t: T; cats: string[];
  upload: (kind: Kind, f: File) => Promise<string | null>; input: CSSProperties;
}) {
  const [open, setOpen] = useState<SectionKey | null>(null);
  const [busy, setBusy] = useState("");
  const pic = async (key: string, kind: Kind, f: File | undefined, done: (path: string) => void) => {
    if (!f) return;
    setBusy(key);
    const path = await upload(kind, f);
    setBusy("");
    if (path) done(path);
  };
  const slides = draft.slides || [];
  const setSlide = (i: number, p: Partial<ShopSlide>) => set({ slides: slides.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const faq = draft.faq || [];
  const setFaq = (i: number, p: Partial<ShopFaq>) => set({ faq: faq.map((f, k) => (k === i ? { ...f, ...p } : f)) });
  const trust = Array.from({ length: 4 }, (_, i) => draft.trust?.[i] || {});
  const steps = Array.from({ length: 3 }, (_, i) => draft.steps?.[i] || {});
  const catSelect = (value: string | undefined, onChange: (v: string) => void, testid: string) => (
    <select data-testid={testid} value={value || ""} onChange={(e) => onChange(e.target.value)} style={input}>
      <option value="">{t.rd_wed_link_all}</option>
      {cats.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
  const body: Partial<Record<SectionKey, ReactNode>> = {
    slides: (
      <>
        {slides.map((s, i) => (
          <div key={i} data-testid="wed-slide" style={box}>
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 13 }}>{t.rd_wed_slide} {i + 1}
              <button type="button" data-testid={`wed-slide-remove-${i}`} onClick={() => set({ slides: slides.filter((_, k) => k !== i) })} style={link}>{t.rd_wps_ship_remove}</button></div>
            <Pic label={t.rd_wed_slide_pic} path={s.pic} busy={busy === `slide${i}`} t={t} testid={`wed-slide-pic-${i}`} onFile={(f) => void pic(`slide${i}`, "slide", f, (p) => setSlide(i, { pic: p }))} />
            <In label={t.rd_wed_slide_title}><input data-testid={`wed-slide-title-${i}`} value={s.title || ""} maxLength={60} onChange={(e) => setSlide(i, { title: e.target.value })} style={input} /></In>
            <In label={t.rd_wed_slide_text}><input value={s.text || ""} maxLength={140} onChange={(e) => setSlide(i, { text: e.target.value })} style={input} /></In>
            <div style={{ display: "flex", gap: 8 }}>
              <In label={t.rd_wed_button}><input value={s.button || ""} maxLength={24} placeholder={t.rd_home_shop_now} onChange={(e) => setSlide(i, { button: e.target.value })} style={input} /></In>
              <In label={t.rd_wed_link}>{catSelect(s.cat, (v) => setSlide(i, { cat: v || undefined }), `wed-slide-cat-${i}`)}</In>
            </div>
          </div>
        ))}
        {slides.length === 0 && <div style={hint}>{t.rd_wed_slides_auto}</div>}
        {slides.length < MAX_SLIDES && <button type="button" data-testid="wed-slide-add" onClick={() => set({ slides: [...slides, {}] })} style={addBtn}>＋ {t.rd_wed_slide_add}</button>}
      </>
    ),
    trust: (
      <>
        <div style={hint}>{t.rd_wed_trust_hint}</div>
        {trust.map((x, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <In label={`${i + 1}`}><input data-testid={`wed-trust-title-${i}`} value={x.title || ""} maxLength={40} placeholder={t.rd_wed_auto} onChange={(e) => set({ trust: trust.map((y, k) => (k === i ? { ...y, title: e.target.value } : y)) })} style={input} /></In>
            <In label=" "><input value={x.sub || ""} maxLength={60} placeholder={t.rd_wed_auto} onChange={(e) => set({ trust: trust.map((y, k) => (k === i ? { ...y, sub: e.target.value } : y)) })} style={input} /></In>
          </div>
        ))}
      </>
    ),
    categories: cats.length ? (
      <>
        <div style={hint}>{t.rd_wed_cat_hint}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
          {cats.slice(0, 30).map((c) => <Pic key={c} label={c} path={draft.catPics?.[c]} busy={busy === `cat${c}`} t={t} testid={`wed-cat-pic-${c}`} onFile={(f) => void pic(`cat${c}`, "cat", f, (p) => set({ catPics: { ...draft.catPics, [c]: p } }))} />)}
        </div>
      </>
    ) : <div style={hint}>{t.rd_wed_cat_none}</div>,
    promo: (
      <div style={box}>
        <Pic label={t.rd_wed_slide_pic} path={draft.promo?.pic} busy={busy === "promo"} t={t} testid="wed-promo-pic" onFile={(f) => void pic("promo", "promo", f, (p) => set({ promo: { ...draft.promo, pic: p } }))} />
        <In label={t.rd_wed_slide_title}><input data-testid="wed-promo-title" value={draft.promo?.title || ""} maxLength={60} onChange={(e) => set({ promo: { ...draft.promo, title: e.target.value } })} style={input} /></In>
        <In label={t.rd_wed_slide_text}><input value={draft.promo?.text || ""} maxLength={140} onChange={(e) => set({ promo: { ...draft.promo, text: e.target.value } })} style={input} /></In>
        <div style={{ display: "flex", gap: 8 }}>
          <In label={t.rd_wed_button}><input value={draft.promo?.button || ""} maxLength={24} placeholder={t.rd_home_shop_now} onChange={(e) => set({ promo: { ...draft.promo, button: e.target.value } })} style={input} /></In>
          <In label={t.rd_wed_link}>{catSelect(draft.promo?.cat, (v) => set({ promo: { ...draft.promo, cat: v || undefined } }), "wed-promo-cat")}</In>
        </div>
        <div style={hint}>{t.rd_wed_promo_hint}</div>
      </div>
    ),
    steps: (
      <>
        <div style={hint}>{t.rd_wed_trust_hint}</div>
        {steps.map((x, i) => (
          <div key={i} style={box}>
            <In label={`${i + 1}`}><input data-testid={`wed-step-title-${i}`} value={x.title || ""} maxLength={40} placeholder={t.rd_wed_auto} onChange={(e) => set({ steps: steps.map((y, k) => (k === i ? { ...y, title: e.target.value } : y)) })} style={input} /></In>
            <input value={x.text || ""} maxLength={140} placeholder={t.rd_wed_auto} onChange={(e) => set({ steps: steps.map((y, k) => (k === i ? { ...y, text: e.target.value } : y)) })} style={input} />
          </div>
        ))}
      </>
    ),
    faq: (
      <>
        {faq.map((f, i) => (
          <div key={i} data-testid="wed-faq" style={box}>
            <In label={t.rd_wed_faq_q}><input data-testid={`wed-faq-q-${i}`} value={f.q} maxLength={80} onChange={(e) => setFaq(i, { q: e.target.value })} style={input} /></In>
            <In label={t.rd_wed_faq_a}><textarea data-testid={`wed-faq-a-${i}`} value={f.a} maxLength={400} rows={2} onChange={(e) => setFaq(i, { a: e.target.value })} style={{ ...input, resize: "vertical" }} /></In>
            <button type="button" onClick={() => set({ faq: faq.filter((_, k) => k !== i) })} style={link}>{t.rd_wps_ship_remove}</button>
          </div>
        ))}
        <div style={hint}>{t.rd_wed_faq_hint}</div>
        {faq.length < MAX_FAQ && <button type="button" data-testid="wed-faq-add" onClick={() => set({ faq: [...faq, { q: "", a: "" }] })} style={addBtn}>＋ {t.rd_wed_faq_add}</button>}
      </>
    ),
  };
  return (
    <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, padding: 14 }} data-testid="wed-home">
      <div style={{ fontSize: 14.5, fontWeight: 800 }}>{t.rd_wed_home}</div>
      <div style={{ ...hint, marginBottom: 6 }}>{t.rd_wed_home_hint}</div>
      {HOME_SECTIONS.map((k) => {
        const on = draft.sections?.[k] !== false;
        const isOpen = open === k;
        return (
          <div key={k} style={{ borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 48 }}>
              <button type="button" role="switch" aria-checked={on} data-testid={`wed-sec-${k}`} onClick={() => set({ sections: { ...draft.sections, [k]: !on } })}
                style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 46, border: "none", background: "transparent", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-ui)", cursor: "pointer", padding: "0 2px", textAlign: "left" }}>
                <span>{t[`rd_wed_sec_${k}`]}</span><Toggle on={on} />
              </button>
              {EDITABLE[k] && <button type="button" data-testid={`wed-sec-edit-${k}`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : k)} style={{ ...link, minWidth: 52, minHeight: 44 }}>{isOpen ? t.rd_shop_close : t.rd_wed_edit}</button>}
            </div>
            {isOpen && <div data-testid={`wed-sec-body-${k}`} style={{ padding: "4px 0 12px" }}>{body[k]}</div>}
          </div>
        );
      })}
    </section>
  );
}

const hint: CSSProperties = { fontSize: 12, color: "var(--text-muted)", margin: "4px 0 8px" };
const box: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: 10, marginBottom: 8, display: "flex", flexDirection: "column", gap: 2 };
const link: CSSProperties = { border: "none", background: "transparent", color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)", padding: 0 };
const addBtn: CSSProperties = { width: "100%", minHeight: 44, borderRadius: 11, border: "1px dashed var(--border)", background: "transparent", color: "var(--accent-fg)", fontWeight: 800, fontSize: 14, cursor: "pointer", fontFamily: "var(--font-ui)" };
function In({ label, children }: { label: string; children: ReactNode }) {
  return <label style={{ display: "block", flex: 1, minWidth: 0, marginBottom: 6 }}><span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "var(--text-dim)", margin: "4px 0 4px" }}>{label}</span>{children}</label>;
}
function Toggle({ on }: { on: boolean }) {
  return <span aria-hidden="true" style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--accent)" : "var(--chip-bg)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 10, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} /></span>;
}
function Pic({ label, path, busy, onFile, t, testid }: { label: string; path?: string; busy: boolean; onFile: (f: File | undefined) => void; t: T; testid: string }) {
  return (
    <label data-testid={testid} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px dashed var(--border)", borderRadius: 12, padding: 8, cursor: "pointer", margin: "6px 0" }}>
      <span style={{ width: 56, height: 42, borderRadius: 8, background: "var(--chip-bg)", overflow: "hidden", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {path ? <img src={productImageUrl(path)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ color: "var(--text-muted)" }}>＋</span>}
      </span>
      <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: 11.5, color: "var(--accent-fg)", fontWeight: 700 }}>{busy ? "…" : path ? t.rd_wed_change_pic : t.rd_wed_add_pic}</span></span>
      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}
