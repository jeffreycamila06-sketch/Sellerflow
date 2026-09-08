// Parcel Scan vision extraction — shared, PURE-where-possible core imported by
// server.js (the /admin/parcel-scan endpoint) AND unit-tested by vitest (the
// broadcastTranslate.js convention: server.js has no test harness — this module
// is how the extraction logic gets real coverage; the endpoint's auth guard is
// covered by node --check + structural review, requireAuth → requireAdmin).
//
// Egress/cost: ONE outbound Anthropic call per scanned slip (admin action, the
// client loops parcels sequentially). No Supabase egress, no client polling.
// The image is NEVER stored — it exists only inside this one request.

export const SCAN_FIELDS = ["name", "phone", "store_id", "amount", "notes"];

// Owner-tunable without a code deploy (Render env). Handwritten zh-TW slips are
// a hard vision task — dogfood decides if this needs to step up or down.
export const DEFAULT_SCAN_MODEL = "claude-sonnet-5";

// The reply is one small JSON object (~100 tokens); 1024 leaves generous room
// so truncation can only mean something went genuinely wrong.
export const SCAN_MAX_TOKENS = 1024;

// Only the types the client's canvas re-encode can produce (it always sends
// JPEG; PNG/WebP accepted for robustness). Anything else → honest reject.
export const SCAN_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function buildScanSystemPrompt() {
  return [
    "You read ONE photo of a handwritten parcel/delivery slip from a seller in Taiwan.",
    "The handwriting may be Traditional Chinese, English, or a mix. Extract these fields:",
    "",
    '- "name": the recipient/customer name, exactly as written (keep Chinese characters as-is).',
    '- "phone": Taiwan mobile number, normalized to DIGITS ONLY in local form 09xxxxxxxx',
    '  (convert +886 9xxxxxxxx / 886 9xxxxxxxx to 09xxxxxxxx; strip spaces and dashes).',
    '- "store_id": the 7-ELEVEN store number — 6 digits — if one is written.',
    '- "amount": the price/COD amount as a plain number (no currency symbol).',
    '- "notes": any OTHER legible writing on the slip that is none of the above (item names, remarks). Null if none.',
    "",
    "RULES:",
    "- NEVER guess. If a field is missing or you cannot read it with reasonable certainty, use null for that field and mark its confidence \"low\".",
    '- "confidence" maps EVERY field name to "high" or "low". "high" only when clearly legible.',
    "- A store name written in words without a 6-digit number is NOT a store_id — put it in notes.",
    "",
    "OUTPUT FORMAT (critical): Respond with ONLY a valid JSON object — no preamble,",
    "no explanation, no markdown, no code fences. Start your response with { and end",
    "with }. Write nothing before the { or after the }.",
    'The object MUST have EXACTLY these keys: "name", "phone", "store_id", "amount", "notes", "confidence".',
  ].join("\n");
}

// Strip a leading/trailing markdown code fence — verbatim broadcastTranslate.js
// approach (belt-and-suspenders with the {…} substring extraction below).
function stripCodeFences(text) {
  return String(text || "")
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, "")
    .replace(/\n?\s*```\s*$/, "")
    .trim();
}

// Server-side belt over the prompt's normalization ask: digits only, +886/886
// prefix → local 0. Never invents digits — a non-conforming result is passed
// through digits-only for the client's validators to flag.
export function normalizeScanPhone(v) {
  if (typeof v !== "string" && typeof v !== "number") return null;
  let d = String(v).replace(/\D/g, "");
  if (d.startsWith("886") && d.length === 12) d = "0" + d.slice(3);
  return d || null;
}

const cleanText = (v) => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

const conf = (v) => (v === "high" ? "high" : "low"); // missing/odd → low, never high

// Extract + validate + normalize the model's JSON reply. Returns
// {ok, fields, confidence} or {ok:false, error, raw} — `raw` (bounded snippet)
// is for SERVER logs only, never forwarded to the client.
export function parseScanResult(rawText) {
  const original = String(rawText || "");
  const snippet = original.slice(0, 800);
  const text = stripCodeFences(original);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: "no_json_in_response", raw: snippet };
  }
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, error: "bad_json_in_response", raw: snippet };
  }
  if (!obj || typeof obj !== "object") return { ok: false, error: "bad_json_in_response", raw: snippet };

  const storeDigits = cleanText(obj.store_id) ? String(obj.store_id).replace(/\D/g, "") : "";
  const amountNum = typeof obj.amount === "number" && Number.isFinite(obj.amount)
    ? obj.amount
    : typeof obj.amount === "string" && obj.amount.trim() !== "" && Number.isFinite(Number(obj.amount.replace(/[^\d.]/g, "")))
      ? Number(obj.amount.replace(/[^\d.]/g, ""))
      : null;

  const fields = {
    name: cleanText(obj.name),
    phone: normalizeScanPhone(obj.phone),
    store_id: storeDigits || null,
    amount: amountNum,
    notes: cleanText(obj.notes),
  };
  const rawConf = obj.confidence && typeof obj.confidence === "object" ? obj.confidence : {};
  const confidence = {};
  for (const f of SCAN_FIELDS) confidence[f] = conf(rawConf[f]);
  return { ok: true, fields, confidence };
}

// Full one-image extraction. fetchImpl injectable for tests; defaults to the
// global fetch (Node 20+ on Render). Returns {ok,fields,confidence} or
// {ok:false,error[,raw]} — never a partial, never a throw.
export async function scanParcelImage(imageBase64, mediaType, opts = {}) {
  const { apiKey, model = DEFAULT_SCAN_MODEL, fetchImpl = fetch } = opts;
  const data = String(imageBase64 || "").trim();
  if (!data) return { ok: false, error: "empty_image" };
  if (!SCAN_MEDIA_TYPES.includes(mediaType)) return { ok: false, error: "bad_media_type" };
  if (!apiKey) return { ok: false, error: "scan_not_configured" };
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
        model,
        max_tokens: SCAN_MAX_TOKENS,
        system: buildScanSystemPrompt(),
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: "Extract the parcel slip fields as specified. JSON only." },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return { ok: false, error: `network_error:${(e && e.message) || String(e)}` };
  }
  if (!resp || !resp.ok) {
    return { ok: false, error: `anthropic_http_${resp ? resp.status : "no_response"}` };
  }
  let body;
  try {
    body = await resp.json();
  } catch {
    return { ok: false, error: "anthropic_bad_json" };
  }
  const raw = body && Array.isArray(body.content) && body.content[0] ? body.content[0].text : "";
  const result = parseScanResult(raw);
  if (!result.ok && body && body.stop_reason === "max_tokens") {
    return { ok: false, error: "truncated", raw: result.raw };
  }
  return result;
}
