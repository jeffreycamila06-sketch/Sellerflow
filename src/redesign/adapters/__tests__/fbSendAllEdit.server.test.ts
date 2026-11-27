// @vitest-environment node
// Invoicing → Facebook: the seller's saved receipt edit (sql/231 fb_receipt_edits) in Send all, the single
// Send and the preview (server/fbSendAll.js), with the REAL fbReceipt send path and the REAL server drawing
// (server/receiptDraw.js, @napi-rs/canvas).
//  • NO edit → the picture the server sends / previews is byte-identical to main before this branch
//    (fixtures/fbSendAllNoEdit.main.json, taken on e9a64019 with SFL_FB_EDIT_GOLDEN=<file>);
//  • an edit → the job, the single Send and the preview draw the edit (opening, lines, shipping fee, note),
//    the buyer number / name / QR / words stay the orders' ones; an edit with no line → that buyer is skipped;
//  • the phone editor and the server build the SAME picture input (and so the same layout) from the same edit
//    (src/lib/receiptEdit.js) — the "the server picture = the sheet's picture" proof;
//  • the edits read fails → the job stops (never sends the orders' receipt over a saved edit); the table not
//    there yet (sql/231 not applied) → today's pictures.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createFbReceipt } from "../../../../server/fbReceipt.js";
import { createSendAllRunner, noEmoji, noEmojiRow, SEND_ALL_LABELS } from "../../../../server/fbSendAll.js";
import { receiptInputFromRows, serverLayout, drawReceiptInputPng, SERVER_FONT_STACK } from "../../../../server/receiptDraw.js";
import { encryptToken } from "../../../../server/fbTokens.js";
import { layoutReceipt, FONT_STACK } from "../../../lib/receiptLayout.js";
import { applyReceiptEdit } from "../../../lib/receiptEdit.js";
import { rebuildSessionFromRows } from "../../../lib/orderLogic";
import { buyerReceipt } from "../useReadData";
import { originalState, fbPictureInput, stateToEdit, editToState } from "../fbReceiptEditState";
import { buildT } from "../../i18n";

const CONFIG = { enabled: true, appId: "a", appSecret: "s", tokenKey: "tk" };
const U = "aaaaaaaa-1111-2222-3333-444444444444";
const S = "11111111-2222-3333-4444-555555555555";
const page = { user_id: U, page_id: "111", active: true, can_message: true, access_token: encryptToken("PAGETOKEN", CONFIG.tokenKey) };
type Row = Record<string, unknown>;
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const AT = Date.parse("2026-11-27T08:00:00Z");

let QR = "";
beforeAll(async () => {
  const { createCanvas } = await import("@napi-rs/canvas");
  const c = createCanvas(60, 60); const x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, 60, 60); x.fillStyle = "#000"; for (let i = 0; i < 6; i++) x.fillRect(i * 10, (i * 7) % 50, 10, 10);
  QR = `data:image/png;base64,${c.toBuffer("image/png").toString("base64")}`;
});

