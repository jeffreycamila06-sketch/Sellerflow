// tesseract.js MEMORY PROBE — run ONCE on Render before wiring the poll cron, to
// confirm the OCR worker's RSS stays under the plan cap. Spins ONE worker, OCRs a
// live SHOPMORE captcha, and logs process RSS before / after-create / after-OCR /
// after-terminate, then exits.
//
//   node scripts/tesseract-mem-probe.js
//   (optionally: node --expose-gc scripts/tesseract-mem-probe.js  → RSS after GC too)
//
// Egress note: fetching the live captcha needs outbound access to
// tracking.shopmore.com.tw — that works on Render but is blocked in some dev
// sandboxes; if the fetch fails the probe still reports the worker RAM cost.
import { createOcr, fetchCaptcha } from "../server/parcelTrackingRunner.js";

const rss = () => `${(process.memoryUsage().rss / 1048576).toFixed(1)} MB`;

async function main() {
  console.log("[mem-probe] node", process.version);
  console.log("[mem-probe] rss BEFORE worker:      ", rss());

  const ocr = await createOcr();
  console.log("[mem-probe] rss AFTER worker create:", rss());

  let image = null;
  try {
    ({ image } = await fetchCaptcha(fetch));
    console.log("[mem-probe] fetched a live captcha:", image ? `${String(image).length} b64 chars` : "(empty)");
  } catch (e) {
    console.error("[mem-probe] captcha fetch failed (expected off-Render):", e && e.message);
  }

  if (image) {
    const digits = await ocr.solve(image);
    console.log("[mem-probe] OCR result:            ", JSON.stringify(digits));
  } else {
    console.log("[mem-probe] no image — skipping OCR (worker RAM still measured)");
  }
  console.log("[mem-probe] rss AFTER OCR:           ", rss());

  await ocr.terminate();
  await new Promise((r) => setTimeout(r, 500));
  if (typeof global.gc === "function") global.gc();
  console.log("[mem-probe] rss AFTER terminate:     ", rss());
  console.log("[mem-probe] done — compare 'AFTER OCR' peak against the Render plan cap.");
  process.exit(0);
}

main().catch((e) => { console.error("[mem-probe] fatal:", e); process.exit(1); });
