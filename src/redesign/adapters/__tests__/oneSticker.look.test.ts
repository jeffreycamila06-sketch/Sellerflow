import fs from "node:fs";
import { describe, it } from "vitest";
import { renderOneSticker, recommendedSettings } from "../oneSticker";
import { fullFonts, installNodeFallbackDrawer, rasterPng } from "./oneSticker.harness";
const OUT = process.env.LOOK_OUT;
describe.skipIf(!OUT)("look", () => {
  it("renders", async () => {
    installNodeFallbackDrawer();
    const f = await fullFonts();
    const samples = [
      { name: "Amy Chen", handle: "amy.shop", items: ["A2 x2 red dress size M please hold"], buyerNum: 12 },
      { name: "田中さん「ワンピース」１２３", handle: "tanaka", items: ["日本語 田中さん「ワンピース」１２３ ｶﾅ"], buyerNum: 7 },
      { name: "김민지 한국어", handle: "minji", items: ["ไทย ขอบคุณค่ะ สวัสดี", "العربية مرحبا"], buyerNum: 345 },
      { name: "🔥𝓐𝓶𝔂 𝐋𝐢𝐦🔥", handle: "amylim", items: ["Българска рокля Nguyễn Thị Hằng"], buyerNum: 88, platform: "facebook" },
    ];
    for (const sz of [{ w: 50, h: 30 }, { w: 60, h: 40 }, { w: 100, h: 60 }]) samples.forEach((smp, i) => {
      const s = recommendedSettings(sz);
      const r = renderOneSticker(s, { storeName: "Maria Ukay Shop", date: "2026/11/07", time: "14:05", ...smp }, f);
      fs.writeFileSync(`${OUT}/s${sz.w}x${sz.h}_${i}.png`, rasterPng(r, 2)!);
      console.log(sz.w, sz.h, i, JSON.stringify(r.warnings), r.layout.commentPx);
    });
  });
});
