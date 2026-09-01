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
  // Per-element size LEVELS (1-8 integer, TSPL multiplier). Absent/1 => base
  // size => byte-identical to the legacy goldens.
  printStoreScale?: number;
  printBuyerNumberScale?: number;
  printBuyerNameScale?: number;
  printUsernameScale?: number;
  printOrderScale?: number;
  printCommentScale?: number;
  printTotalScale?: number;
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

// ── Script handling (language-agnostic; mirrors TsplBuilder.java) ────────────
const SCRIPT_ASCII = 1;
const SCRIPT_CJK = 2;
const SCRIPT_UNSUPPORTED = 3;

// Latin letters NFD does NOT decompose to base+combining-mark.
const ATOMIC_LATIN: Record<string, string> = {
  "đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ø": "o", "Ø": "O",
  "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ß": "ss",
  "þ": "th", "Þ": "Th", "ð": "d", "Ð": "D", "ı": "i",
};

// Romanize Latin-script text: NFD-decompose, drop combining marks
// (U+0300–U+036F), map atomic Latin letters. CJK ideographs and plain ASCII
// pass through unchanged, so existing goldens are byte-identical.
function transliterateLatin(s: string): string {
  if (!s) return "";
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x300 && cp <= 0x36f) continue; // combining mark
    out += ATOMIC_LATIN[ch] ?? ch;
  }
  return out;
}

function isCjkIdeograph(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff)
  );
}

// Classify already-transliterated text: ASCII | CJK ideograph | UNSUPPORTED.
function classifyScript(s: string): number {
  let hasCjk = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 127) continue;
    if (isCjkIdeograph(cp)) {
      hasCjk = true;
      continue;
    }
    return SCRIPT_UNSUPPORTED;
  }
  return hasCjk ? SCRIPT_CJK : SCRIPT_ASCII;
}

