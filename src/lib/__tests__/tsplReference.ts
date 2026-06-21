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

  writeAscii('TEXT 16,10,"4",0,1,1,"SellerFlowLive"');
  if (sessionDate) {
    writeAscii(`TEXT ${wDots - 340},18,"2",0,1,1,"Session: ${safe(truncate(sessionDate, 22))}"`);
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
    y += 35;
  }

  if (printBuyerNumber) {
    writeAscii(`TEXT 16,${y},"4",0,2,2,"Buyer #${buyerNum}"`);
    y += 95;
  }

  if (buyerNameToPrint) {
    writeTextSmart(16, y, "4", safe(truncate(buyerNameToPrint, 30)), 1, 1);
    y += 40;
  }

  if (printBuyerUsername && cleanBuyerHandle) {
    writeTextSmart(16, y, "3", "@" + safe(truncate(cleanBuyerHandle, 30)), 1, 1);
    y += 35;
  }

  if (printOrderItems && orders.length > 0 && y < 350) {
    writeAscii(`BAR 16,${y},${wDots - 280},2`);
    y += 10;
    const maxOrders = 2;
    for (let i = 0; i < Math.min(orders.length, maxOrders) && y < 360; i++) {
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

  writeAscii(`BAR 0,380,${wDots},3`);
  if (printTotal && totalSpent > 0) {
    writeAscii('TEXT 16,395,"3",0,1,1,"Total:"');
    const totalStr = safe(currency) + money(totalSpent);
    writeAscii(`TEXT ${wDots - 390},395,"4",0,2,1,"${safe(truncate(totalStr, 18))}"`);
  }

  writeAscii("PRINT 1");
  return Uint8Array.from(out);
}
