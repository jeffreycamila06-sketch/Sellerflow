import fs from "node:fs";
import { describe, it } from "vitest";
import { renderStickerBitmap, withSyntheticCjk, type RasterAtlases, type RasterPayload } from "../stickerRaster";
import { prepareAllScripts, augmentAtlases } from "../oneStickerScripts";
import { LATIN_ATLAS } from "../glyphAtlas.latin";
import { CYRILLIC_ATLAS } from "../glyphAtlas.cyrillic";
import { CJK_ATLAS } from "../glyphAtlas.cjk";
import { installNodeFallbackDrawer, installSans, rasterPng } from "./oneSticker.harness";
const OUT = process.env.LOOK_OUT;
describe.skipIf(!OUT)("look2", () => {
  it("today's layout, all scripts off vs on", () => {
    installNodeFallbackDrawer(); installSans();
    const pl = (name: string, item: string): RasterPayload => ({ storeName: "Maria Shop", sessionDate: "11/07/2026", buyer: { num: 7, name, handle: "tanaka", orders: [{ time: "14:05", item }] }, settings: { printStoreName: true, printBuyerNumber: true, printBuyerUsername: true, printOrderItems: true, printCommentFullWidth: true, printStoreScale: 1, printBuyerNumberScale: 1, printBuyerNameScale: 1, printUsernameScale: 1, printOrderScale: 1, printCommentScale: 1 } });
    const cases = [["田中さん", "日本語「ワンピース」１２３"], ["김민지", "ไทย ขอบคุณ"], ["Мария", "العربية مرحبا"], ["𝓐𝓶𝔂 𝐋𝐢𝐦", "Amy 350"]];
    cases.forEach(([n, it2], i) => {
      const p = pl(n, it2);
      const base: RasterAtlases = { latin: LATIN_ATLAS, cjk: CJK_ATLAS };
      const off = renderStickerBitmap(p, 100, 60, base);
      const prep = prepareAllScripts(p, false, true)!;
      const on = withSyntheticCjk(prep.synth, () => renderStickerBitmap(prep.payload, 100, 60, augmentAtlases(base, prep, CYRILLIC_ATLAS)));
      fs.writeFileSync(`${OUT}/t${i}_off.png`, rasterPng(off, 1)!); fs.writeFileSync(`${OUT}/t${i}_on.png`, rasterPng(on, 1)!);
    });
  });
});
