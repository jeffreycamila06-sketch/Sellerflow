// 賣貨便 .xlsm RAW ZIP PATCHING (P4 fallback — Jeff 2026-07-03). The SheetJS
// round-trip REBUILT the whole workbook (36KB → 73KB) and 賣貨便 rejected it
// ("Failed to read Excel file"). This module instead treats the bundled
// template as what it is — a zip — and patches ONLY the 訂單匯入 sheet XML:
//   · every other zip entry's COMPRESSED BYTES are copied verbatim
//     (VBA project, styles, sharedStrings, 填寫說明, printer settings, …),
//   · the data sheet XML gets our rows inserted before </sheetData> as
//     inlineStr cells (no sharedStrings touch) + an updated <dimension>,
//     and is STORED uncompressed (no compressor needed; well under the 2MB
//     upload limit).
// No new dependency: a ~150-line zip reader/writer + native
// DecompressionStream("deflate-raw") for the few entries we must READ
// (workbook.xml, rels, the data sheet). Verified template facts (recon
// 2026-07-03): 17 entries, all DEFLATE, no data descriptors (flag bit 3
// clear), no zip64; new cells inherit the template's COLUMN styles (Text @)
// because they carry no style attribute of their own.

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50;

export interface ZipEntry {
  name: string;
  flags: number; method: number; time: number; date: number;
  crc: number; csize: number; usize: number;
  localOffset: number;
}

// ── CRC-32 (standard, table-based) ────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── ZIP read ──────────────────────────────────────────────────────────────────
const td = new TextDecoder();
const te = new TextEncoder();

export function parseZip(b: Uint8Array): ZipEntry[] {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; } }
  if (eocd < 0) throw new Error("not a zip (EOCD missing)");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) throw new Error("bad central directory");
    const fnlen = dv.getUint16(p + 28, true), extralen = dv.getUint16(p + 30, true), cmtlen = dv.getUint16(p + 32, true);
    entries.push({
      flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true),
      time: dv.getUint16(p + 12, true), date: dv.getUint16(p + 14, true),
      crc: dv.getUint32(p + 16, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true),
      localOffset: dv.getUint32(p + 42, true),
      name: td.decode(b.subarray(p + 46, p + 46 + fnlen)),
    });
    p += 46 + fnlen + extralen + cmtlen;
  }
  return entries;
}

// Raw (still-compressed) entry bytes — sized from the central directory; the
// local header's own name/extra lengths locate the data start.
export function readEntryRaw(b: Uint8Array, e: ZipEntry): Uint8Array {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(e.localOffset, true) !== SIG_LOCAL) throw new Error(`bad local header: ${e.name}`);
  const fnlen = dv.getUint16(e.localOffset + 26, true), extralen = dv.getUint16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + fnlen + extralen;
  return b.subarray(start, start + e.csize);
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  // ReadableStream directly (jsdom's Blob lacks .stream(); this path works in
  // real browsers AND node/vitest — DecompressionStream is global in both).
  const src = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(data.slice()); c.close(); } });
  const resp = new Response(src.pipeThrough(new DecompressionStream("deflate-raw")));
  return new Uint8Array(await resp.arrayBuffer());
}
export async function readEntryText(b: Uint8Array, e: ZipEntry): Promise<string> {
  const raw = readEntryRaw(b, e);
  if (e.method === 0) return td.decode(raw);
  if (e.method === 8) return td.decode(await inflateRaw(raw));
  throw new Error(`unsupported zip method ${e.method}: ${e.name}`);
}

