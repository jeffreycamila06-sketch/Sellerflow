// Seller Website v4 — "catalogue and slip": the styles of the new look, on top of v2's and v3's.
// Every rule is scoped to a shop root that carries the class k4 (ShopApp adds it only when the new look is on
// for that shop), so a shop without it is not touched by one character of this file.
//   browsing pages  a catalogue: one photo frame, sections under one line, prices as strong numerals
//   paying pages    one ruled sheet: lines between the parts, no boxes
//   colour          paper and ink are fixed; the seller's colours = the sign, the stripe, the main button, the sale price
// Where a page writes a style straight on an element, the rule here carries !important and names why.
const K = ".sfl-v2.k4";
const k = (css: string) => css.replace(/^P /gm, `${K} `).replace(/,P /g, `,${K} `).replace(/^P([.:{[])/gm, `${K}$1`).replace(/,P([.:[])/g, `,${K}$1`);
const NUM = "font-family:var(--s-head);font-stretch:var(--k-pst);font-weight:var(--k-pw);font-variant-numeric:tabular-nums lining-nums";

const BASE = k(`
P{font-size:15px;line-height:1.5}
P .v-wrap{padding:0 16px}
P h2,P h3,P .v-hd{font-family:var(--s-head);letter-spacing:-.014em;font-weight:var(--k-hw)}
P ::selection{background:var(--s-acc);color:var(--s-on)}
P :focus-visible{outline:2px solid var(--s-acct);outline-offset:2px}
P button[style*="color: var(--s-acc)"],P a[style*="color: var(--s-acc)"]{color:var(--s-fg)!important;text-decoration:underline;text-underline-offset:3px;font-weight:500!important}
P b[style*="color: var(--s-acc)"]{color:var(--s-fg)!important}

P .v-ann{background:var(--top1);color:var(--on-top1);text-align:left;font-size:12.5px;font-weight:500;line-height:1.3;padding:7px 16px;border-bottom:1px solid color-mix(in srgb,var(--on-top1) 22%,transparent)}
P .v-hdr,P.l-brand .v-hdr,P.l-brand .v-hdr.v-top{background:var(--top1);color:var(--on-top1);border-bottom:3px solid var(--top2);transition:none}
P .v-hdr .v-row{gap:4px;padding:6px 0;min-height:56px;flex-wrap:wrap}
P .v-logo{gap:10px;flex:1;min-width:0;min-height:44px;text-align:left;font:760 19px/1.1 var(--s-head);font-stretch:var(--k-sst);letter-spacing:-.012em}
P .v-logo i,P.l-brand .v-hdr.v-top .v-logo i{width:34px;height:34px;flex:none;border-radius:var(--k-rs);background:var(--on-top1);color:var(--top1);font:700 17px/1 var(--s-head)}
P .v-logo img{width:34px!important;height:34px!important;flex:none;border-radius:var(--k-rs)!important;background:var(--on-top1)}
P .v-logo span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
P .v-ib{width:44px;height:44px;border-radius:var(--k-rs)}
P .v-hdr .v-ib{margin:0 -5px}
P .v-hdr .v-ib:first-child{margin-left:-12px}
P .v-hdr .v-ib:last-child{margin-right:-8px}
P .v-ib b,P.l-brand .v-hdr.v-top .v-ib b{top:4px;right:2px;min-width:17px;height:17px;background:var(--on-top1);color:var(--top1);font:700 12px/1 var(--s-font)}
P .v-buy .v-ib{color:var(--s-fg)}
P .v-srch,P.l-brand .v-hdr.v-top .v-srch{order:9;flex:0 0 100%;margin:0 0 8px;height:40px;padding:0 12px;gap:8px;border-radius:var(--k-rs);color:inherit;font-size:14px;background:color-mix(in srgb,var(--on-top1) 11%,transparent);border:1px solid color-mix(in srgb,var(--on-top1) 30%,transparent)}
P .v-srch input{color:inherit}
P .v-srch input::placeholder{color:inherit;opacity:.86}
P .v-srch.v-in{display:none}
P .v-srch.v-in.v-open{display:flex}

P .v-sec{margin-top:44px}
P .v-sech{border-top:1.5px solid var(--s-fg);padding-top:12px;margin-bottom:14px;align-items:baseline}
P .v-sech h3,P.t-bold .v-sech h3{font-size:20px!important;line-height:1.2;text-transform:none}
P .v-sech button,P.l-brand .v-sech .v-va{color:var(--s-fg);font-weight:500;font-size:13.5px;text-decoration:underline;text-underline-offset:3px;min-height:44px;min-width:44px;margin:-14px 0}
P .v-arrows button{width:36px;height:36px;min-width:36px;min-height:36px;margin:0;padding:0;border:1px solid var(--k-ink3);border-radius:var(--k-rs);display:grid;place-items:center;text-decoration:none}
P .v-arrows button+button svg{transform:scaleX(-1)}

P .v-band{background:none;color:var(--s-fg);margin-top:0;padding:22px 0 0;text-align:left}
P .v-band h2,P.v-caps .v-band h2{font:var(--k-hw) 33px/1.05 var(--s-head);letter-spacing:-.024em;text-wrap:balance;text-transform:none}
P .v-band p{margin:10px 0 0;max-width:44ch;font-size:15px;color:var(--s-mut);opacity:1}
P .v-band .v-noband{height:0}
P .v-tiles2{gap:10px;margin-top:18px}
P .v-tile{aspect-ratio:auto;overflow:visible;background:none;border-radius:0;display:flex;flex-direction:column;text-align:left;color:inherit}
P .v-tile img,P .v-tile .v-ph0{aspect-ratio:var(--k-ar);height:auto;border-radius:var(--s-r);background:var(--k-back)}
P .v-tile span{position:static;transform:none;background:none;color:var(--s-fg);padding:9px 0 0;max-width:100%;font:620 15px/1.2 var(--s-head);display:flex;justify-content:space-between;align-items:center;gap:8px;white-space:normal}
P .v-tile span::after{content:"";flex:none;width:8px;height:8px;margin-right:3px;border-top:1.6px solid;border-right:1.6px solid;transform:rotate(45deg)}
P .v-tline{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;justify-content:stretch;border-top:1px solid var(--s-line);margin-top:22px;padding:0;font-size:13.5px;color:var(--s-fg)}
P .v-tline span{display:flex;gap:9px;align-items:center;padding:11px 0;border-bottom:1px solid var(--s-line);line-height:1.25}
P .v-tline svg{flex:none;color:var(--s-mut)}

P .v-hs,P.l-brand .v-hs{gap:12px;margin:0 -16px;padding:0 16px 2px;scroll-snap-type:x proximity}
P .v-hs .v-card,P.l-brand .v-hs .v-card{flex:0 0 44%;max-width:230px;scroll-snap-align:start}
P .v-grid,P.l-brand .v-grid{gap:24px 12px}
P .v-card,P.l-brand .v-card{border:0;border-radius:0;background:transparent;overflow:visible}
P .v-card .v-ph,P.l-brand .v-card .v-ph{aspect-ratio:var(--k-ar);border-radius:var(--s-r);background:var(--k-back);overflow:hidden}
P .v-card .v-inf,P.l-brand .v-card .v-inf{padding:9px 0 0;gap:0}
P .v-card .v-nm,P.l-brand .v-card .v-nm{font-size:14px;font-weight:400;line-height:1.3;min-height:0;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
P .v-t2{display:block}
P .v-rt{display:block;font-size:12.5px;margin-top:2px}
P .v-vr{font-size:12.5px;margin-top:2px}
P .v-sw{margin-top:5px}
P .v-sw2{margin:0 0 6px}
P .v-sw i,P .v-sw2 i{width:11px;height:11px;border-radius:50%}
P .v-sw small{font-size:12.5px}
P .v-pr{margin-top:6px;gap:7px}
P .v-pr b,P.l-brand .v-pr b,P.l-market .v-pr b{color:var(--s-fg);font-size:18px;line-height:1.1;${NUM}}
P .v-pr:has(s) b{color:var(--k-salet)}
P .v-pr s,P.l-brand .v-pr s{color:var(--s-mut);font-size:12.5px}
P .v-meta{font-size:12.5px;margin-top:4px}
P .v-off2{left:8px;bottom:8px;background:var(--s-bg);color:var(--s-fg);font:600 12px/1 var(--s-font);padding:5px 7px;border-radius:calc(var(--k-rs)/2)}
P .v-off2[data-kind=off]{background:var(--s-sale);color:var(--k-onsale)}
P .v-bdg span{font:600 12px/1 var(--s-font);padding:5px 7px;border-radius:calc(var(--k-rs)/2);background:var(--s-sale);color:var(--k-onsale)}
P .v-bdg .v-n,P .v-bdg .v-l,P .v-bdg .v-x{background:var(--s-bg);color:var(--s-fg)}
P .v-rank{left:0;border-radius:0;background:var(--s-fg);color:var(--s-bg);font:700 12px/1 var(--s-font);padding:6px 8px}
P .v-hrt,P.l-brand .v-hrt{top:0;right:0;width:44px;height:44px;border-radius:0;background:transparent;color:var(--s-fg)}
P .v-hrt svg{width:30px;height:30px;padding:6.5px;border-radius:50%;background:color-mix(in srgb,var(--s-bg) 86%,transparent)}
P .v-hrt.v-on,P .v-hrt.v-on svg{color:var(--k-salet);fill:none}
P .v-hrt.v-on svg path{fill:currentColor}
P .v-qplus,P .v-qa{width:36px;height:36px;border-radius:var(--k-rs);background:var(--s-bg);color:var(--s-fg);font:400 20px/1 var(--s-font);box-shadow:0 1px 3px rgba(0,0,0,.16)}
P .v-qa{position:relative;box-shadow:none;border:1px solid var(--k-ink3)}
P .v-qplus::after,P .v-qa::after{content:"";position:absolute;inset:-6px}
P .v-pd3{display:none}

P .v-btn,P.t-bou .v-btn,P.t-bold .v-btn{min-height:48px;padding:0 20px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--k-rs);border:1.5px solid transparent;background:var(--s-acc);color:var(--s-on);font:650 15px/1.2 var(--s-font);text-decoration:none}
P .v-btn.v-o{background:transparent;color:var(--s-fg);border-color:var(--s-fg)}
P .v-btn.v-full{width:100%;padding:0 20px}
P .v-btn.v-sm{min-height:44px;padding:0 14px;font-size:14px}
P .v-buy .v-btn,P .v-dbuy .v-btn{padding:0 12px}
P .v-promo{display:grid;gap:12px;justify-items:start;padding:20px;border:1.5px dashed var(--s-fg);border-radius:var(--s-r);background:none;color:var(--s-fg)}
P .v-promo h3{font-size:20px;line-height:1.2}
P .v-promo p{margin:6px 0 0;font-size:15px;color:var(--s-mut);opacity:1}
P .v-promo .v-btn.v-w{background:transparent;color:var(--s-fg);border-color:var(--s-fg);min-height:44px}
P .v-promo[style]{border:0;color:#fff}
P .v-promo[style] p{color:inherit;opacity:.9}
P .v-promo[style] .v-btn.v-w{background:#fff;color:#151515;border-color:#fff}

P .v-ptiles{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:0 16px}
P .v-ptiles::-webkit-scrollbar{display:none}
P .v-pt{flex:0 0 38%;font:620 14.5px/1.25 var(--s-head)}
P .v-pt .v-art{aspect-ratio:var(--k-ar);border-radius:var(--s-r);background:var(--k-back)}
P .v-pt small{font:400 12.5px/1.3 var(--s-font);margin-top:3px}
P .v-cat{width:76px;font-size:12.5px;font-weight:500}
P .v-cat .v-art,P.t-bou .v-cat .v-art,P.t-bold .v-cat .v-art{width:76px;height:76px;border:0;box-shadow:none;border-radius:var(--s-r);background:var(--k-back)}

P .v-live{background:none;border:0;border-top:1.5px solid var(--s-fg);border-bottom:1px solid var(--s-line);border-radius:0;padding:14px 0 18px;gap:12px;flex-direction:column;align-items:flex-start}
P .v-live .v-tx{flex:none;min-width:0;width:100%}
P .v-live .v-tx .v-pill{display:inline-flex;align-items:center;gap:7px;padding:0;background:none;color:var(--s-mut);font:500 13px/1 var(--s-font);letter-spacing:0}
P .v-live .v-pill i{width:8px;height:8px;border-radius:50%;background:var(--s-sale)}
P .v-live .v-tx b{font:var(--k-hw) 22px/1.15 var(--s-head);letter-spacing:-.015em;margin-top:8px}
P .v-live .v-tx span{font-size:14px}
P .v-live .v-btn{background:transparent;color:var(--s-fg);border-color:var(--s-fg);min-height:44px}
P .v-about{background:none;border:0;border-top:1.5px solid var(--s-fg);border-radius:0;padding:12px 0 0}
P .v-about h3{font-size:20px!important;line-height:1.2}
P .v-about p{margin:10px 0 14px;max-width:60ch;font-size:15px;color:var(--s-fg)}
P [data-testid=shop-verified]{display:inline-flex;align-items:center;gap:3px;margin-left:6px;vertical-align:middle;color:var(--s-okt)!important;font-size:12.5px!important;font-weight:500!important;letter-spacing:0}
P .v-stats{display:block;max-width:420px;text-align:left}
P .v-stats div{display:grid;grid-template-columns:auto 1fr auto;align-items:baseline;padding:7px 0}
P .v-stats div::before{content:"";grid-column:2;grid-row:1;margin:0 8px;border-bottom:1px dotted var(--k-ink3);transform:translateY(-3px)}
P .v-stats span{grid-column:1;grid-row:1;font-size:14px}
P .v-stats b{grid-column:3;grid-row:1;font-size:17px;line-height:1;${NUM}}
P .v-steps{gap:0}
P .v-step{background:none;border:0;border-bottom:1px solid var(--s-line);border-radius:0;padding:14px 0;gap:12px}
P .v-step i{width:22px;height:auto;border-radius:0;background:none;color:var(--s-fg);font-size:22px;line-height:1;place-items:start;${NUM}}
P .v-step b{font-size:15px;font-weight:620}
P .v-step span{font-size:13.5px}
P details{background:none;border:0;border-bottom:1px solid var(--s-line);border-radius:0;padding:0;margin:0}
P summary{min-height:48px;display:flex;align-items:center;justify-content:space-between;gap:12px;list-style:none;font-weight:500;font-size:15px}
P summary::-webkit-details-marker{display:none}
P summary::after{content:"+";flex:none;color:var(--s-mut);font:400 20px/1 var(--s-font)}
P details[open] summary::after{content:"\\2212"}
P details p{margin:0 0 14px;max-width:60ch;font-size:14px}

P .v-foot,P.l-brand .v-foot{margin-top:56px;background:none;border-top:1.5px solid var(--s-fg);padding:22px 0 30px;font-size:13.5px}
P .v-fcols{gap:22px}
P .v-foot b{font-size:13.5px;font-weight:620}
P .v-fcols>div:first-child>b{font:760 18px/1.2 var(--s-head);font-stretch:var(--k-sst);letter-spacing:-.01em}
P .v-foot .v-fcols button{min-height:44px;padding:0!important;display:flex!important;align-items:center}
P .v-soc{gap:0;margin-left:-11px}
P .v-soc a{width:44px!important;height:44px!important;border-radius:var(--k-rs)!important;background:none!important;border:0!important}
P .v-pay{gap:0}
P .v-pay span{border:0;border-radius:0;background:none;padding:0;font:400 13.5px/1.6 var(--s-font);color:var(--s-mut)}
P .v-pay span+span::before{content:"\\00a0\\00b7\\00a0"}
P .v-pw{text-align:left;border-top:1px solid var(--s-line);padding-top:14px;margin-top:22px;font-size:12.5px}
P [data-testid=shop-lang]{font-size:12.5px!important;min-height:44px}
P .v-bnav{background:var(--s-bg);padding:0 0 env(safe-area-inset-bottom)}
P .v-bnav button,P .v-bnav a{min-height:58px;gap:3px;margin-top:-1px;border-top:2px solid transparent;color:var(--s-mut);font:500 12px/1 var(--s-font)}
P .v-bnav .v-on{color:var(--s-fg);font-weight:650;border-top-color:var(--s-acct)}
P .v-bnav b{background:var(--s-fg);color:var(--s-bg);font:700 11px/1 var(--s-font)}
P .v-fab{display:none}

P .v-chips{gap:8px}
P .v-chip{min-height:40px;padding:0 13px;display:inline-flex;align-items:center;gap:6px;border-radius:var(--k-rs);border-color:var(--k-ink3);background:none;font-size:13.5px;font-weight:500}
P .v-chip.v-on{background:var(--s-fg);color:var(--s-bg);border-color:var(--s-fg)}
P .v-tool{font-size:13px}
P .v-tool select{min-height:40px;border-radius:var(--k-rs);border-color:var(--k-ink3);background:var(--s-bg);font:500 13.5px var(--s-font)}
P .v-crumb{font-size:12.5px;padding:12px 0}
P .v-fside,P.l-brand .v-fside{border:0;background:none;padding:0}
P .v-fside button{min-height:36px}
P .v-fside button.v-on{color:var(--s-fg);font-weight:650;text-decoration:underline;text-underline-offset:3px}

P .v-gal{margin:0 -16px;border-radius:0;background:var(--k-back)}
P .v-gal .v-imgs{aspect-ratio:var(--k-ar)}
P .v-gal .v-cnt{background:var(--s-bg);color:var(--s-fg);border-radius:0;padding:5px 8px;font:500 12px/1 var(--s-font);font-variant-numeric:tabular-nums}
P .v-ths{margin-top:10px}
P .v-ths button{width:56px;height:56px;border:0;border-radius:var(--k-rs);outline:1px solid var(--s-line);outline-offset:-1px}
P .v-ths button.v-on{outline:2px solid var(--s-fg);outline-offset:-2px}
P .v-pi{margin-top:6px}
P .v-pi h2{font:var(--k-hw) 25px/1.14 var(--s-head);letter-spacing:-.018em;text-wrap:balance}
P .v-pi .v-pr{align-items:center}
P .v-pi .v-pr b,P.l-brand .v-pi .v-pr b{font-size:32px;${NUM}}
P .v-pi .v-pr s,P.l-brand .v-pi .v-pr s{font-size:15px}
P .v-off{background:var(--s-sale);color:var(--k-onsale);border-radius:calc(var(--k-rs)/2);padding:4px 6px;font:700 12px/1 var(--s-font)}
P .v-sub{font-size:13px}
P .v-note{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:none;border-radius:0;border-top:1px solid var(--s-line);border-bottom:1px solid var(--s-line);padding:10px 0;font-size:13.5px}
P .v-note svg{flex:none;color:var(--s-mut)}
P .v-note .v-prog{flex:0 0 100%}
P .v-note[style*="background"]{padding:10px 12px;border:0;border-radius:var(--k-rs)}
P .v-cd{gap:1px;font:inherit}
P .v-cd>span:first-child{margin-left:4px}
P .v-cd i{background:none;color:var(--k-salet);border-radius:0;padding:0;font-size:16px;line-height:1;${NUM}}
P [data-testid=od-countdown] i{color:var(--s-fg)}
P .v-lbl{margin:0 0 8px;font-size:13.5px;font-weight:400;align-items:baseline}
P .v-lbl button{color:var(--s-fg);font-size:13.5px;font-weight:500;min-height:44px;margin:-14px 0}
P .v-opts{gap:8px}
P .v-opt,P.t-bou .v-opt,P.t-bold .v-opt{min-height:44px;min-width:48px;padding:0 14px;justify-content:center;border:1px solid var(--k-ink3);border-radius:var(--k-rs);background:none;font-weight:500;font-size:14px}
P .v-opt.v-on{border-color:var(--s-fg);box-shadow:inset 0 0 0 1px var(--s-fg);font-weight:650}
P .v-opt:disabled{opacity:1;color:var(--k-ink3);border-style:dashed}
P .v-qty{border:1px solid var(--k-ink3);border-radius:var(--k-rs)}
P .v-qty button{width:44px;height:44px;background:none}
P .v-qty span{font-weight:600;font-variant-numeric:tabular-nums}
P .v-box{background:none;border:0;border-top:1.5px solid var(--s-fg);border-radius:0;padding:14px 0 10px}
P .v-box[style*="padding"]{padding:14px 0 10px!important}
P .v-box>.v-lbl:first-child{font:var(--k-hw) 17px/1.25 var(--s-head);letter-spacing:-.008em}
P .v-box.v-rows{border-top:1px solid var(--s-line);padding:0;gap:0}
P .v-rows div{gap:10px;padding:13px 0;border-bottom:1px solid var(--s-line)}
P .v-rows svg,P.l-brand .v-rows svg{color:var(--s-fg);width:20px;height:20px}
P .v-rows b{font-size:14.5px;font-weight:620}
P .v-rows small{font-size:13px}
P .v-spec{gap:6px 18px;font-size:14px}
P .v-buy{background:var(--s-bg);gap:10px;padding:10px 16px calc(10px + env(safe-area-inset-bottom))}
P .v-buy .v-tot{font-size:12px}
P .v-buy .v-tot b{font-size:21px;line-height:1.1;${NUM}}

P .v-stp{gap:10px;padding:14px 0 12px;font-size:13px;font-weight:400;color:var(--s-mut)}
P .v-stp span.v-on,P.l-brand .v-stp span.v-on{color:var(--s-fg);font-weight:650}
P .v-ci{background:none;border:0;border-bottom:1px solid var(--s-line);border-radius:0;margin:0;padding:16px 0;gap:12px}
P .v-ci .v-art{border-radius:var(--k-rs)!important;background:var(--k-back)}
P .v-ci .v-m b{font-size:15px;font-weight:560;line-height:1.3}
P .v-ci .v-m small{font-size:13px}
P .v-ci .v-x{color:var(--s-fg);font-size:13px;min-height:44px!important}
P .v-prog{height:3px;border-radius:0;margin-top:9px}
P .v-sum{gap:8px;font-size:14.5px}
P .v-sum span{color:var(--s-mut)}
P .v-sum b{font-weight:560}
P .v-sum .v-t{padding-top:12px;margin-top:4px;align-items:baseline;font:var(--k-hw) 17px/1.2 var(--s-head)}
P .v-sum .v-t span{color:var(--s-fg)}
P .v-sum .v-t span:last-child{font-size:24px;line-height:1;${NUM}}
P .v-fld{gap:6px;margin-bottom:14px;font-size:13px;font-weight:500}
P .v-fld input,P .v-fld textarea,P .v-fld select,P [data-testid=co-note],P [data-testid=od-link]{min-height:48px;border:1px solid var(--k-ink3)!important;border-radius:var(--k-rs)!important;background:var(--k-field)!important}
P [aria-invalid=true]{border-color:var(--k-err)!important}
P [data-bad=true]{border-color:var(--k-err)!important}
P .v-err{color:var(--k-err);font-size:13px;font-weight:500;margin:-6px 0 12px}
P [role=radiogroup]{gap:0!important}
P .v-radio{position:relative;margin:-1px 0 0;padding:13px 12px;border:1px solid var(--s-line);border-radius:0;background:none;font-size:15px}
P .v-radio.v-on{z-index:1;border-color:var(--s-fg);box-shadow:inset 0 0 0 1px var(--s-fg);background:none}
P .v-radio i{width:20px;height:20px;border:1.5px solid var(--k-ink3)}
P .v-radio.v-on i{border:1.5px solid var(--s-fg);background:radial-gradient(circle,var(--s-fg) 0 5px,transparent 5.5px)}
P .v-radio b{font-weight:620;line-height:1.3}
P .v-radio small{font-size:13px}
P .v-radio em{font-size:16px;line-height:1.3;${NUM}}
P .v-radio.v-bad{border-color:var(--k-err)}
P [data-testid=co-store]{border-radius:var(--k-rs)!important}
P .v-side [style*="border-radius: 9px"]{border-radius:var(--k-rs)!important;background:var(--k-back)!important}
P .v-tl div{gap:12px;font-size:14.5px}
P .v-tl div::before{width:18px;height:18px;margin-top:1px;box-sizing:border-box;background:var(--s-bg);border:1.5px solid var(--k-ink3)}
P .v-tl div::after{left:8.5px;top:20px;width:1px}
P .v-tl .v-dn::before{background:var(--s-ok);border-color:var(--s-ok)}
P .v-tl .v-nw::before{border-color:var(--s-fg);background:radial-gradient(circle,var(--s-fg) 0 4.5px,var(--s-bg) 5px);box-shadow:none}
P [data-testid=od-no]{font:var(--k-hw) 26px/1.1 var(--s-head)!important;letter-spacing:-.018em}
P [data-testid=od-status]{border-radius:calc(var(--k-rs)/2)!important;padding:7px 9px!important;font-weight:620!important}
P [data-testid=od-pay]>div:first-child{font-size:28px!important;line-height:1.1;${NUM}}
P [data-testid=od-link]{color:var(--s-mut)!important}
P [data-testid=od-qr],P [data-testid=od-method-qr]{border-radius:var(--k-rs)!important}
P .v-kv{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14.5px}
P .v-kv>span:first-child{flex:none;color:var(--s-mut)}
P .v-kv>span:last-child{display:flex;align-items:center;justify-content:flex-end;gap:10px;font-weight:560;text-align:right;overflow-wrap:anywhere}
P .v-kv.v-kvc{border-top:1px solid var(--s-line);border-bottom:1px solid var(--s-line);padding:10px 0;margin:4px 0}
P .v-kv.v-kvc>span:last-child{font-size:19px;line-height:1.2;${NUM}}
P .v-kv .v-btn{flex:none;min-height:40px;padding:0 12px;font:600 13px/1 var(--s-font)}
P .v-oksent{display:inline-grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--s-ok);color:var(--s-bg)}

P .v-empty{padding:46px 10px}
P .v-sheet>div{border-radius:var(--s-r) var(--s-r) 0 0;background:var(--s-bg)}
P .v-drawer>div{background:var(--s-bg)}
P .v-drawer h3{font-size:20px}
P .v-cb{min-height:52px;border-radius:var(--k-rs);border-color:var(--k-ink3);background:none}
P .v-qsz button,P .v-qs button{border:1px solid var(--k-ink3);border-radius:var(--k-rs);background:var(--s-bg)}
P .v-toast,P [data-testid=co-toast]{border-radius:var(--k-rs)!important;background:var(--s-fg)!important;color:var(--s-bg)!important;font-weight:500!important}
P .v-bank{border-radius:var(--k-rs)}

P .v-hero{margin-top:16px;border-radius:var(--s-r)}
P .v-slide{min-height:176px;padding:22px 18px;color:var(--on-top1)}
P .v-slide h2{font:var(--k-hw) 27px/1.06 var(--s-head);letter-spacing:-.02em;text-wrap:balance}
P .v-slide p{font-size:14px;opacity:.92}
P .v-slide .v-btn.v-w{background:var(--on-top1);color:var(--top1);min-height:44px}
P .v-slide[style*="url("]{color:#fff}
P .v-slide[style*="url("] .v-btn.v-w{background:#fff;color:#151515}
P .v-dots i.v-on{background:var(--s-fg)}
P .v-trust{gap:0 14px;margin-top:18px;border-top:1px solid var(--s-line)}
P .v-trust div{background:none;border:0;border-bottom:1px solid var(--s-line);border-radius:0;padding:11px 0;font-size:13.5px;font-weight:400}
P .v-trust small{font-size:12.5px}
P .v-trust svg,P.l-market .v-trust svg{color:var(--s-mut)}
P .v-flash{background:none;border-radius:0;padding:0}
@media (prefers-reduced-motion:no-preference){
P .v-btn,P .v-opt,P .v-radio,P .v-chip,P .v-qplus,P .v-bnav button{transition:background-color .15s ease-out,border-color .15s ease-out,box-shadow .15s ease-out,color .15s ease-out}
P .v-btn:active{transform:scale(.98)}
P .v-sheet>div{animation:k4-up .32s cubic-bezier(.16,1,.3,1)}
P .v-drawer>div{animation:k4-up .32s cubic-bezier(.16,1,.3,1)}
P [data-testid=od-status]{animation:k4-stamp .24s cubic-bezier(.16,1,.3,1)}
}
@keyframes k4-up{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
@keyframes k4-stamp{from{transform:scale(1.18);opacity:0}to{transform:none;opacity:1}}
`);
// laptop (from 860 px of the shop's own width, as v2)
const wide = (ann: string, fab: string) => k(`
P .v-wrap{padding:0 28px}
P .v-ann{font-size:13px;padding-inline:${ann}}
P .v-hdr .v-row{flex-wrap:nowrap;gap:14px;min-height:64px}
P .v-logo{flex:none;font-size:22px;max-width:40%}
P .v-logo i,P.l-brand .v-hdr.v-top .v-logo i{width:38px;height:38px}
P .v-logo img{width:38px!important;height:38px!important}
P .v-srch,P .v-srch.v-in,P.l-brand .v-hdr.v-top .v-srch{display:flex;order:0;flex:1;max-width:420px;margin:0 auto 0 18px}
P .v-sbtn{display:none}
P .v-nav{gap:26px;padding:0;height:42px;align-items:center;font-weight:400;font-size:13.5px;border-top:1px solid color-mix(in srgb,var(--on-top1) 16%,transparent)}
P .v-nav button,P.l-brand .v-hdr.v-top .v-nav button{color:inherit;opacity:.9}
P .v-nav button:hover,P.l-brand .v-nav button:hover,P.l-market .v-nav button:hover{color:inherit;opacity:1;text-decoration:underline;text-underline-offset:6px}
P .v-band{padding:52px 0 0}
P .v-band .v-wrap{display:grid;grid-template-columns:5fr 7fr;grid-template-rows:1fr auto;column-gap:56px}
P .v-band h2,P.v-caps .v-band h2{grid-column:1;align-self:end;font-size:56px;letter-spacing:-.03em}
P .v-band p{grid-column:1;margin-top:16px;font-size:17px}
P .v-tiles2{grid-column:2;grid-row:1/span 2;margin-top:0;gap:16px}
P .v-band .v-wrap:has(.v-noband) .v-tiles2{grid-column:1/-1}
P .v-tile{aspect-ratio:auto}
P .v-tile span{font-size:17px;padding-top:12px}
P .v-tline{grid-template-columns:repeat(4,1fr);margin-top:34px;font-size:14.5px}
P .v-tline span{padding:13px 0}
P .v-sec{margin-top:72px}
P .v-sech h3,P.t-bold .v-sech h3{font-size:25px!important}
P .v-hs,P.l-brand .v-hs{gap:16px;margin:0;padding:0 0 2px}
P .v-hs .v-card,P.l-brand .v-hs .v-card{flex:0 0 calc((100% - 64px)/5);max-width:none}
P .v-grid,P.l-brand .v-grid{gap:32px 16px}
P .v-card .v-nm,P.l-brand .v-card .v-nm{font-size:15px}
P .v-pr b,P.l-brand .v-pr b,P.l-market .v-pr b{font-size:20px}
P .v-arrows{display:inline-flex;gap:6px}
P .v-promo{grid-template-columns:1fr auto;align-items:center;column-gap:32px;padding:28px 32px}
P .v-promo h3{font-size:25px}
P .v-ptiles{margin:0;padding:0;gap:16px}
P .v-pt{flex:0 0 calc((100% - 96px)/7)}
P .v-cats{gap:26px;justify-content:flex-start}
P .v-cat,P .v-cat .v-art,P.t-bou .v-cat .v-art,P.t-bold .v-cat .v-art{width:112px}
P .v-cat .v-art,P.t-bou .v-cat .v-art,P.t-bold .v-cat .v-art{height:112px}
P .v-live{display:grid;grid-template-columns:1fr auto;align-items:center;column-gap:40px;padding:22px 0}
P .v-steps{grid-template-columns:repeat(3,1fr);gap:0 32px}
P .v-foot,P.l-brand .v-foot{margin-top:88px}
P .v-fcols{grid-template-columns:1.3fr 1fr 1fr 1.4fr;column-gap:56px}
P .v-gal{margin:0}
P .v-pdp{grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:64px}
P .v-pi{margin-top:0}
P .v-pi h2{font-size:36px}
P .v-pi .v-pr b,P.l-brand .v-pi .v-pr b{font-size:38px}
P .v-two{grid-template-columns:minmax(0,1fr) 388px;gap:72px}
P .v-stp{padding:20px 0 16px}
P .v-slide{min-height:330px;padding:44px 64px}
P .v-slide h2{font-size:48px}
P .v-slide p{font-size:16px}
P .v-trust{grid-template-columns:repeat(4,1fr)}
P .v-sheet>div{border-radius:var(--s-r)}
P .v-toast{bottom:30px}
P .v-fab{display:grid;right:16px;bottom:24px;width:52px;height:52px;border-radius:max(var(--k-rs),4px);background:var(--s-acc);color:var(--s-on);box-shadow:0 6px 18px rgba(0,0,0,.2),0 0 0 1px color-mix(in srgb,var(--s-bg) 40%,transparent)}
P.k4-fab .v-main .v-wrap,P.k4-fab .v-foot .v-wrap{padding-inline:${fab}}
`);
// The chat button (laptop) sits in a lane at the right edge that the page column never enters: the column's
// side padding grows to 84 px whenever the free margin beside the 1180 px column is narrower than that.
const FAB_LANE = (w: string) => `max(28px,calc(84px - max(0px,(${w} - 1180px)/2)))`;
const ANN_LANE = (w: string) => `max(28px,calc((${w} - 1180px)/2 + 28px))`;
const wideFor = (w: string) => wide(ANN_LANE(w), FAB_LANE(w));
const HOVER = k(`
P.l-brand .v-card:hover .v-qs{display:grid}
P .v-qs{background:var(--s-bg);padding:10px;gap:6px}
P .v-qs button{margin:0;min-height:40px}
P .v-qs button:not(:disabled):hover{background:var(--s-fg);color:var(--s-bg)}
@media (prefers-reduced-motion:no-preference){
P .v-card .v-art,P .v-tile img,P .v-pt .v-art{transition:transform .5s cubic-bezier(.16,1,.3,1)}
P .v-card:hover .v-art,P .v-tile:hover img,P .v-pt:hover .v-art{transform:scale(1.03)}
}
`);
export const V4_CSS = `${BASE}
@container vp (min-width:860px){${wideFor("100cqw")}@media (hover:hover){${HOVER}}}
@supports not (container-type:inline-size){@media (min-width:860px){${wideFor("100vw")}}@media (min-width:860px) and (hover:hover){${HOVER}}}
`;
