// PROOF SCRIPT for docs/plans/buyer-qr-id-plan.md (plan only — not app code). Run: node docs/plans/buyer-qr-id-proof/qrcheck.cjs
// Shows: bytes, QR version/modules (qrcode-generator, ECC M, byte mode = src/lib/qr.ts), a jsQR round trip,
// and whether TODAY's parser (src/lib/tiktokHandle.ts handleFromQrPayload regexes) would accept the text.
const qrcode = require("../../../node_modules/qrcode-generator");
const jsQR = require("../../../node_modules/jsqr");
const crypto = require("crypto");
function mat(s, ecc){ const q=qrcode(0,ecc); q.addData(s); q.make(); return {n:q.getModuleCount(), q}; }
function decode(q, n, scale){ const quiet=4, W=(n+2*quiet)*scale; const d=new Uint8ClampedArray(W*W*4).fill(255);
  for(let r=0;r<n;r++)for(let c=0;c<n;c++) if(q.isDark(r,c)) for(let y=0;y<scale;y++)for(let x=0;x<scale;x++){const i=(((r+quiet)*scale+y)*W+(c+quiet)*scale+x)*4; d[i]=d[i+1]=d[i+2]=0;}
  const res=jsQR(d,W,W); return res&&res.data; }
const B32="0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function b32(buf,n){ let bits="",o=""; for(const b of buf) bits+=b.toString(2).padStart(8,"0"); for(let i=0;i<n;i++) o+=B32[parseInt(bits.slice(i*5,i*5+5),2)]; return o; }
function buyerQr(sellerUuid, ttUid){ const tag=crypto.createHash("sha256").update("sfb-tag:"+sellerUuid).digest("hex").slice(0,5).toUpperCase();
  const id=b32(crypto.createHmac("sha256", sellerUuid).update("sfb1:"+ttUid).digest(),16); return `SFB1-${tag}-${id}`; }
const legacyBare=/^@?([A-Za-z0-9._]{1,30})$/, legacyUrl=/^(?:https?:\/\/)?(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9._]{1,30})/i;
const samples = {
  "today 4-char handle": "https://tiktok.com/@annc",
  "today 12-char handle": "https://tiktok.com/@maria_shops1",
  "today 22-char handle": "https://tiktok.com/@"+"a".repeat(22),
  "today 24-char handle": "https://tiktok.com/@"+"a".repeat(24),
  "NEW id (seller A, buyer 1)": buyerQr("11111111-1111-1111-1111-111111111111","6812345678901234567"),
  "NEW id (seller B, buyer 1)": buyerQr("22222222-2222-2222-2222-222222222222","6812345678901234567"),
  "NEW id (seller A, buyer 2)": buyerQr("11111111-1111-1111-1111-111111111111","7012345678901234567"),
};
for (const [k,s] of Object.entries(samples)) { const {n,q}=mat(s,"M"); const back=decode(q,n,4);
  console.log(k.padEnd(28), JSON.stringify(s), "bytes="+Buffer.byteLength(s), "modules="+n, "version="+((n-17)/4), "jsQR-roundtrip="+(back===s), "legacyParserAccepts="+(legacyBare.test(s)||legacyUrl.test(s))); }
console.log("deterministic:", buyerQr("11111111-1111-1111-1111-111111111111","6812345678901234567")===samples["NEW id (seller A, buyer 1)"]);
