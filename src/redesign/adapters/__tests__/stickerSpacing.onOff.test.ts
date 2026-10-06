// STICKER SPACING — flags ON vs flags OFF, label by label (audit F1/F2 follow-up). For every
// label: (a) not past the bottom unless flags-off already was, and never lower than flags-off;
// (b) no text past the right edge unless flags-off already was; (c) a comment flags-off printed
// prints at the SAME scale; (d) fully visible non-space characters drop by at most 1 (a long
// unspaced name now cut inside the right margin instead of at the physical edge).
import { describe, it, expect } from "vitest";
import { stickerDrawOps, stickerQrPlacement, lowestOpBottom, STICKER_LAYOUTS, type DrawOp, type RasterPayload, type RasterSettings } from "../stickerRaster";

const SIZES: [number, number][] = [[100, 60], [80, 60], [80, 50], [70, 50], [60, 40]];
const STORES = ["My Shop", "Cristine's Ukay Ukay Live Selling"];
const NAMES = ["Cristine Ramos Cabañas", "Joy M", "陳小美的店", "Supercalifragilisticexpialidocious"];
const COMMENTS = ["Mine black size XL 2pcs 350", "Mine", "藍色外套 2件 pls"];
type Case = { w: number; h: number; ns: number; cs: number; os: number; qr: boolean; fb: boolean; n: number; compact: boolean; store: string; name: string; comment: string };

export function onOffPayload(k: Case, on: boolean): RasterPayload {
  const handle = k.fb ? k.name : "cristineramos";
  return {
    storeName: k.store, sessionDate: "10/07/2026", currency: "NT$",
    buyer: { num: 12, name: k.name, handle, totalSpent: 700,
      orders: [{ time: "21:41", item: k.comment }, { time: "21:42", item: k.comment }].slice(0, k.n) },
    settings: {
      printStoreName: true, printBuyerNumber: true, printBuyerUsername: !k.fb, printOrderItems: true, printTotal: false,
      printStoreScale: k.os, printBuyerNumberScale: k.os, printUsernameScale: k.os, printOrderScale: 1,
      printBuyerNameScale: k.ns, printCommentScale: k.cs,
      printStickerQr: k.qr && !k.fb, printCommentFullWidth: true, ...(k.fb ? { printFacebookName: true } : {}),
      ...(on ? { printHalfWordGap: true, ...(k.compact ? { printSpacing: "compact" as const } : {}) } : {}),
    } as RasterSettings,
  };
}
const CELL: Record<string, [number, number]> = { "2": [12, 20], "3": [16, 24], "4": [24, 32], cjk: [24, 24] };
type Txt = Exclude<DrawOp, { k: "bar" }>;
export function measure(p: RasterPayload, w: number, h: number) {
  const cfg = STICKER_LAYOUTS[`${w}x${h}`];
  const r = stickerDrawOps(p, w, h, "extended", stickerQrPlacement(p, cfg.wDots, h * 8, h));
  const text = r.ops.filter((o): o is Txt => o.k !== "bar");
  const sep = r.ops.find((o) => o.k === "bar" && o.x === 16);
  const comment = sep ? text.filter((o) => o.y > sep.y && !(o.k === "txt" && o.font === "2")) : [];
  let right = 0, visible = 0;
  for (const o of text) {
    const [cw, ch] = CELL[o.k === "txt" ? o.font : "cjk"];
    const chars = [...o.s];
    right = Math.max(right, o.x + chars.length * cw * o.xm);
    chars.forEach((c, i) => { if (c.trim() && o.x + (i + 1) * cw * o.xm <= r.wDots && o.y + ch * o.ym <= r.hDots) visible++; });
  }
  return { bottom: lowestOpBottom(r.ops), hDots: r.hDots, wDots: r.wDots, right, visible,
    commentScale: [...new Set(comment.map((o) => `${o.xm}x${o.ym}`))].sort().join(","), commentPrinted: comment.length > 0 };
}
export function violations(k: Case): string[] {
  const off = measure(onOffPayload(k, false), k.w, k.h), on = measure(onOffPayload(k, true), k.w, k.h);
  const v: string[] = [];
  if (on.bottom > on.hDots && (off.bottom <= off.hDots || on.bottom > off.bottom)) v.push(`a bottom ${off.bottom}->${on.bottom}/${on.hDots}`);
  if (on.right > on.wDots && off.right <= off.wDots) v.push(`b right ${off.right}->${on.right}/${on.wDots}`);
  if (off.commentPrinted && on.commentScale !== off.commentScale) v.push(`c comment ${off.commentScale}->${on.commentScale || "none"}`);
  // (d) exemption, R4 by design: flags-off printed NO comment (a 2nd Facebook name line pushed it
  // off) and flags-on prints the comment instead of that 2nd name line → fewer name letters, but the
  // comment is back. Reported as "d* comment-restored" so the matrix can list these separately.
  if (on.visible < off.visible - 1) v.push(!off.commentPrinted && on.commentPrinted ? `d* comment-restored ${off.visible}->${on.visible}` : `d visible ${off.visible}->${on.visible}`);
  return v;
}
const label = (k: Case) => `${k.w}x${k.h} ${k.fb ? "FB" : "TT"} n${k.ns} c${k.cs} o${k.os} qr=${k.qr} ${k.n}ord ${k.compact ? "compact" : "normal"} [${k.store}] ${k.name} | ${k.comment}`;

