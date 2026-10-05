// Facebook before opening — client parts. A: ?fb=error&code=cancelled (the seller tapped
// Cancel on the confirm page) shows no toast. E: the in-app Legal screen carries the two new
// privacy sentences in all 8 languages.
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
import { fbReturnText, parseFbReturn } from "../fb";
import { buildT } from "../../i18n";

describe("A — cancelled on the confirm page", () => {
  const t = buildT("en");
  it("?fb=error&code=cancelled → no toast (null); other codes unchanged", () => {
    expect(parseFbReturn("?fb=error&code=cancelled")).toEqual({ status: "error", code: "cancelled" });
    expect(fbReturnText({ status: "error", code: "cancelled" }, t, 3)).toBeNull();
    expect(fbReturnText({ status: "error", code: "bad_state" }, t, 3)).toBe(t.rd_fb_auth_error_toast);
    expect(fbReturnText({ status: "connected" }, t, 3)).toBe(t.rd_fb_authorized_toast);
  });
});

describe("E — Legal screen sentences in all 8 languages", () => {
  const langs = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
  it("lg_use_p mentions the Messenger receipt; lg_keep_p states 24 hours and the 3-month receipt records", () => {
    for (const lang of langs) {
      const t = buildT(lang);
      expect(t.lg_use_p, lang).toContain("Messenger");
      expect(t.lg_keep_p, lang).toContain("Messenger");
      expect(t.lg_keep_p, lang).toMatch(/24/);
    }
    const en = buildT("en");
    expect(en.lg_use_p).toContain("If you send a Messenger receipt, your Page sends that commenter one message with the receipt picture.");
    expect(en.lg_keep_p).toContain("Order history: 3 months. Messenger receipt pictures: 24 hours. Receipt records: 3 months.");
  });
});