// three buyers: Latin · two lines with emoji (the server takes emoji out) · Chinese with no price
function orderRows(): Row[] {
  const t = AT;
  const meta = (b: number) => ({ page_id: "111", live_video_id: "LV", commenter_id: `C${b}` });
  return [
    { id: 10, session_id: S, buyer_number: 1, handle: "ana", customer_name: "Ana Cruz", product: "A1 dress", price: 350, qty: 1, created_at: new Date(t - 3600_000).toISOString(), comment_msg_id: "91_1", platform_meta: meta(1) },
    { id: 20, session_id: S, buyer_number: 2, handle: "ben", customer_name: "Ben 😀 Lim", product: "Bag 👜", price: 120, qty: 1, created_at: new Date(t - 3500_000).toISOString(), comment_msg_id: "92_1", platform_meta: meta(2) },
    { id: 21, session_id: S, buyer_number: 2, handle: "ben", customer_name: "Ben 😀 Lim", product: "C3 hat", price: 50, qty: 2, created_at: new Date(t - 3400_000).toISOString(), comment_msg_id: "92_2", platform_meta: meta(2) },
    { id: 30, session_id: S, buyer_number: 3, handle: "may", customer_name: "陳小美", product: "連衣裙", price: 0, qty: 1, created_at: new Date(t - 3300_000).toISOString(), comment_msg_id: "93_1", platform_meta: meta(3) },
  ];
}
interface Opts { shipping?: number; qr?: boolean; edits?: Row[] | "missing" | "error"; cancels?: number[] }
function world(o: Opts = {}) {
  let t = AT;
  const rows = orderRows();
  const receipts: Row[] = [];
  const uploads = new Map<string, Buffer>(); // comment id → the PNG sent
  const jobs: Row[] = [];
  const fetchImpl = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") return { status: 200, json: async () => ({ message_id: "m1", recipient_id: "PSID" }) };
    return { status: 200, json: async () => ({ can_reply_privately: true }) };
  });
  const store = {
    hasReceiptAccess: async () => true, isAdmin: async () => false, getPage: async () => ({ ...page }),
    listReceiptOrders: async (_u: string, _s: string, b: number) => rows.filter((r) => r.buyer_number === b).map((r) => ({ comment_msg_id: r.comment_msg_id, platform_meta: r.platform_meta, handle: r.handle, created_at: r.created_at })),
    listReceiptRows: async (ids: string[]) => receipts.filter((r) => ids.includes(String(r.comment_id))),
    insertReceipt: async (row: Row) => {
      if (receipts.some((r) => r.comment_id === row.comment_id && r.status !== "failed")) return { conflict: true };
      const r = { kind: "receipt", ...row, id: receipts.length + 1, created_at: new Date(t).toISOString() }; receipts.push(r); return { id: r.id };
    },
    updateReceipt: async (id: number, patch: Row) => { Object.assign(receipts.find((r) => r.id === id)!, patch); return {}; },
    deleteReceipt: async () => true,
    uploadReceiptImage: async (p: string, png: Buffer) => { const r = receipts[receipts.length - 1]; uploads.set(String(r.comment_id), Buffer.from(png)); return `https://cdn.test/${p}`; },
    insertSendAllJob: async (row: Row) => { const j = { id: jobs.length + 1, attempts: 0, created_at: new Date(t).toISOString(), ...row }; jobs.push(j); return { id: j.id }; },
    claimSendAllJobs: async () => { const q = jobs.filter((j) => j.status === "queued"); for (const j of q) Object.assign(j, { status: "running", claimed_at: new Date(t).toISOString() }); return q.map((j) => ({ ...j })); },
    touchSendAllJob: async (id: number, patch: Row) => { Object.assign(jobs.find((x) => x.id === id)!, patch); },
    finishSendAllJob: async (id: number, patch: Row) => { Object.assign(jobs.find((x) => x.id === id)!, patch); },
    latestSendAllJob: async () => jobs[jobs.length - 1] || null,
    listSessionFbRows: async () => rows,
    listSessionReceipts: async () => receipts,
    listInvoiceSkips: async () => [],
    listLineCancels: async () => o.cancels || [],
    getSendAllSettings: async () => ({ opening: "Hi! 🎉 Thank you", note: "Pay by Friday\nBank 123", qrImage: o.qr ? QR : null, shippingFee: o.shipping ?? 0 }),
    listReceiptEdits: vi.fn(async (_u: string, _s: string) => {
      if (o.edits === "error") throw new Error("receipt_edits_read");
      return o.edits === "missing" || !o.edits ? [] : o.edits;
    }),
  };
  const receipt = createFbReceipt({ config: CONFIG, store, fetchImpl, now: () => t });
  const runner = createSendAllRunner({ store, receipt, enabled: async () => true, config: CONFIG, fetchImpl, now: () => t, sleep: async (ms: number) => { t += ms; }, log: (l: string) => { if (process.env.DBG) console.log(l); } });
  return { rows, receipts, uploads, jobs, store, runner };
}
const preview = async (w: ReturnType<typeof world>, n: number, lang = "en") => {
  const r = await w.runner.preview(U, { sessionId: S, buyerNumber: n, lang, currency: "NT$" });
  return r.status === 200 ? Buffer.from(String((r.json as Row).png), "base64") : r;
};
// the start kicks a pass in the background: wait until the job has finished
const done = async (w: ReturnType<typeof world>) => {
  for (let i = 0; i < 2000 && w.jobs.some((j) => j.status === "queued" || j.status === "running"); i++) await new Promise((r) => setTimeout(r, 2));
};
const sendAll = async (w: ReturnType<typeof world>, extra: Row = {}) => {
  await w.runner.start(U, { sessionId: S, lang: "en", currency: "NT$", ...extra });
  await done(w);
};
const VARIANTS: Record<string, Opts> = { plain: {}, shipQr: { shipping: 60, qr: true }, cancelled: { cancels: [21] } };

