// Seller Website v3 — item 6: the look settings in the Website editor (docs/design/seller-website-v3/site-v3.html,
// its "🎨" panel): layout; five ready combinations; top colour 1 and 2 (two colours blend); buttons; sale /
// old price (Brand store only — kept, just hidden, on Marketplace); light or dark page body; font; corners;
// and, in the Brand store, which two categories are the big tiles. The live preview sits on top and follows
// every change.
import type { CSSProperties, ReactNode } from "react";
import type { ShopDesign } from "../../website/shopApi";
import { LOOK_PRESETS, type ShopLook } from "../../website/v3/look";
import { editorLook, lookPatch, presetPatch, presetOf, tileChoices, tileTogglePatch } from "../adapters/websiteLook";

type T = Record<string, string>;
const lbl: CSSProperties = { fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", margin: "12px 0 6px" };
const segWrap: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4, background: "var(--surface-2, var(--surface))", border: "1px solid var(--border)", borderRadius: 999, padding: 3, width: "fit-content", maxWidth: "100%" };
const segBtn = (on: boolean): CSSProperties => ({ minHeight: 38, border: 0, borderRadius: 999, padding: "0 14px", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, background: on ? "var(--accent)" : "transparent", color: on ? "var(--accent-text)" : "var(--text-muted)" });
const colorInput: CSSProperties = { width: 52, height: 44, padding: 2, border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", cursor: "pointer", flexShrink: 0 };

function Seg<V extends string>({ label, value, options, onPick, testid }: { label: string; value: V; options: [V, string][]; onPick: (v: V) => void; testid: string }) {
  return (
    <>
      <div style={lbl}>{label}</div>
      <div role="radiogroup" aria-label={label} style={segWrap} data-testid={testid}>
        {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={value === v} data-testid={`${testid}-${v}`} style={segBtn(value === v)} onClick={() => onPick(v)}>{text}</button>)}
      </div>
    </>
  );
}
function Colour({ label, value, onPick, testid }: { label: string; value: string; onPick: (v: string) => void; testid: string }) {
  return <input type="color" aria-label={label} data-testid={testid} value={value} onChange={(e) => onPick(e.target.value.toLowerCase())} style={colorInput} />;
}

