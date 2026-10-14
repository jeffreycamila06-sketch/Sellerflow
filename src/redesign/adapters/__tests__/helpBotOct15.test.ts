// Help bot fixes (Oct 15): the verification-code rule and the per-language FAQ matcher list.
import { describe, it, expect, vi } from "vitest";
import { answerQuestion, faqsForLang, CLASSIFIER_PROMPT, OUTPUT_CHECK_PROMPT } from "../../../../server/helpBot.js";
import { isForbiddenTopic } from "../../../lib/helpBotGuard.js";

describe("驗證碼 = verification code (not forbidden on its own)", () => {
  it.each(["沒收到驗證碼", "验证码没收到", "寄送新驗證碼怎麼按"])("not forbidden: %s", (q) => expect(isForbiddenTopic(q)).toBe(false));
  it.each(["怎麼繞過驗證碼", "破解验证码"])("forbidden: %s", (q) => expect(isForbiddenTopic(q)).toBe(true));
});

const FAQS = [
  { id: 1, lang: "en", question: "How do I print a test sticker?", answer: "A", guide_sections: [] },
  { id: 2, lang: "fil", question: "Paano mag print ng test sticker?", answer: "B", guide_sections: [] },
  { id: 3, lang: "zh-TW", question: "怎麼列印測試貼紙？", answer: "C", guide_sections: [] },
  { id: 4, lang: "zh", question: "怎么打印测试贴纸？", answer: "D", guide_sections: [] },
];

describe("faqsForLang", () => {
  it("keeps only the seller's language", () => {
    expect(faqsForLang(FAQS, "en").map((f) => f.id)).toEqual([1]);
    expect(faqsForLang(FAQS, "fil").map((f) => f.id)).toEqual([2]);
  });
  it("zh and zh-TW are one group", () => {
    expect(faqsForLang(FAQS, "zh-TW").map((f) => f.id)).toEqual([3, 4]);
    expect(faqsForLang(FAQS, "zh").map((f) => f.id)).toEqual([3, 4]);
  });
  it("no FAQ in that language → all of them", () => {
    expect(faqsForLang(FAQS, "vi").map((f) => f.id)).toEqual([1, 2, 3, 4]);
    expect(faqsForLang(FAQS.slice(0, 1), "fil").map((f) => f.id)).toEqual([1]);
  });
});

describe("the Haiku matcher sees only that list", () => {
  const run = async (question: string) => {
    const calls: { system: string; maxTokens: number }[] = [];
    const d = {
      settings: { capUsd: 15, dailyPerSeller: 20 },
      matchFaq: vi.fn(async () => null),
      usage: vi.fn(async () => ({ day_count: 0, month_cost: 0 })),
      faqs: vi.fn(async () => FAQS),
      guide: vi.fn(async () => []),
      callModel: vi.fn(async (a: { system: string; maxTokens: number }) => {
        calls.push(a);
        if (a.system === CLASSIFIER_PROMPT) return { ok: true, text: "HOWTO", usage: {} };
        if (a.system === OUTPUT_CHECK_PROMPT) return { ok: true, text: "NO", usage: {} };
        if (a.maxTokens === 20) return { ok: true, text: "3", usage: {} };
        return { ok: true, text: "x", usage: {} };
      }),
      save: vi.fn(async () => "id"),
    };
    const r = await answerQuestion({ userId: "u", question, appLang: "en", platform: "android" }, d as never);
    return { r: r as { source?: string; answer?: string }, matcher: calls.find((c) => c.maxTokens === 20)! };
  };
  it("Chinese question → only zh + zh-TW FAQs in the prompt; the pick comes from that list", async () => {
    const { r, matcher } = await run("怎麼列印測試貼紙");
    expect(matcher.system).toContain("3: 怎麼列印測試貼紙？");
    expect(matcher.system).toContain("4: 怎么打印测试贴纸？");
    expect(matcher.system).not.toContain("How do I print");
    expect(matcher.system).not.toContain("Paano");
    expect(r).toMatchObject({ source: "faq_ai_match", answer: "C" });
  });
  it("English question → English FAQs only; a pick outside the list is ignored", async () => {
    const { r, matcher } = await run("how do I print a test sticker please");
    expect(matcher.system).toContain("1: How do I print a test sticker?");
    expect(matcher.system).not.toContain("怎麼");
    expect(r.source).toBe("ai"); // the fake picked 3, which is not in the English list
  });
});
