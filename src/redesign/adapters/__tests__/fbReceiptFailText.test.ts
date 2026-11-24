// receiptFailText + fbReceiptSend's fb_code parsing (the app half of the receipt error detail).
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } } }));
import { receiptFailText, fbReceiptSend, FB_NO_PRIVATE_REPLY_CODE, FB_THREAD_OWNED_CODE } from "../fbReceipt";
import { buildT } from "../../i18n";

const t = buildT("en");
afterEach(() => { vi.unstubAllGlobals(); });

describe("receiptFailText", () => {
  it("generic text; a Facebook code is never shown — 'reconnect your Page' instead (Build 10b)", () => {
    expect(receiptFailText({}, t)).toBe("Couldn't send the receipt. Try again.");
    expect(receiptFailText({ code: 613 }, t)).toBe("Couldn't send the receipt. Try again.");
    expect(receiptFailText({ code: 100, fbCode: "100/1893060" }, t)).toBe("Couldn't connect. Please reconnect your Page.");
  });
  it("10903 (from code or fb_code) → the clear text", () => {
    expect(FB_NO_PRIVATE_REPLY_CODE).toBe(10903);
    const clear = "Facebook doesn't allow a private message to this commenter (they commented as a Page, or their settings block it).";
    expect(receiptFailText({ code: 10903 }, t)).toBe(clear);
    expect(receiptFailText({ fbCode: "10903/2018278" }, t)).toBe(clear); // Build 10b: no code on screen
  });
  it("10/2018300 (another app holds the buyer's chat) → its own line, with or without the polish switch; no other code gets it", () => {
    expect(FB_THREAD_OWNED_CODE).toBe("10/2018300");
    const line = "Not sent. Facebook says another app is handling this buyer's chat with your Page right now, so it refused the message.";
    expect(receiptFailText({ code: 10, fbCode: "10/2018300" }, t)).toBe(line);
    expect(receiptFailText({ code: 10, fbCode: "10/2018300" }, t, true)).toBe(line);
    expect(receiptFailText({ fbCode: "10/2018300" }, t, true)).toBe(line);
    for (const r of [{ code: 10 }, { code: 10, fbCode: "10/0" }, { code: 10, fbCode: "10/2018301" }, { code: 10903, fbCode: "10903/2018300" }, { code: 2018300 }, {}]) {
      expect(receiptFailText(r, t), JSON.stringify(r)).not.toBe(line);
      expect(receiptFailText(r, t, true), JSON.stringify(r)).not.toBe(line);
    }
    // it promises nothing: no "try again", no "later", no code on screen
    expect(line).not.toMatch(/try again|later|2018300|\b10\b/i);
  });
  it("the 10/2018300 line exists in all 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) expect(buildT(lang).rd_rs_thread_owned, lang).toBeTruthy();
  });
  it("the 10903 text exists in all 8 languages", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const) expect(buildT(lang).rd_rs_no_private_reply, lang).toBeTruthy();
  });
});

describe("fbReceiptSend passes fb_code through (digits/digits only)", () => {
  const answer = (json: unknown) => vi.stubGlobal("fetch", vi.fn(async () => ({ status: 502, json: async () => json })));
  it("fb_code kept; anything not 'n/n' dropped", async () => {
    answer({ ok: false, error: "send_failed", code: 100, fb_code: "100/1893060" });
    expect(await fbReceiptSend("s", 3, "x")).toEqual({ ok: false, error: "send_failed", code: 100, fbCode: "100/1893060" });
    answer({ ok: false, error: "send_failed", code: 100, fb_code: "<b>x</b>" });
    expect(await fbReceiptSend("s", 3, "x")).toEqual({ ok: false, error: "send_failed", code: 100 });
  });
});
