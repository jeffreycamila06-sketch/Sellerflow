// PERMANENT GUARD (Nov 3, item 12) — Jeff's rule: every control on Settings → Printer / LIVE print pattern must
// change the printed sticker at every step (1×→2×→3×) and every switch (on→off), on every printer path (AIMO
// stream, generic TSPL = Flash Y41BT / Xprinter XP-420B, Niimbot 50×30) and every label size, with layout v2
// OFF and ON — and the preview must be the print. Rendered with the real atlases through the one production
// function (printing.stickerBitmapFor). The control list is read from the screens (printControls.harness
// screenControls), so a new row cannot ship untested. A control that changes nothing is a failure unless it is
// in the ALLOWED list below, each entry with its reason.
import { describe, it, expect } from "vitest";
import { PATHS, SIZES, screenControls, renderCase, rasterKey, recomposeBands, sampleBuyer, settingsFor, applyModuleState, AT, type CaseSpec } from "./printControls.harness";
import { buildGenericStickerBytes, buildNiimbotImage, buildNativeStickerPayload, NIIMBOT_LABEL } from "../printing";
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
  // The 60×40 compact layout (font-C, v2 OFF — today's layout Jeff likes) has no shop line either; the shop
  // row exists on 60×40 only with layout v2 ON (the Nov 3 shop-name branch).
  "generic|60x40mm|v2-off|shopName": "60x40 compact v1 has no shop name line",
  "generic|60x40mm|v2-off|shopNameSize": "60x40 compact v1 has no shop name line",
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
        if (base === k2 || k2 === k3) { if (!allowed(c, k)) noEffect.push(`${k} (1x=${base} 2x=${k2} 3x=${k3})`); }
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
