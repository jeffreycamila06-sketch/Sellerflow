// PERMANENT GUARD (Nov 3, item 12) — Jeff's rule: every control on Settings → Printer / LIVE print pattern must
// change the printed sticker at every step (1×→2×→3×) and every switch (on→off), on every printer path (AIMO
// stream, generic TSPL = Flash Y41BT / Xprinter XP-420B, Niimbot 50×30) and every label size, with layout v2
// OFF and ON — and the preview must be the print. Rendered with the real atlases through the one production
// function (printing.stickerBitmapFor). The control list is read from the screens (printControls.harness
// screenControls), so a new row cannot ship untested. A control that changes nothing is a failure unless it is
// in the ALLOWED list below, each entry with its reason.
import { describe, it, expect } from "vitest";
import { PATHS, SIZES, screenControls, renderCase, rasterKey, recomposeBands, sampleBuyer, settingsFor, applyModuleState, browserCase, pageSrc, rasterFromBmpDataUrl, AT, type CaseSpec } from "./printControls.harness";
import { stickerFit } from "../stickerFit";
import { buildNativeStickerPayload, imageStickerPayload, imagePathAtlases, bitmapBmpDataUrl, NIIMBOT_CANVAS, NIIMBOT_LABEL } from "../printing";
import { stickerDrawOps, stickerQrPlacement, propLayoutLines, propLayoutLinesV2, isPropCompactSize, rightmostOpEdge, STICKER_LAYOUTS, type FullRaster } from "../stickerRaster";
import type { Buyer } from "../../../lib/orderTypes";
import { buildGenericStickerBytes, buildNiimbotImage } from "../printing";
import type { PpBoolKey } from "../../screens/PrintPattern";
import { readFileSync } from "node:fs";

// ── The ONLY controls allowed to leave the print unchanged. Key = `${path}|${size}|v2-${on|off}|${control}`;
// `*` matches any path / size / v2. Everything else must change the bitmap.
const ALLOWED: Record<string, string> = {
  // "50×30 gets NO shop name" (Jeff, Nov 3) — the fixed 50×30 layout, the compact 50×30 and the Niimbot frame have
  // no shop line, so the Shop name switch and its size do nothing there.
  "*|50x30mm|*|shopName": "50x30 has no shop name line",
  "*|50x30mm|*|shopNameSize": "50x30 has no shop name line",
  "niimbot|*|*|shopName": "Niimbot always prints the 50x30 layout — no shop name line",
  "niimbot|*|*|shopNameSize": "Niimbot always prints the 50x30 layout — no shop name line",
  // AIMO 60×40 with layout v2 OFF never prints a QR (stickerQrPrints → "no": the fixed-cell 60×40 has no room).
  "aimo|60x40mm|v2-off|stickerQr": "AIMO 60x40 v2 OFF prints no QR",
};
const allowed = (c: CaseSpec, control: string): string | undefined => {
  const v2 = `v2-${c.v2 ? "on" : "off"}`;
  for (const p of [c.path, "*"]) for (const s of [c.psSize, "*"]) for (const v of [v2, "*"]) { const r = ALLOWED[`${p}|${s}|${v}|${control}`]; if (r) return r; }
  return undefined;
};
const cases: CaseSpec[] = [];
for (const path of PATHS) for (const psSize of (path === "niimbot" ? ["50x30mm"] : SIZES)) for (const v2 of [false, true]) cases.push({ path, psSize, v2 });
const name = (c: CaseSpec) => `${c.path} ${c.psSize.replace(/mm.*/, "")} v2-${c.v2 ? "on" : "off"}`;

