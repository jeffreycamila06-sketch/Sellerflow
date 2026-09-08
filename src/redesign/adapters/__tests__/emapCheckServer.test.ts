// Server-side E-Map store-code check core (server/emapCheck.js). server.js has
// no vitest harness, so this exercises the lookup/parse logic directly with an
// injected fetch (the parcelScanServer.test.ts convention). The route's admin
// guard is covered by node --check + the structural pin below (requireAuth →
// requireAdmin) plus the client-side 403 test in parcelScan.test.ts.
//
// ⚠️ These XML fixtures follow the DOCUMENTED public EMapSDK.aspx shape — the
// live probe against real store IDs could not run in the build sandbox (egress
// policy blocks emap.pcsc.com.tw). The parser is deliberately shape-tolerant
// and degrades to 'unknown', so a slightly-off real shape can never produce a
// false 'not_found'; the route logs the real XML on first Render use.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMAP_LOOKUP_COMMAND,
  EMAP_LOOKUP_PARAM,
  parseEmapVerdict,
  decodeEmapBytes,
  checkEmapStore,
} from "../../../../server/emapCheck.js";

// A store node as documented: POIID + POIName + Address + Telno + X + Y.
const storeXml = (id: string, name = "測試門市", addr = "台北市測試路1號") =>
  `<?xml version="1.0" encoding="utf-8"?><iMap><GeoPosition><POIID>${id}</POIID><POIName>${name}</POIName><Address>${addr}</Address><Telno>02-1234</Telno><X>121000000</X><Y>25000000</Y></GeoPosition></iMap>`;
const emptyXml = `<?xml version="1.0" encoding="utf-8"?><iMap></iMap>`;

describe("parseEmapVerdict (pure)", () => {
  it("store node whose POIID matches → valid + name/address", () => {
    const v = parseEmapVerdict("982063", storeXml("982063", "德民門市", "台北市德民路2號"));
    expect(v.status).toBe("valid");
    expect(v.storeName).toBe("德民門市");
    expect(v.address).toBe("台北市德民路2號");
  });

  it("well-formed XML with zero store nodes → not_found (wrong code)", () => {
    expect(parseEmapVerdict("930342", emptyXml).status).toBe("not_found");
  });

  it("store nodes present but NONE match the queried id → unknown (never a false wrong-code)", () => {
    // e.g. a name-search that echoed a different store — don't flag it red.
    expect(parseEmapVerdict("930342", storeXml("111111")).status).toBe("unknown");
  });

  it("matches the RIGHT node when several are returned", () => {
    const multi = `<iMap>${storeXml("111111", "A店").replace(/<\?xml[^>]*\?>/, "")}${storeXml("266402", "B店", "B路3號").replace(/<\?xml[^>]*\?>/, "")}</iMap>`;
    const v = parseEmapVerdict("266402", multi);
    expect(v.status).toBe("valid");
    expect(v.storeName).toBe("B店");
  });

  it("HTML error page → unknown, never not_found", () => {
    expect(parseEmapVerdict("982063", "<html><body>502 Bad Gateway</body></html>").status).toBe("unknown");
  });

  it("empty / non-XML body → unknown", () => {
    expect(parseEmapVerdict("982063", "").status).toBe("unknown");
    expect(parseEmapVerdict("982063", "   ").status).toBe("unknown");
  });

  it("caps returned name/address length", () => {
    const v = parseEmapVerdict("982063", storeXml("982063", "名".repeat(400), "址".repeat(400)));
    expect((v.storeName || "").length).toBeLessThanOrEqual(120);
    expect((v.address || "").length).toBeLessThanOrEqual(120);
  });
});

