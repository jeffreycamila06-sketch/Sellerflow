// Help bot server core (server/helpBot.js): answer order a→e, redaction, limits, cost math,
// guide parsing, and "no question text in logs". server.js wiring is covered by
// helpBotRoute.contract.test.ts (server.js has no runtime harness).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  SONNET, HAIKU, PRICES, costUsd, redact, isHandoffTopic, detectLang, parseGuide, pickSections,
  changedSections, checkedMap, parseMatcherReply, parseAnswer, answerQuestion, callClaude, NOT_COVERED,
  buildAnswerSystem, buildMatcherPrompt,
} from "../../../../server/helpBot.js";

const FAQS = [
  { id: 7, question: "How do I print a test sticker?", answer: "Settings → Printer → Test print.", guide_sections: ["printer-bluetooth"] },
  { id: 9, question: "Why are no comments coming in?", answer: "Close and reopen the app, then tap Connect once.", guide_sections: [] },
];
const GUIDE = parseGuide(readFileSync("docs/support/sfl-guide.md", "utf8"));

function deps(over: Partial<Record<string, unknown>> = {}) {
  const saved: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const calls: { model: string; maxTokens: number; cache?: boolean; system: string; user: string }[] = [];
  const d = {
    settings: { capUsd: 15, dailyPerSeller: 20 },
    matchFaq: vi.fn(async () => null),
    usage: vi.fn(async () => ({ day_count: 0, month_cost: 0 })),
    faqs: vi.fn(async () => FAQS),
    guide: vi.fn(async () => GUIDE),
    callModel: vi.fn(async (a: { model: string; maxTokens: number; system: string; user: string; cache?: boolean }) => {
      calls.push(a);
      if (a.maxTokens === 20) return { ok: true, text: "none", usage: { input_tokens: 300, output_tokens: 2 } };
      return { ok: true, text: "1. Open Settings.\n2. Tap Printer.", usage: { input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 80 } };
    }),
    save: vi.fn(async (row: Record<string, unknown>) => { saved.push(row); return `id-${saved.length}`; }),
    log: (s: string) => logs.push(s),
    ...over,
  };
  return { d, saved, logs, calls };
}
type R = { source?: string; contact?: boolean; answer?: string; saved?: boolean; error?: string };
const ask = (question: string, d: ReturnType<typeof deps>["d"]) => answerQuestion({ userId: "u1", question, appLang: "en" }, d as never) as Promise<R>;

