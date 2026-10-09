// Build 10 — server error/reason words travel as short codes (server/errorCodes.js) and the app
// turns them back (src/lib/errCodes.js) where it reads the answer. Pins: every mapping
// (old word → new code → the same word, so the same seller text), HTTP statuses unchanged
// (401/403/409/429/502), cron/Meta routes keep their words, the descriptive text goes to the
// server log only, and every app fetch of the live server decodes before reading.
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ERR_CODES, ERR_TEMPLATES, decodeErr, decodeServerJson } from "../errCodes.js";
import { SERVER_ONLY_CODES, encodeErr, opaqueErrors, OPAQUE_SKIP } from "../../../server/errorCodes.js";
import { fbConnectFailText } from "../../redesign/adapters/fb";
import { igConnectFailText } from "../../redesign/adapters/ig";
import { buildT } from "../../redesign/i18n";

const shared = Object.entries(ERR_CODES) as [string, string][];
const serverOnly = Object.entries(SERVER_ONLY_CODES) as [string, string][];
const num = (c: string) => Number(c.slice(1));

describe("the code tables", () => {
  it("codes never change (an old app and a new server must agree during a deploy)", () => {
    expect(ERR_CODES).toEqual({"Unauthorized":"E1","forbidden":"E2","plan_expired":"E3","no_profile":"E4","too_many_requests":"E5","account_limit":"E6","account_not_covered":"E7","not_live":"E8","needs_reauth":"E9","page_not_found":"E10","account_not_found":"E11","no_pages":"E12","token_exchange":"E13","exception":"E14","busy":"E15","mixed_buyer":"E16","needs_messaging":"E17","no_access":"E18","no_orders":"E19","none_left":"E20","send_failed":"E21","unknown_result":"E22","server_error":"E23","empty":"E24","empty_image":"E25","disabled":"E26","partial":"E27","claim_failed":"E28","scan_failed":"E29","idle":"E30","inactive":"E31","disconnect":"E32","live_session_ended":"E33","no_token":"E34","Account is not live right now. Start your TikTok LIVE first.":"E35","Facebook page is required":"E36","Seller account is required before connecting live":"E37","TikTok connection is already starting. Please wait before trying again.":"E38","TikTok username is required":"E39","You're already connecting a live on another device. Please try again.":"E40"});
    expect(ERR_TEMPLATES).toEqual({"E41":"TikTok connection is on cooldown after a rate limit. Try again in {v} minutes.","E42":"TikTok rate limit reached. Try again in about {v}."});
    expect(SERVER_ONLY_CODES).toEqual({"already_connected":"E101","already_replied":"E102","already_running":"E103","anthropic_bad_json":"E104","auth":"E105","bad_gm_shape":"E106","bad_image":"E107","bad_json_in_response":"E108","bad_media_type":"E109","bad_request":"E110","bad_store_id":"E111","cannot_reply_privately":"E112","credit_unavailable":"E113","draw_or_send_failed":"E114","fb_check_failed":"E115","fb_not_available":"E116","fb_pages_failed":"E117","fb_start_failed":"E118","feature_gate":"E119","fetch_error":"E120","fetch_failed":"E121","ig_accounts_failed":"E122","ig_check_failed":"E123","ig_not_available":"E124","ig_start_failed":"E125","ig_user_id required":"E126","insert_failed":"E127","max_session":"E128","model_refused":"E129","no_json_in_response":"E130","no_service_role":"E131","not_owned":"E132","page_id required":"E133","poll_not_configured":"E134","rate_limited":"E135","scan_not_configured":"E136","select_failed":"E137","seller_off":"E138","session_end":"E139","shop_id required":"E140","shop_not_found":"E141","shopee_start_failed":"E142","sweep_not_configured":"E143","too_many_attempts":"E144","translation_not_configured":"E145","truncated":"E146","upload_failed":"E147","Server auth is not configured":"E148","try_later":"E149","insufficient_credits":"E150","not_signed_in":"E151","bad_amount":"E152","connect_failed":"E153","not_found":"E154"});
  });
  it("every code is unique; shared codes stay below E100, server-only codes from E100; no word in both", () => {
    const all = [...shared.map(([, c]) => c), ...Object.keys(ERR_TEMPLATES), ...serverOnly.map(([, c]) => c)];
    expect(new Set(all).size).toBe(all.length);
    for (const [, c] of shared) expect(num(c)).toBeLessThan(100);
    for (const c of Object.keys(ERR_TEMPLATES)) expect(num(c)).toBeLessThan(100);
    for (const [w, c] of serverOnly) { expect(num(c)).toBeGreaterThanOrEqual(100); expect(ERR_CODES).not.toHaveProperty(w); }
    expect(all).not.toContain("E0");
  });

  it.each(shared)("shared: %s → %s → the same word", (word, code) => {
    expect(encodeErr(word)).toBe(code);
    expect(decodeErr(code)).toBe(word);
  });

  it.each(serverOnly)("server-only: %s → %s (the app keeps the code)", (word, code) => {
    expect(encodeErr(word)).toBe(code);
    expect(decodeErr(code)).toBe(code);
  });

  it("server-only words never appear in the app's table file (so they never reach the bundle)", () => {
    const src = readFileSync(join(__dirname, "..", "errCodes.js"), "utf8");
    for (const [w] of serverOnly) expect(src.includes(`"${w}"`) || new RegExp(`\\b${w}:`).test(src)).toBe(false);
  });

  it("sentences with one changing part keep that part", () => {
    const a = "TikTok connection is on cooldown after a rate limit. Try again in 12 minutes.";
    const b = "TikTok rate limit reached. Try again in about 2 hour(s).";
    expect(encodeErr(a)).toBe("E41:12");
    expect(encodeErr(b)).toBe("E42:2 hour(s)");
    expect(decodeErr(encodeErr(a))).toBe(a);
    expect(decodeErr(encodeErr(b))).toBe(b);
  });

  it("anything made up on the spot (raw errors) leaves as E0 and stays E0 in the app", () => {
    for (const raw of ["the request user is not online", "http_502", "network_error:ECONNRESET", "anthropic_http_500", "missing_lang_th", ""]) {
      expect(encodeErr(raw)).toBe("E0");
    }
    expect(decodeErr("E0")).toBe("E0");
    expect(decodeErr("E999")).toBe("E999");
  });

  it("an old server still sending words: the app reads them unchanged", () => {
    const body = { ok: false, error: "needs_reauth", reason: "not_live", fb_code: 190 };
    expect(decodeServerJson(body)).toBe(body);
    expect(decodeServerJson(null)).toBeNull();
    expect(decodeErr(42)).toBe(42);
  });
});

