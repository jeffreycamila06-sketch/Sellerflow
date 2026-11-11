// PROOF SCRIPT for docs/plans/buyer-qr-id-plan.md v4 (plan only — not app code).
// Run: node docs/plans/buyer-qr-id-proof/qrsize.cjs > docs/plans/buyer-qr-id-proof/qrsize.output.txt
// Measures, with the SAME library the app uses (qrcode-generator, typeNumber 0 = smallest version that fits):
// the QR version / modules for every username length 1–24, for each candidate way of writing
// "TikTok link + buyer code", at ECC L and M — weighted by the real handle-length distribution
// (live_session_orders, platform TikTok, read-only query on 2026-11-11, 177,581 rows).
const qrcode = require("../../../node_modules/qrcode-generator");
const jsQR = require("../../../node_modules/jsqr");
const DIST = { 4: 1, 5: 258, 6: 2770, 7: 9617, 8: 19125, 9: 23412, 10: 23830, 11: 21287, 12: 18623, 13: 15045, 14: 12392, 15: 8643, 16: 6516, 17: 8811, 18: 3125, 19: 1469, 20: 971, 21: 786, 22: 441, 23: 233, 24: 226 };
const TOTAL = Object.values(DIST).reduce((a, b) => a + b, 0);
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code32 = (n) => Array.from({ length: n }, (_, i) => B32[(i * 7 + 3) % 32]).join("");
const digits = (n) => Array.from({ length: n }, (_, i) => String((i * 7 + 3) % 10)).join("");
const handle = (n) => "maria_live.shop.tw_2026_x".slice(0, n).padEnd(n, "a");

// each format → list of [text, mode] segments
const FORMATS = {
  "A today (link only)":                         (h) => [[`https://tiktok.com/@${h}`, "Byte"]],
  "B all byte  ?b=CODE":                         (h, c) => [[`https://tiktok.com/@${h}?b=${c}`, "Byte"]],
  "C byte link + alnum CODE":                    (h, c) => [[`https://tiktok.com/@${h}?b=`, "Byte"], [c, "Alphanumeric"]],
  "D ALNUM 'HTTPS://TIKTOK.COM/' + byte + alnum": (h, c) => [["HTTPS://TIKTOK.COM/", "Alphanumeric"], [`@${h}?b=`, "Byte"], [c, "Alphanumeric"]],
  "E as D, digits-only code (numeric mode)":     (h, c) => [["HTTPS://TIKTOK.COM/", "Alphanumeric"], [`@${h}?b=`, "Byte"], [c, "Numeric"]],
  "F as C, digits-only code (numeric mode)":     (h, c) => [[`https://tiktok.com/@${h}?b=`, "Byte"], [c, "Numeric"]],
  "G as D, no param name  ?CODE":                (h, c) => [["HTTPS://TIKTOK.COM/", "Alphanumeric"], [`@${h}?`, "Byte"], [c, "Alphanumeric"]],
};
function make(segs, ecc, type = 0) { const q = qrcode(type, ecc); for (const [t, m] of segs) q.addData(t, m); q.make(); return q; }
function versionOf(segs, ecc) { try { const q = make(segs, ecc); return (q.getModuleCount() - 17) / 4; } catch { return 99; } }
function pixels(q, scale = 4, quiet = 4) { const n = q.getModuleCount(), W = (n + 2 * quiet) * scale, d = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = (((r + quiet) * scale + y) * W + (c + quiet) * scale + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; }
  return { d, W, n, scale, quiet }; }
const decode = (p) => { const r = jsQR(p.d, p.W, p.W); return r ? r.data : null; };

console.log("== 1. Version per username length (v2 = 25 modules, v3 = 29, v4 = 33, v5 = 37) ==");
console.log("code lengths: base32 8 = 40 bits, 10 = 50 bits, 12 = 60 bits, 13 = 65 bits · digits 15 = 49.8 bits, 18 = 59.8 bits\n");
const rows = [];
for (const [name, f] of Object.entries(FORMATS)) {
  const numeric = name.includes("digits");
  const lens = name.startsWith("A") ? [0] : numeric ? [15, 18] : [8, 10, 12, 13];
  for (const cl of lens) for (const ecc of ["M", "L"]) {
    const c = numeric ? digits(cl) : code32(cl);
    const v = {}; for (let h = 1; h <= 24; h++) v[h] = versionOf(f(handle(h), c), ecc);
    let le3 = 0, le4 = 0; for (const [h, n] of Object.entries(DIST)) { if (v[h] <= 3) le3 += n; if (v[h] <= 4) le4 += n; }
    let max3 = 0; for (let h = 1; h <= 24; h++) if (v[h] <= 3) max3 = h;
    rows.push({ name, cl, ecc, v, le3, le4, max3 });
    console.log(`${name.padEnd(46)} code=${String(cl).padStart(2)} ECC ${ecc} | ` + Array.from({ length: 24 }, (_, i) => v[i + 1]).join("") + ` | v3 up to ${String(max3).padStart(2)} chars | orders at ≤v3: ${(100 * le3 / TOTAL).toFixed(1)}% | at ≤v4: ${(100 * le4 / TOTAL).toFixed(1)}%`);
  }
}
console.log("\n(the 24 digits = the version for username length 1,2,…,24)");