// Keep only what the printer can render: ASCII + CJK ideographs.
function stripUnrenderable(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 127 || isCjkIdeograph(cp)) out += ch;
  }
  return out;
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
  // CJK buyer-name enlargement (Chinese/kanji render via 24-dot TSS24.BF2 vs the
  // 32-dot ASCII name font). nameCjk{X,Y}Mul scale ONLY the CJK name; nameCjkGap
  // is its y advance; the layout below shifts by (nameCjkGap - nameGap) only when
  // the name is CJK, so English fixtures stay byte-identical.
  nameCjkXMul: number; nameCjkYMul: number; nameCjkGap: number;
}
export const STICKER_LAYOUTS: Record<string, SizeConfig> = {
  // 480-dot height tier (60mm): full 2x2 buyer#, 2 order rows, Total kept.
  "100x60": { wDots: 800, rightEdge: 784, storeGap: 55, buyerNumYMul: 2, buyerNumGap: 110, nameGap: 58, usernameGap: 58, sepGap: 10, sepWidth: 520, orderEntryGuard: 390, orderLoopGuard: 400, showTotal: true, totalY: 445, totalAmountX: 410, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58 },
  "80x60":  { wDots: 640, rightEdge: 624, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 360, orderEntryGuard: 350, orderLoopGuard: 360, showTotal: true, totalY: 395, totalAmountX: 250, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58 },
  // 400-dot height tier (50mm): Total moves up, ~1 order row fits.
  "80x50":  { wDots: 640, rightEdge: 624, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 360, orderEntryGuard: 270, orderLoopGuard: 280, showTotal: true, totalY: 315, totalAmountX: 250, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58 },
  "70x50":  { wDots: 560, rightEdge: 544, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 280, orderEntryGuard: 270, orderLoopGuard: 280, showTotal: true, totalY: 315, totalAmountX: 170, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58 },
  // 320-dot height tier (40mm): compact — buyer# 2x1, tighter gaps, NO Total
  // (swapped for @username); order row uses the freed bottom space.
  "60x40":  { wDots: 480, rightEdge: 464, storeGap: 30, buyerNumYMul: 1, buyerNumGap: 46, nameGap: 34, usernameGap: 30, sepGap: 6,  sepWidth: 200, orderEntryGuard: 240, orderLoopGuard: 264, showTotal: false, totalY: 0, totalAmountX: 0, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58 },
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
  // Separate ASCII (xMul,yMul) and CJK (cjkXMul,cjkYMul) multipliers so a CJK
  // field can be enlarged without touching ASCII. Content is normalized first:
  // Latin diacritics romanized, then anything the AIMO can't render dropped, so
  // nothing prints as '?'. Mirrors TsplBuilder.writeTextSmart.
  const writeTextSmart = (x: number, y: number, asciiFont: string, rawContent: string, xMul: number, yMul: number, cjkXMul: number, cjkYMul: number) => {
    const content = stripUnrenderable(transliterateLatin(rawContent));
    if (!content) return;
    if (!hasNonAscii(content)) {
      writeAscii(`TEXT ${x},${y},"${asciiFont}",0,${xMul},${yMul},"${content}"`);
      return;
    }
    const maxChars = Math.max(1, Math.floor((c.rightEdge - x) / (24 * cjkXMul)));
    const fitted = truncate(content, maxChars);
    out.push(...asciiBytes(`TEXT ${x},${y},"TSS24.BF2",0,${cjkXMul},${cjkYMul},"`));
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

  // ── Per-element size scaling (mirrors TsplBuilder.java / Swift) ─────────────
  // Each element has an integer LEVEL 1-8 = the seller's size adjuster. The
  // level multiplies the element's BASE TSPL multiplier (clamped to the TSPL 8x
  // ceiling). Level 1 => base => byte-identical to the legacy goldens. The
  // already-2x-wide elements (buyer#, price code, total amount) scale HEIGHT
  // only (width stays at base) so they never overrun the right edge. F2/F3/F4
  // are the 1x font heights (dots) used only to reflow the layout down so a
  // grown element never overlaps the next — at level 1 every delta is 0, so the
  // goldens are untouched.
  const F2 = 24, F3 = 24, F4 = 32;
  const cmul = (m: number) => Math.max(1, Math.min(8, m));
  const lvl = (key: keyof RefSettings) => {
    const v = settings == null ? 1 : (settings[key] as number | undefined) ?? 1;
    return Math.max(1, Math.min(8, Number(v) || 1));
  };
  const lvlStore = lvl("printStoreScale");
  const lvlBuyerNum = lvl("printBuyerNumberScale");
  const lvlName = lvl("printBuyerNameScale");
  const lvlUser = lvl("printUsernameScale");
  const lvlOrder = lvl("printOrderScale");
  const lvlComment = lvl("printCommentScale");
  const lvlTotal = lvl("printTotalScale");

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

  // Buyer name — language-agnostic resolution (mirrors TsplBuilder):
  //  1. pure-emoji name -> handle / "Buyer #N".
  //  2. transliterate Latin diacritics -> ASCII (big font "4").
  //  3. classify: ASCII | CJK ideograph | UNSUPPORTED.
  //  4. UNSUPPORTED (Arabic/Korean/Thai/...) -> romanized @handle if ASCII, else
  //     omit the name line — never '?'.
  let nameSource = cleanBuyerName;
  if (buyerName && !cleanBuyerName) {
    nameSource = cleanBuyerHandle ? cleanBuyerHandle : `Buyer #${buyerNum}`;
  }
  let nameOut = transliterateLatin(nameSource);
  let nameTier = classifyScript(nameOut);
  if (nameTier === SCRIPT_UNSUPPORTED) {
    const handleOut = transliterateLatin(cleanBuyerHandle);
    if (handleOut && classifyScript(handleOut) === SCRIPT_ASCII) {
      nameOut = handleOut;
      nameTier = SCRIPT_ASCII;
    } else {
      nameOut = "";
    }
  }

  // `extra` accumulates the cumulative downward shift from BOTH the CJK-name
  // enlargement (legacy) and per-element size scaling, so the guards + the
  // bottom-anchored Total track everything above them. At all levels = 1 it
  // stays 0 (or the legacy CJK delta), keeping every fixture byte-identical.
  let extra = 0;
  let y = 60;
  if (printStoreName && cleanStoreName) {
    const m = cmul(lvlStore);
    writeTextSmart(16, y, "3", safe(truncate(cleanStoreName, 36)), m, m, m, m);
    const d = (m - 1) * F3;
    y += c.storeGap + d;
    extra += d;
  }

  // Buyer # — dominant element; 2x1 on the 320 tier (config buyerNumYMul).
  // Height-priority: width stays 2x, height = buyerNumYMul * level (clamped 8).
  // BUYER 4-DIGIT FIT (2026-07-22): two fixed-position TEXT commands — "Buyer"
  // at x=16 + BARE number (no "#") at x=280 (= 16 + 5x48 + 24-dot gap). 4
  // digits end at 472 <= 480 (60x40 wDots). Same ym/y both commands; y-advance
  // identical. Mirrors TsplBuilder.java/Swift — keep all three byte-identical.
  if (printBuyerNumber) {
    const ym = cmul(c.buyerNumYMul * lvlBuyerNum);
    writeAscii(`TEXT 16,${y},"4",0,2,${ym},"Buyer"`);
    writeAscii(`TEXT 280,${y},"4",0,2,${ym},"${buyerNum}"`);
    const d = (ym - c.buyerNumYMul) * F4;
    y += c.buyerNumGap + d;
    extra += d;
  }

  // Buyer name — scaled on both axes (left-aligned, has width budget). CJK
  // renders via TSS24.BF2 (base cjkXMul x cjkYMul); ASCII via font "4" (base 1x1).
  if (nameOut) {
    const cjkName = nameTier === SCRIPT_CJK;
    const asciiX = cmul(lvlName), asciiY = cmul(lvlName);
    const cjkX = cmul(c.nameCjkXMul * lvlName), cjkY = cmul(c.nameCjkYMul * lvlName);
    writeTextSmart(16, y, "4", safe(truncate(nameOut, 30)), asciiX, asciiY, cjkX, cjkY);
    const usedY = cjkName ? cjkY : asciiY;
    const refBaseY = cjkName ? c.nameCjkYMul : 1;
    const d = (usedY - refBaseY) * F4;
    y += (cjkName ? c.nameCjkGap : c.nameGap) + d;
    extra += (cjkName ? c.nameCjkGap - c.nameGap : 0) + d;
  }

  // @username — kept on every size, incl. 60x40 (replaced the Total line there).
  if (printBuyerUsername && cleanBuyerHandle) {
    const m = cmul(lvlUser);
    writeTextSmart(16, y, "3", "@" + safe(truncate(cleanBuyerHandle, 30)), m, m, m, m);
    const d = (m - 1) * F3;
    y += c.usernameGap + d;
    extra += d;
  }

  if (printOrderItems && orders.length > 0 && y < c.orderEntryGuard + extra) {
    writeAscii(`BAR 16,${y},${c.sepWidth},2`);
    y += c.sepGap;
    const maxOrders = 2;
    for (let i = 0; i < Math.min(orders.length, maxOrders) && y < c.orderLoopGuard + extra; i++) {
      const order = orders[i] ?? {};
      const time = order.time ?? "";
      const item = order.item ?? "";
      const cleanItem = stripEmoji(item);
      const tm = cmul(lvlOrder);
      const pm = cmul(lvlComment); // price code: height-priority (width stays 2x)
      if (time) {
        writeAscii(`TEXT 16,${y},"2",0,${tm},${tm},"${safe(truncate(time, 10))}"`);
      }
      if (cleanItem) {
        // Buyer's short price code -> same base as the grand Total amount:
        // font "4", 2x width, 1x height. truncate(12) guards the column width.
        // PRICE-NEXT-TO-TIME (owner req): x = time_x(16) + time width + TWO
        // spaces, all in the TIME's font "2" (12-dot cell) at the time's scale
        // tm, so the gap reads ~2 spaces at 1x/2x/3x and tracks the actual time
        // length (never overlaps the time). ONLY x changes — font/width/height
        // untouched. No time on this row -> keep the legacy x=180.
        const priceX = time ? 16 + (truncate(time, 10).length + 2) * 12 * tm : 180;
        writeTextSmart(priceX, y, "4", safe(truncate(cleanItem, 12)), 2, pm, 2, pm);
      }
      const d = Math.max((tm - 1) * F2, (pm - 1) * F4);
      y += 38 + d;
      extra += d;
    }
  }

  // Footer divider line removed; the order rows stay clear of the total via the
  // guards. Total dropped on 60x40 (config showTotal=false) — swapped for @username.
  if (printTotal && totalSpent > 0 && c.showTotal) {
    const totalY = c.totalY + extra;
    const lm = cmul(lvlTotal);
    writeAscii(`TEXT 16,${totalY},"3",0,${lm},${lm},"Total:"`);
    const am = cmul(lvlTotal); // amount: height-priority (width stays 2x)
    const totalStr = safe(currency) + money(totalSpent);
    writeAscii(`TEXT ${c.totalAmountX},${totalY},"4",0,2,${am},"${safe(truncate(totalStr, 18))}"`);
  }

  writeAscii("PRINT 1");
  return Uint8Array.from(out);
}
