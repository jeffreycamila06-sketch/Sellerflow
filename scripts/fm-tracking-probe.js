// THROWAWAY RESEARCH PROBE (branch claude/fm-tracking-probe — never merged).
// Can our 7-11 captcha approach (tesseract.js, digits whitelist, PSM 7) read the FamilyMart
// public tracking captcha, and what does the tracking response look like?
//
// Flow (ecfme.fme.com.tw, the iframe behind fmec.famiport.com.tw/FP_Entrance/QueryBox):
//   GET  index.aspx?orderno=                  → ASP.NET session cookie
//   POST index.aspx/GetVerificationCode {}     → { d: '{"Code":"<token>"}' }
//   GET  CodeHandler.ashx?Code=<token>         → 300×60 GIF, 6 digits
//   POST index.aspx/ChkVerificationCode {P_CODE, P_VCODE} → { d: '{"success":"1"|…,"msg":…}' }
//   POST list.aspx  ORDER_NO=<comma-joined, up to 5>     → result page (no data in it)
//   POST list.aspx/InquiryOrders {ListEC_ORDER_NO}       → { d: '{"ErrorCode":"000","List":[{EC_ORDER_NO, ORDER_NO, CNT, ORDERMESSAGE}]}' }
//   POST list.aspx/GetOrderDetail {EC_ORDER_NO, RCV_USER_NAME:null, ORDER_NO}  (only when CNT = 1;
//        CNT > 1 asks for the recipient name) → { d: '{"ErrorCode":"000","List":[{STATUS_D, ORDER_DATE,
//        ORDER_TIME, ORDER_DATE_RTN (取貨截止日), RCV_STORE_NAME, SEND_STORE_NAME (return store), …}]}' }
//   --detail also makes these two calls after the first accepted query (status wordings only are printed).
//
// Gentle by design: one request at a time, 8–15 s random wait before every request, hard caps
// (15 captcha fetches, 10 submits), stop on any unusual answer. Never logs tokens or cookies.
// Run from the Mac only:  node scripts/fm-tracking-probe.js [--n 10]
import { createWorker } from "tesseract.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "https://ecfme.fme.com.tw/FMEDCFPWebV2_II";
const ENTRY = `${BASE}/index.aspx?orderno=`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const TRACKING = "16351746626"; // our own test parcel
const OUT = "vendor/fm-captcha-samples";
const MAX_CAPTCHA = 15, MAX_SUBMIT = 10;
const N = Math.min(Number(process.argv[process.argv.indexOf("--n") + 1]) || 10, MAX_SUBMIT);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gentle = () => sleep(8000 + Math.floor(Math.random() * 7000));
const jar = new Map();
let captchas = 0, submits = 0;

function keepCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function req(url, init = {}) {
  await gentle();
  const headers = { "User-Agent": UA, Referer: ENTRY, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8", ...(init.headers || {}) };
  if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  keepCookies(res);
  if (res.status !== 200) throw new Error(`STOP: HTTP ${res.status} on ${new URL(url).pathname}`);
  return res;
}
const postJson = (path, body) => req(`${BASE}/${path}`, {
  method: "POST", body: JSON.stringify(body),
  headers: { "Content-Type": "application/json; charset=utf-8", "X-Requested-With": "XMLHttpRequest" },
});

// Digits are near-white on a light grey speckled background: keep the brightest pixels as black
// ink on white, upscale 2×.
async function preprocess(gif) {
  const img = await loadImage(gif);
  const s = 2, c = createCanvas(img.width * s, img.height * s), g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const y = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    const v = y > 238 ? 0 : 255;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c.toBuffer("image/png");
}
// tesseract reads PNG reliably; hand it the raw image re-encoded without any change.
async function asPng(gif) {
  const img = await loadImage(gif);
  const c = createCanvas(img.width, img.height);
  c.getContext("2d").drawImage(img, 0, 0);
  return c.toBuffer("image/png");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const worker = await createWorker("eng");
  await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: "7" });
  const ocr = async (buf) => (await worker.recognize(buf)).data.text.replace(/\D/g, "");
  const rows = [];
  let saved = false;
  try {
    await req(ENTRY); // session cookie
    console.log(`session cookies: ${[...jar.keys()].join(", ")}`);
    for (let i = 1; i <= N; i++) {
      if (captchas >= MAX_CAPTCHA || submits >= MAX_SUBMIT) break;
      captchas++;
      const vc = await (await postJson("index.aspx/GetVerificationCode", {})).json();
      const token = JSON.parse(vc.d || "{}").Code;
      if (!token) throw new Error("STOP: no captcha token in GetVerificationCode answer");
      const imgRes = await req(`${BASE}/CodeHandler.ashx?Code=${encodeURIComponent(token)}`);
      const type = imgRes.headers.get("content-type") || "";
      if (!type.startsWith("image/")) throw new Error(`STOP: captcha answer is ${type}`);
      const gif = Buffer.from(await imgRes.arrayBuffer());
      const pre = await preprocess(gif);
      const n = String(i).padStart(2, "0");
      writeFileSync(`${OUT}/cap_${n}.gif`, gif);
      writeFileSync(`${OUT}/pre_${n}.png`, pre);
      const raw = await ocr(await asPng(gif));
      const prep = await ocr(pre);
      const answer = prep.length === 6 ? prep : raw;
      submits++;
      const chk = await (await postJson("index.aspx/ChkVerificationCode", { P_CODE: answer, P_VCODE: token })).json();
      const r = JSON.parse(chk.d || "{}");
      const ok = r.success === "1";
      rows.push({ n, raw, prep, sent: answer, ok, msg: ok ? "" : String(r.msg || "").slice(0, 60) });
      console.log(`#${n} raw=${raw || "-"} pre=${prep || "-"} sent=${answer} → ${ok ? "ACCEPTED" : `rejected (${r.msg || "no msg"})`}`);
      if (ok && !saved) {
        const html = await (await req(`${BASE}/list.aspx`, {
          method: "POST", body: new URLSearchParams({ ORDER_NO: TRACKING }).toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: ENTRY },
        })).text();
        writeFileSync(`${OUT}/response.html`, html);
        saved = true;
        console.log(`saved response.html (${html.length} chars)`);
        if (process.argv.includes("--detail")) {
          const list = JSON.parse((await (await postJson("list.aspx/InquiryOrders", { ListEC_ORDER_NO: TRACKING })).json()).d || "{}");
          writeFileSync(`${OUT}/inquiry.json`, JSON.stringify(list, null, 2));
          const first = (list.List || [])[0] || {};
          console.log(`InquiryOrders ErrorCode=${list.ErrorCode} CNT=${first.CNT} ORDERMESSAGE=${first.ORDERMESSAGE ?? "-"}`);
          if (first.CNT === 1) {
            const det = JSON.parse((await (await postJson("list.aspx/GetOrderDetail", { EC_ORDER_NO: first.EC_ORDER_NO, RCV_USER_NAME: null, ORDER_NO: first.ORDER_NO })).json()).d || "{}");
            writeFileSync(`${OUT}/detail.json`, JSON.stringify(det, null, 2));
            const L = det.List || [];
            console.log(`GetOrderDetail ErrorCode=${det.ErrorCode} steps=${L.length} deadline(ORDER_DATE_RTN)=${L[0]?.ORDER_DATE_RTN ?? "none"} returnStore=${L[0]?.SEND_STORE_NAME ? "yes" : "no"}`);
            for (const st of L) console.log(`  status: ${st.STATUS_D ?? "-"} @ ${st.ORDER_DATE ?? ""} ${st.ORDER_TIME ?? ""}`);
          }
          break; // one query is enough for the detail run
        }
      }
    }
  } finally {
    await worker.terminate();
    writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 2));
    console.log(`captcha fetches=${captchas} submits=${submits} accepted=${rows.filter((r) => r.ok).length}/${rows.length}`);
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