console.log("\n== 2. \"Strongest ECC that still fits version 3\" — format D (the proposal) and C (lower-case fallback) ==");
for (const [fname, cl] of [["D ALNUM 'HTTPS://TIKTOK.COM/' + byte + alnum", 10], ["D ALNUM 'HTTPS://TIKTOK.COM/' + byte + alnum", 12], ["G as D, no param name  ?CODE", 10], ["C byte link + alnum CODE", 10]]) {
  const tally = {}; const per = [];
  for (let h = 1; h <= 24; h++) { const segs = FORMATS[fname](handle(h), code32(cl));
    let pick = "v4"; for (const ecc of ["H", "Q", "M", "L"]) { if (versionOf(segs, ecc) <= 3) { pick = ecc; break; } }
    tally[pick] = (tally[pick] || 0) + (DIST[h] || 0); per.push(pick); }
  console.log(`${fname.padEnd(46)} code=${cl} | per username length 1..24: ${per.join(" ")}`);
  console.log(`${"".padEnd(46)}          share of orders: ` + Object.entries(tally).map(([k, v]) => `${k === "v4" ? "needs v4" : "ECC " + k} ${(100 * v / TOTAL).toFixed(1)}%`).join(" · ")); }

console.log("\n== 3. Does it decode, and what do today's parser and a URL parser make of it? ==");
const LEGACY = /^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})/i; // src/lib/tiktokHandle.ts:32 (today's app)
for (const name of Object.keys(FORMATS).slice(1)) { const numeric = name.includes("digits");
  const segs = FORMATS[name]("maria_live", numeric ? digits(15) : code32(10)); const text = segs.map((s) => s[0]).join("");
  for (const ecc of ["M", "L"]) { const q = make(segs, ecc); const back = decode(pixels(q)); const u = new URL(back);
    console.log(`${name.padEnd(46)} ECC ${ecc} modules=${q.getModuleCount()} jsQR=${back === text} today'sParser→@${(back.match(LEGACY) || [])[1]} URL host=${u.host} path=${u.pathname} query=${u.search}`); } }

console.log("\n== 4. Simulated damage at version 3: ECC M vs L (jsQR, 4 px/module, 400 tries each) — a SIMULATION, not paper ==");
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function trial(q, kind, amt) { const p = pixels(q); const { d, W, n, scale, quiet } = p; const o = quiet * scale, S = n * scale;
  const set = (x, y, v) => { if (x < 0 || y < 0 || x >= W || y >= W) return; const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; };
  if (kind === "flip") { for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (rnd() < amt) { const i0 = ((o + r * scale) * W + o + c * scale) * 4; const v = d[i0] ? 0 : 255; for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) set(o + c * scale + x, o + r * scale + y, v); } }
  if (kind === "whiteline") { const x0 = o + Math.floor(rnd() * (S - amt)); for (let y = 0; y < W; y++) for (let x = 0; x < amt; x++) set(x0 + x, y, 255); }      // dead print-head dots: a white line along the feed
  if (kind === "blotch") { const b = Math.round(amt * scale), x0 = o + Math.floor(rnd() * (S - b)), y0 = o + Math.floor(rnd() * (S - b)); for (let y = 0; y < b; y++) for (let x = 0; x < b; x++) set(x0 + x, y0 + y, 0); } // smudge / sticker damage
  return decode(p); }
const segM = FORMATS["D ALNUM 'HTTPS://TIKTOK.COM/' + byte + alnum"](handle(10), code32(10));
const qM = make(segM, "M", 3), qL = make(segM, "L", 3), want = segM.map((s) => s[0]).join("");
for (const [kind, amts, unit] of [["flip", [0.01, 0.02, 0.04, 0.06, 0.08], "of modules flipped"], ["whiteline", [2, 4, 6, 8, 12], "px wide white line (4 px = 1 module)"], ["blotch", [3, 4, 5, 6, 8], "modules square black blotch"]])
  for (const a of amts) { let okM = 0, okL = 0; const N = 400; for (let i = 0; i < N; i++) { if (trial(qM, kind, a) === want) okM++; if (trial(qL, kind, a) === want) okL++; }
    console.log(`${kind.padEnd(9)} ${String(a).padStart(4)} ${unit.padEnd(38)} ECC M reads ${(100 * okM / N).toFixed(0).padStart(3)}% · ECC L reads ${(100 * okL / N).toFixed(0).padStart(3)}%`); }

console.log("\n== 5. Chance that two buyers of ONE seller get the same code (birthday bound n²/2^(bits+1)) ==");
for (const bits of [40, 50, 60, 65]) console.log(`${bits} bits: ` + [8000, 50000, 100000, 1000000].map((n) => `${n.toLocaleString("en-US")} buyers → 1 in ${Math.round(2 ** (bits + 1) / (n * n)).toLocaleString("en-US")}`).join(" · "));
console.log("(largest seller today: 7,977 TikTok buyers in the CRM table)");
