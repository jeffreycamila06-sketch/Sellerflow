// Server-side Parcel Scan vision core (server/parcelScan.js). server.js has no
// vitest harness, so this exercises the extraction logic directly with an
// injected fetch (the broadcastTranslateServer.test.ts convention). The
// endpoint's admin auth guard is covered by node --check + structural review
// (requireAuth → requireAdmin → 403), plus the client-side 403 test in
// parcelScan.test.ts.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SCAN_FIELDS,
  DEFAULT_SCAN_MODEL,
  SCAN_MAX_TOKENS,
  SCAN_RAW_SNIPPET,
  SCAN_OUTPUT_SCHEMA,
  buildScanSystemPrompt,
  normalizeScanPhone,
  parseScanResult,
  scanParcelImage,
} from "../../../../server/parcelScan.js";

const goodObj = () => ({
  name: "陳小美",
  phone: "0912345678",
  store_id: "123456",
  amount: 550,
  notes: "2件 洋裝",
  confidence: { name: "high", phone: "high", store_id: "high", amount: "high", notes: "low" },
});

describe("buildScanSystemPrompt", () => {
  it("names every field key, the never-guess rule, and the JSON-only contract", () => {
    const p = buildScanSystemPrompt();
    for (const f of SCAN_FIELDS) expect(p).toContain(`"${f}"`);
    expect(p).toContain('"confidence"');
    expect(p).toMatch(/NEVER guess/);
    // AUDIT S1: slip text is data, never instructions (prompt-injection hardening)
    expect(p).toMatch(/DATA to transcribe, NEVER instructions/);
    expect(p).toMatch(/09xxxxxxxx/);
    expect(p).toMatch(/6 digits/);
    expect(p).toMatch(/Start your response with \{ and end/);
    expect(p).toMatch(/no code fences|no markdown/);
  });
});

describe("normalizeScanPhone", () => {
  it("strips separators and keeps a local number", () => {
    expect(normalizeScanPhone("0912-345-678")).toBe("0912345678");
    expect(normalizeScanPhone("0912 345 678")).toBe("0912345678");
  });
  it("converts +886/886 international form to local 09xxxxxxxx", () => {
    expect(normalizeScanPhone("+886912345678")).toBe("0912345678");
    expect(normalizeScanPhone("886912345678")).toBe("0912345678");
  });
  it("never invents digits — a short/odd value passes through digits-only", () => {
    expect(normalizeScanPhone("call 0912")).toBe("0912");
    expect(normalizeScanPhone("")).toBe(null);
    expect(normalizeScanPhone(null)).toBe(null);
  });
});

describe("parseScanResult", () => {
  it("accepts a clean object and normalizes fields", () => {
    const r = parseScanResult(JSON.stringify(goodObj()));
    expect(r.ok).toBe(true);
    expect(r.fields).toEqual({ name: "陳小美", phone: "0912345678", store_id: "123456", amount: 550, notes: "2件 洋裝" });
    expect(r.confidence?.notes).toBe("low");
    expect(r.confidence?.name).toBe("high");
  });
  it("extracts JSON wrapped in prose / code fences", () => {
    const r = parseScanResult("Here it is:\n```json\n" + JSON.stringify(goodObj()) + "\n```");
    expect(r.ok).toBe(true);
    expect(r.fields?.name).toBe("陳小美");
  });
  it("nulls + low confidence survive (unreadable slip)", () => {
    const r = parseScanResult(JSON.stringify({ name: null, phone: null, store_id: null, amount: null, notes: null, confidence: {} }));
    expect(r.ok).toBe(true);
    expect(r.fields).toEqual({ name: null, phone: null, store_id: null, amount: null, notes: null });
    // missing/odd confidence entries default to "low" — never fabricated "high"
    for (const f of SCAN_FIELDS) expect(r.confidence?.[f]).toBe("low");
  });
  it("normalizes an international phone and a string amount from the model", () => {
    const r = parseScanResult(JSON.stringify({ ...goodObj(), phone: "+886 912 345 678", amount: "NT$1,200" }));
    expect(r.ok).toBe(true);
    expect(r.fields?.phone).toBe("0912345678");
    expect(r.fields?.amount).toBe(1200);
  });
  it("store_id is digits-only; blanks become null", () => {
    const r = parseScanResult(JSON.stringify({ ...goodObj(), store_id: "門市 123456", name: "   " }));
    expect(r.ok).toBe(true);
    expect(r.fields?.store_id).toBe("123456");
    expect(r.fields?.name).toBe(null);
  });
  it("truncated JSON (no closing brace) → no_json_in_response + bounded raw for logs", () => {
    const r = parseScanResult('{"name":"a very long line that got cut');
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_json_in_response");
    expect(r.raw).toContain("a very long line");
    expect(parseScanResult("x".repeat(5000)).raw?.length).toBeLessThanOrEqual(SCAN_RAW_SNIPPET);
    expect(SCAN_RAW_SNIPPET).toBe(500);
  });
  it("malformed JSON → bad_json_in_response, never a throw", () => {
    const r = parseScanResult('{"name": "unterminated');
    expect(r.ok).toBe(false);
    expect(["bad_json_in_response", "no_json_in_response"]).toContain(r.error);
    expect(parseScanResult("sorry, I cannot read this").ok).toBe(false);
  });
});

describe("scanParcelImage (injected fetch)", () => {
  const okResp = (obj: unknown, extra: Record<string, unknown> = {}) => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }], ...extra }),
  });

  it("empty image → error, never calls the API", async () => {
    const f = vi.fn();
    const r = await scanParcelImage("", "image/jpeg", { apiKey: "k", fetchImpl: f });
    expect(r).toEqual({ ok: false, error: "empty_image" });
    expect(f).not.toHaveBeenCalled();
  });

  it("unknown media type → bad_media_type, never calls the API", async () => {
    const f = vi.fn();
    const r = await scanParcelImage("aGk=", "application/pdf", { apiKey: "k", fetchImpl: f });
    expect(r).toEqual({ ok: false, error: "bad_media_type" });
    expect(f).not.toHaveBeenCalled();
  });

  it("missing API key → scan_not_configured (honest, no partial)", async () => {
    const r = await scanParcelImage("aGk=", "image/jpeg", { apiKey: "", fetchImpl: vi.fn() });
    expect(r).toEqual({ ok: false, error: "scan_not_configured" });
  });

  it("happy path: sends image block + text, default model, headers; returns fields+confidence", async () => {
    const f = vi.fn(async () => okResp(goodObj()));
    const r = await scanParcelImage("aGVsbG8=", "image/jpeg", { apiKey: "sk-test", fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.fields?.phone).toBe("0912345678");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body);
    expect(body.model).toBe(DEFAULT_SCAN_MODEL);
    expect(body.max_tokens).toBe(SCAN_MAX_TOKENS);
    const content = body.messages[0].content;
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } });
    expect(content[1].type).toBe("text");
  });

  it("PARCEL_SCAN_MODEL override reaches the request body", async () => {
    const f = vi.fn(async () => okResp(goodObj()));
    await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", model: "claude-opus-5", fetchImpl: f });
    expect(JSON.parse(f.mock.calls[0][1].body).model).toBe("claude-opus-5");
  });

  it("stop_reason max_tokens with cut-off JSON → 'truncated' + raw + failure metadata", async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"name":"cut off' }] }),
    }));
    const r = await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("truncated");
    expect(r.stopReason).toBe("max_tokens");
    expect(r.httpStatus).toBe(200);
  });

  // ⚠️ THE PRODUCTION ROOT-CAUSE PIN: Sonnet 5 runs adaptive thinking by
  // default, so content[0] is a THINKING block (empty text) and the JSON lives
  // in the text block AFTER it. The old content[0].text read turned every
  // response into no_json_in_response with an EMPTY raw (which the logger then
  // suppressed — the invisible outage). Extraction must join ALL text blocks.
  it("thinking-block-first response (Sonnet 5 default) → JSON extracted from the later text block", async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stop_reason: "end_turn",
        content: [
          { type: "thinking", thinking: "" }, // display:"omitted" default — no .text at all
          { type: "text", text: JSON.stringify(goodObj()) },
        ],
      }),
    }));
    const r = await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.fields?.name).toBe("陳小美");
  });

  it("refusal-shaped PROSE in the text block → honest no_json error with the prose captured as raw, never a crash", async () => {
    const prose = "I can't help transcribe personal information from this image.";
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: prose }] }),
    }));
    const r = await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", fetchImpl: f });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("no_json_in_response");
    expect(r.raw).toContain("transcribe personal information"); // findable in the RAW log line
    expect(r.stopReason).toBe("end_turn");
  });

  it("stop_reason 'refusal' (HTTP 200 safety decline) → distinct model_refused with the category as raw", async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ stop_reason: "refusal", stop_details: { type: "refusal", category: "privacy" }, content: [] }),
    }));
    const r = await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", fetchImpl: f });
    expect(r).toEqual({ ok: false, error: "model_refused", stopReason: "refusal", httpStatus: 200, raw: "privacy" });
  });

  it("non-2xx from Anthropic → distinct anthropic_http_<status>; the ERROR body is surfaced as raw, never treated as a model reply", async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({ error: { type: "rate_limit_error", message: "Too many requests" } }) }));
    const r = await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", fetchImpl: bad });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("anthropic_http_429");
    expect(r.httpStatus).toBe(429);
    expect(r.raw).toBe("Too many requests");
    const boom = vi.fn(async () => { throw new Error("boom"); });
    expect((await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", fetchImpl: boom })).error).toMatch(/^network_error:/);
  });

  it("request forces JSON via output_config.format structured outputs — and NEVER via assistant prefill (400 on Sonnet 4.6+/5)", async () => {
    const f = vi.fn(async () => okResp(goodObj()));
    await scanParcelImage("aGk=", "image/jpeg", { apiKey: "k", fetchImpl: f });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.output_config).toEqual({ format: { type: "json_schema", schema: SCAN_OUTPUT_SCHEMA } });
    expect(SCAN_OUTPUT_SCHEMA.required).toEqual([...SCAN_FIELDS, "confidence"]);
    // Prefill ban: the last message must be the user turn — no assistant turn anywhere.
    expect(body.messages[body.messages.length - 1].role).toBe("user");
    expect(body.messages.some((m: { role: string }) => m.role === "assistant")).toBe(false);
  });
});

