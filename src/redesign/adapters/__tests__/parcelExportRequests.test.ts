// How many database requests a 7-11 Sync makes (review of addition A, 2026-11-17): a sync of only NEW
// parcels must stay at today's count (before addition A) plus a small fixed number — the pickup store
// and the amount of a new parcel travel in the write that creates it, never one request per value.
// PRINT_COUNTS=1 prints the counts (used to compare main / addition A / this fix).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { crc32, buildZip } from "../shippingXlsmPatch";

const M = vi.hoisted(() => ({ existing: [] as Record<string, unknown>[], counts: { rpc: 0, select: 0, upsert: 0, update: 0 } }));
vi.mock("../../../supabase", () => {
  const chain = (result: () => unknown) => {
    const ch: Record<string, unknown> = new Proxy({}, {
      get(_t, k: string) {
        if (k === "then") return (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(result()).then(f, r);
        return () => ch;
      },
    });
    return ch;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "SELLER" } } } }) }, // local, not a request
      rpc: async () => { M.counts.rpc += 1; return { data: 0, error: null }; },
      from: () => ({
        select: () => { M.counts.select += 1; return chain(() => ({ data: M.existing, error: null })); },
        upsert: () => { M.counts.upsert += 1; return chain(() => ({ error: null })); },
        update: () => { M.counts.update += 1; return chain(() => ({ data: null, error: null })); },
      }),
    },
  };
});

import { syncFromExport } from "../parcelExportRead";

const te = new TextEncoder();
const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
// n new parcels: every store different (the worst case for one-request-per-value), 25 different amounts,
// every 7th parcel without a username.
function file(n: number): Uint8Array {
  const head = `<row r="3">${cell("G3", "收件人姓名")}${cell("H3", "配送單編號")}${cell("K3", "取件門市")}${cell("R3", "商品總額&#10;(A+B)")}${cell("V3", "其它資訊&#10;(FB/LINE/IG帳號)")}</row>`;
  const rows = Array.from({ length: n }, (_, i) => {
    const r = 4 + i;
    return `<row r="${r}">${cell(`G${r}`, "王小明")}${cell(`H${r}`, `F9${String(i).padStart(9, "0")}`)}${cell(`K${r}`, `門市${i}`)}${cell(`R${r}`, String(100 + (i % 25) * 10))}${i % 7 === 0 ? "" : cell(`V${r}`, `buyer${i}`)}</row>`;
  }).join("");
  const entries: Record<string, string> = {
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="訂單匯入" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${head}${rows}</sheetData></worksheet>`,
  };
  return buildZip(Object.entries(entries).map(([name, text]) => {
    const data = te.encode(text);
    return { name, flags: 0, method: 0, time: 0, date: 0, crc: crc32(data), csize: data.length, usize: data.length, data };
  }));
}
// Today's sync before addition A, for n new parcels of which `noHandle` have no username: the overlap
// check + one own-row read per 200 + one write per 500 with a username + one per 500 without.
const todayRequests = (n: number, noHandle: number) =>
  1 + Math.ceil(n / 200) + Math.ceil((n - noHandle) / 500) + Math.ceil(noHandle / 500);
const SMALL_FIXED = 2;

beforeEach(() => { M.existing = []; M.counts = { rpc: 0, select: 0, upsert: 0, update: 0 }; });

describe("Sync request count — only new parcels", () => {
  for (const n of [31, 123]) {
    it(`${n} new parcels: at most today's requests + ${SMALL_FIXED}`, async () => {
      const res = await syncFromExport(file(n));
      expect(res).toMatchObject({ ok: true, fresh: n });
      const total = M.counts.rpc + M.counts.select + M.counts.upsert + M.counts.update;
      const noHandle = Math.ceil(n / 7);
      if (process.env.PRINT_COUNTS) console.log(`[sync-requests] n=${n} total=${total} ${JSON.stringify(M.counts)} today(before A)=${todayRequests(n, noHandle)}`);
      expect(total).toBeLessThanOrEqual(todayRequests(n, noHandle) + SMALL_FIXED);
    });
  }
});