describe("old code → new code → same seller text", () => {
  const t = buildT("en");
  const live = { ios: false, planName: "Pro", max: 3 };
  const roundTrip = <T extends Record<string, unknown>>(r: T): T => decodeServerJson({ ...r, ...(r.error ? { error: encodeErr(r.error as string) } : {}), ...(r.reason ? { reason: encodeErr(r.reason as string) } : {}) });
  it.each([
    [{ ok: false, reason: "not_live" }], [{ ok: false, error: "needs_reauth" }], [{ ok: false, error: "page_not_found" }],
    [{ ok: false, error: "too_many_requests" }], [{ ok: false, error: "account_not_covered" }], [{ ok: false, error: "plan_expired" }],
    [{ ok: false, error: "fb_check_failed", fbCode: 190 }], [{ ok: false, error: "account_not_found" }],
  ])("%o", (r) => {
    expect(fbConnectFailText(roundTrip(r), t, live)).toBe(fbConnectFailText(r, t, live));
    expect(fbConnectFailText(roundTrip(r), t, live, true)).toBe(fbConnectFailText(r, t, live, true));
    expect(igConnectFailText(roundTrip(r), t, live)).toBe(igConnectFailText(r, t, live));
  });
});

describe("the server middleware (real express)", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]> | null = null;
  afterEach(() => { server?.close(); server = null; });
  const logs: string[] = [];
  async function serve() {
    logs.length = 0;
    const app = express();
    app.use(opaqueErrors({ log: (l: string) => logs.push(l) }));
    app.get("/connect/tiktok", (_q, res) => res.status(401).json({ success: false, error: "Unauthorized" }));
    app.get("/fb/connect", (_q, res) => res.status(403).json({ ok: false, error: "plan_expired", message: "Your plan has expired." }));
    app.get("/ig/connect", (_q, res) => res.status(429).json({ ok: false, error: "too_many_requests" }));
    app.get("/shopee/connect", (_q, res) => res.status(200).json({ ok: false, reason: "not_live" }));
    app.get("/connect/raw", (_q, res) => res.status(500).json({ success: false, error: "the request user is not online" }));
    app.get("/fb/receipt/send", (_q, res) => res.status(502).json({ ok: false, error: "try_later", code: 4 }));
    app.get("/parcel-x", (_q, res) => res.status(409).json({ error: "busy" }));
    app.get("/admin/parcel-scan", (_q, res) => res.status(402).json({ success: false, error: "insufficient_credits", balance: 0 }));
    app.get("/admin/parcel-tracking-poll", (_q, res) => res.status(503).json({ error: "poll_not_configured" }));
    app.get("/admin/product-images-sweep", (_q, res) => res.status(409).json({ error: "already_running" }));
    app.get("/myship/validate-gm", (_q, res) => res.status(400).json({ error: "bad_gm_shape" }));
    app.get("/fb/ok", (_q, res) => res.json({ ok: true, pages: [] }));
    await new Promise<void>((r) => { server = app.listen(0, r); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }
  const get = async (base: string, p: string) => { const r = await fetch(base + p); return { status: r.status, j: await r.json() }; };

  it("statuses unchanged; only the words change; the app gets the same answer back", async () => {
    const base = await serve();
    const cases: [string, number, Record<string, unknown>][] = [
      ["/connect/tiktok", 401, { success: false, error: "E1" }],
      ["/fb/connect", 403, { ok: false, error: "E3", message: "Your plan has expired." }],
      ["/ig/connect", 429, { ok: false, error: "E5" }],
      ["/shopee/connect", 200, { ok: false, reason: "E8" }],
      ["/connect/raw", 500, { success: false, error: "E0" }],
      ["/fb/receipt/send", 502, { ok: false, error: "E149", code: 4 }],
      ["/parcel-x", 409, { error: "E15" }],
      ["/admin/parcel-scan", 402, { success: false, error: "E150", balance: 0 }],
    ];
    for (const [p, status, body] of cases) {
      const r = await get(base, p);
      expect(r.status, p).toBe(status);
      expect(r.j, p).toEqual(body);
    }
    expect(decodeServerJson((await get(base, "/fb/connect")).j)).toEqual({ ok: false, error: "plan_expired", message: "Your plan has expired." });
    expect(decodeServerJson((await get(base, "/shopee/connect")).j)).toEqual({ ok: false, reason: "not_live" });
  });

  it("cron / Meta routes and routes outside the list keep their words; success bodies untouched", async () => {
    const base = await serve();
    expect(OPAQUE_SKIP).toContain("/fb/deauthorize");
    expect((await get(base, "/admin/parcel-tracking-poll")).j).toEqual({ error: "poll_not_configured" });
    expect((await get(base, "/admin/product-images-sweep")).j).toEqual({ error: "already_running" });
    expect((await get(base, "/myship/validate-gm")).j).toEqual({ error: "bad_gm_shape" });
    expect((await get(base, "/fb/ok")).j).toEqual({ ok: true, pages: [] });
  });

  it("the descriptive text goes to the server log only", async () => {
    const base = await serve();
    const r = await get(base, "/connect/raw");
    expect(JSON.stringify(r.j)).not.toContain("not online");
    expect(logs.some((l) => l.includes("error=E0") && l.includes("the request user is not online"))).toBe(true);
  });
});

describe("source contracts", () => {
  const root = join(__dirname, "..", "..", "..");
  it("server.js mounts the middleware before the first route", () => {
    const s = readFileSync(join(root, "server.js"), "utf8");
    const mount = s.indexOf("app.use(opaqueErrors());");
    expect(mount).toBeGreaterThan(0);
    expect(mount).toBeLessThan(s.search(/app\.(get|post)\(/));
  });
  it("every app file that calls the live server decodes the answer before reading it", () => {
    const dir = join(root, "src", "redesign", "adapters");
    const files = readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    let checked = 0;
    for (const f of files) {
      const s = readFileSync(join(dir, f), "utf8");
      if (!/fetch(?:Impl)?\(`\$\{SERVER\}/.test(s)) continue;
      const raw = s.split("\n").filter((l) => /r\.json\(\)/.test(l) && !/decodeServerJson\(/.test(l));
      // ttDisconnect only reads ok:true (POST /disconnect/tiktok is outside the coded routes).
      expect(raw.filter((l) => !/as \{ ok\?: unknown \} \| null/.test(l)), f).toEqual([]);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });
});
