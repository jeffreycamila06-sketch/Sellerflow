// TypeScript reference port of the Android `TsplBuilder.forStickerNative`
// (mobile/android/.../TsplBuilder.java). Its SOLE purpose is to re-derive the
// TSPL byte stream from scratch in a runnable (vitest) environment and assert
// it byte-for-byte against the Android golden fixtures — which in turn proves
// the algorithm the iOS Swift `buildTsplSticker` mirrors. Test-only; never
// shipped (the iOS plugin builds TSPL natively).
//
// Parity rules preserved from the Java original:
//   - truncate() slices by UTF-16 code units (Java String.substring)
//   - writeAscii uses '?' (0x3F) for any UTF-16 unit > 127 (getBytes US_ASCII)
//   - CJK fields -> TSS24.BF2 + GBK bytes, re-truncated to printable width
//   - stripEmoji walks code points; javaTrim strips units <= U+0020

interface RefOrder {
  time?: string;
  item?: string;
}
interface RefBuyer {
  num?: number;
  bNum?: number;
  name?: string;
  handle?: string;
  totalSpent?: number;
  orders?: RefOrder[];
}
interface RefSettings {
  printStoreName?: boolean;
  printBuyerNumber?: boolean;
  printBuyerUsername?: boolean;
  printOrderItems?: boolean;
  printTotal?: boolean;
}
export interface RefPayload {
  storeName?: string;
  sessionDate?: string;
  currency?: string;
  buyer?: RefBuyer;
  settings?: RefSettings | null;
}

type GbkEncoder = (s: string) => number[];

const CRLF = [0x0d, 0x0a];

function asciiBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out.push(code <= 127 ? code : 0x3f);
  }
  return out;
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safe(s: string): string {
  return s.replace(/"/g, "'");
}

function hasNonAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 127) return true;
  }
  return false;
}

function isStrippable(cp: number): boolean {
  return (
    cp >= 0x1f000 ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0x200d ||
    cp === 0x20e3
  );
}

function javaTrim(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && s.charCodeAt(start) <= 0x20) start++;
  while (end > start && s.charCodeAt(end - 1) <= 0x20) end--;
  return s.slice(start, end);
}

function stripEmoji(s: string): string {
  if (!s) return "";
  let kept = "";
  for (const ch of s) {
    if (!isStrippable(ch.codePointAt(0) ?? 0)) kept += ch;
  }
  return javaTrim(kept);
}

function money(v: number): string {
  return v === Math.trunc(v) ? String(v) : v.toFixed(2);
}

