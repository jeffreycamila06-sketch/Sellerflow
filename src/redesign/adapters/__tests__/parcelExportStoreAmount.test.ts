// Addition A (2026-11-17): Sync also saves the pickup store (取件門市) and the amount (商品總額(A+B))
// for each 7-11 parcel — found by HEADER TEXT, only into EMPTY fields, never the recipient name or a phone.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { crc32, buildZip } from "../shippingXlsmPatch";

const M = vi.hoisted(() => ({
  existing: [] as Record<string, unknown>[],
  calls: [] as { op: string; payload?: unknown; filters: unknown[][] }[],
  updateThrows: false,
  updateError: null as null | { code: string },
}));
vi.mock("../../../supabase", () => {
  const chain = (call: { op: string; payload?: unknown; filters: unknown[][] }, result: () => unknown) => {
    const ch: Record<string, unknown> = new Proxy({}, {
      get(_t, k: string) {
        if (k === "then") return (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => {
          if (call.op === "update" && M.updateThrows) return Promise.reject(new Error("offline")).then(f, r);
          return Promise.resolve(result()).then(f, r);
        };
        return (...a: unknown[]) => { call.filters.push([k, ...a]); return ch; };
      },
    });
    return ch;
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: "SELLER" } } } }) },
      rpc: async () => ({ data: 0, error: null }),
      from: () => ({
        select: (cols: string) => {
          const call = { op: "select", payload: cols, filters: [] as unknown[][] };
          M.calls.push(call);
          return chain(call, () => {
            const codes = (call.filters.find((f) => f[0] === "in")?.[2] as string[]) ?? [];
            return { data: M.existing.filter((e) => codes.includes(String(e.tracking_no))), error: null };
          });
        },
        upsert: (rows: unknown, opt: unknown) => {
          const call = { op: "upsert", payload: rows, filters: [["options", opt]] as unknown[][] };
          M.calls.push(call);
          return chain(call, () => ({ error: null }));
        },
        update: (patch: unknown) => {
          const call = { op: "update", payload: patch, filters: [] as unknown[][] };
          M.calls.push(call);
          return chain(call, () => ({ data: null, error: M.updateError }));
        },
      }),
    },
  };
});

import {
  extractImportHandles, parseExportBytes, syncFromExport, planFills, fillInfoOf,
  isStoreHeader, isAmountHeader, storeValue, amountValue, STORE_MAX,
} from "../parcelExportRead";

