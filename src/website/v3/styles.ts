// Seller Website v3 — the styles a seller's look adds on top of v2's (docs/design/seller-website-v3/site-v3.html,
// its v3 block). Everything is scoped under .sfl-v2 and only matches a shop whose root carries a look class
// (l-brand / l-market / v-sharp / v-caps), so a shop without a look (Build 1) is not touched.
// item 7, the contrast guard: wherever Build 1 writes text in the button colour, a look uses the readable
// version of it (--s-acct); fixed colours that assume a light page follow the look's body.
const L = (sel: string) => sel.split(",").flatMap((x) => [`.sfl-v2.l-brand ${x.trim()}`, `.sfl-v2.l-market ${x.trim()}`]).join(",");
const GUARD = `
${L(".v-nav button:hover,.v-trust svg,.v-sech button,.v-pr b,.v-vc b,.v-bnav .v-on,.v-lbl button,.v-rows svg,.v-stp span.v-on,.v-fside button.v-on")}{color:var(--s-acct)}
${L('[style^="color: var(--s-acc)"],[style*="; color: var(--s-acc)"]')}{color:var(--s-acct)!important}
${L('.v-slide[style*="var(--s-hero)"]')}{color:var(--on-top)}
${L("[data-testid=co-toast]")}{color:var(--s-bg)!important}
${L("[data-testid=od-link]")}{color:var(--s-fg)!important}
${L("[data-testid=od-receipt-ok]")}{color:var(--s-okt)!important}
`;
const BASE = `
${GUARD}
.sfl-v2.v-sharp .v-btn,.sfl-v2.v-sharp .v-qa,.sfl-v2.v-sharp .v-opt,.sfl-v2.v-sharp .v-cat .v-art{border-radius:var(--s-r)}
.sfl-v2.v-caps .v-sech h3,.sfl-v2.v-caps .v-band h2{text-transform:uppercase}
.sfl-v2.l-brand .v-ann{background:var(--top1);color:var(--on-top1)}
.sfl-v2.l-brand .v-hdr{transition:background .2s,border-color .2s}
.sfl-v2.l-brand .v-hdr.v-top{background:transparent;border-color:transparent;color:var(--on-top)}
.sfl-v2.l-brand .v-hdr.v-top .v-srch{background:rgba(255,255,255,.2);border-color:transparent;color:inherit}
.sfl-v2.l-brand .v-hdr.v-top .v-srch input{color:inherit}
.sfl-v2.l-brand .v-hdr.v-top .v-srch input::placeholder{color:inherit;opacity:.85}
.sfl-v2.l-brand .v-hdr.v-top .v-nav button{color:inherit;opacity:.92}
.sfl-v2.l-brand .v-hdr.v-top .v-logo i{background:var(--on-top);color:var(--top-ink)}
.sfl-v2.l-brand .v-hdr.v-top .v-ib b{background:var(--on-top);color:var(--top-ink)}
.sfl-v2 .v-band{background:var(--s-hero);color:var(--on-top);margin-top:calc(-1 * var(--hh, 56px) - 1px);padding:calc(var(--hh, 56px) + 28px) 0 14px;text-align:center}
.sfl-v2 .v-band h2{font-size:31px;line-height:1.02}
.sfl-v2 .v-band p{margin:8px auto 18px;max-width:30em;font-size:13.5px;opacity:.95}
.sfl-v2 .v-band .v-noband{height:4px}
.sfl-v2 .v-tiles2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sfl-v2 .v-tiles2.v-one{grid-template-columns:1fr}
.sfl-v2 .v-tile{position:relative;aspect-ratio:4/5;overflow:hidden;border:0;padding:0;cursor:pointer;background:#1b1c20;display:block;border-radius:var(--s-r)}
.sfl-v2 .v-tile img,.sfl-v2 .v-tile .v-ph0{width:100%;height:100%;object-fit:cover;display:block}
.sfl-v2 .v-tile span{position:absolute;left:50%;top:62%;transform:translateX(-50%);background:#fff;color:#111;padding:10px 18px;font:600 13.5px var(--s-font);white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis}
.sfl-v2 .v-tline{display:flex;gap:6px 18px;flex-wrap:wrap;justify-content:center;font-size:12px;color:var(--s-mut);padding:12px 0 0}
.sfl-v2 .v-arrows{display:none}
.sfl-v2 .v-arrows button{border:0;background:none;font-size:24px;line-height:1;color:var(--s-fg);padding:0 10px;min-width:32px;min-height:32px}
.sfl-v2.l-brand .v-sech .v-va{font-weight:500;text-decoration:underline;color:var(--s-mut)}
.sfl-v2.l-brand .v-hs{gap:6px}
.sfl-v2.l-brand .v-hs .v-card{flex:0 0 47%}
.sfl-v2 .v-ptiles{display:grid;grid-template-columns:1fr 1fr;gap:14px 6px}
.sfl-v2 .v-pt{border:0;background:none;padding:0;text-align:left;color:inherit;font:500 13.5px var(--s-font)}
.sfl-v2 .v-pt .v-art{aspect-ratio:4/5;width:100%;height:auto;object-fit:cover;display:block;margin-bottom:8px;border-radius:var(--s-r)}
.sfl-v2 .v-pt small{display:block;color:var(--s-mut);font-size:12.5px;margin-top:2px}
.sfl-v2.l-brand .v-card{border:0;border-radius:0;background:transparent}
.sfl-v2.l-brand .v-card .v-ph{border-radius:var(--s-r)}
.sfl-v2.l-brand .v-card .v-inf{padding:10px 2px 6px;gap:3px}
.sfl-v2.l-brand .v-card .v-nm{min-height:0;font-weight:500;-webkit-line-clamp:1}
.sfl-v2.l-brand .v-grid{gap:22px 6px}
.sfl-v2.l-brand .v-hrt{background:transparent;top:4px;right:4px}
.sfl-v2.l-brand .v-pd3{display:none}
.sfl-v2 .v-off2{position:absolute;left:8px;bottom:8px;background:#fff;color:#111;font:600 11.5px Inter,sans-serif;padding:4px 8px;z-index:2}
.sfl-v2 .v-t2{display:flex;justify-content:space-between;gap:8px;font-size:13.5px;min-width:0}
.sfl-v2 .v-t2 .v-nm{min-width:0}
.sfl-v2 .v-rt{color:var(--s-mut);font-size:12px;white-space:nowrap}
.sfl-v2 .v-vr{color:var(--s-mut);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sfl-v2.l-brand .v-pr b{color:var(--s-fg);font:600 14.5px var(--s-font)}
.sfl-v2.l-brand .v-pr s{color:var(--s-sale);font-size:13.5px}
.sfl-v2.l-brand .v-pi .v-pr b{font:700 24px var(--s-head)}
.sfl-v2.l-brand .v-pi .v-pr s{font-size:15px}
.sfl-v2 .v-sw2{display:flex;gap:4px;margin-bottom:3px}
.sfl-v2 .v-sw2 i{width:14px;height:14px;border:1px solid rgba(128,128,128,.5)}
.sfl-v2.l-brand .v-fside{border:0;padding:0;background:transparent}
.sfl-v2.l-brand .v-foot{background:transparent}
.sfl-v2 .v-qs{display:none}
.sfl-v2 .v-qplus{position:absolute;right:8px;bottom:8px;width:34px;height:34px;border-radius:50%;border:0;background:#fff;color:#111;font:500 21px/1 Inter,sans-serif;z-index:3;box-shadow:0 2px 8px rgba(0,0,0,.18);display:grid;place-items:center;cursor:pointer}
.sfl-v2 .v-drawer{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.5);display:flex;justify-content:flex-end;align-items:flex-end}
.sfl-v2 .v-drawer>div{background:var(--s-card);color:var(--s-fg);width:100%;max-height:88%;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:10px}
.sfl-v2 .v-drawer h3{font-size:19px;display:flex;justify-content:space-between;align-items:center}
.sfl-v2 .v-drawer h3 button{border:0;background:none;color:inherit;font-size:24px;line-height:1;min-width:44px;min-height:44px}
.sfl-v2 .v-qsz{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}
.sfl-v2 .v-qsz button{border:1.5px solid var(--s-line);background:var(--s-card);color:var(--s-fg);padding:14px 4px;font:600 14px var(--s-font);border-radius:var(--s-r);min-height:44px}
.sfl-v2 .v-qsz button:disabled,.sfl-v2 .v-qs button:disabled{opacity:.4;text-decoration:line-through;cursor:default}
`;
const WIDE = `
.sfl-v2 .v-band{padding-bottom:26px}
.sfl-v2 .v-band h2{font-size:54px}
.sfl-v2 .v-band p{font-size:16px;margin-bottom:26px}
.sfl-v2 .v-tile{aspect-ratio:4/3}
.sfl-v2 .v-tile span{font-size:15px;padding:13px 24px}
.sfl-v2 .v-tline{font-size:13px;padding-top:16px}
.sfl-v2.l-brand .v-hs .v-card{flex-basis:calc(20% - 5px)}
.sfl-v2 .v-arrows{display:inline-flex}
.sfl-v2 .v-ptiles{grid-template-columns:repeat(4,1fr)}
.sfl-v2 .v-drawer{align-items:stretch}
.sfl-v2 .v-drawer>div{width:420px;max-height:none}
`;
// laptop with a mouse: the sizes show over the photo on hover (the "+" stays for products that follow Build 1's rule)
const WIDE_HOVER = `
.sfl-v2 .v-qplus:not(.v-qany){display:none}
.sfl-v2.l-brand .v-card:hover .v-qs{display:grid}
.sfl-v2 .v-qs{position:absolute;left:0;right:0;bottom:0;background:var(--s-card);padding:12px;grid-template-columns:repeat(4,1fr);z-index:3}
.sfl-v2 .v-qs button{border:1px solid var(--s-line);background:var(--s-card);color:var(--s-fg);padding:12px 2px;font:600 12.5px var(--s-font);margin:-.5px;cursor:pointer}
.sfl-v2 .v-qs button:not(:disabled):hover{background:var(--s-fg);color:var(--s-bg)}
`;
export const V3_CSS = `${BASE}
@container vp (min-width:860px){${WIDE}@media (hover:hover){${WIDE_HOVER}}}
@supports not (container-type:inline-size){@media (min-width:860px){${WIDE}}@media (min-width:860px) and (hover:hover){${WIDE_HOVER}}}
`;