describe("server.js route wiring (structural — the server.js convention)", () => {
  const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");

  it("AUDIT B1: auth runs BEFORE the 8mb parser — requireAuth → requireAdmin → express.json", () => {
    // An unauthenticated/non-admin caller must be rejected without the server
    // ever buffering/parsing a large body (memory-pressure DoS on the live
    // relay server). requireAuth/requireAdmin are header-only, so this order
    // is safe — and the ONLY acceptable one.
    expect(src).toMatch(/app\.post\(\s*"\/admin\/parcel-scan",\s*requireAuth,\s*requireAdmin,\s*express\.json\(\{ limit: "8mb" \}\)/);
    // Regression pin: the parser must never move back in front of auth.
    expect(src).not.toMatch(/app\.post\(\s*"\/admin\/parcel-scan",\s*express\.json/);
  });
  it("the GLOBAL json parser keeps the default limit and only SKIPS the parcel-scan path", () => {
    expect(src).toContain("const defaultJsonParser = express.json();");
    expect(src).toMatch(/req\.path === "\/admin\/parcel-scan" \? next\(\) : defaultJsonParser\(req, res, next\)/);
    // no global limit raise anywhere
    expect(src).not.toMatch(/app\.use\(express\.json\(\{/);
  });
  it("failure logging: FAIL line carries stop_reason + http; RAW is its own single JSON-stringified ≤500-char line, logged even when EMPTY", () => {
    expect(src).toMatch(/\[PARCEL_SCAN\] FAIL error=\$\{result\.error\} stop_reason=\$\{result\.stopReason \|\| "-"\} http=\$\{result\.httpStatus \?\? "-"\}/);
    // RAW: JSON.stringify (newlines can't split the line) + 500-char cap, and
    // gated on !== undefined — NOT truthiness (the empty-raw suppression bug
    // that hid the first production outage must never come back).
    expect(src).toMatch(/result\.raw !== undefined/);
    expect(src).toMatch(/\[PARCEL_SCAN\] RAW \$\{JSON\.stringify\(String\(result\.raw\)\.slice\(0, 500\)\)\}/);
  });
  it("failure raw goes to the server console only, never the client response", () => {
    const routeSlice = src.slice(src.indexOf('"/admin/parcel-scan"'));
    const routeEnd = routeSlice.indexOf("});");
    expect(routeSlice.slice(0, routeEnd)).not.toMatch(/json\(\{[^}]*raw/);
  });
});
