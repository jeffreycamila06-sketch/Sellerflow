// PROOF SCRIPT for docs/plans/buyer-qr-id-plan.md v5 (plan only — not app code).
// Run: node docs/plans/buyer-qr-id-proof/qrsize-v5.cjs > docs/plans/buyer-qr-id-proof/qrsize-v5.output.txt
// FORMAT DECIDED BY THE OWNER after the camera test (2026-11-11):  https://www.tiktok.com/@<username>?<CODE>
//   lower-case link with "www.", the code after "?" with no "b=", CODE = upper-case Crockford base32.
// Same library as the app (qrcode-generator, typeNumber 0 = smallest version that fits), weighted by the real
// username-length distribution (live_session_orders, TikTok, read-only query 2026-11-11, 177,581 rows).
const qrcode = require("../../../node_modules/qrcode-generator");
const jsQR = require("../../../node_modules/jsqr");
const DIST = { 4: 1, 5: 258, 6: 2770, 7: 9617, 8: 19125, 9: 23412, 10: 23830, 11: 21287, 12: 18623, 13: 15045, 14: 12392, 15: 8643, 16: 6516, 17: 8811, 18: 3125, 19: 1469, 20: 971, 21: 786, 22: 441, 23: 233, 24: 226 };
const TOTAL = Object.values(DIST).reduce((a, b) => a + b, 0);
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const code32 = (n) => Array.from({ length: n }, (_, i) => B32[(i * 7 + 3) % 32]).join("");
const handle = (n) => "maria_live.shop.tw_2026_x".slice(0, n).padEnd(n, "a");
const pct = (n) => (100 * n / TOTAL).toFixed(1) + "%";
const FORMATS = {
  "TODAY  https://tiktok.com/@u  (link only)":            (h) => [[`https://tiktok.com/@${h}`, "Byte"]],
  "FINAL  https://www.tiktok.com/@u? + alnum CODE":       (h, c) => [[`https://www.tiktok.com/@${h}?`, "Byte"], [c, "Alphanumeric"]],
  "       same, CODE written as bytes (no mixed mode)":   (h, c) => [[`https://www.tiktok.com/@${h}?${c}`, "Byte"]],
};
function make(segs, ecc, type = 0) { const q = qrcode(type, ecc); for (const [t, m] of segs) q.addData(t, m); q.make(); return q; }
function versionOf(segs, ecc) { try { return (make(segs, ecc).getModuleCount() - 17) / 4; } catch { return 99; } }

console.log("== 1. Version per username length 1..24 (2 = 25 modules, 3 = 29, 4 = 33, 5 = 37) ==\n");
for (const [name, f] of Object.entries(FORMATS)) for (const cl of name.startsWith("TODAY") ? [0] : [8, 10, 12]) for (const ecc of ["M", "L"]) {
  const v = {}; for (let h = 1; h <= 24; h++) v[h] = versionOf(f(handle(h), code32(cl)), ecc);
  let le3 = 0, le4 = 0, max3 = 0, max4 = 0; for (const [h, n] of Object.entries(DIST)) { if (v[h] <= 3) le3 += n; if (v[h] <= 4) le4 += n; }
  for (let h = 1; h <= 24; h++) { if (v[h] <= 3) max3 = h; if (v[h] <= 4) max4 = h; }
  console.log(`${name.padEnd(52)} code=${String(cl).padStart(2)} ECC ${ecc} | ${Array.from({ length: 24 }, (_, i) => v[i + 1]).join("")} | v3 up to ${String(max3).padStart(2)} chars = ${pct(le3).padStart(6)} of orders | v4 up to ${String(max4).padStart(2)} chars = ${pct(le4).padStart(6)}`);
}
console.log("(the 24 digits = the version for username length 1,2,…,24)");

