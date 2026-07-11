// Broadcast auto-translation — shared, PURE-where-possible core imported by
// server.js (the /admin/broadcast-translate endpoint) AND unit-tested by vitest
// (server.js itself has no test harness — this module is how the translation
// logic gets real coverage; the endpoint's auth guard is covered by node --check
// + structural review per the CLAUDE.md server.js convention).
//
// Egress/cost: ONE outbound Anthropic call per broadcast SEND (admin action),
// never per read. No Supabase egress, no client polling.

// The 7 canonical i18n codes — MUST match VALID_LANGS in
// src/redesign/i18n/index.tsx (a test cross-checks this exact list).
export const TARGET_LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"];

export const TRANSLATE_MODEL = "claude-haiku-4-5";

const LANG_NAMES = {
  en: "English",
  fil: "Filipino (Tagalog)",
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese (Taiwan)",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
};

export function buildSystemPrompt() {
  return [
    "You are a translation engine for a live-selling app's seller announcements.",
    "You translate one short admin broadcast into several languages at once.",
    "",
    "RULES:",
    "- The input may be English or Taglish (mixed Tagalog/English). For the \"en\" output, normalize it into clean, natural English. For every other language, translate faithfully from that normalized meaning.",
    "- Use a warm, clear marketing/announcement tone appropriate for notifying sellers.",
    "- Keep VERBATIM, do NOT translate or reformat: emojis, numbers, prices (e.g. NT$500), dates, times, %/units, @handles, #hashtags, and URLs.",
    "- Preserve line breaks.",
    "- Do NOT add, remove, or explain anything. Translate only.",
    "",
    "OUTPUT: Respond with ONLY a single minified JSON object, no markdown, no code fences, no commentary.",
    `The object MUST have EXACTLY these keys: ${TARGET_LANGS.map((l) => `"${l}"`).join(", ")}.`,
    "Each value is the translated string for that language:",
    TARGET_LANGS.map((l) => `  "${l}" = ${LANG_NAMES[l]}`).join("\n"),
  ].join("\n");
}

export function buildUserPrompt(sourceText) {
  return `Translate this seller announcement. Source text:\n\n${sourceText}`;
}

// Extract the first balanced {...} JSON object from a model reply that may (in
// theory) carry stray prose or code fences, then validate it has every target
// language filled with a non-empty string. Returns {ok,i18n} or {ok,error}.
export function parseTranslateResult(rawText) {
  const text = String(rawText || "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: "no_json_in_response" };
  }
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: "bad_json_in_response" };
  }
  if (!obj || typeof obj !== "object") return { ok: false, error: "bad_json_in_response" };
  const i18n = {};
  for (const lang of TARGET_LANGS) {
    const v = obj[lang];
    if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: `missing_lang_${lang}` };
    }
    i18n[lang] = v;
  }
  return { ok: true, i18n };
}

// Full send-time translation. fetchImpl is injectable for tests; defaults to the
// global fetch (Node 20+ on Render). Returns {ok:true,i18n} or {ok:false,error}.
// NEVER partial — any failure returns ok:false so the caller can offer the
// explicit "send English only" fallback instead of shipping a broken row.
export async function translateBroadcast(sourceText, opts = {}) {
  const { apiKey, fetchImpl = fetch } = opts;
  const text = String(sourceText || "").trim();
  if (!text) return { ok: false, error: "empty" };
  if (!apiKey) return { ok: false, error: "translation_not_configured" };
  let resp;
  try {
    resp = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        max_tokens: 2000,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(text) }],
      }),
    });
  } catch (e) {
    return { ok: false, error: `network_error:${(e && e.message) || String(e)}` };
  }
  if (!resp || !resp.ok) {
    return { ok: false, error: `anthropic_http_${resp ? resp.status : "no_response"}` };
  }
  let data;
  try {
    data = await resp.json();
  } catch {
    return { ok: false, error: "anthropic_bad_json" };
  }
  const raw = data && Array.isArray(data.content) && data.content[0] ? data.content[0].text : "";
  return parseTranslateResult(raw);
}
