const { chromium } = require("playwright");
const TW = "50,80,100,120,150,180,200,250,300,350,400,500";
const TWB = "1500,2000,2500,3000,3500,4000,4500,5000,6000,7000,8000,12000";
const DEV = [["android-360x640",360,640],["android-360x780",360,780],["iphone-390x844",390,844],["android-412x915",412,915],["laptop-1280x800",1280,800]];
(async()=>{const b=await chromium.launch();
for (const [nm,qs] of [["12+free",`view=pop&free=1&wait=2&prices=${TW}`],["12+free NT$ big",`view=pop&free=1&wait=2&cur=NT$&prices=${TWB}`],["9+free",`view=pop&free=1&wait=2&prices=50,80,100,120,150,180,200,250,300`]]) for (const [l,w,h] of DEV){
 const p=await b.newPage({viewport:{width:w,height:h}});
 await p.goto(`http://localhost:5199/docs/design/choose-price-twelve/harness/index.html?${qs}`,{waitUntil:"networkidle"});
 await p.waitForSelector("[data-testid=cpp-price-0]"); await p.waitForTimeout(500);
 const m=await p.evaluate(()=>{const q=s=>document.querySelector(s),r=e=>e.getBoundingClientRect();const sh=q("[data-testid=cpp-sheet]");const sk=q("[data-testid=cpp-skip]");const fr=q("[data-testid=cpp-free]");
 return {sheetH:Math.round(r(sh).height),scrolls:sh.scrollHeight>sh.clientHeight,overflow:sh.scrollHeight-sh.clientHeight,skipVisible:r(sk).bottom<=innerHeight,freeBottom:fr?Math.round(r(fr).bottom):null,vh:innerHeight,cut:[...document.querySelectorAll("[data-testid^=cpp-price-]")].filter(e=>e.scrollWidth>e.clientWidth+1).length}});
 console.log(nm.padEnd(16),l.padEnd(16),JSON.stringify(m)); await p.close();}
await b.close();})();