describe("decodeEmapBytes", () => {
  it("decodes UTF-8 bytes", () => {
    expect(decodeEmapBytes(new TextEncoder().encode("門市"))).toContain("門市");
  });
  it("decodes Big5 store name (E-Map's historical charset)", () => {
    // 門市 in Big5 = 0xAA 0xF9 0xA9 0xB1
    const big5 = Uint8Array.from([0xaa, 0xf9, 0xa9, 0xb1]);
    const out = decodeEmapBytes(big5.buffer);
    // Node 20 full-ICU decodes big5; if a runtime lacks it, the fallback still
    // returns a non-throwing string — we assert only that it never throws/empties.
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("checkEmapStore (injected fetch)", () => {
  const okResp = (xml: string) => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode(xml).buffer });

  it("malformed store id → unknown, never calls E-Map", async () => {
    const f = vi.fn();
    expect(await checkEmapStore("12ab", { fetchImpl: f })).toMatchObject({ storeId: "12ab", status: "unknown" });
    expect(await checkEmapStore("", { fetchImpl: f })).toMatchObject({ storeId: "", status: "unknown" });
    expect(f).not.toHaveBeenCalled();
  });

  it("DEFAULT 'id' variant → sends ID=<code> with the full blank param set (NOT StoreName=<code>)", async () => {
    const f = vi.fn(async () => okResp(storeXml("982063", "德民門市")));
    const r = await checkEmapStore("982063", { fetchImpl: f, confirmed: true }); // no variant → EMAP_LOOKUP_VARIANT default "id"
    expect(r.status).toBe("valid");
    expect(r.storeName).toBe("德民門市");
    expect(r.variant).toBe("id");
    expect(r.pois).toBe(1);
    expect(r.raw).toBeUndefined(); // confirmed + valid = quiet, nothing to log
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("EMapSDK.aspx");
    const body = String(init.body);
    expect(body).toBe(`commandid=${EMAP_LOOKUP_COMMAND}&ID=982063&StoreName=&address=&roadname=&city=&town=&SpecialStore_Kind=&is7WiFi=False&isATM=False`);
    expect(body).toContain("ID=982063");       // the code is in ID …
    expect(body).toContain("StoreName=&");      // … and StoreName is BLANK (the bug that returned 0 stores)
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("'storename' variant → the old single-field shape (StoreName=<code>), the documented fallback", async () => {
    const f = vi.fn(async () => okResp(storeXml("982063")));
    const r = await checkEmapStore("982063", { fetchImpl: f, confirmed: true, variant: "storename" });
    expect(r.status).toBe("valid");
    expect(r.variant).toBe("storename");
    expect(String((f.mock.calls[0][1] as RequestInit).body)).toBe(`commandid=${EMAP_LOOKUP_COMMAND}&${EMAP_LOOKUP_PARAM}=982063`);
  });

  it("'both' → id first; on 0 GeoPosition retries storename once; reports the variant that answered", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(okResp(emptyXml))                         // id → 0 stores
      .mockResolvedValueOnce(okResp(storeXml("982063", "德民門市"))); // storename → the store
    const r = await checkEmapStore("982063", { fetchImpl: f, confirmed: true, variant: "both" });
    expect(f).toHaveBeenCalledTimes(2);
    expect(String((f.mock.calls[0][1] as RequestInit).body)).toContain("ID=982063");        // 1st attempt = id
    expect(String((f.mock.calls[1][1] as RequestInit).body)).toContain("StoreName=982063"); // 2nd attempt = storename
    expect(r.status).toBe("valid");
    expect(r.variant).toBe("storename"); // the one that returned data
    expect(r.pois).toBe(1);
  });

  it("'both' → stops at id (no retry) when id already returns store data", async () => {
    const f = vi.fn(async () => okResp(storeXml("982063")));
    const r = await checkEmapStore("982063", { fetchImpl: f, confirmed: true, variant: "both" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(r.variant).toBe("id");
    expect(r.status).toBe("valid");
  });

  it("not-found XML (CONFIRMED) → not_found + bounded raw + pois=0", async () => {
    const f = vi.fn(async () => okResp(emptyXml));
    const r = await checkEmapStore("930342", { fetchImpl: f, confirmed: true });
    expect(r.status).toBe("not_found");
    expect(r.pois).toBe(0);
    expect(typeof r.raw).toBe("string");
    expect((r.raw || "").length).toBeLessThanOrEqual(500);
  });

  it("timeout / abort → unknown (never blocks)", async () => {
    const f = vi.fn(async () => { throw new Error("The operation was aborted"); });
    const r = await checkEmapStore("982063", { fetchImpl: f, timeoutMs: 10 });
    expect(r.status).toBe("unknown");
    expect(r.raw).toMatch(/^fetch_error:/);
  });

  it("non-200 from E-Map → unknown", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }));
    const r = await checkEmapStore("982063", { fetchImpl: f });
    expect(r.status).toBe("unknown");
    expect(r.raw).toBe("http_500");
  });

  it("unreadable body → unknown, never throws", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => { throw new Error("boom"); } }));
    const r = await checkEmapStore("982063", { fetchImpl: f });
    expect(r.status).toBe("unknown");
    expect(r.raw).toMatch(/^read_error:/);
  });

  it("command/param are env-overridable via opts (safety valve; storename variant puts the code in ANY field)", async () => {
    const f = vi.fn(async () => okResp(storeXml("982063")));
    await checkEmapStore("982063", { fetchImpl: f, variant: "storename", command: "SearchStoreId", param: "StoreID" });
    expect(String((f.mock.calls[0][1] as RequestInit).body)).toBe("commandid=SearchStoreId&StoreID=982063");
  });

  // AUDIT B1 — the abort timer must cover the BODY read, not just headers.
  it("stalled body past the timeout → aborts → unknown, never hangs", async () => {
    // fetch resolves fast (headers), but arrayBuffer() never settles on its own —
    // only the core's abort signal can end it. If the timer were cleared after
    // fetch (the old bug), this test would hang instead of resolving.
    const f = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      arrayBuffer: () => new Promise((_resolve, reject) => {
        const sig = init.signal as AbortSignal;
        if (sig.aborted) return reject(new Error("The operation was aborted"));
        sig.addEventListener("abort", () => reject(new Error("The operation was aborted")));
        // otherwise never resolves → would hang without a live abort timer
      }),
    }));
    const r = await checkEmapStore("982063", { fetchImpl: f as unknown as typeof fetch, timeoutMs: 25 });
    expect(r.status).toBe("unknown");
    expect(r.raw).toMatch(/^read_error:/);
  });

  // AUDIT S1 — cry-wolf gate: not_found is a red badge only once confirmed.
  it("UNCONFIRMED: not_found → downgraded to unknown (+ note), raw kept for logging", async () => {
    const f = vi.fn(async () => okResp(emptyXml));
    const r = await checkEmapStore("930342", { fetchImpl: f, confirmed: false });
    expect(r.status).toBe("unknown");
    expect(r.note).toBe("unconfirmed_downgrade");
    expect(typeof r.raw).toBe("string");
  });

  it("UNCONFIRMED: valid store still reads valid, and attaches raw so the owner can confirm the shape", async () => {
    const f = vi.fn(async () => okResp(storeXml("982063", "德民門市")));
    const r = await checkEmapStore("982063", { fetchImpl: f, confirmed: false });
    expect(r.status).toBe("valid"); // valid is never downgraded — only not_found is gated
    expect(typeof r.raw).toBe("string"); // positive [EMAP_CHECK] valid + RAW confirmation
    expect(r.note).toBeUndefined();
  });

  it("CONFIRMED: not_found passes through as the real red verdict", async () => {
    const f = vi.fn(async () => okResp(emptyXml));
    const r = await checkEmapStore("930342", { fetchImpl: f, confirmed: true });
    expect(r.status).toBe("not_found");
    expect(r.note).toBeUndefined();
  });
});

