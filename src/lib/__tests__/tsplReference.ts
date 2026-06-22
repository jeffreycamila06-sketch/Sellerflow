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

// ── Per-size layout config (ISOLATION) ──────────────────────────────────────
// Each sticker size is a self-contained entry: editing one row cannot affect
// another (no shared geometry formula for any tunable value). The renderer just
// executes the config. Values are the resolved equivalents of the previous
// parametric formulas, so every fixture stays byte-identical. Mirrors the
// Java/Swift LAYOUTS tables — keep all three in sync (goldens enforce it).
//   rightEdge   = wDots-16 (CJK clamp)         sepWidth  = separator bar width
//   *Gap        = y advance after that field   buyerNumYMul = 2x2 vs 2x1 height
//   orderEntry/LoopGuard = order-row y caps    totalAmountX = right-aligned $
export interface SizeConfig {
  wDots: number; rightEdge: number;
  storeGap: number; buyerNumYMul: number; buyerNumGap: number;
  nameGap: number; usernameGap: number; sepGap: number; sepWidth: number;
  orderEntryGuard: number; orderLoopGuard: number;
  showTotal: boolean; totalY: number; totalAmountX: number;
}
export const STICKER_LAYOUTS: Record<string, SizeConfig> = {
  // 480-dot height tier (60mm): full 2x2 buyer#, 2 order rows, Total kept.
  "100x60": { wDots: 800, rightEdge: 784, storeGap: 55, buyerNumYMul: 2, buyerNumGap: 110, nameGap: 58, usernameGap: 58, sepGap: 10, sepWidth: 520, orderEntryGuard: 390, orderLoopGuard: 400, showTotal: true, totalY: 445, totalAmountX: 410 },
  "80x60":  { wDots: 640, rightEdge: 624, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 360, orderEntryGuard: 350, orderLoopGuard: 360, showTotal: true, totalY: 395, totalAmountX: 250 },
  // 400-dot height tier (50mm): Total moves up, ~1 order row fits.
  "80x50":  { wDots: 640, rightEdge: 624, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 360, orderEntryGuard: 270, orderLoopGuard: 280, showTotal: true, totalY: 315, totalAmountX: 250 },
  "70x50":  { wDots: 560, rightEdge: 544, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 280, orderEntryGuard: 270, orderLoopGuard: 280, showTotal: true, totalY: 315, totalAmountX: 170 },
  // 320-dot height tier (40mm): compact — buyer# 2x1, tighter gaps, NO Total
  // (swapped for @username); order row uses the freed bottom space.
  "60x40":  { wDots: 480, rightEdge: 464, storeGap: 30, buyerNumYMul: 1, buyerNumGap: 46, nameGap: 34, usernameGap: 30, sepGap: 6,  sepWidth: 200, orderEntryGuard: 240, orderLoopGuard: 264, showTotal: false, totalY: 0, totalAmountX: 0 },
};
function stickerConfig(wMm: number, hMm: number): SizeConfig {
  return STICKER_LAYOUTS[`${wMm}x${hMm}`] ?? STICKER_LAYOUTS["100x60"];
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
  // ISOLATION: all per-size geometry comes from this size's config entry — no
  // shared formula, so editing one size can't affect another. Mirrors TsplBuilder.
  const c = stickerConfig(labelWidthMm, labelHeightMm);
  // xMul/yMul multipliers + per-size rightEdge for the CJK clamp; applied to
  // both the ASCII and TSS24.BF2 (CJK) paths. Mirrors TsplBuilder.writeTextSmart.
  const writeTextSmart = (x: number, y: number, asciiFont: string, content: string, xMul: number, yMul: number) => {
    if (!hasNonAscii(content)) {
      writeAscii(`TEXT ${x},${y},"${asciiFont}",0,${xMul},${yMul},"${content}"`);
      return;
    }
    const maxChars = Math.max(1, Math.floor((c.rightEdge - x) / (24 * xMul)));
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
  writeAscii(`BAR 0,48,${c.wDots},3`);

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
    y += c.storeGap;
  }

  // Buyer # — dominant element; 2x1 on the 320 tier (config buyerNumYMul).
  if (printBuyerNumber) {
    writeAscii(`TEXT 16,${y},"4",0,2,${c.buyerNumYMul},"Buyer #${buyerNum}"`);
    y += c.buyerNumGap;
  }

  if (buyerNameToPrint) {
    writeTextSmart(16, y, "4", safe(truncate(buyerNameToPrint, 30)), 1, 1);
    y += c.nameGap;
  }

  // @username — kept on every size, incl. 60x40 (replaced the Total line there).
  if (printBuyerUsername && cleanBuyerHandle) {
    writeTextSmart(16, y, "3", "@" + safe(truncate(cleanBuyerHandle, 30)), 1, 1);
    y += c.usernameGap;
  }

  if (printOrderItems && orders.length > 0 && y < c.orderEntryGuard) {
    writeAscii(`BAR 16,${y},${c.sepWidth},2`);
    y += c.sepGap;
    const maxOrders = 2;
    for (let i = 0; i < Math.min(orders.length, maxOrders) && y < c.orderLoopGuard; i++) {
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

  // Footer divider line removed; the order rows stay clear of the total via the
  // guards. Total dropped on 60x40 (config showTotal=false) — swapped for @username.
  if (printTotal && totalSpent > 0 && c.showTotal) {
    writeAscii(`TEXT 16,${c.totalY},"3",0,1,1,"Total:"`);
    const totalStr = safe(currency) + money(totalSpent);
    writeAscii(`TEXT ${c.totalAmountX},${c.totalY},"4",0,2,1,"${safe(truncate(totalStr, 18))}"`);
  }

  writeAscii("PRINT 1");
  return Uint8Array.from(out);
}