export default function WebsiteLookEditor({ draft, set, t, cats, preview, note }: {
  draft: ShopDesign; set: (p: Partial<ShopDesign>) => void; t: T; cats: string[];
  /** the live preview (the shop with this draft) */
  preview: ReactNode;
  /** item 7: the one line that says a colour was swapped so buyers can read it */
  note?: ReactNode;
}) {
  const l = editorLook(draft);
  const put = (p: Partial<ShopLook>) => set(lookPatch(draft, p));
  const pre = presetOf(l);
  const brand = l.layout === "brand";
  const tiles = tileChoices(draft, cats);
  return (
    <div data-testid="wed-look">
      <div data-testid="wed-live-preview" aria-label={t.rd_wed_live_preview}
        style={{ position: "sticky", top: 74, zIndex: 3, height: 340, borderRadius: 14, border: "1px solid var(--border)", overflow: "hidden", transform: "translateZ(0)", background: "var(--surface)" }}>
        <div style={{ position: "absolute", top: 6, left: 8, zIndex: 70, fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", background: "rgba(17,24,39,.75)", color: "#fff", padding: "2px 7px", borderRadius: 999, pointerEvents: "none" }}>{t.rd_wed_live_preview}</div>
        <div style={{ height: "100%", overflowY: "auto", overscrollBehavior: "contain" }}>{preview}</div>
      </div>
      {note}

      <Seg label={t.rd_wed_layout} value={l.layout} testid="wed-layout" onPick={(v) => put({ layout: v })}
        options={[["brand", t.rd_wed_layout_brand], ["market", t.rd_wed_layout_market]]} />

      <div style={lbl}>{t.rd_wed_presets}</div>
      <div role="radiogroup" aria-label={t.rd_wed_presets} style={{ display: "flex", flexWrap: "wrap", gap: 8 }} data-testid="wed-presets">
        {LOOK_PRESETS.map((p) => (
          <button key={p.key} type="button" role="radio" aria-checked={pre === p.key} data-testid={`wed-preset-${p.key}`} onClick={() => set(presetPatch(draft, p.key))}
            style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "0 12px 0 6px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, color: "var(--text)", background: "var(--surface)", border: pre === p.key ? "2px solid var(--accent)" : "1px solid var(--border)" }}>
            <i aria-hidden="true" style={{ width: 30, height: 30, borderRadius: 999, background: `linear-gradient(120deg, ${p.look.top1}, ${p.look.top2})`, boxShadow: `inset 0 0 0 3px ${p.look.btn}` }} />
            {t[`rd_wed_pre_${p.key}`]}{pre === p.key ? " ✓" : ""}
          </button>
        ))}
      </div>

      <div style={lbl}>{t.rd_wed_top}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Colour label={t.rd_wed_top1} value={l.top1} testid="wed-top1" onPick={(v) => put({ top1: v })} />
        <Colour label={t.rd_wed_top2} value={l.top2} testid="wed-top2" onPick={(v) => put({ top2: v })} />
        <span aria-hidden="true" style={{ flex: "1 1 80px", minWidth: 60, height: 30, borderRadius: 8, background: `linear-gradient(120deg, ${l.top1}, ${l.top2})` }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{t.rd_wed_top_hint}</div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div><div style={lbl}>{t.rd_wed_btn_color}</div><Colour label={t.rd_wed_btn_color} value={l.btn} testid="wed-btn" onPick={(v) => put({ btn: v })} /></div>
        {brand && <div><div style={lbl}>{t.rd_wed_sale_color}</div><Colour label={t.rd_wed_sale_color} value={l.sale} testid="wed-sale" onPick={(v) => put({ sale: v })} /></div>}
      </div>

      <Seg label={t.rd_wed_body} value={l.dark ? "dark" : "light"} testid="wed-body" onPick={(v) => put({ dark: v === "dark" })}
        options={[["light", t.rd_wed_body_light], ["dark", t.rd_wed_body_dark]]} />
      <Seg label={t.rd_wed_font} value={l.font} testid="wed-font" onPick={(v) => put({ font: v })}
        options={[["modern", t.rd_wed_font_modern], ["friendly", t.rd_wed_font_friendly], ["classic", t.rd_wed_font_classic]]} />
      <Seg label={t.rd_wed_corners} value={l.corners} testid="wed-corners" onPick={(v) => put({ corners: v })}
        options={[["sharp", t.rd_wed_corners_sharp], ["round", t.rd_wed_corners_round]]} />

      {brand && (
        <div data-testid="wed-tiles">
          <div style={lbl}>{t.rd_wed_tiles}</div>
          {tiles.length === 0
            ? <div style={{ fontSize: 12.5, color: "var(--text-muted)" }} data-testid="wed-tiles-none">{t.rd_wed_tiles_none}</div>
            : (
              <>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>{t.rd_wed_tiles_hint}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button type="button" aria-pressed={!l.tiles?.length} data-testid="wed-tile-auto" onClick={() => set(tileTogglePatch(draft, null))} style={chip(!l.tiles?.length)}>{t.rd_wed_tile_auto}</button>
                  {tiles.map((c) => {
                    const at = l.tiles?.indexOf(c) ?? -1;
                    return <button key={c} type="button" aria-pressed={at >= 0} data-testid="wed-tile" onClick={() => set(tileTogglePatch(draft, c))} style={chip(at >= 0)}>{at >= 0 ? `${at + 1} · ` : ""}{c}</button>;
                  })}
                </div>
              </>
            )}
        </div>
      )}
    </div>
  );
}
const chip = (on: boolean): CSSProperties => ({ minHeight: 40, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, background: on ? "var(--accent)" : "var(--surface)", color: on ? "var(--accent-text)" : "var(--text)", border: on ? "1px solid var(--accent)" : "1px solid var(--border)" });