const FINAL = FORMATS["FINAL  https://www.tiktok.com/@u? + alnum CODE"];
console.log("\n== 2. FINAL format, 10-character code: what each username length gets ==");
{ const rows = []; for (let h = 1; h <= 24; h++) { const segs = FINAL(handle(h), code32(10));
    rows.push({ h, n: DIST[h] || 0, v3M: versionOf(segs, "M") <= 3, v3L: versionOf(segs, "L") <= 3, v4M: versionOf(segs, "M") <= 4, v4Q: versionOf(segs, "Q") <= 4 }); }
  const sum = (f) => rows.filter(f).reduce((a, r) => a + r.n, 0);
  console.log("username length : " + rows.map((r) => String(r.h).padStart(2)).join(" "));
  console.log("fits v3 at ECC M: " + rows.map((r) => (r.v3M ? " y" : " -")).join(" "));
  console.log("fits v3 at ECC L: " + rows.map((r) => (r.v3L ? " y" : " -")).join(" "));
  console.log("fits v4 at ECC M: " + rows.map((r) => (r.v4M ? " y" : " -")).join(" "));
  console.log("fits v4 at ECC Q: " + rows.map((r) => (r.v4Q ? " y" : " -")).join(" "));
  console.log(`\nshare of orders — v3 at M: ${pct(sum((r) => r.v3M))} · v3 only at L: ${pct(sum((r) => !r.v3M && r.v3L))} · needs v4: ${pct(sum((r) => !r.v3L))} (all of those fit v4 at M: ${rows.filter((r) => !r.v3L).every((r) => r.v4M)})`);
  console.log("\nThree ways to choose (the paper test decides):");
  console.log(`  P1 "same size as today":  v3-M ${pct(sum((r) => r.v3M))} · v3-L ${pct(sum((r) => !r.v3M && r.v3L))} · v4-M ${pct(sum((r) => !r.v3L))}`);
  console.log(`  P2 "always ECC M":        v3-M ${pct(sum((r) => r.v3M))} · v4-M ${pct(sum((r) => !r.v3M))}`);
  console.log(`  P3 "one size, 33 modules": v4-M 100.0% (v4 at ECC Q would fit ${pct(sum((r) => r.v4Q))})`); }

console.log("\n== 3. Decode + what today's parser and the proposed parser read ==");
const LEGACY = /^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})/i;                       // src/lib/tiktokHandle.ts:32 (today's app, unchanged)
const BARE = /^@?([A-Za-z0-9._]{1,30})$/;                                                                  // src/lib/tiktokHandle.ts:34
const NEW = /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})\?([0-9A-HJKMNP-TV-Z]{10})$/i;    // PROPOSED: link + "?" + exactly 10 Crockford chars
function parse(raw) { const s = String(raw || "").trim(); const m = s.match(NEW);
  if (m && m[2] === m[2].toUpperCase()) return { handle: m[1], code: m[2] };          // code must be upper-case as printed
  const u = s.match(LEGACY); if (u) return { handle: u[1], code: null };
  const b = s.match(BARE); return b ? { handle: b[1], code: null } : null; }
function pixels(q, scale = 4, quiet = 4) { const n = q.getModuleCount(), W = (n + 2 * quiet) * scale, d = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = (((r + quiet) * scale + y) * W + (c + quiet) * scale + x) * 4; d[i] = d[i + 1] = d[i + 2] = 0; }
  return { d, W, n, scale, quiet }; }
const decode = (p) => { const r = jsQR(p.d, p.W, p.W); return r ? r.data : null; };
let ok = 0, all = 0;
for (let h = 1; h <= 24; h++) for (const [ecc, type] of [["M", 0], ["L", 0], ["M", 4]]) { const segs = FINAL(handle(h), code32(10)); const text = segs.map((s) => s[0]).join("");
  let q; try { q = make(segs, ecc, type); } catch { continue; } all++; const back = decode(pixels(q)); const pr = back && parse(back); const old = back && (back.match(LEGACY) || [])[1];
  if (back === text && pr && pr.handle === handle(h) && pr.code === code32(10) && old === handle(h)) ok++; }