// ── NO edit = main's bytes ───────────────────────────────────────────────────────────────────────
const FIX = resolve(__dirname, "fixtures/fbSendAllNoEdit.main.json");
const DUMP = process.env.SFL_FB_EDIT_GOLDEN || "";
const want: Record<string, string> = !DUMP && existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")).hashes : {};
const got: Record<string, string> = {};
afterAll(() => { if (DUMP) writeFileSync(DUMP, JSON.stringify({ _note: "sha256 of the Send all picture (preview + the PNG the job uploads), NO edit — taken on main e9a64019. fbSendAllEdit.server.test.ts", hashes: got }, null, 1) + "\n"); });
describe("no saved edit → the server picture is byte-identical to main", () => {
  for (const [v, o] of Object.entries(VARIANTS)) {
    for (const lang of ["en", "zh-TW"]) {
      it(`${v} · ${lang}: preview + the job's sent pictures`, async () => {
        const w = world(o);
        for (const n of [1, 2, 3]) { const k = `preview|${v}|${lang}|${n}`; got[k] = sha(await preview(w, n, lang) as Buffer); if (!DUMP) expect(got[k]).toBe(want[k]); }
        await w.runner.start(U, { sessionId: S, lang, currency: "NT$" }); await done(w);
        for (const [cid, png] of w.uploads) { const k = `job|${v}|${lang}|${cid}`; got[k] = sha(png); if (!DUMP) expect(got[k]).toBe(want[k]); }
        expect(w.uploads.size).toBe(3);
      }, 60000);
    }
  }
  it("the fixture covers every case", () => { if (!DUMP) expect(Object.keys(want).length).toBe(Object.keys(VARIANTS).length * 2 * (3 + 3)); });
});

