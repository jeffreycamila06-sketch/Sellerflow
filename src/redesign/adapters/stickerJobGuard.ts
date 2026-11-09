// FINAL SAFETY for every sticker PICTURE job (Jeff 2026-11-09, XP-420B extra blank labels): whatever font drew
// the text, the data handed to the printer is checked on its REAL BYTES right before it is sent — never taller
// than the label, exactly ONE print per sticker, no extra feed / re-sync command. A job that fails is not sent
// (the seller sees "print failed"; nothing feeds a blank label). The encoders never produce such a job; this is
// the backstop. PURE — no I/O. Valid jobs pass through untouched (bytes identical).
//   TSPL (Flash Y41BT, Xprinter XP-420B …): SIZE = the label · one GAP · one CLS · bands inside the label ·
//       ONE "PRINT 1" as the last command · no FORMFEED / FEED / BACKFEED / HOME / GAPDETECT / AUTODETECT …
//   D520 SDK stream (Android SPP + iPhone BLE): SIZE = the label · ONE compressed image ≤ the label · ONE
//       "PRINT 1,1" last · no feed command
//   generic ESC/POS: ESC @ · ONE GS v 0 image ≤ the label · ONE ESC d n · nothing else
//   generic CPCL: ONE "! 0 200 200 h 1" page (h ≤ the label) · ONE EG image · FORM · PRINT
//   Niimbot (vendor SDK image): ONE image ≤ the SDK frame, the label size = the label
//   laptop: the picture ≤ the label (one W×H mm page — laptopPage)
export type JobKind = "tspl" | "d520" | "escpos" | "cpcl";
const FEEDS = /^(FORMFEED|FEED|BACKFEED|BACKUP|HOME|GAPDETECT|AUTODETECT|BLINEDETECT|SELFTEST|SET TEAR|SET PEEL|SET CUTTER|CUT|OFFSET)\b/i;
const latin1 = (b: Uint8Array, from = 0, to = b.length): string => { let s = ""; for (let i = from; i < to; i++) s += String.fromCharCode(b[i]); return s; };

/** TSPL commands outside the BITMAP data (binary rows skipped by their declared size, never read as text). */
export function tsplCommands(b: Uint8Array): { cmds: string[]; bands: { x: number; y: number; rowBytes: number; h: number }[]; broken: boolean } {
  const cmds: string[] = [], bands: { x: number; y: number; rowBytes: number; h: number }[] = [];
  let i = 0;
  while (i < b.length) {
    let j = i;
    while (j < b.length && !(b[j] === 0x0d && b[j + 1] === 0x0a)) {
      if (b[j] === 0x2c && j - i < 40 && b[i] === 0x42 /* B */ && /^BITMAP \d+,\d+,\d+,\d+,\d+$/.test(latin1(b, i, j))) break;
      j++;
    }
    const head = latin1(b, i, j);
    const m = /^BITMAP (\d+),(\d+),(\d+),(\d+),(\d+)$/.exec(head);
    if (m && b[j] === 0x2c) {
      const rowBytes = +m[3], h = +m[4];
      bands.push({ x: +m[1], y: +m[2], rowBytes, h });
      cmds.push(`BITMAP ${m[1]},${m[2]},${m[3]},${m[4]},${m[5]}`);
      i = j + 1 + rowBytes * h;
      if (i > b.length) return { cmds, bands, broken: true };
      if (b[i] === 0x0d && b[i + 1] === 0x0a) i += 2;
      continue;
    }
    if (head.trim()) cmds.push(head.trim());
    i = j + 2;
  }
  return { cmds, bands, broken: false };
}

export function checkTsplJob(b: Uint8Array, wMm: number, hMm: number): string[] {
  const bad: string[] = [];
  const { cmds, bands, broken } = tsplCommands(b);
  if (broken) bad.push("a BITMAP band runs past the end of the job");
  const count = (re: RegExp) => cmds.filter((c) => re.test(c)).length;
  if (count(/^SIZE /) !== 1 || !cmds.some((c) => c.replace(/\s+/g, "") === `SIZE${wMm}mm,${hMm}mm`)) bad.push(`SIZE is not exactly the ${wMm}×${hMm} mm label`);
  if (count(/^CLS$/) !== 1) bad.push("not exactly one CLS");
  if (count(/^PRINT /) !== 1 || !/^PRINT 1(,1)?$/.test(cmds[cmds.length - 1] ?? "")) bad.push("not exactly one PRINT 1, as the last command");
  if (cmds.some((c) => FEEDS.test(c))) bad.push("a feed / re-sync command");
  for (const x of bands) if (x.y < 0 || x.y + x.h > hMm * 8 || x.x + x.rowBytes * 8 > wMm * 8) bad.push(`band ${x.x},${x.y} ${x.rowBytes * 8}×${x.h} outside the ${wMm * 8}×${hMm * 8} label`);
  return bad;
}