console.log(`FINAL format, username 1..24 × (auto-M, auto-L, forced v4-M): jsQR decodes the exact text, the proposed parser returns username + code, and TODAY's parser returns the username: ${ok}/${all}`);
const CASES = [
  ["https://www.tiktok.com/@maria_live?3AHRZ6DMV2", "NEW sticker"],
  ["https://tiktok.com/@maria_live", "today's sticker"],
  ["https://www.tiktok.com/@maria_live", "old URL with www"],
  ["HTTPS://TikTok.com/@annc", "upper-case URL (already accepted today)"],
  ["m.tiktok.com/@annc", "no scheme, m."],
  ["https://www.tiktok.com/@annc?lang=en", "TikTok's own query → username only"],
  ["https://www.tiktok.com/@annc?_t=8abc&_r=1", "TikTok share link → username only"],
  ["https://www.tiktok.com/@annc?3ahrz6dmv2", "lower-case 'code' → username only"],
  ["https://www.tiktok.com/@annc?3AHRZ6DMV", "9 chars → username only"],
  ["https://www.tiktok.com/@annc?3AHRZ6DMV2X", "11 chars → username only"],
  ["https://www.tiktok.com/@annc?HELLOWORLD", "has L and O (not Crockford) → username only"],
  ["https://www.tiktok.com/@annc?3AHRZ6DMV2&x=1", "extra parameter after the code → username only"],
  ["https://www.tiktok.com/@maria_live?3AHRZ6DMV2\n", "trailing newline from a scanner → trimmed, code kept"],
  ["  https://www.tiktok.com/@maria_live?3AHRZ6DMV2  ", "spaces around → trimmed, code kept"],
  ["HTTPS://WWW.TIKTOK.COM/@annc?3AHRZ6DMV2", "upper-case scheme/host + code → username + code"],
  ["https://www.tiktok.com/@annc?3AHRZ6DMV2#x", "fragment after the code → username only"],
  ["https://www.tiktok.com/@annc/?3AHRZ6DMV2", "slash before the ? → username only"],
  ["www.tiktok.com/@annc?3AHRZ6DMV2", "no scheme → username only"],
  ["annc", "bare username (oldest stickers)"], ["@annc", "bare @username"],
  ["https://example.com/@annc?3AHRZ6DMV2", "not TikTok → nothing"], ["hello world", "random text → nothing"],
];
for (const [t, why] of CASES) { const r = parse(t); console.log(`  ${JSON.stringify(t).padEnd(50)} → ${r ? `@${r.handle}${r.code ? " + code " + r.code : " (no code)"}` : "nothing"}   [${why}]`); }

console.log("\n== 4. SIMULATED damage: v3 at ECC L vs v4 at ECC M (jsQR, 400 tries each) — a SIMULATION, not paper ==");
console.log("   Units are PRINTER DOTS (8 dots = 1 mm). v3 at 6 dots/module = 21.8 mm; v4 at 6 = 24.8 mm; v4 at 5 = 20.6 mm.");
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
function trial(q, scale, kind, amt) { const p = pixels(q, scale); const { d, W, n, quiet } = p; const o = quiet * scale, S = n * scale;
  const set = (x, y, v) => { if (x < 0 || y < 0 || x >= W || y >= W) return; const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v; };
  if (kind === "line") { const x0 = o + Math.floor(rnd() * (S - amt)); for (let y = 0; y < W; y++) for (let x = 0; x < amt; x++) set(x0 + x, y, 255); }
  if (kind === "blotch") { const x0 = o + Math.floor(rnd() * (S - amt)), y0 = o + Math.floor(rnd() * (S - amt)); for (let y = 0; y < amt; y++) for (let x = 0; x < amt; x++) set(x0 + x, y0 + y, 0); }
  return decode(p); }
const seg = FINAL(handle(12), code32(10)), want = seg.map((s) => s[0]).join("");
const A = make(seg, "L", 3), B = make(seg, "M", 4);
for (const [kind, amts, unit] of [["line", [3, 6, 9, 12, 18], "dots wide white line along the feed"], ["blotch", [18, 24, 30, 36, 48], "dots square black blotch"]])
  for (const a of amts) { let x = 0, y = 0, z = 0; const N = 400; for (let i = 0; i < N; i++) { if (trial(A, 6, kind, a) === want) x++; if (trial(B, 6, kind, a) === want) y++; if (trial(B, 5, kind, a) === want) z++; }
    console.log(`${kind.padEnd(6)} ${String(a).padStart(2)} ${unit.padEnd(36)} v3-L @6 dots ${(100 * x / N).toFixed(0).padStart(3)}% · v4-M @6 dots ${(100 * y / N).toFixed(0).padStart(3)}% · v4-M @5 dots ${(100 * z / N).toFixed(0).padStart(3)}%`); }

console.log("\n== 5. Chance that two buyers of ONE seller get the same 10-character (50-bit) code ==");
console.log([8000, 50000, 100000, 1000000].map((n) => `${n.toLocaleString("en-US")} buyers → 1 in ${Math.round(2 ** 51 / (n * n)).toLocaleString("en-US")}`).join(" · "));
