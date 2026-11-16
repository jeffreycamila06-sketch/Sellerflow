// Seller Website v2 — the storefront look, ported from docs/design/seller-website-v2/site-v2.html (its
// SHOP styles, every class prefixed v- and scoped under .sfl-v2 so nothing leaks into the seller app when
// the shop shows inside the editor preview). Three themes: t-pop / t-bou / t-bold. Laptop layout from
// 860 px of the shop's own width (container query; plain media query where container queries are missing).
const BASE = `
.sfl-v2{container:vp/inline-size;display:flex;flex-direction:column;min-height:100vh;min-height:100dvh;position:relative;-webkit-text-size-adjust:100%;background:var(--s-bg);color:var(--s-fg);font-family:var(--s-font);font-size:14px;line-height:1.4}
.sfl-v2.t-pop{--s-bg:#f5f5f7;--s-fg:#17181c;--s-mut:#6c7080;--s-card:#fff;--s-line:#e8e9ee;--s-acc:#ee4d2d;--s-acc2:#fff3ef;--s-on:#fff;--s-ok:#16a34a;--s-font:"Plus Jakarta Sans",system-ui,sans-serif;--s-head:"Plus Jakarta Sans",system-ui,sans-serif;--s-r:14px;--s-hero:linear-gradient(120deg,#ff7a45,#ee4d2d 55%,#c81e4a)}
.sfl-v2.t-bou{--s-bg:#faf6f0;--s-fg:#2a2420;--s-mut:#7d7268;--s-card:#fffdf9;--s-line:#e9e0d3;--s-acc:#2f4a3a;--s-acc2:#edf2ec;--s-on:#fff;--s-ok:#2f7a4d;--s-font:Inter,system-ui,sans-serif;--s-head:Fraunces,Georgia,serif;--s-r:6px;--s-hero:linear-gradient(120deg,#d9c7ae,#c8a98a 60%,#a98567)}
.sfl-v2.t-bold{--s-bg:#0e0f12;--s-fg:#f3f4f6;--s-mut:#9a9eaa;--s-card:#191b21;--s-line:#2a2d36;--s-acc:#d7ff3e;--s-acc2:#23261a;--s-on:#0e0f12;--s-ok:#5fe08a;--s-font:Inter,system-ui,sans-serif;--s-head:"Space Grotesk",system-ui,sans-serif;--s-r:4px;--s-hero:linear-gradient(120deg,#22252e,#3a2a6b 60%,#6b2a5a)}
.sfl-v2 button{font-family:inherit;cursor:pointer}
.sfl-v2 .v-scr{flex:1;overflow-y:auto;overflow-x:hidden;scrollbar-width:thin}
.sfl-v2 .v-wrap{max-width:1180px;margin:0 auto;padding:0 12px}
.sfl-v2 h2,.sfl-v2 h3,.sfl-v2 .v-hd{font-family:var(--s-head);letter-spacing:-.01em;margin:0}
.sfl-v2 .v-ann{background:var(--s-fg);color:var(--s-bg);text-align:center;font-size:12px;font-weight:600;padding:7px 12px}
.sfl-v2 .v-hdr{position:sticky;top:0;z-index:30;background:var(--s-card);border-bottom:1px solid var(--s-line)}
.sfl-v2 .v-hdr .v-row{display:flex;align-items:center;gap:10px;padding:9px 0}
.sfl-v2 .v-logo{display:flex;align-items:center;gap:8px;font:700 17px var(--s-head);border:0;background:none;color:inherit;padding:0}
.sfl-v2 .v-logo i{width:30px;height:30px;border-radius:50%;background:var(--s-acc);color:var(--s-on);display:grid;place-items:center;font:800 15px var(--s-head);font-style:normal}
.sfl-v2 .v-srch{flex:1;min-width:0;display:flex;align-items:center;gap:6px;background:var(--s-bg);border:1px solid var(--s-line);border-radius:999px;padding:8px 12px;color:var(--s-mut);font-size:13px}
.sfl-v2 .v-srch input{border:0;background:transparent;outline:0;flex:1;min-width:0;font:inherit;color:var(--s-fg)}
.sfl-v2 .v-ib{position:relative;border:0;background:none;color:inherit;width:36px;height:36px;display:grid;place-items:center;border-radius:50%;flex:none}
.sfl-v2 .v-ib svg{width:22px;height:22px}
.sfl-v2 .v-ib b{position:absolute;top:0;right:0;background:var(--s-acc);color:var(--s-on);font:700 10px Inter;min-width:16px;height:16px;border-radius:8px;display:grid;place-items:center;padding:0 4px}
.sfl-v2 .v-nav{display:none;gap:22px;padding:0 0 10px;font-weight:600;font-size:13.5px}
.sfl-v2 .v-nav button{border:0;background:none;color:var(--s-mut);padding:0;font:inherit}
.sfl-v2 .v-nav button:hover{color:var(--s-acc)}
.sfl-v2 .v-lname{display:none}
.sfl-v2 .v-hero{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;border-radius:var(--s-r);margin-top:10px}
.sfl-v2 .v-hero::-webkit-scrollbar{display:none}
.sfl-v2 .v-slide{flex:0 0 100%;scroll-snap-align:start;min-height:176px;padding:20px 18px;display:flex;align-items:center;justify-content:space-between;gap:8px;color:#fff;position:relative;overflow:hidden}
.sfl-v2 .v-slide h2{font-size:25px;line-height:1.08;max-width:11em}
.sfl-v2 .v-slide p{margin:6px 0 12px;font-size:13px;opacity:.92;max-width:22em}
.sfl-v2 .v-slide .v-art{width:120px;height:120px;flex:none;background:transparent!important;filter:drop-shadow(0 10px 14px rgba(0,0,0,.3))}
.sfl-v2 .v-btn{border:0;border-radius:999px;background:var(--s-acc);color:var(--s-on);font-weight:700;font-size:13.5px;padding:11px 18px}
.sfl-v2.t-bou .v-btn,.sfl-v2.t-bold .v-btn{border-radius:var(--s-r)}
.sfl-v2 .v-btn.v-w{background:#fff;color:#17181c}
.sfl-v2 .v-btn.v-o{background:transparent;color:var(--s-fg);border:1.5px solid var(--s-fg)}
.sfl-v2 .v-btn.v-full{width:100%;padding:14px}
.sfl-v2 .v-btn:disabled{opacity:.45;cursor:not-allowed}
.sfl-v2 .v-dots{display:flex;justify-content:center;gap:5px;margin:8px 0 0}
.sfl-v2 .v-dots i{width:6px;height:6px;border-radius:3px;background:var(--s-line)}
.sfl-v2 .v-dots i.v-on{width:16px;background:var(--s-acc)}
.sfl-v2 .v-trust{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.sfl-v2 .v-trust div{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:9px 10px;display:flex;gap:8px;align-items:center;font-size:12px;font-weight:600}
.sfl-v2 .v-trust small{display:block;font-weight:400;color:var(--s-mut);font-size:11px}
.sfl-v2 .v-trust svg{width:20px;height:20px;color:var(--s-acc);flex:none}
.sfl-v2 .v-sec{margin-top:22px}
.sfl-v2 .v-sech{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}
.sfl-v2 .v-sech h3{font-size:19px}
.sfl-v2 .v-sech button{border:0;background:none;color:var(--s-acc);font-weight:700;font-size:13px;padding:0}
.sfl-v2.t-bold .v-sech h3{text-transform:uppercase}
.sfl-v2 .v-cats{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.sfl-v2 .v-cats::-webkit-scrollbar{display:none}
.sfl-v2 .v-cat{flex:none;width:68px;border:0;background:none;color:inherit;padding:0;text-align:center;font-size:11.5px;font-weight:600}
.sfl-v2 .v-cat .v-art{width:68px;height:68px;border-radius:50%;margin-bottom:5px;border:2px solid var(--s-card);box-shadow:0 0 0 1px var(--s-line)}
.sfl-v2.t-bou .v-cat .v-art,.sfl-v2.t-bold .v-cat .v-art{border-radius:var(--s-r)}
.sfl-v2 .v-live{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.sfl-v2 .v-live .v-pill{background:#e11d48;color:#fff;font:700 11px Inter;padding:3px 8px;border-radius:4px;letter-spacing:.05em}
.sfl-v2 .v-live .v-tx{flex:1;min-width:150px}
.sfl-v2 .v-live .v-tx b{font:700 15.5px var(--s-head);display:block;margin-top:3px}
.sfl-v2 .v-live .v-tx span{color:var(--s-mut);font-size:12.5px}
.sfl-v2 .v-flash{background:var(--s-acc2);border-radius:var(--s-r);padding:12px}
.sfl-v2 .v-cd{display:inline-flex;gap:3px;align-items:center;font:700 12px Inter}
.sfl-v2 .v-cd i{background:var(--s-fg);color:var(--s-bg);border-radius:4px;padding:2px 5px;font-style:normal}
.sfl-v2 .v-hs{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px}
.sfl-v2 .v-hs::-webkit-scrollbar{display:none}
.sfl-v2 .v-hs .v-card{flex:0 0 142px}
.sfl-v2 .v-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.sfl-v2 .v-card{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);overflow:hidden;position:relative;display:flex;flex-direction:column;cursor:pointer}
.sfl-v2 .v-card .v-ph{position:relative;aspect-ratio:1/1.12;overflow:hidden}
.sfl-v2 .v-card .v-imgs{display:flex;height:100%;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none}
.sfl-v2 .v-card .v-imgs::-webkit-scrollbar{display:none}
.sfl-v2 .v-card .v-imgs .v-art{flex:0 0 100%;height:100%;scroll-snap-align:start}
.sfl-v2 .v-art{display:block;width:100%;height:100%}
.sfl-v2 .v-bdg{position:absolute;top:7px;left:7px;display:flex;flex-direction:column;gap:4px;align-items:flex-start;z-index:2}
.sfl-v2 .v-bdg span{font:700 10.5px Inter;padding:3px 7px;border-radius:4px;background:var(--s-acc);color:var(--s-on)}
.sfl-v2 .v-bdg .v-n{background:var(--s-fg);color:var(--s-bg)}
.sfl-v2 .v-bdg .v-l{background:#f59e0b;color:#1c1300}
.sfl-v2 .v-bdg .v-x{background:#6b7280;color:#fff}
.sfl-v2 .v-rank{position:absolute;top:0;left:8px;background:#f59e0b;color:#1c1300;font:800 12px Inter;padding:4px 7px 6px;border-radius:0 0 6px 6px;z-index:2}
.sfl-v2 .v-hrt{position:absolute;top:6px;right:6px;z-index:2;width:30px;height:30px;border-radius:50%;border:0;background:rgba(255,255,255,.9);color:#17181c;display:grid;place-items:center}
.sfl-v2 .v-hrt svg{width:16px;height:16px}
.sfl-v2 .v-hrt.v-on{color:#e11d48}
.sfl-v2 .v-hrt.v-on svg{fill:#e11d48}
.sfl-v2 .v-pd3{position:absolute;bottom:6px;left:50%;transform:translateX(-50%);display:flex;gap:3px;z-index:2}
.sfl-v2 .v-pd3 i{width:5px;height:5px;border-radius:50%;background:rgba(0,0,0,.25)}
.sfl-v2 .v-pd3 i:first-child{background:rgba(0,0,0,.6)}
.sfl-v2 .v-card .v-inf{padding:8px 9px 10px;display:flex;flex-direction:column;gap:4px;flex:1}
.sfl-v2 .v-card .v-nm{font-size:13px;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.6em}
.sfl-v2 .v-sw{display:flex;gap:4px;align-items:center;min-height:14px}
.sfl-v2 .v-sw i{width:12px;height:12px;border-radius:50%;border:1px solid rgba(128,128,128,.4)}
.sfl-v2 .v-sw small{font-size:10.5px;color:var(--s-mut)}
.sfl-v2 .v-pr{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.sfl-v2 .v-pr b{color:var(--s-acc);font:800 15.5px var(--s-head)}
.sfl-v2 .v-pr s{color:var(--s-mut);font-size:11.5px}
.sfl-v2.t-bou .v-pr b{color:var(--s-fg)}
.sfl-v2 .v-meta{display:flex;justify-content:space-between;align-items:center;color:var(--s-mut);font-size:11px;margin-top:auto}
.sfl-v2 .v-qa{width:30px;height:30px;border-radius:50%;border:0;background:var(--s-acc);color:var(--s-on);font:700 18px Inter;line-height:1;display:grid;place-items:center}
.sfl-v2.t-bou .v-qa,.sfl-v2.t-bold .v-qa{border-radius:var(--s-r)}
.sfl-v2 .v-sold .v-art{filter:grayscale(1) opacity(.55)}
.sfl-v2 .v-promo{border-radius:var(--s-r);background:var(--s-fg);color:var(--s-bg);padding:18px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.sfl-v2 .v-promo h3{font-size:20px}
.sfl-v2 .v-promo p{margin:4px 0 0;opacity:.8;font-size:13px}
.sfl-v2 .v-vch{display:flex;gap:10px;overflow-x:auto;scrollbar-width:none}
.sfl-v2 .v-vch::-webkit-scrollbar{display:none}
.sfl-v2 .v-vc{flex:0 0 232px;display:flex;border:1.5px dashed var(--s-acc);border-radius:var(--s-r);background:var(--s-acc2);overflow:hidden}
.sfl-v2 .v-vc div{flex:1;padding:10px 12px}
.sfl-v2 .v-vc b{font:800 17px var(--s-head);color:var(--s-acc);display:block}
.sfl-v2 .v-vc small{color:var(--s-mut);font-size:11.5px}
.sfl-v2.t-bold .v-vc b{color:var(--s-acc)}
.sfl-v2 .v-vc button{border:0;background:var(--s-acc);color:var(--s-on);font-weight:700;font-size:12px;padding:0 12px}
.sfl-v2 .v-rev{display:grid;gap:10px}
.sfl-v2 .v-rv{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:12px}
.sfl-v2 .v-stars{color:#f59e0b;letter-spacing:1px;font-size:13px}
.sfl-v2 .v-rv p{margin:6px 0;font-size:13px}
.sfl-v2 .v-rv small{color:var(--s-mut);font-size:11.5px}
.sfl-v2 .v-about{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:16px}
.sfl-v2 .v-about p{color:var(--s-mut);margin:8px 0 12px;font-size:13.5px}
.sfl-v2 .v-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}
.sfl-v2 .v-stats b{font:800 18px var(--s-head);display:block}
.sfl-v2 .v-stats span{font-size:11px;color:var(--s-mut)}
.sfl-v2 .v-steps{display:grid;gap:8px}
.sfl-v2 .v-step{display:flex;gap:10px;align-items:flex-start;background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:12px}
.sfl-v2 .v-step i{flex:none;width:26px;height:26px;border-radius:50%;background:var(--s-acc);color:var(--s-on);font:800 13px Inter;display:grid;place-items:center;font-style:normal}
.sfl-v2 .v-step b{display:block;font-size:13.5px}
.sfl-v2 .v-step span{color:var(--s-mut);font-size:12.5px}
.sfl-v2 details{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:12px 14px;margin-bottom:8px}
.sfl-v2 summary{font-weight:700;font-size:13.5px;cursor:pointer}
.sfl-v2 details p{margin:8px 0 0;color:var(--s-mut);font-size:13px}
.sfl-v2 .v-foot{margin-top:26px;background:var(--s-card);border-top:1px solid var(--s-line);padding:20px 0 26px;font-size:12.5px;color:var(--s-mut)}
.sfl-v2 .v-fcols{display:grid;gap:16px}
.sfl-v2 .v-foot b{color:var(--s-fg);display:block;margin-bottom:6px;font-size:13px}
.sfl-v2 .v-soc{display:flex;gap:8px;flex-wrap:wrap}
.sfl-v2 .v-soc span{width:34px;height:34px;border-radius:50%;background:var(--s-bg);border:1px solid var(--s-line);display:grid;place-items:center;font:700 11px Inter;color:var(--s-fg)}
.sfl-v2 .v-pay{display:flex;gap:6px;flex-wrap:wrap}
.sfl-v2 .v-pay span{border:1px solid var(--s-line);border-radius:5px;padding:4px 8px;font:700 11px Inter;color:var(--s-fg);background:var(--s-bg)}
.sfl-v2 .v-pw{text-align:center;margin-top:16px;font-size:11.5px}
.sfl-v2 .v-bnav{display:grid;grid-template-columns:repeat(5,1fr);background:var(--s-card);border-top:1px solid var(--s-line);padding:6px 0 calc(10px + env(safe-area-inset-bottom));flex:none;position:sticky;bottom:0;z-index:30}
.sfl-v2 .v-bnav button{border:0;background:none;color:var(--s-mut);font:600 10.5px var(--s-font);display:grid;justify-items:center;gap:2px;position:relative}
.sfl-v2 .v-bnav svg{width:21px;height:21px}
.sfl-v2 .v-bnav .v-on{color:var(--s-acc)}
.sfl-v2 .v-bnav b{position:absolute;top:-3px;left:54%;background:var(--s-acc);color:var(--s-on);font:700 9.5px Inter;min-width:15px;height:15px;border-radius:8px;display:grid;place-items:center;padding:0 3px}
.sfl-v2 .v-buy{display:flex;gap:8px;background:var(--s-card);border-top:1px solid var(--s-line);padding:8px 12px calc(12px + env(safe-area-inset-bottom));flex:none;align-items:center;position:sticky;bottom:0;z-index:30}
.sfl-v2 .v-buy .v-btn{flex:1;padding:13px 8px}
.sfl-v2 .v-buy .v-tot{flex:1;font-size:12px;color:var(--s-mut)}
.sfl-v2 .v-buy .v-tot b{display:block;color:var(--s-fg);font:800 17px var(--s-head)}
.sfl-v2 .v-fab{position:fixed;right:14px;bottom:calc(74px + env(safe-area-inset-bottom));text-decoration:none;z-index:25;width:50px;height:50px;border-radius:50%;border:0;background:#06c755;color:#fff;display:grid;place-items:center;box-shadow:0 6px 16px rgba(0,0,0,.25)}
.sfl-v2 .v-fab svg{width:25px;height:25px}
.sfl-v2 .v-chips{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;padding:10px 0}
.sfl-v2 .v-chips::-webkit-scrollbar{display:none}
.sfl-v2 .v-chip{flex:none;border:1px solid var(--s-line);background:var(--s-card);color:var(--s-fg);border-radius:999px;padding:7px 13px;font-size:12.5px;font-weight:600}
.sfl-v2 .v-chip.v-on{background:var(--s-fg);color:var(--s-bg);border-color:var(--s-fg)}
.sfl-v2 .v-tool{display:flex;justify-content:space-between;align-items:center;gap:8px;color:var(--s-mut);font-size:12.5px;margin-bottom:10px}
.sfl-v2 .v-tool select{border:1px solid var(--s-line);background:var(--s-card);color:var(--s-fg);border-radius:8px;padding:7px 8px;font:600 12.5px var(--s-font)}
.sfl-v2 .v-crumb{font-size:12px;color:var(--s-mut);padding:10px 0}
.sfl-v2 .v-crumb button{border:0;background:none;color:inherit;padding:0;font:inherit;text-decoration:underline}
.sfl-v2 .v-pdp{display:grid;gap:14px}
.sfl-v2 .v-gal{position:relative;border-radius:var(--s-r);overflow:hidden;background:var(--s-card)}
.sfl-v2 .v-gal .v-imgs{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;aspect-ratio:1/1}
.sfl-v2 .v-gal .v-imgs::-webkit-scrollbar{display:none}
.sfl-v2 .v-gal .v-imgs .v-art{flex:0 0 100%;scroll-snap-align:start}
.sfl-v2 .v-gal .v-cnt{position:absolute;bottom:10px;right:10px;background:rgba(0,0,0,.55);color:#fff;font:600 11px Inter;padding:3px 8px;border-radius:10px}
.sfl-v2 .v-ths{display:flex;gap:8px;margin-top:8px}
.sfl-v2 .v-ths button{width:58px;height:58px;border-radius:var(--s-r);overflow:hidden;border:2px solid var(--s-line);padding:0;background:none}
.sfl-v2 .v-ths button.v-on{border-color:var(--s-acc)}
.sfl-v2 .v-pi h2{font-size:21px;line-height:1.2}
.sfl-v2 .v-pi .v-pr b{font-size:25px}
.sfl-v2 .v-pi .v-pr s{font-size:14px}
.sfl-v2 .v-off{background:var(--s-acc);color:var(--s-on);font:700 11px Inter;padding:2px 6px;border-radius:4px}
.sfl-v2 .v-sub{color:var(--s-mut);font-size:12.5px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:4px}
.sfl-v2 .v-box{background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:13px}
.sfl-v2 .v-lbl{font-weight:700;font-size:13px;margin-bottom:8px;display:flex;justify-content:space-between}
.sfl-v2 .v-lbl button{border:0;background:none;color:var(--s-acc);font:600 12px var(--s-font);padding:0;text-decoration:underline}
.sfl-v2 .v-opts{display:flex;gap:8px;flex-wrap:wrap}
.sfl-v2 .v-opt{min-width:46px;border:1.5px solid var(--s-line);background:var(--s-card);color:var(--s-fg);border-radius:8px;padding:9px 12px;font-weight:600;font-size:13px;display:flex;gap:6px;align-items:center}
.sfl-v2.t-bou .v-opt,.sfl-v2.t-bold .v-opt{border-radius:var(--s-r)}
.sfl-v2 .v-opt.v-on{border-color:var(--s-acc);box-shadow:0 0 0 1px var(--s-acc)}
.sfl-v2 .v-opt:disabled{opacity:.4;text-decoration:line-through;cursor:not-allowed}
.sfl-v2 .v-opt i{width:14px;height:14px;border-radius:50%;border:1px solid rgba(128,128,128,.4)}
.sfl-v2 .v-qty{display:inline-flex;align-items:center;border:1.5px solid var(--s-line);border-radius:8px;overflow:hidden}
.sfl-v2 .v-qty button{border:0;background:var(--s-card);color:var(--s-fg);width:36px;height:36px;font-size:18px}
.sfl-v2 .v-qty span{min-width:34px;text-align:center;font-weight:700}
.sfl-v2 .v-rows{display:grid;gap:9px;font-size:13px}
.sfl-v2 .v-rows div{display:flex;gap:10px}
.sfl-v2 .v-rows svg{width:18px;height:18px;flex:none;color:var(--s-acc);margin-top:1px}
.sfl-v2 .v-rows small{display:block;color:var(--s-mut);font-size:12px}
.sfl-v2 .v-spec{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:13px}
.sfl-v2 .v-spec span{color:var(--s-mut)}
.sfl-v2 .v-ci{display:flex;gap:10px;background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:10px;margin-bottom:8px}
.sfl-v2 .v-ci .v-art{width:74px;height:74px;border-radius:8px;flex:none}
.sfl-v2 .v-ci .v-m{flex:1;min-width:0}
.sfl-v2 .v-ci .v-m b{display:block;font-size:13.5px}
.sfl-v2 .v-ci .v-m small{color:var(--s-mut)}
.sfl-v2 .v-ci .v-x{border:0;background:none;color:var(--s-mut);font-size:12px;text-decoration:underline;padding:0}
.sfl-v2 .v-prog{height:6px;background:var(--s-line);border-radius:3px;overflow:hidden;margin-top:6px}
.sfl-v2 .v-prog i{display:block;height:100%;background:var(--s-ok)}
.sfl-v2 .v-sum{display:grid;gap:7px;font-size:13.5px}
.sfl-v2 .v-sum div{display:flex;justify-content:space-between}
.sfl-v2 .v-sum .v-t{font:800 17px var(--s-head);border-top:1px solid var(--s-line);padding-top:9px;margin-top:2px}
.sfl-v2 .v-sum .v-g{color:var(--s-ok)}
.sfl-v2 .v-fld{display:grid;gap:5px;margin-bottom:10px;font-size:12.5px;font-weight:600}
.sfl-v2 .v-fld input,.sfl-v2 .v-fld textarea{border:1.5px solid var(--s-line);background:var(--s-bg);color:var(--s-fg);border-radius:8px;padding:11px 12px;font:400 16px var(--s-font);width:100%}
.sfl-v2 .v-radio{display:flex;gap:10px;align-items:flex-start;border:1.5px solid var(--s-line);border-radius:10px;padding:11px 12px;margin-bottom:8px;background:var(--s-card);color:var(--s-fg);width:100%;text-align:left;font-size:13.5px}
.sfl-v2 .v-radio.v-on{border-color:var(--s-acc);background:var(--s-acc2)}
.sfl-v2 .v-radio i{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid var(--s-mut);margin-top:1px}
.sfl-v2 .v-radio.v-on i{border:5px solid var(--s-acc)}
.sfl-v2 .v-radio b{display:block}
.sfl-v2 .v-radio small{color:var(--s-mut)}
.sfl-v2 .v-radio em{margin-left:auto;font-style:normal;font-weight:700;white-space:nowrap}
.sfl-v2 .v-stp{display:flex;gap:6px;font-size:12px;font-weight:700;color:var(--s-mut);padding:12px 0 4px}
.sfl-v2 .v-stp span.v-on{color:var(--s-acc)}
.sfl-v2 .v-tl{display:grid;gap:0}
.sfl-v2 .v-tl div{display:flex;gap:12px;padding-bottom:16px;position:relative;color:var(--s-mut);font-size:13px}
.sfl-v2 .v-tl div::before{content:"";flex:none;width:14px;height:14px;border-radius:50%;background:var(--s-line);margin-top:2px;z-index:1}
.sfl-v2 .v-tl div::after{content:"";position:absolute;left:6px;top:14px;bottom:0;width:2px;background:var(--s-line)}
.sfl-v2 .v-tl div:last-child::after{display:none}
.sfl-v2 .v-tl .v-dn{color:var(--s-fg)}
.sfl-v2 .v-tl .v-dn::before{background:var(--s-ok)}
.sfl-v2 .v-tl .v-nw::before{background:var(--s-acc);box-shadow:0 0 0 4px var(--s-acc2)}
.sfl-v2 .v-tl .v-nw{color:var(--s-fg);font-weight:700}
.sfl-v2 .v-note{background:var(--s-acc2);border-radius:var(--s-r);padding:11px 13px;font-size:13px}
.sfl-v2 .v-bank{font:600 14px ui-monospace,Menlo,monospace;background:var(--s-bg);border:1px dashed var(--s-line);border-radius:8px;padding:10px;margin:8px 0}
.sfl-v2 .v-empty{text-align:center;color:var(--s-mut);padding:46px 10px}
.sfl-v2 .v-empty .v-art{width:110px;height:110px;margin:0 auto 10px;border-radius:50%}
.sfl-v2 .v-sheet{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center}
.sfl-v2 .v-sheet>div{background:var(--s-card);color:var(--s-fg);width:100%;max-width:440px;border-radius:18px 18px 0 0;padding:16px 16px 22px;max-height:82%;overflow:auto}
.sfl-v2 .v-sheet h3{font-size:17px;margin-bottom:10px}
.sfl-v2 .v-cb{display:flex;align-items:center;gap:10px;width:100%;border:1px solid var(--s-line);background:var(--s-bg);color:var(--s-fg);border-radius:10px;padding:12px;font-weight:700;margin-bottom:8px}
.sfl-v2 .v-cb i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;color:#fff;font:800 11px Inter;font-style:normal}
.sfl-v2 table{border-collapse:collapse;width:100%;font-size:13px}
.sfl-v2 td,.sfl-v2 th{border:1px solid var(--s-line);padding:7px;text-align:center}
.sfl-v2 .v-toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));max-width:calc(100vw - 32px);white-space:normal;text-align:center;transform:translateX(-50%);background:#17181c;color:#fff;padding:10px 16px;border-radius:999px;font-size:13px;font-weight:600;z-index:70;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.sfl-v2 .v-two{display:grid;gap:14px}
.sfl-v2 .v-dbuy{display:none;gap:10px;margin-top:4px}
.sfl-v2 .v-dbuy .v-btn{flex:1;padding:15px}
.sfl-v2 .v-fside{display:none;background:var(--s-card);border:1px solid var(--s-line);border-radius:var(--s-r);padding:14px;font-size:13px;position:sticky;top:120px}
.sfl-v2 .v-fside b{display:block;margin:10px 0 6px}
.sfl-v2 .v-fside b:first-child{margin-top:0}
.sfl-v2 .v-fside button{display:block;border:0;background:none;color:var(--s-mut);padding:4px 0;font:500 13px var(--s-font);text-align:left}
.sfl-v2 .v-fside button.v-on{color:var(--s-acc);font-weight:700}
.sfl-v2 *{box-sizing:border-box}
.sfl-v2 input,.sfl-v2 textarea,.sfl-v2 select{font-family:inherit;font-size:16px}
.sfl-v2 a{color:inherit}
.sfl-v2 .v-main{flex:1 0 auto}
.sfl-v2 img.v-art{object-fit:cover}
.sfl-v2 .v-ph0{display:grid;place-items:center;font:800 38px var(--s-head);color:var(--s-mut);background:var(--s-line)}
.sfl-v2 .v-bnav button,.sfl-v2 .v-bnav a{border:0;background:none;color:var(--s-mut);font:600 10.5px var(--s-font);display:grid;justify-items:center;gap:2px;position:relative;text-decoration:none;min-height:44px;align-content:center}
.sfl-v2 .v-bnav .v-on{color:var(--s-acc)}
.sfl-v2 .v-err{color:#dc2626;font-size:12px;font-weight:600;margin-top:-4px;margin-bottom:8px}
.sfl-v2 .v-fld select{border:1.5px solid var(--s-line);background:var(--s-bg);color:var(--s-fg);border-radius:8px;padding:11px 10px;font:400 16px var(--s-font);width:100%}
.sfl-v2 .v-fld .v-bad,.sfl-v2 .v-fld input.v-bad,.sfl-v2 .v-fld textarea.v-bad,.sfl-v2 .v-fld select.v-bad{border-color:#dc2626}
.sfl-v2 .v-radio:disabled{opacity:.5;cursor:not-allowed}
.sfl-v2 .v-radio.v-bad{border-color:#dc2626}
.sfl-v2 .v-hide{display:none!important}
@media (prefers-reduced-motion:reduce){.sfl-v2 *{scroll-behavior:auto!important}}
`;
const WIDE = `
.sfl-v2 .v-wrap{padding:0 28px}
.sfl-v2 .v-hdr .v-row{gap:22px;padding:14px 0}
.sfl-v2 .v-logo{font-size:21px}
.sfl-v2 .v-logo i{width:36px;height:36px}
.sfl-v2 .v-lname{display:inline}
.sfl-v2 .v-srch{max-width:520px;margin:0 auto}
.sfl-v2 .v-nav{display:flex}
.sfl-v2 .v-bnav{display:none}
.sfl-v2 .v-fab{bottom:24px;right:24px;width:56px;height:56px}
.sfl-v2 .v-slide{min-height:330px;padding:44px 64px}
.sfl-v2 .v-slide h2{font-size:48px}
.sfl-v2 .v-slide p{font-size:16px}
.sfl-v2 .v-slide .v-art{width:250px;height:250px}
.sfl-v2 .v-trust{grid-template-columns:repeat(4,1fr)}
.sfl-v2 .v-trust div{padding:13px 14px;font-size:13px}
.sfl-v2 .v-cats{gap:26px;justify-content:center}
.sfl-v2 .v-cat{width:104px;font-size:13px}
.sfl-v2 .v-cat .v-art{width:104px;height:104px}
.sfl-v2 .v-grid{grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}
.sfl-v2 .v-grid.v-g4{grid-template-columns:repeat(4,minmax(0,1fr))}
.sfl-v2 .v-hs .v-card{flex-basis:190px}
.sfl-v2 .v-sech h3{font-size:25px}
.sfl-v2 .v-sec{margin-top:36px}
.sfl-v2 .v-rev{grid-template-columns:repeat(3,1fr)}
.sfl-v2 .v-steps{grid-template-columns:repeat(3,1fr)}
.sfl-v2 .v-fcols{grid-template-columns:2fr 1fr 1fr 1fr}
.sfl-v2 .v-pdp{grid-template-columns:1.05fr 1fr;gap:36px;align-items:start}
.sfl-v2 .v-pi h2{font-size:29px}
.sfl-v2 .v-two{grid-template-columns:1.5fr 1fr;gap:28px;align-items:start}
.sfl-v2 .v-two .v-side{position:sticky;top:120px}
.sfl-v2 .v-buy{display:none}
.sfl-v2 .v-dbuy{display:flex!important}
.sfl-v2 .v-list{display:grid;grid-template-columns:210px 1fr;gap:28px;align-items:start}
.sfl-v2 .v-fside{display:block!important}
.sfl-v2 .v-chips.v-fc{display:none}
.sfl-v2 .v-promo{padding:30px 40px}
.sfl-v2 .v-promo h3{font-size:28px}
.sfl-v2 .v-sheet{align-items:center}
.sfl-v2 .v-sheet>div{border-radius:18px}
.sfl-v2 .v-toast{bottom:30px}
.sfl-v2 .v-fab{bottom:24px}
`;
export const V2_CSS = `${BASE}
@container vp (min-width:860px){${WIDE}}
@supports not (container-type:inline-size){@media (min-width:860px){${WIDE}}}
`;