export function buildTsplStickerReference(
  payload: RefPayload,
  labelWidthMm: number,
  labelHeightMm: number,
  gbk: GbkEncoder,
): Uint8Array {
  const out: number[] = [];
  const writeAscii = (s: string) => {
    out.push(...asciiBytes(s), ...CRLF);
  };
  // 8 dots/mm @ 203 DPI. PHASE 1 scales only WIDTH-dependent layout; the 60mm
  // height tier keeps every y. 100x60 reproduces the original bytes exactly
  // (wDots-340==460, wDots-390==410, wDots-16==784 at 800). Mirrors TsplBuilder.
  const wDots = labelWidthMm * 8;
  const rightEdge = wDots - 16;
  // PHASE 2 height tier: footer anchored to the bottom; order caps derive from
  // it. At 60mm (480) these reduce to the original 380/395/350/360 -> byte-identical.
  const hDots = labelHeightMm * 8;
  const footerBarY = hDots - 100;
  const totalY = hDots - 85;
  // PHASE 3 / 320-dot (40mm) tier: compact body (tighter gaps, buyer# 2x1).
  // On 60x40 the Total line is dropped for the @username row. Gated to
  // hDots<=320 so 480/400 stay byte-identical (Total + username kept).
  const compact = hDots <= 320;
  // Order caps: compact has no Total, so orders use the bottom (hDots-80/-56).
  const orderEntryGuard = compact ? (hDots - 80) : (footerBarY - 30);
  const orderLoopGuard  = compact ? (hDots - 56) : (footerBarY - 20);
  // xMul/yMul multipliers + width-dependent rightEdge for the CJK clamp; applied
  // to both the ASCII and TSS24.BF2 (CJK) paths. Mirrors TsplBuilder.writeTextSmart.
  const writeTextSmart = (x: number, y: number, asciiFont: string, content: string, xMul: number, yMul: number) => {
    if (!hasNonAscii(content)) {
      writeAscii(`TEXT ${x},${y},"${asciiFont}",0,${xMul},${yMul},"${content}"`);
      return;
    }
    const maxChars = Math.max(1, Math.floor((rightEdge - x) / (24 * xMul)));
    const fitted = truncate(content, maxChars);
    out.push(...asciiBytes(`TEXT ${x},${y},"TSS24.BF2",0,${xMul},${yMul},"`));
    out.push(...gbk(fitted));
    out.push(...asciiBytes(`"`), ...CRLF);
  };

  const buyer: RefBuyer = payload.buyer ?? {};
  const settings = payload.settings;
  const storeName = payload.storeName ?? "";
  const sessionDate = payload.sessionDate ?? "";
  const currency = payload.currency ?? "";
  const buyerNum = buyer.num ?? buyer.bNum ?? 0;
  const buyerName = buyer.name ?? "";
  const buyerHandle = buyer.handle ?? "";
  const totalSpent = buyer.totalSpent ?? 0;
  const orders = buyer.orders ?? [];

  const flag = (key: keyof RefSettings) =>
    settings == null ? true : settings[key] !== false;
  const printStoreName = flag("printStoreName");
  const printBuyerNumber = flag("printBuyerNumber");
  const printBuyerUsername = flag("printBuyerUsername");
  const printOrderItems = flag("printOrderItems");
  const printTotal = flag("printTotal");

  writeAscii(`SIZE ${labelWidthMm} mm, ${labelHeightMm} mm`);
  writeAscii("GAP 2 mm, 0");
  writeAscii("DIRECTION 1");
  writeAscii("REFERENCE 0,0");
  writeAscii("DENSITY 8");
  writeAscii("CLS");

  writeAscii('TEXT 16,10,"3",0,1,1,"SellerFlowLive"');
  if (sessionDate) {
    writeAscii(`TEXT 290,18,"2",0,1,1,"${safe(truncate(sessionDate, 12))}"`);
  }
  writeAscii(`BAR 0,48,${wDots},3`);

  const cleanStoreName = stripEmoji(storeName);
  const cleanBuyerName = stripEmoji(buyerName);
  const cleanBuyerHandle = stripEmoji(buyerHandle);
  let buyerNameToPrint = cleanBuyerName;
  if (buyerName && !cleanBuyerName) {
    buyerNameToPrint = cleanBuyerHandle ? cleanBuyerHandle : `Buyer #${buyerNum}`;
  }

  let y = 60;
  if (printStoreName && cleanStoreName) {
    writeTextSmart(16, y, "3", safe(truncate(cleanStoreName, 36)), 1, 1);
    y += compact ? 30 : 35;
  }

  // Buyer # — dominant element; drops to 2x1 on the 320 tier to fit.
  if (printBuyerNumber) {
    writeAscii(`TEXT 16,${y},"4",0,2,${compact ? 1 : 2},"Buyer #${buyerNum}"`);
    y += compact ? 46 : 95;
  }

  if (buyerNameToPrint) {
    writeTextSmart(16, y, "4", safe(truncate(buyerNameToPrint, 30)), 1, 1);
    y += compact ? 34 : 40;
  }

  // @username — kept on every size, incl. 60x40 (replaced the Total line there).
  if (printBuyerUsername && cleanBuyerHandle) {
    writeTextSmart(16, y, "3", "@" + safe(truncate(cleanBuyerHandle, 30)), 1, 1);
    y += compact ? 30 : 35;
  }

  if (printOrderItems && orders.length > 0 && y < orderEntryGuard) {
    writeAscii(`BAR 16,${y},${wDots - 280},2`);
    y += compact ? 6 : 10;
    const maxOrders = 2;
    for (let i = 0; i < Math.min(orders.length, maxOrders) && y < orderLoopGuard; i++) {
      const order = orders[i] ?? {};
      const time = order.time ?? "";
      const item = order.item ?? "";
      const cleanItem = stripEmoji(item);
      if (time) {
        writeAscii(`TEXT 16,${y},"2",0,1,1,"${safe(truncate(time, 10))}"`);
      }
      if (cleanItem) {
        // Buyer's short price code -> same size as the grand Total amount:
        // font "4", 2x width, 1x height. truncate(12) guards the column width.
        writeTextSmart(180, y, "4", safe(truncate(cleanItem, 12)), 2, 1);
      }
      y += 38;
    }
  }

  // Footer divider line removed; footerBarY stays as the invisible clearance
  // boundary. Total dropped on 60x40 (compact) — swapped for the @username row.
  if (printTotal && totalSpent > 0 && !compact) {
    writeAscii(`TEXT 16,${totalY},"3",0,1,1,"Total:"`);
    const totalStr = safe(currency) + money(totalSpent);
    writeAscii(`TEXT ${wDots - 390},${totalY},"4",0,2,1,"${safe(truncate(totalStr, 18))}"`);
  }

  writeAscii("PRINT 1");
  return Uint8Array.from(out);
}