// ── a saved edit ─────────────────────────────────────────────────────────────────────────────────
const EDIT2 = { buyer_number: 2, opening: "Hello Ben 🎉", note: "GCash 0917", shipping_fee: 45, lines: [{ item: "Bag (blue)", price: 150 }, { item: "  ", price: 9 }, { item: "Gift", price: null }] };
const s = (o: Opts) => ({ opening: noEmoji("Hi! 🎉 Thank you"), note: noEmoji("Pay by Friday\nBank 123"), qrImage: o.qr ? QR : null, shippingFee: o.shipping ?? 0, lang: "en", currency: "NT$", labels: SEND_ALL_LABELS.en });
const expectedEditPng = async (o: Opts, rows: Row[], edit: Row) => drawReceiptInputPng(applyReceiptEdit(receiptInputFromRows(rows.map(noEmojiRow), s(o)), edit));
describe("a saved edit → Send all, the single Send and the preview draw the edit", () => {
  for (const [v, o] of Object.entries({ plain: {}, shipQr: { shipping: 60, qr: true } })) {
    it(`${v}: the job sends the edited picture to buyer #2 and today's picture to #1 / #3`, async () => {
      const w = world({ ...o, edits: [EDIT2] });
      await sendAll(w);
      expect(w.uploads.size).toBe(3);
      const want2 = sha(await expectedEditPng(o, w.rows.filter((r) => r.buyer_number === 2), EDIT2));
      const sent2 = sha(w.uploads.get("92_1") ?? w.uploads.get("92_2")!);
      expect(sent2).toBe(want2);
      expect(sent2).not.toBe(want[`job|${v}|en|92_1`] ?? want[`job|${v}|en|92_2`]); // really different from the orders' picture
      for (const cid of ["91_1", "93_1"]) expect(sha(w.uploads.get(cid)!)).toBe(want[`job|${v}|en|${cid}`]);
    }, 60000);
  }
  it("the single Send of buyer #2 (Send to #2 in Messenger) sends the edit, nothing else", async () => {
    const w = world({ edits: [EDIT2] });
    await sendAll(w, { buyerNumber: 2 });
    expect([...w.uploads.keys()].every((k) => k.startsWith("92_"))).toBe(true);
    expect(w.uploads.size).toBe(1);
    expect(sha([...w.uploads.values()][0])).toBe(sha(await expectedEditPng({}, w.rows.filter((r) => r.buyer_number === 2), EDIT2)));
  }, 60000);
  it("the preview of #2 = the edited picture; #1 = main's", async () => {
    const w = world({ edits: [EDIT2] });
    expect(sha(await preview(w, 2) as Buffer)).toBe(sha(await expectedEditPng({}, w.rows.filter((r) => r.buyer_number === 2), EDIT2)));
    expect(sha(await preview(w, 1) as Buffer)).toBe(want["preview|plain|en|1"]);
  }, 60000);
  it("the edit's lines win over a cancelled line (the seller's receipt); emoji are taken out like the orders' text", async () => {
    const w = world({ edits: [EDIT2], cancels: [20, 21] });   // every order line of #2 cancelled → #2 has no orders left
    await sendAll(w);
    expect([...w.uploads.keys()].some((k) => k.startsWith("92_"))).toBe(false); // no order left = skipped, as today
    const input = applyReceiptEdit(receiptInputFromRows(orderRows().filter((r) => r.buyer_number === 2).map(noEmojiRow), s({})), EDIT2);
    expect(input.opening).toBe("Hello Ben");
    expect(input.lines).toEqual([{ item: "Bag (blue)", total: 150 }, { item: "Gift", total: 0 }]);
    expect(input.shippingFee).toBe(45);
    expect(input.buyerName).toBe("Ben Lim");
  });
  it("an edit with no line left → that buyer is skipped (job) / 'no_lines' (preview)", async () => {
    const empty = { ...EDIT2, lines: [{ item: " ", price: 1 }, { item: "🎉", price: 2 }] };
    const w = world({ edits: [empty] });
    await sendAll(w);
    expect([...w.uploads.keys()].some((k) => k.startsWith("92_"))).toBe(false);
    expect(w.uploads.size).toBe(2);
    expect((await preview(w, 2) as { status: number; json: Row })).toMatchObject({ status: 404, json: { error: "no_lines" } });
  }, 60000);
  it("the edits read fails → the job stops (never the orders' receipt over a saved edit); the preview says read_failed", async () => {
    const w = world({ edits: "error" });
    await sendAll(w);
    expect(w.uploads.size).toBe(0);
    expect(w.jobs[0]).toMatchObject({ status: "failed", note: "read_failed" });
    expect((await preview(w, 1) as { status: number })).toMatchObject({ status: 502 });
  });
  it("no reader in the store (older wiring) / the table not there ([]) → today's pictures", async () => {
    const w = world({ edits: "missing" });
    delete (w.store as Partial<typeof w.store>).listReceiptEdits;
    await sendAll(w);
    expect(w.uploads.size).toBe(3);
    for (const [cid, png] of w.uploads) expect(sha(png)).toBe(want[`job|plain|en|${cid}`]);
  }, 60000);
});