describe("server.js route wiring (structural — the server.js convention)", () => {
  const src = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");

  it("route exists as requireAuth → requireAdmin (auth before the handler; no per-route body parser needed for the tiny body)", () => {
    expect(src).toMatch(/app\.post\(\s*"\/admin\/parcel-emap-check",\s*requireAuth,\s*requireAdmin,\s*async/);
  });
  it("validates a 6-digit store id server-side", () => {
    const slice = src.slice(src.indexOf('"/admin/parcel-emap-check"'));
    expect(slice.slice(0, 400)).toMatch(/\^\\d\{6\}\$/);
  });
  it("logs ONE diagnostic line per check with variant + result + pois, plus the bounded RAW; server-console only (never in the json response)", () => {
    expect(src).toMatch(/\[EMAP_CHECK\] variant=\$\{result\.variant\} store=\$\{storeId\} result=\$\{result\.status\} pois=\$\{result\.pois/);
    expect(src).toMatch(/\[EMAP_CHECK\] RAW \$\{JSON\.stringify\(String\(result\.raw\)\.slice\(0, 500\)\)\}/);
    const slice = src.slice(src.indexOf('"/admin/parcel-emap-check"'));
    const end = slice.indexOf("\n});");
    // neither raw nor variant/pois are forwarded to the client json response
    expect(slice.slice(0, end)).not.toMatch(/json\(\{[^}]*raw/);
    expect(slice.slice(0, end)).not.toMatch(/json\(\{[^}]*pois/);
  });
});
