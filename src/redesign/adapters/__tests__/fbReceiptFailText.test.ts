// receiptFailText + fbReceiptSend's fb_code parsing (the app half of the receipt error detail).
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } } }));
import { receiptFailText, fbReceiptSend, FB_NO_PRIVATE_REPLY_CODE } from "../fbReceipt";
import { buildT } from "../../i18n";

const t = buildT("en");
afterEach(() => { vi.unstubAllGlobals(); });

describe("receiptFailText", () => {
  it("generic text, + (FB code/subcode) only when the server sent fb_code", () => {
    expect(receiptFailText({}, t)).toBe("Couldn't send the receipt. Try again.");
    expect(receiptFailText({ code: 613 }, t)).toBe("Couldn't send the receipt. Try again.");
    expect(receiptFailText({ code: 100, fbCode: "100/1893060" }, t)).toBe("Couldn't send the receipt. Try again. (FB 100/1893060)");
  });
  it("10903 (from code or fb_code) → the clear text", () => {
    expect(FB_NO_PRIVATE_REPLY_CODE).toBe(10903);
    const clear = "Facebook doesn't allow a private message to this commenter (they commented as a Page, or their settings block it).";
    expect(receiptFailText({ code: 10903 }, t)).toBe(clear);
    expect(receiptFailText({ fbCode: "10903/2018278" }, t)).toBe(`${clear} (FB 10903/2018278)`);
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
