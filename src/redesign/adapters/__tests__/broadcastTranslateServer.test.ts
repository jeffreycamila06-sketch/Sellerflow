// Server-side broadcast translation core (server/broadcastTranslate.js). server.js
// has no vitest harness, so this exercises the translation logic directly with an
// injected fetch. The endpoint's admin auth guard is covered by node --check +
// structural review (requireAuth → requireAdmin → 403), plus the client 403 test.
import { describe, it, expect, vi } from "vitest";
import {
  TARGET_LANGS,
  TRANSLATE_MODEL,
  buildSystemPrompt,
  parseTranslateResult,
  translateBroadcast,
} from "../../../../server/broadcastTranslate.js";
import { normalizeLang } from "../../i18n";

const full = () => ({ en: "Sale!", fil: "Sale!", zh: "促销！", "zh-TW": "促銷！", vi: "Giảm giá!", th: "ลดราคา!", id: "Diskon!" });

describe("TARGET_LANGS matches the i18n canonical codes", () => {
  it("is exactly the 7 canonical codes and each is already normalized", () => {
    expect(TARGET_LANGS).toEqual(["en", "fil", "zh", "zh-TW", "vi", "th", "id"]);
    for (const code of TARGET_LANGS) expect(normalizeLang(code)).toBe(code);
  });
  it("uses the requested model id", () => {
    expect(TRANSLATE_MODEL).toBe("claude-haiku-4-5");
  });
});

describe("buildSystemPrompt", () => {
  it("names all 7 codes and the verbatim-preserve + Taglish→English rules", () => {
    const p = buildSystemPrompt();
    for (const code of TARGET_LANGS) expect(p).toContain(`"${code}"`);
    expect(p).toMatch(/VERBATIM/);
    expect(p).toMatch(/NT\$/);
    expect(p).toMatch(/Taglish/i);
    expect(p).toMatch(/JSON/);
  });
});

describe("parseTranslateResult", () => {
  it("accepts a complete 7-language object", () => {
    const r = parseTranslateResult(JSON.stringify(full()));
    expect(r.ok).toBe(true);
    expect(r.i18n?.["zh-TW"]).toBe("促銷！");
  });
  it("extracts JSON even when wrapped in prose / code fences", () => {
    const r = parseTranslateResult("Here you go:\n```json\n" + JSON.stringify(full()) + "\n```");
    expect(r.ok).toBe(true);
  });
  it("rejects a missing language", () => {
    const partial = full(); delete (partial as Record<string, string>).th;
    const r = parseTranslateResult(JSON.stringify(partial));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_lang_th");
  });
  it("rejects a blank language value (never a blank banner)", () => {
    const blank = { ...full(), vi: "   " };
    const r = parseTranslateResult(JSON.stringify(blank));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("missing_lang_vi");
  });
  it("rejects non-JSON output", () => {
    expect(parseTranslateResult("sorry, no").ok).toBe(false);
  });
});

describe("translateBroadcast (injected fetch)", () => {
  const okResp = (obj: unknown) => ({ ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }] }) });

  it("empty source → error, never calls the API", async () => {
    const f = vi.fn();
    const r = await translateBroadcast("   ", { apiKey: "k", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("empty");
    expect(f).not.toHaveBeenCalled();
  });

  it("missing API key → translation_not_configured (honest, no partial)", async () => {
    const r = await translateBroadcast("hi", { apiKey: "", fetchImpl: vi.fn() });
    expect(r).toEqual({ ok: false, error: "translation_not_configured" });
  });

  it("success → full 7-lang map; sends model + x-api-key + version", async () => {
    const f = vi.fn(async () => okResp(full()));
    const r = await translateBroadcast("Big sale NT$500 🎉", { apiKey: "sk-test", fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(Object.keys(r.i18n || {}).sort()).toEqual([...TARGET_LANGS].sort());
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(JSON.parse(init.body).model).toBe("claude-haiku-4-5");
  });

  it("non-2xx from Anthropic → anthropic_http_<status>, no partial", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }));
    const r = await translateBroadcast("hi", { apiKey: "k", fetchImpl: f });
    expect(r).toEqual({ ok: false, error: "anthropic_http_429" });
  });

  it("network throw → network_error (caller offers English-only)", async () => {
    const f = vi.fn(async () => { throw new Error("boom"); });
    const r = await translateBroadcast("hi", { apiKey: "k", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^network_error:/);
  });
});
