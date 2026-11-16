// Seller Website v3 — the styles a seller's look adds on top of v2's (docs/design/seller-website-v3/site-v3.html,
// its v3 block). Everything is scoped under .sfl-v2 and only matches a shop whose root carries a look class
// (l-brand / l-market / v-sharp / v-caps), so a shop without a look (Build 1) is not touched.
const BASE = `
.sfl-v2.v-sharp .v-btn,.sfl-v2.v-sharp .v-qa,.sfl-v2.v-sharp .v-opt,.sfl-v2.v-sharp .v-cat .v-art{border-radius:var(--s-r)}
.sfl-v2.v-caps .v-sech h3,.sfl-v2.v-caps .v-band h2{text-transform:uppercase}
.sfl-v2.l-brand .v-ann{background:var(--top1);color:var(--on-top)}
.sfl-v2.l-brand .v-hdr{transition:background .2s,border-color .2s}
.sfl-v2.l-brand .v-hdr.v-top{background:transparent;border-color:transparent;color:var(--on-top)}
.sfl-v2.l-brand .v-hdr.v-top .v-srch{background:rgba(255,255,255,.2);border-color:transparent;color:inherit}
.sfl-v2.l-brand .v-hdr.v-top .v-srch input{color:inherit}
.sfl-v2.l-brand .v-hdr.v-top .v-srch input::placeholder{color:inherit;opacity:.85}
.sfl-v2.l-brand .v-hdr.v-top .v-nav button{color:inherit;opacity:.92}
.sfl-v2.l-brand .v-hdr.v-top .v-logo i{background:var(--on-top);color:var(--top1)}
.sfl-v2.l-brand .v-hdr.v-top .v-ib b{background:var(--on-top);color:var(--top1)}
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
.sfl-v2.l-brand .v-fside{border:0;padding:0;background:transparent}
.sfl-v2.l-brand .v-foot{background:transparent}
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
`;
export const V3_CSS = `${BASE}
@container vp (min-width:860px){${WIDE}}
@supports not (container-type:inline-size){@media (min-width:860px){${WIDE}}}
`;