// ── the phone's editor and the server build the SAME input (→ the same layout) ─────────────────────
describe("the editor's picture = the server's picture (same input, same layout)", () => {
  it("a line cancelled for the invoice: the editor starts without it, as the server leaves it out", () => {
    const rows = orderRows();
    const receipt = buyerReceipt(rebuildSessionFromRows(rows as never).buyers, 2)!;
    const start = originalState(receipt, [false, true], { opening: "Hi! 🎉 Thank you", note: "Pay by Friday\nBank 123" }, "");
    expect(start.lines.map((l) => l.item)).toEqual(["Bag 👜"]);
    const t = buildT("en") as unknown as Record<string, string>;
    const labels = { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc, more: t.rd_rc_pic_more, shipping: t.rd_rc_pic_shipping, howToPay: t.rd_rc_pic_howto, scanToPay: t.rd_rc_pic_scan };
    const kept = rows.filter((r) => r.buyer_number === 2 && r.id !== 21);     // the server's keptRows with cancel 21
    expect(fbPictureInput(start, { receipt, qrImage: null, cur: "NT$", labels })).toEqual(receiptInputFromRows(kept.map(noEmojiRow), s({})));
  });
  const fakeMeasure = (txt: string, font: string) => txt.length * (Number(/(\d+)px/.exec(font)?.[1]) || 10) * 0.55;
  const appLabels = (lang: string) => {
    const t = buildT(lang as never) as unknown as Record<string, string>;
    return { total: t.rd_rc_pic_total, toBeConfirmed: t.rd_rc_pic_tbc, more: t.rd_rc_pic_more, shipping: t.rd_rc_pic_shipping, howToPay: t.rd_rc_pic_howto, scanToPay: t.rd_rc_pic_scan };
  };
  const FORMAT = { opening: "Hi! 🎉 Thank you", note: "Pay by Friday\nBank 123" };
  for (const lang of ["en", "zh-TW", "fil", "th"]) {
    for (const o of [{}, { shipping: 60, qr: true }] as Opts[]) {
      it(`${lang} ${o.qr ? "with QR + shipping" : "plain"}: unedited and edited, every buyer`, () => {
        const rows = orderRows();
        const sv = { ...s(o), lang, labels: SEND_ALL_LABELS[lang as keyof typeof SEND_ALL_LABELS] };
        const buyers = rebuildSessionFromRows(rows as never).buyers;
        for (const n of [1, 2, 3]) {
          const receipt = buyerReceipt(buyers, n)!;
          const mine = rows.filter((r) => r.buyer_number === n);
          const ctx = { receipt, qrImage: o.qr ? QR : null, cur: "NT$", labels: appLabels(lang) };
          // unedited: the editor's starting fields vs the server's orders path
          const start = originalState(receipt, receipt.lines.map(() => false), FORMAT, o.shipping ? String(o.shipping) : "");
          const phone = fbPictureInput(start, ctx);
          const server = receiptInputFromRows(mine.map(noEmojiRow), sv);
          expect(phone).toEqual(server);
          // edited: what the editor shows vs what the server draws from the saved row
          const edited = { ...start, opening: "Hello 你好 🎉", note: "Bank 0917", shipping: "45", lines: [...start.lines.slice(0, 1).map((l) => ({ ...l, item: `${l.item} (L)`, price: "500" })), { id: 99, item: "Extra 🎁 gift", price: "" }] };
          const saved = { buyer_number: n, ...JSON.parse(JSON.stringify({ opening: stateToEdit(edited).opening, note: stateToEdit(edited).note, lines: stateToEdit(edited).lines, shipping_fee: stateToEdit(edited).shippingFee })) };
          const phone2 = fbPictureInput(edited, ctx);
          const server2 = applyReceiptEdit(receiptInputFromRows(mine.map(noEmojiRow), sv), saved);
          expect(phone2).toEqual(server2);
          expect(stateToEdit(editToState(saved))).toEqual(stateToEdit(edited));   // saved and read back = the same fields
          for (const [p, q] of [[phone, server], [phone2, server2]]) for (const qr of [null, { w: 60, h: 60 }]) {
            const a = layoutReceipt(p, fakeMeasure, qr), b = serverLayout(q, fakeMeasure, qr);
            expect(b.width).toBe(a.width); expect(b.height).toBe(a.height);
            const norm = (ops: unknown[], stack: string) => JSON.parse(JSON.stringify(ops).split(stack.replace(/"/g, '\\"')).join("STACK"));
            expect(norm(b.ops, SERVER_FONT_STACK)).toEqual(norm(a.ops, FONT_STACK));
          }
        }
      });
    }
  }
});