export function checkSdkJob(b: Uint8Array, wMm: number, hMm: number): string[] {
  const bad: string[] = [];
  const s = latin1(b, 0, Math.min(b.length, 200));
  const at = s.indexOf("BITMAP 4,0,");
  if (at < 0) return ["no image"];
  const head = s.slice(0, at).split(/\r\n/).filter(Boolean);
  if (head.filter((c) => c.startsWith("SIZE ")).length !== 1 || head[0] !== `SIZE ${wMm} mm,${hMm} mm`) bad.push(`SIZE is not exactly the ${wMm}×${hMm} mm label`);
  if (head.some((c) => FEEDS.test(c) || c.startsWith("PRINT"))) bad.push("a feed / print before the image");
  const m = /^BITMAP 4,0,(\d+),(\d+),4,/.exec(s.slice(at));
  if (!m) return [...bad, "image header unreadable"];
  if (+m[2] > hMm * 8 || +m[1] * 8 > wMm * 8) bad.push(`image ${+m[1] * 8}×${m[2]} taller / wider than the label`);
  let i = at + m[0].length;
  for (let n = 0; ; n++) {
    if (i + 4 > b.length || n > 10000) return [...bad, "image data runs past the end of the job"];
    const len = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
    i += 4;
    if (!len) break;
    i += len;
  }
  const tail = latin1(b, i).split(/[\r\n]+/).filter(Boolean);
  if (tail.length !== 1 || tail[0] !== "PRINT 1,1") bad.push(`after the image: ${tail.join(" | ") || "nothing"} (must be one PRINT 1,1)`);
  if (latin1(b, i).includes("BITMAP")) bad.push("a second image");
  return bad;
}

export function checkEscposJob(b: Uint8Array, wMm: number, hMm: number): string[] {
  const bad: string[] = [];
  if (b.length < 13 || b[0] !== 0x1b || b[1] !== 0x40 || b[2] !== 0x1d || b[3] !== 0x76 || b[4] !== 0x30) return ["not ESC @ + one GS v 0 image"];
  const rb = b[6] | (b[7] << 8), h = b[8] | (b[9] << 8);
  if (b.length !== 10 + rb * h + 3 || b[b.length - 3] !== 0x1b || b[b.length - 2] !== 0x64) bad.push("more than one image + one feed");
  if (h > hMm * 8 || rb * 8 > wMm * 8) bad.push(`image ${rb * 8}×${h} taller / wider than the label`);
  return bad;
}

export function checkCpclJob(b: Uint8Array, wMm: number, hMm: number): string[] {
  const m = /^! 0 200 200 (\d+) 1\r\nPAGE-WIDTH (\d+)\r\nEG (\d+) (\d+) 0 0 [0-9A-F]*\r\nFORM\r\nPRINT\r\n$/.exec(latin1(b));
  if (!m) return ["not ONE page (! 0 200 200 h 1 … FORM PRINT)"];
  if (+m[1] > hMm * 8 || +m[4] > hMm * 8 || +m[2] > wMm * 8) return [`page ${m[2]}×${m[1]} taller / wider than the label`];
  return [];
}

export function checkStickerJob(kind: JobKind, b: Uint8Array, wMm: number, hMm: number): string[] {
  return kind === "tspl" ? checkTsplJob(b, wMm, hMm) : kind === "d520" ? checkSdkJob(b, wMm, hMm) : kind === "cpcl" ? checkCpclJob(b, wMm, hMm) : checkEscposJob(b, wMm, hMm);
}

/** Niimbot: one image, never taller / wider than the SDK frame, for the label it says (when given). */
export function checkNiimbotImage(img: { w: number; h: number; rowBytes: number; data: string; labelWidthMm: number; labelHeightMm: number }, frameW: number, frameH: number, wMm?: number, hMm?: number): string[] {
  const bad: string[] = [];
  if (img.h > frameH || img.w > frameW) bad.push(`image ${img.w}×${img.h} larger than the ${frameW}×${frameH} frame`);
  if (img.rowBytes * 8 < img.w) bad.push("image rows shorter than its width");
  if (wMm != null && hMm != null && (img.labelWidthMm !== wMm || img.labelHeightMm !== hMm)) bad.push(`label ${img.labelWidthMm}×${img.labelHeightMm} mm is not the ${wMm}×${hMm} mm label`);
  return bad;
}

/** Laptop: the picture never taller / wider than the W×H mm page it is printed on. */
export function checkLaptopPicture(r: { w: number; h: number }, wMm: number, hMm: number): string[] {
  return r.h > hMm * 8 || r.w > wMm * 8 ? [`picture ${r.w}×${r.h} larger than the ${wMm}×${hMm} mm page`] : [];
}
export const STICKER_JOB_INVALID = "STICKER_JOB_INVALID";