describe("flags ON vs OFF — named audit cases", () => {
  const base = { os: 1, store: "My Shop", name: "Cristine Ramos Cabañas" };
  it("F1: 80x60, TikTok, QR on, 2 orders, comment 2×, Compact — not past the bottom (Normal ends at 479)", () => {
    const k: Case = { ...base, w: 80, h: 60, ns: 1, cs: 2, qr: true, fb: false, n: 2, compact: true, comment: "Mine black size XL 2pcs 350" };
    expect(violations(k)).toEqual([]);
    expect(measure(onOffPayload(k, true), 80, 60).bottom).toBeLessThanOrEqual(480);
  });
  it("F2: 70x50, Facebook, name 2×, comment 2×, \"Mine\" — the comment keeps its 2× size", () => {
    for (const compact of [false, true]) {
      const k: Case = { ...base, w: 70, h: 50, ns: 2, cs: 2, qr: false, fb: true, n: 1, compact, comment: "Mine" };
      expect(violations(k)).toEqual([]);
      expect(measure(onOffPayload(k, true), 70, 50).commentScale).toBe("4x4");
    }
  });
});

describe("flags ON vs OFF — matrix", () => {
  it("34,560 label pairs: rules a–d hold for every one", () => {
    let count = 0; const bad: string[] = []; const restored: string[] = [];
    for (const [w, h] of SIZES) for (const ns of [1, 2, 3]) for (const cs of [1, 2, 3]) for (const os of [1, 2]) for (const qr of [false, true])
      for (const fb of [false, true]) for (const n of [1, 2]) for (const compact of [false, true]) for (const store of STORES) for (const name of NAMES) for (const comment of COMMENTS) {
        const k: Case = { w, h, ns, cs, os, qr, fb, n, compact, store, name, comment };
        count++;
        const v = violations(k);
        if (v.some((x) => !x.startsWith("d*"))) bad.push(`${label(k)} :: ${v.join("; ")}`);
        else if (v.length) restored.push(label(k));
      }
    expect(count).toBe(34560);
    expect(bad.length + "\n" + bad.slice(0, 25).join("\n")).toBe("0\n");
    // the R4 "comment restored instead of a 2nd Facebook name line" cases — all Facebook, pinned
    // by count so any change in this trade-off is noticed (owner decision pending)
    expect(restored.every((l) => l.includes(" FB "))).toBe(true);
    expect(restored.length).toBe(210);
  }, 600000);
});