// ── a real-shaped 匯出報表: the 22 headers of the 訂單匯入 tab (row 3), as read from the real file ──
const HEADERS = [
  "賣場類型", "溫層", "訂購日期", "訂單編號", "狀態", "已取件日期時間", "收件人姓名", "配送單編號", "付款方式", "配送方式",
  "取件門市", "商品名稱&#10;(品名/規格)", "單價", "優惠價", "數量", "小計&#10;(A)", "運費&#10;(B)", "商品總額&#10;(A+B)",
  "配送數量", "買家下訂日期", "商品備註", "其它資訊&#10;(FB/LINE/IG帳號)",
];
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUV".split("");
const te = new TextEncoder();
const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
// order = the header index for each column letter (default: the real order A..V)
function file(rows: Record<string, string>[], order: number[] = HEADERS.map((_, i) => i), drop: string[] = []) {
  const head = order.map((hi, ci) => (drop.includes(HEADERS[hi]) ? "" : cell(`${LETTERS[ci]}3`, HEADERS[hi]))).join("");
  const data = rows.map((r, ri) => `<row r="${4 + ri}">${order.map((hi, ci) => {
    const key = HEADERS[hi].replace(/&#10;.*/, "");
    return r[key] != null ? cell(`${LETTERS[ci]}${4 + ri}`, r[key]) : "";
  }).join("")}</row>`).join("");
  const sheet = `<?xml version="1.0"?><worksheet><sheetData><row r="1">${cell("A1", "訂購日期：2026/11/01~2026/11/17")}</row><row r="3">${head}</row>${data}</sheetData></worksheet>`;
  const entries: Record<string, string> = {
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="非訂單匯入" sheetId="1" r:id="rId1"/><sheet name="訂單匯入" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData/></worksheet>`,
    "xl/worksheets/sheet2.xml": sheet,
  };
  return buildZip(Object.entries(entries).map(([name, text]) => {
    const data2 = te.encode(text);
    return { name, flags: 0, method: 0, time: 0, date: 0, crc: crc32(data2), csize: data2.length, usize: data2.length, data: data2 };
  }));
}
const R = (code: string, store: string, total: string, extra: Record<string, string> = {}) => ({
  配送單編號: code, 取件門市: store, 商品總額: total, 收件人姓名: "王小明", 小計: "999", 運費: "60", 單價: "111", 其它資訊: `buyer_${code}`, ...extra,
});
const rowsOf = async (bytes: Uint8Array) => (await parseExportBytes(bytes)).rows;
const updates = () => M.calls.filter((c) => c.op === "update");

beforeEach(() => { M.existing = []; M.calls = []; M.updateThrows = false; M.updateError = null; });

describe("header matching (by text, spaces / line breaks ignored)", () => {
  it("取件門市 and 商品總額(A+B) match; neighbours never do", () => {
    for (const h of ["取件門市", " 取件 門市 ", "取件門市\n", "取件　門市"]) expect(isStoreHeader(h), h).toBe(true);
    for (const h of ["寄件門市", "取件門市代號", "門市", "", null]) expect(isStoreHeader(h), String(h)).toBe(false);
    for (const h of ["商品總額\n(A+B)", "商品總額 (A+B)", "商品總額（A+B）", "商品總額"]) expect(isAmountHeader(h), h).toBe(true);
    for (const h of ["小計\n(A)", "運費\n(B)", "單價", "優惠價", "商品名稱\n(品名/規格)", "商品總額(A)"]) expect(isAmountHeader(h), h).toBe(false);
  });
});

describe("values", () => {
  it("store: trimmed text as written (a trailing 門市 is kept), at most 40 characters, empty → nothing", () => {
    expect(storeValue("  中壢華強門市 ")).toBe("中壢華強門市");
    expect(storeValue("151003 朝陽")).toBe("151003 朝陽");
    expect(storeValue("")).toBeNull();
    expect(storeValue("   ")).toBeNull();
    expect(storeValue("店".repeat(60))).toHaveLength(STORE_MAX);
  });
  it("amount: a whole number of 0 or more; anything else saves nothing", () => {
    expect(amountValue("350")).toBe(350);
    expect(amountValue(" 0 ")).toBe(0);
    expect(amountValue("350.0")).toBe(350);
    for (const bad of ["350.5", "-1", "1,200", "1e3", "NT$350", "", "abc", "99999999999999999999"]) expect(amountValue(bad), bad).toBeNull();
  });
});

describe("reading the 訂單匯入 tab", () => {
  it("picks 取件門市 and 商品總額(A+B) — never 小計 / 運費 / 單價 — and never the recipient name", async () => {
    const rows = await rowsOf(file([R("F1", "中壢華強", "410")]));
    expect(rows).toEqual([{ tracking_no: "F1", buyer_username: "buyer_F1", store: "中壢華強", amount: 410 }]);
    expect(JSON.stringify(rows)).not.toContain("王小明");
  });
  it("found by header text, not by position (columns shuffled)", async () => {
    const order = HEADERS.map((_, i) => i).reverse();
    const rows = await rowsOf(file([R("F1", "朝陽", "260")], order));
    expect(rows).toEqual([{ tracking_no: "F1", buyer_username: "buyer_F1", store: "朝陽", amount: 260 }]);
  });
  it("a missing header saves nothing for that field; the rest reads exactly as today", async () => {
    const noStore = await rowsOf(file([R("F1", "朝陽", "260")], undefined, ["取件門市"]));
    expect(noStore).toEqual([{ tracking_no: "F1", buyer_username: "buyer_F1", amount: 260 }]);
    const neither = await rowsOf(file([R("F1", "朝陽", "260")], undefined, ["取件門市", "商品總額&#10;(A+B)"]));
    expect(neither).toEqual([{ tracking_no: "F1", buyer_username: "buyer_F1" }]); // = today's row shape
  });
  it("a bad amount / empty store saves nothing for that field only", async () => {
    const rows = await rowsOf(file([R("F1", "  ", "abc")]));
    expect(rows).toEqual([{ tracking_no: "F1", buyer_username: "buyer_F1", store: null, amount: null }]);
  });
  it("extractImportHandles reports the columns it found", () => {
    const sheet = `<worksheet><sheetData><row r="3">${cell("K3", "取件門市")}${cell("H3", "配送單編號")}${cell("R3", "商品總額&#10;(A+B)")}</row></sheetData></worksheet>`;
    expect(extractImportHandles(sheet, "").cols).toEqual({ fcodeCol: "H", storeCol: "K", amountCol: "R" });
  });
});

describe("what gets filled (only EMPTY fields)", () => {
  const rows = [
    { tracking_no: "NEW", buyer_username: null, store: "朝陽", amount: 260 },
    { tracking_no: "EXT", buyer_username: null, store: "朝陽", amount: 260 },
    { tracking_no: "CHK", buyer_username: null, store: "朝陽", amount: 260 },
    { tracking_no: "BARE", buyer_username: null, store: "中壢", amount: 410 },
  ];
  const info = new Map([
    ["EXT", fillInfoOf({ store_id: "198002", order_amount: 260, recipient_name: "王*明" })], // Chrome extension row
    ["CHK", fillInfoOf({ store_id: null, rec_store: "朝陽", order_amount: 250 })],             // already checked
    ["BARE", fillInfoOf({ store_id: null, rec_store: "", order_amount: null })],               // synced earlier, never checked
  ]);
  it("new rows and empty fields only; a checked row's store/amount and the extension's row are never touched", () => {
    const p = planFills(rows, info);
    expect([...p.stores]).toEqual([["朝陽", ["NEW"]], ["中壢", ["BARE"]]]);
    expect([...p.amounts]).toEqual([[260, ["NEW"]], [410, ["BARE"]]]);
  });
});

describe("Sync writes", () => {
  const sync = async (bytes: Uint8Array) => syncFromExport(bytes);
  it("upserts are exactly today's (no store / amount / name keys); fills are guarded updates, one per value", async () => {
    M.existing = [{ tracking_no: "F3", buyer_username: "buyer_F3", store_id: null, rec_store: null, order_amount: null, recipient_name: null }];
    const res = await sync(file([R("F1", "朝陽", "260"), R("F2", "朝陽", "410"), R("F3", "中壢華強門市", "410")]));
    expect(res).toMatchObject({ ok: true, total: 3, fresh: 2, same: 1 });
    for (const u of M.calls.filter((c) => c.op === "upsert")) {
      for (const row of u.payload as Record<string, unknown>[]) expect(Object.keys(row).sort()).toEqual(["buyer_username", "tracking_no", "user_id"]);
    }
    const ups = updates();
    const storeUps = ups.filter((u) => "store_id" in (u.payload as object));
    const amountUps = ups.filter((u) => "order_amount" in (u.payload as object));
    expect(storeUps.map((u) => [u.payload, u.filters.find((f) => f[0] === "in")?.[2]])).toEqual([
      [{ store_id: "朝陽" }, ["F1", "F2"]], [{ store_id: "中壢華強門市" }, ["F3"]],
    ]);
    expect(amountUps.map((u) => [u.payload, u.filters.find((f) => f[0] === "in")?.[2]])).toEqual([
      [{ order_amount: 260 }, ["F1"]], [{ order_amount: 410 }, ["F2", "F3"]],
    ]);
    for (const u of storeUps) expect(u.filters).toEqual(expect.arrayContaining([
      ["eq", "user_id", "SELLER"], ["eq", "carrier", "711"], ["is", "recipient_name", null],
      ["or", "and(store_id.is.null,rec_store.is.null),and(store_id.is.null,rec_store.eq.),and(store_id.eq.,rec_store.is.null),and(store_id.eq.,rec_store.eq.)"],
    ]));
    for (const u of amountUps) expect(u.filters).toEqual(expect.arrayContaining([
      ["eq", "user_id", "SELLER"], ["eq", "carrier", "711"], ["is", "order_amount", null], ["is", "recipient_name", null],
    ]));
    // never the recipient name, never a phone
    expect(JSON.stringify(M.calls.filter((c) => c.op !== "select"))).not.toMatch(/王小明|recipient_name":|phone/);
  });
  it("a row that already has a store / amount (extension or checked) gets nothing for that field", async () => {
    M.existing = [
      { tracking_no: "F1", buyer_username: "buyer_F1", store_id: "198002", rec_store: null, order_amount: 260, recipient_name: null },
      { tracking_no: "F2", buyer_username: "buyer_F2", store_id: null, rec_store: "朝陽", order_amount: null, recipient_name: null },
      { tracking_no: "F3", buyer_username: "buyer_F3", store_id: null, rec_store: null, order_amount: null, recipient_name: "王*明" },
    ];
    await sync(file([R("F1", "朝陽", "260"), R("F2", "朝陽", "300"), R("F3", "朝陽", "300")]));
    const ups = updates().map((u) => [u.payload, u.filters.find((f) => f[0] === "in")?.[2]]);
    expect(ups).toEqual([[{ order_amount: 300 }, ["F2"]]]); // F2 has no amount yet; its store came from the check
  });
  it("a fill that fails never changes the sync result (the parcels are saved)", async () => {
    M.updateThrows = true;
    expect(await sync(file([R("F1", "朝陽", "260")]))).toMatchObject({ ok: true, fresh: 1 });
    M.updateThrows = false; M.updateError = { code: "42501" };
    expect(await sync(file([R("F2", "朝陽", "260")]))).toMatchObject({ ok: true, fresh: 1 });
  });
  it("a file without the two columns makes no update at all (today's behaviour)", async () => {
    await sync(file([R("F1", "朝陽", "260")], undefined, ["取件門市", "商品總額&#10;(A+B)"]));
    expect(updates()).toEqual([]);
  });
});