// ── ZIP write — original entry order; unpatched entries keep their compressed
// bytes + crc/sizes/method/timestamps verbatim (only the header bytes are
// re-emitted); the patched entry is STORED (method 0) with a fresh crc. ───────
interface OutEntry { name: string; flags: number; method: number; time: number; date: number; crc: number; csize: number; usize: number; data: Uint8Array }
export function buildZip(entries: OutEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (u: Uint8Array) => { parts.push(u); pos += u.length; };
  for (const e of entries) {
    offsets.push(pos);
    const name = te.encode(e.name);
    const h = new Uint8Array(30 + name.length);
    const dv = new DataView(h.buffer);
    dv.setUint32(0, SIG_LOCAL, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, e.flags & ~0x0008, true); // never emit data descriptors
    dv.setUint16(8, e.method, true);
    dv.setUint16(10, e.time, true);
    dv.setUint16(12, e.date, true);
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.csize, true);
    dv.setUint32(22, e.usize, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    h.set(name, 30);
    push(h); push(e.data);
  }
  const cdStart = pos;
  entries.forEach((e, i) => {
    const name = te.encode(e.name);
    const c = new Uint8Array(46 + name.length);
    const dv = new DataView(c.buffer);
    dv.setUint32(0, SIG_CENTRAL, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, e.flags & ~0x0008, true);
    dv.setUint16(10, e.method, true);
    dv.setUint16(12, e.time, true);
    dv.setUint16(14, e.date, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.csize, true);
    dv.setUint32(24, e.usize, true);
    dv.setUint16(28, name.length, true);
    dv.setUint32(42, offsets[i], true);
    c.set(name, 46);
    push(c);
  });
  const cdSize = pos - cdStart;
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, SIG_EOCD, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, cdStart, true);
  push(eocd);
  const out = new Uint8Array(pos);
  let o = 0;
  for (const u of parts) { out.set(u, o); o += u.length; }
  return out;
}

// ── Sheet XML patching (pure string work — unit-tested) ───────────────────────
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch] as string));
}
const COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
// inlineStr cells (no sharedStrings edit); empty values emit NO cell so the
// column styles (Text @) rule. xml:space keeps intentional spaces.
export function rowsToSheetXml(rows: string[][], startRow: number): string {
  return rows.map((cells, i) => {
    const r = startRow + i;
    const cs = cells.map((v, c) => (v === "" ? "" : `<c r="${COLS[c]}${r}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`)).join("");
    return `<row r="${r}" spans="1:10">${cs}</row>`;
  }).join("");
}
export function patchSheetXml(xml: string, rows: string[][], startRow = 7): string {
  const close = "</sheetData>";
  const at = xml.lastIndexOf(close);
  if (at < 0) throw new Error("sheetData not found in 訂單匯入 sheet");
  let out = xml.slice(0, at) + rowsToSheetXml(rows, startRow) + xml.slice(at);
  const endRow = startRow + rows.length - 1;
  out = out.replace(/<dimension ref="A1:K\d+"\/>/, `<dimension ref="A1:K${endRow}"/>`);
  return out;
}

// workbook.xml + workbook.xml.rels → the data sheet's zip path.
export function resolveSheetPath(workbookXml: string, relsXml: string, sheetName: string): string {
  const sheet = new RegExp(`<sheet name="${sheetName}"[^>]*r:id="(rId\\d+)"`).exec(workbookXml);
  if (!sheet) throw new Error(`${sheetName} sheet missing from template`);
  const rel = new RegExp(`<Relationship Id="${sheet[1]}"[^>]*Target="([^"]+)"`).exec(relsXml);
  if (!rel) throw new Error(`${sheetName} relationship missing from template`);
  return "xl/" + rel[1].replace(/^\//, "");
}

// ── Main: template bytes + A–J string rows → patched .xlsm bytes ─────────────
export async function patchXlsmTemplate(templateBytes: Uint8Array, rows: string[][]): Promise<Uint8Array> {
  const entries = parseZip(templateBytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const wbE = byName.get("xl/workbook.xml"), relE = byName.get("xl/_rels/workbook.xml.rels");
  if (!wbE || !relE) throw new Error("訂單匯入 workbook structure missing from template");
  const sheetPath = resolveSheetPath(await readEntryText(templateBytes, wbE), await readEntryText(templateBytes, relE), "訂單匯入");
  const sheetE = byName.get(sheetPath);
  if (!sheetE) throw new Error(`訂單匯入 sheet entry missing (${sheetPath})`);
  const patchedXml = te.encode(patchSheetXml(await readEntryText(templateBytes, sheetE), rows));
  return buildZip(entries.map((e) => (
    e.name === sheetPath
      ? { name: e.name, flags: 0, method: 0, time: e.time, date: e.date, crc: crc32(patchedXml), csize: patchedXml.length, usize: patchedXml.length, data: patchedXml }
      : { ...e, data: readEntryRaw(templateBytes, e) }
  )));
}