describe("print controls matrix — every control changes the print (or is explicitly allowed not to)", () => {
  const { switches, sizes, fixed } = screenControls();
  it("the screens show the controls this guard knows (a new row must be added to the matrix on purpose)", () => {
    expect(sizes).toEqual(["shopNameSize", "buyerNumSize", "tiktokNameSize", "tiktokUserSize", "commentSize"]);
    expect(fixed).toEqual(["dateTimeSize"]); // "Fixed size" note — a switch, not a size control
    expect(switches).toEqual(["shopName", "dateTime", "buyerNum", "tiktokName", "tiktokUser", "comment", "stickerQr"]);
    for (const k of Object.keys(ALLOWED)) expect([...sizes, ...switches]).toContain(k.split("|")[3]);
  });
  for (const c of cases) {
    it(`${name(c)}: size steps 1x→2x→3x and switches on→off each change the bitmap`, async () => {
      const base = rasterKey(await renderCase(c));
      const noEffect: string[] = [];
      for (const k of sizes) {
        const k2 = rasterKey(await renderCase({ ...c, pp: { [k]: 2 } })), k3 = rasterKey(await renderCase({ ...c, pp: { [k]: 3 } }));
        if (base === k2 || k2 === k3) {
          // item 2 (round 2): the buyer number is the ONE control allowed to stop growing — only where it would not
          // fit whole beside the QR, and only with a red line on that level (round 3, item 3: "limit" when the cap
          // is the reason, "push" when it pushes lines off — measured with this case's buyer number)
          if (k === "buyerNumSize") {
            for (const lv of [2, 3] as const) {
              const same = lv === 2 ? base === k2 : k2 === k3;
              if (!same) continue;
              const cc: CaseSpec = { ...c, pp: { [k]: lv } };
              applyModuleState(cc);
              const f = await stickerFit(settingsFor(cc), "NT$", "BudgetUkay", c.path, { maxBuyerNum: sampleBuyer().num });
              expect(f.controls.printBuyerNumberScale, `${name(c)} buyerNumSize ${lv}x did not change the print and no red line explains it`).toBeDefined();
            }
            continue;
          }
          if (!allowed(c, k)) noEffect.push(`${k} (1x=${base} 2x=${k2} 3x=${k3})`);
        }
        else expect(allowed(c, k), `${name(c)} ${k} is ALLOWED but it does change the print — drop the allow entry`).toBeUndefined();
      }
      for (const k of switches) {
        const off = rasterKey(await renderCase(k === "stickerQr" ? { ...c, qr: false } : { ...c, pp: { [k as PpBoolKey]: false } }));
        if (base === off) { if (!allowed(c, k)) noEffect.push(`${k} OFF`); }
        else expect(allowed(c, k), `${name(c)} ${k} is ALLOWED but it does change the print — drop the allow entry`).toBeUndefined();
      }
      expect(noEffect, `${name(c)}: controls with NO EFFECT on the print`).toEqual([]);
    }, 60_000);
  }
});