describe("answer order", () => {
  it("a) billing words → handoff, no FAQ lookup, no AI", async () => {
    for (const q of ["Can I get a refund?", "magkano ang Pro plan", "我想退款", "how do I delete my account", "upgrade po"]) {
      const { d, saved } = deps();
      const r = await ask(q, d);
      expect(r.source).toBe("handoff");
      expect(r.contact).toBe(true);
      expect(saved[0]).toMatchObject({ source: "handoff", needs_admin: "billing" });
      expect(d.matchFaq).not.toHaveBeenCalled();
      expect(d.callModel).not.toHaveBeenCalled();
    }
  });
  it("b) a saved FAQ match answers for free", async () => {
    const { d, saved } = deps({ matchFaq: vi.fn(async () => FAQS[0]) });
    const r = await ask("how do i print a test sticker", d);
    expect(r).toMatchObject({ source: "faq", answer: FAQS[0].answer, saved: true, contact: false });
    expect(saved[0]).toMatchObject({ faq_id: 7 });
    expect(d.usage).not.toHaveBeenCalled();
    expect(d.callModel).not.toHaveBeenCalled();
  });
  it("c) daily limit → limit, no AI", async () => {
    const { d, saved } = deps({ usage: vi.fn(async () => ({ day_count: 20, month_cost: 0 })) });
    const r = await ask("printer not printing", d);
    expect(r.source).toBe("limit");
    expect(r.contact).toBe(true);
    expect(saved[0].source).toBe("limit");
    expect(d.callModel).not.toHaveBeenCalled();
  });
  it("c) monthly cap reached (100%) → limit", async () => {
    const { d } = deps({ usage: vi.fn(async () => ({ day_count: 0, month_cost: 15 })) });
    expect((await ask("printer not printing", d)).source).toBe("limit");
    expect(d.callModel).not.toHaveBeenCalled();
  });
  it("d) Haiku picks a saved question → faq_ai_match", async () => {
    const { d, calls } = deps({
      callModel: vi.fn(async (a: { model: string; maxTokens: number }) => { calls.push(a as never); return { ok: true, text: "9", usage: { input_tokens: 300, output_tokens: 1 } }; }),
    });
    const r = await ask("walang comments na pumapasok", d);
    expect(r).toMatchObject({ source: "faq_ai_match", answer: FAQS[1].answer, saved: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: HAIKU, maxTokens: 20 });
  });
  it("d) is skipped when there are no saved FAQs", async () => {
    const { d, calls } = deps({ faqs: vi.fn(async () => []) });
    await ask("printer not printing", d);
    expect(calls.map((c) => c.maxTokens)).toEqual([600]);
  });
  it("e) Sonnet answers with caching, guide sections and FAQs", async () => {
    const { d, calls, saved } = deps();
    const r = await ask("bluetooth printer not printing", d);
    expect(r).toMatchObject({ source: "ai", saved: false, contact: false });
    expect(calls[1]).toMatchObject({ model: SONNET, maxTokens: 600, cache: true });
    expect(calls[1].system).toContain(FAQS[0].answer);
    expect(calls[1].user).toMatch(/## printer-bluetooth/);
    expect(saved[0]).toMatchObject({ source: "ai", model: SONNET, needs_admin: null });
    expect((saved[0].guide_sections as string[]).length).toBeGreaterThan(0);
    expect(saved[0].cost_usd).toBeCloseTo(costUsd(HAIKU, { input_tokens: 300, output_tokens: 2 }) + costUsd(SONNET, { input_tokens: 1000, cache_read_input_tokens: 2000, output_tokens: 80 }), 9);
  });
  it("e) at 80% of the cap full answers use Haiku", async () => {
    const { d, calls } = deps({ usage: vi.fn(async () => ({ day_count: 0, month_cost: 12 })) });
    await ask("printer not printing", d);
    expect(calls[1].model).toBe(HAIKU);
  });
  it("e) just under 80% still uses Sonnet", async () => {
    const { d, calls } = deps({ faqs: vi.fn(async () => []), usage: vi.fn(async () => ({ day_count: 19, month_cost: 11.99 })) });
    await ask("printer not printing", d);
    expect(calls[0].model).toBe(SONNET);
  });
  it("e) guide doesn't cover it → flagged for Admin + contact buttons", async () => {
    const { d, saved } = deps({ faqs: vi.fn(async () => []), callModel: vi.fn(async () => ({ ok: true, text: `${NOT_COVERED} I don't have that yet. Admin can help.`, usage: {} })) });
    const r = await ask("can I sell on lazada", d);
    expect(r).toMatchObject({ source: "ai", contact: true });
    expect(r.answer).not.toContain(NOT_COVERED);
    expect(saved[0].needs_admin).toBe("not_covered");
  });
  it("e) AI failure → handoff ai_error, never a crash", async () => {
    const { d, saved } = deps({ faqs: vi.fn(async () => []), callModel: vi.fn(async () => ({ ok: false, error: "http_529" })) });
    const r = await ask("printer not printing", d);
    expect(r).toMatchObject({ source: "handoff", contact: true });
    expect(saved[0].needs_admin).toBe("ai_error");
  });
  it("a failed FAQ lookup falls through instead of failing", async () => {
    const { d } = deps({ matchFaq: vi.fn(async () => { throw new Error("db"); }), faqs: vi.fn(async () => []) });
    expect((await ask("printer not printing", d)).source).toBe("ai");
  });
  it("empty question → error, nothing saved", async () => {
    const { d, saved } = deps();
    expect(await ask("   ", d)).toEqual({ error: "empty" });
    expect(saved).toHaveLength(0);
  });
});

describe("redaction", () => {
  it("removes emails, phones and tokens before saving and before the AI call", async () => {
    const q = "my email is ana.b+x@gmail.com phone 0912-345-678 key eyJhbGciOi.eyJzdWIi.sig and sk_live_51AbCdEfGhIjKlMnOpQrSt help";
    const { d, saved, calls } = deps({ faqs: vi.fn(async () => []) });
    await ask(q, d);
    const stored = String(saved[0].question);
    for (const bad of ["ana.b", "gmail", "0912", "345-678", "eyJ", "sk_live"]) {
      expect(stored).not.toContain(bad);
      expect(calls[0].user.split("<question>")[1]).not.toContain(bad);
    }
    expect(stored).toContain("[email]");
    expect(stored).toContain("[phone]");
    expect(stored).toContain("[token]");
  });
  it("keeps buyer numbers, prices and short numbers", () => {
    expect(redact("buyer #123 paid NT$500 at 10:30")).toBe("buyer #123 paid NT$500 at 10:30");
  });
  it("+886 numbers and long digit runs are phones", () => {
    expect(redact("call +886 912 345 678")).toBe("call [phone]");
  });
  it("max 500 characters", () => {
    expect(redact("a".repeat(900))).toHaveLength(500);
  });
});

describe("logs", () => {
  it("never contain the question or the answer", async () => {
    const secret = "zebra-unicorn printer question";
    const { d, logs } = deps({ faqs: vi.fn(async () => []), callModel: vi.fn(async () => ({ ok: true, text: "secret-answer-text", usage: { input_tokens: 5, output_tokens: 5 } })) });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await ask(secret, d);
    const all = [...logs, ...spy.mock.calls.flat().map(String)].join("\n");
    spy.mockRestore();
    expect(logs.length).toBeGreaterThan(0);
    expect(all).not.toContain("zebra");
    expect(all).not.toContain("secret-answer-text");
    expect(logs[0]).toMatch(/^\[SUPPORT\] src=ai model=claude-sonnet-5-5 in=\d+ out=\d+ cache=\d+ cost=[\d.]+$/);
  });
});

describe("prices + cost", () => {
  it("are the verified Anthropic prices (2026-10-11)", () => {
    expect(PRICES[SONNET]).toEqual({ in: 2, cacheWrite: 2.5, cacheRead: 0.1, out: 10 });
    expect(PRICES[HAIKU]).toEqual({ in: 0.1, cacheWrite: 0.125, cacheRead: 0.01, out: 0.5 });
  });
  it("cost math, incl. Haiku's over-100K tier", () => {
    expect(costUsd(SONNET, { input_tokens: 1e6, output_tokens: 1e6 })).toBe(12);
    expect(costUsd(SONNET, { cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 })).toBeCloseTo(2.6);
    expect(costUsd(HAIKU, { input_tokens: 50_000 })).toBeCloseTo(0.005);
    expect(costUsd(HAIKU, { input_tokens: 150_000 })).toBeCloseTo(0.075);
    expect(costUsd("unknown", { input_tokens: 1e6 })).toBe(0);
  });
});

describe("helpers", () => {
  it("handoff words", () => {
    expect(isHandoffTopic("printer not printing")).toBe(false);
    expect(isHandoffTopic("paano mag-print")).toBe(false);
    expect(isHandoffTopic("how much is the Pro plan")).toBe(true);
  });
  it("language", () => {
    expect(detectLang("打印機不能用", "en")).toBe("zh-TW");
    expect(detectLang("打印机", "zh")).toBe("zh");
    expect(detectLang("bakit ayaw po mag print", "en")).toBe("fil");
    expect(detectLang("printer broken", "vi")).toBe("vi");
  });
  it("matcher reply", () => {
    expect(parseMatcherReply("9", FAQS)?.id).toBe(9);
    expect(parseMatcherReply("none", FAQS)).toBeNull();
    expect(parseMatcherReply("42", FAQS)).toBeNull();
    expect(buildMatcherPrompt(FAQS)).toContain("7: How do I print a test sticker?");
  });
  it("answer never names a person", () => {
    expect(parseAnswer("Message Jeff on Telegram").answer).toBe("Message Admin on Telegram");
    expect(buildAnswerSystem([])).not.toMatch(/jeff/i);
  });
  it("guide parsing + section pick", () => {
    expect(GUIDE.length).toBeGreaterThan(20);
    expect(new Set(GUIDE.map((s) => s.id)).size).toBe(GUIDE.length);
    for (const s of GUIDE) expect(s.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(pickSections(GUIDE, "bluetooth printer").map((s) => s.id)).toContain("printer-bluetooth");
    expect(pickSections(GUIDE, "qwzx")).toEqual([]);
  });
  it("changed 'last checked' dates", () => {
    const s: never = [{ id: "a", checked: "2026-10-11" }, { id: "b", checked: "2026-10-12" }, { id: "c", checked: "2026-10-11" }] as never;
    expect(changedSections({ a: "2026-10-11", b: "2026-10-01" }, s)).toEqual(["b"]);
    expect(changedSections(null, s)).toEqual([]);
    expect(checkedMap(s)).toEqual({ a: "2026-10-11", b: "2026-10-12", c: "2026-10-11" });
  });
});

describe("callClaude", () => {
  it("sends the request shape and reads text + usage", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "hi" }], usage: { input_tokens: 3 } }) }));
    const r = await callClaude({ apiKey: "k", fetchImpl, model: SONNET, system: "S", user: "U", maxTokens: 600, cache: true } as never);
    expect(r).toEqual({ ok: true, text: "hi", usage: { input_tokens: 3 } });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ model: SONNET, max_tokens: 600, thinking: { type: "between_tools" }, output_config: { effort: "low" } });
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body).not.toHaveProperty("tools");
  });
  it("refusal / http error / network → ok:false", async () => {
    const mk = (x: unknown) => vi.fn(async () => x);
    expect((await callClaude({ apiKey: "k", fetchImpl: mk({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) }), model: HAIKU, system: "", user: "", maxTokens: 20 } as never)).error).toBe("refusal");
    expect((await callClaude({ apiKey: "k", fetchImpl: mk({ ok: false, status: 529 }), model: HAIKU, system: "", user: "", maxTokens: 20 } as never)).error).toBe("http_529");
    expect((await callClaude({ apiKey: "k", fetchImpl: vi.fn(async () => { throw new Error("x"); }), model: HAIKU, system: "", user: "", maxTokens: 20 } as never)).error).toBe("network");
  });
});
