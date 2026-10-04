// Messenger receipt settings: QR size cap, load/save own row, sql/74 mirror, buyerReceipt platform.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const { from, getSession } = vi.hoisted(() => ({ from: vi.fn(), getSession: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { from, auth: { getSession } } }));

import {
  encodeUnderCap, fitWithin, normalizeReceiptSettings, loadReceiptSettings, saveReceiptSettings,
  QR_DATA_URL_CAP, QR_MAX_SIDE,
} from "../receiptSettings";
import { buyerReceipt } from "../useReadData";
import type { Buyer } from "../../../lib/orderTypes";

beforeEach(() => { from.mockReset(); getSession.mockReset(); getSession.mockResolvedValue({ data: { session: { user: { id: "u1" } } } }); });

describe("QR downscale", () => {
  it("fitWithin: longest side ≤ 600, aspect kept, never upscaled", () => {
    expect(fitWithin(3000, 1500)).toEqual({ w: QR_MAX_SIDE, h: 300 });
    expect(fitWithin(800, 1200)).toEqual({ w: 400, h: 600 });
    expect(fitWithin(300, 200)).toEqual({ w: 300, h: 200 });
    expect(fitWithin(0, 10)).toEqual({ w: 0, h: 0 });
  });
  it("encodeUnderCap returns the first encoding under the cap (PNG preferred) and never one over it", () => {
    // Fake encoder: PNG at full size is too big; JPEG 0.9 at full size fits.
    const sizes = (scale: number, q: number | null) => Math.round((q == null ? 500_000 : 400_000 * q) * scale * scale);
    const enc = vi.fn((scale: number, q: number | null) => "data:image/x;base64," + "A".repeat(sizes(scale, q)));
    const url = encodeUnderCap(enc)!;
    expect(url.length).toBeLessThanOrEqual(QR_DATA_URL_CAP);
    expect(enc.mock.calls[0]).toEqual([1, null]);          // PNG tried first
    expect(enc.mock.calls.at(-1)).toEqual([1, 0.7]);        // first JPEG quality that fits
    const small = encodeUnderCap(() => "data:image/png;base64,AAAA");
    expect(small).toBe("data:image/png;base64,AAAA");
  });
  it("nothing fits → null (the screen shows an error instead of saving an oversized picture)", () => {
    expect(encodeUnderCap(() => "A".repeat(QR_DATA_URL_CAP + 1))).toBeNull();
  });
});

describe("load / save own row", () => {
  it("normalize: trims to the caps and keeps only an image data URL", () => {
    expect(normalizeReceiptSettings(null)).toEqual({ opening: "", note: "", qrImage: null });
    expect(normalizeReceiptSettings({ opening: "x".repeat(400), note: "n", qr_image: "javascript:alert(1)" }))
      .toEqual({ opening: "x".repeat(300), note: "n", qrImage: null });
  });
  it("load reads the own row; a read error (e.g. table missing) → { ok:false }", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { opening: "Hi", note: "Pay", qr_image: "data:image/png;base64,AA" }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    from.mockReturnValue({ select: () => ({ eq }) });
    expect(await loadReceiptSettings()).toEqual({ ok: true, settings: { opening: "Hi", note: "Pay", qrImage: "data:image/png;base64,AA" } });
    expect(from).toHaveBeenCalledWith("seller_receipt_settings");
    expect(eq).toHaveBeenCalledWith("user_id", "u1");
    maybeSingle.mockResolvedValueOnce({ data: null, error: { code: "42P01", message: "relation does not exist" } });
    expect(await loadReceiptSettings()).toEqual({ ok: false });
  });
  it("save upserts ONLY the own row (onConflict user_id) and drops a QR over the cap", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ upsert });
    expect(await saveReceiptSettings({ opening: "Hi", note: "Pay", qrImage: "data:image/png;base64," + "A".repeat(QR_DATA_URL_CAP) })).toBe(true);
    const [row, opts] = upsert.mock.calls[0];
    expect(row).toMatchObject({ user_id: "u1", opening: "Hi", note: "Pay", qr_image: null });
    expect(opts).toEqual({ onConflict: "user_id" });
    upsert.mockResolvedValueOnce({ error: { message: "x" } });
    expect(await saveReceiptSettings({ opening: "", note: "", qrImage: null })).toBe(false);
  });
});

describe("buyerReceipt returns the platform (additive)", () => {
  const buyer = (platform: string): Buyer => ({
    handle: "@ann", name: "Ann", platform, num: 3, totalSpent: 630, totalOrders: 2,
    orders: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }] as never,
  });
  it("platform is passed through; every existing field is unchanged", () => {
    expect(buyerReceipt([buyer("Facebook")], 3)).toEqual({
      num: 3, name: "Ann", handle: "@ann", lines: [{ item: "A1", total: 350 }, { item: "B2", total: 280 }], count: 2, total: 630, platform: "Facebook",
    });
    expect(buyerReceipt([buyer("TikTok")], 3)!.platform).toBe("TikTok");
    expect(buyerReceipt([buyer("TikTok")], 4)).toBeNull();
  });
});

describe("sql/74 mirror", () => {
  const sql = readFileSync("sql/74_seller_receipt_settings.sql", "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").toLowerCase();
  it("table, caps, owner-only RLS for all four actions; idempotent; no drop", () => {
    expect(code).toContain("create table if not exists public.seller_receipt_settings");
    expect(code).toContain("user_id    uuid primary key references auth.users(id) on delete cascade");
    expect(code).toContain("opening    text not null default ''");
    expect(code).toContain("note       text not null default ''");
    expect(code).toContain("qr_image   text,");
    expect(code).toContain("check (char_length(opening) <= 300)");
    expect(code).toContain("check (char_length(note) <= 1000)");
    expect(code).toContain("check (qr_image is null or char_length(qr_image) <= 400000)");
    expect(code).toContain("alter table public.seller_receipt_settings enable row level security");
    expect(code).toContain("for select using (auth.uid() = user_id)");
    expect(code).toContain("for insert with check (auth.uid() = user_id)");
    expect(code).toContain("for update using (auth.uid() = user_id) with check (auth.uid() = user_id)");
    expect(code).toContain("for delete using (auth.uid() = user_id)");
    expect(code.match(/if not exists \(select 1 from pg_policies/g)).toHaveLength(4);
    expect(code).not.toMatch(/\bdrop\b/);
  });
});