describe("preview = print", () => {
  it("generic TSPL (Flash / Xprinter): the bands sent to the printer recompose to exactly the preview bitmap", async () => {
    for (const psSize of SIZES) for (const v2 of [false, true]) {
      const c: CaseSpec = { path: "generic", psSize, v2, pp: { commentSize: 2, tiktokNameSize: 2 } };
      const preview = await renderCase(c);
      applyModuleState(c);
      const bytes = await buildGenericStickerBytes("tspl", buildNativeStickerPayload(sampleBuyer(), "NT$", "BudgetUkay", settingsFor(c), AT), "TikTok", false, { density: 15, speed: 2, bold: true });
      expect(rasterKey(recomposeBands(bytes, preview.w, preview.h)), `${psSize} v2-${v2}`).toBe(rasterKey(preview));
    }
  });
  it("Niimbot: the image sent to the printer IS the preview bitmap; the label is always 50x30 whatever size is saved", async () => {
    for (const v2 of [false, true]) {
      const c: CaseSpec = { path: "niimbot", psSize: "50x30mm", v2, pp: { buyerNumSize: 2 } };
      const preview = await renderCase(c);
      applyModuleState(c);
      const im = await buildNiimbotImage(buildNativeStickerPayload(sampleBuyer(), "NT$", "BudgetUkay", settingsFor(c), AT), "TikTok");
      expect(rasterKey({ buf: new Uint8Array(Buffer.from(im.data, "base64")), w: im.w, h: im.h, rowBytes: im.rowBytes })).toBe(rasterKey(preview));
      expect(rasterKey(await renderCase({ ...c, psSize: "60x40mm" }))).toBe(rasterKey(preview));
      expect(rasterKey(await renderCase({ ...c, psSize: "100x60mm (Standard)" }))).toBe(rasterKey(preview));
      expect([NIIMBOT_LABEL.w, NIIMBOT_LABEL.h]).toEqual([50, 30]);
    }
  });
  it("AIMO stream and the LIVE print pattern preview are built from the same function (source pins)", () => {
    const printing = readFileSync("src/redesign/adapters/printing.ts", "utf8");
    expect(printing).toMatch(/sdkStreamFromRaster\(await stickerBitmapFor\(\{ path: "aimo"/);
    const preview = readFileSync("src/redesign/components/ExactStickerPreview.tsx", "utf8");
    expect(preview).toMatch(/stickerBitmapFor\(\{ path: printerPath, payload/);
    expect(preview).not.toMatch(/renderStickerBitmap\(/); // never its own layout
  });
});

// ── round 3 (items 1 + 7): the laptop preview and the laptop print are the same picture, at every frame width ──
describe("laptop (browser): the print page carries exactly the preview bitmap; the frame only scales it", () => {
  for (const psSize of SIZES) for (const v2 of [false, true]) {
    it(`${psSize.replace(/mm.*/, "")} v2-${v2 ? "on" : "off"}: page image == stickerBitmapFor("browser") == the preview's source`, async () => {
      const c: CaseSpec = { path: "browser", psSize, v2, pp: { commentSize: 2, tiktokNameSize: 3 } };
      const page = await browserCase(c);
      const preview = await renderCase(c); // ExactStickerPreview draws stickerBitmapFor({ path }) — the source pin below
      expect(rasterKey(rasterFromBmpDataUrl(pageSrc(page.html)))).toBe(rasterKey(preview));
      expect(page.html).toContain(bitmapBmpDataUrl(preview));
      const wh = psSize.match(/^(\d+)x(\d+)/)!;
      expect(page.html).toContain(`@page{size:${wh[1]}mm ${wh[2]}mm;margin:0}`); // the page IS the label
      expect(page.html).not.toMatch(/<(div|span|p)[ >]/);                             // no browser text layout
    }, 60_000);
  }
  it("the preview draws the label at its real size (mm → px) and scales it with a transform (ExactStickerPreview source pins)", () => {
    const src = readFileSync("src/redesign/components/ExactStickerPreview.tsx", "utf8");
    expect(src).toMatch(/width: `\$\{mm\.w\}mm`, height: `\$\{mm\.h\}mm`, transform: `scale\(\$\{scale\}\)`/);
    expect(src).toMatch(/const scale = frameW > 0 \? frameW \/ px\.w : 1/);
    expect(src).toMatch(/path \?\? \(asBrowser \? "browser" : savedPrinterPath\(\)\)/);
  });
});

// ── item 1 (round 2): Chinese names and comments grow 1× < 2× < 3× on every path / size / layout ──────────────
const cjkBuyer = (): Buyer => ({ ...sampleBuyer(), name: "王小明", handle: "wangxiaoming", orders: [{ ...sampleBuyer().orders[0], item: "我要黑色" }] } as Buyer);
// the vertical ink extent (last − first ink row + 1) below the fixed header band (the 48-dot bar on the fixed-cell sizes)
const inkExtent = (r: FullRaster, fromY: number): number => {
  let first = -1, last = -1;
  for (let y = fromY; y < r.h; y++) { let any = false; for (let i = 0; i < r.rowBytes && !any; i++) if (r.buf[y * r.rowBytes + i]) any = true; if (any) { if (first < 0) first = y; last = y; } }
  return first < 0 ? 0 : last - first + 1;
};
describe("item 1 — Chinese name 王小明 / comment 我要黑色: ink height strictly grows 1×→2×→3×", () => {
  for (const c of cases) for (const [k, pp] of [["tiktokNameSize", { shopName: false, dateTime: false, buyerNum: false, tiktokUser: false, comment: false }], ["commentSize", { shopName: false, dateTime: false, buyerNum: false, tiktokUser: false, tiktokName: false }]] as const) {
    it(`${name(c)} ${k}`, async () => {
      const heights: number[] = [];
      for (const lv of [1, 2, 3]) {
        const r = await renderCase({ ...c, qr: false, buyer: cjkBuyer(), pp: { ...pp, [k]: lv } });
        heights.push(inkExtent(r, isPropCompactSize(Number(c.psSize.match(/^(\d+)/)![1]), Number(c.psSize.match(/x(\d+)/)![1])) ? 0 : 52));
      }
      expect(heights[0], `${name(c)} ${k} 1x prints nothing`).toBeGreaterThan(0);
      expect(heights[1], `${name(c)} ${k} 2x (${heights.join("<")}) is not taller than 1x`).toBeGreaterThan(heights[0]);
      expect(heights[2], `${name(c)} ${k} 3x (${heights.join("<")}) is not taller than 2x`).toBeGreaterThan(heights[1]);
    }, 60_000);
  }
});

// ── item 2 (round 2): the buyer number is NEVER cut — whole digits, never "…", never a partial digit ─────────
describe("item 2 — the buyer number prints whole on every path / size / level (largest scale that fits beside the QR)", () => {
  for (const c of cases) {
    it(`${name(c)}`, async () => {
      for (const num of [7, 88, 123, 1002, 12345]) for (const lv of [1, 2, 3]) {
        const cc: CaseSpec = { ...c, buyer: { ...sampleBuyer(), num } as Buyer, pp: { buyerNumSize: lv } };
        applyModuleState(cc);
        const np0 = buildNativeStickerPayload(cc.buyer!, "NT$", "BudgetUkay", settingsFor(cc), AT);
        const np = c.path === "niimbot" ? { ...np0, labelWidthMm: NIIMBOT_LABEL.w, labelHeightMm: NIIMBOT_LABEL.h } : np0;
        const img = imageStickerPayload(np, "TikTok");
        const w = np.labelWidthMm, h = np.labelHeightMm;
        const compact = c.path !== "aimo" || c.v2 ? isPropCompactSize(w, h) : false; // AIMO v2 OFF = the fixed layouts
        const tag = `${name(c)} #${num} ${lv}x`;
        if (compact) {
          const atl = await imagePathAtlases(np, img);
          const canvas = c.path === "niimbot" ? NIIMBOT_CANVAS : undefined;
          const L = c.v2 ? propLayoutLinesV2(img, w, h, atl, canvas) : propLayoutLines(img, w, h, atl, canvas);
          const line = L.lines.find((l) => l.line.text === String(num));
          expect(line, `${tag}: the whole number is not on the label`).toBeTruthy();
          expect(line!.line.cut).toBe(false);
          const x = "x" in L ? L.x : (line as unknown as { x: number }).x;
          if ((line!.scale ?? 1) > 1 && L.qr) expect(x + line!.line.inkWidth * (line!.scale ?? 1), `${tag}: a magnified number reaches the QR`).toBeLessThanOrEqual(L.qr.x0);
        } else {
          const cfg = STICKER_LAYOUTS[`${w}x${h}`];
          const qr = stickerQrPlacement(img, cfg.wDots, h * 8, h);
          const r = stickerDrawOps(img, w, h, "extended", qr);
          const op = r.ops.find((o): o is Extract<typeof o, { k: "txt" }> => o.k === "txt" && o.s === String(num));
          expect(op, `${tag}: the whole number is not on the label`).toBeTruthy();
          expect(r.ops.some((o) => o.k === "txt" && o.font === "4" && o.s.includes("…") && /\d/.test(o.s)), `${tag}: a digit was cut`).toBe(false);
          // round 3 (item 2): every digit ends on the label — and before the QR column when the QR shares its rows
          const right = rightmostOpEdge([op!]);
          expect(right, `${tag}: the number runs past the label's edge (${right} > ${r.wDots})`).toBeLessThanOrEqual(r.wDots);
          const numH = 32 * (op!.ym ?? 1);
          if (qr && op!.y < qr.y0 + qr.foot && op!.y + numH > qr.y0) expect(right, `${tag}: the number runs into the QR`).toBeLessThanOrEqual(qr.x0);
        }
      }
    }, 60_000);
  }
});
