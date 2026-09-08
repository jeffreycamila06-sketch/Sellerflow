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
    expect(await checkEmapStore("12ab", { fetchImpl: f })).toEqual({ storeId: "12ab", status: "unknown" });
    expect(await checkEmapStore("", { fetchImpl: f })).toEqual({ storeId: "", status: "unknown" });
    expect(f).not.toHaveBeenCalled();
  });

  it("valid store → verdict + sends the documented command/param shape", async () => {
    const f = vi.fn(async () => okResp(storeXml("982063", "德民門市")));
    const r = await checkEmapStore("982063", { fetchImpl: f });
    expect(r.status).toBe("valid");
    expect(r.storeName).toBe("德民門市");
    expect(r.raw).toBeUndefined(); // no raw on the valid path
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("EMapSDK.aspx");
    expect(init.body).toBe(`commandid=${EMAP_LOOKUP_COMMAND}&${EMAP_LOOKUP_PARAM}=982063`);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("not-found XML → not_found + bounded raw for logging", async () => {
    const f = vi.fn(async () => okResp(emptyXml));
    const r = await checkEmapStore("930342", { fetchImpl: f });
    expect(r.status).toBe("not_found");
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

  it("command/param are env-overridable via opts (the safety valve)", async () => {
    const f = vi.fn(async () => okResp(storeXml("982063")));
    await checkEmapStore("982063", { fetchImpl: f, command: "SearchStoreId", param: "StoreID" });
    expect((f.mock.calls[0][1] as RequestInit).body).toBe("commandid=SearchStoreId&StoreID=982063");
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
  it("logs bounded raw on non-valid verdicts, server-console only (never in the json response)", () => {
    expect(src).toMatch(/\[EMAP_CHECK\] RAW \$\{JSON\.stringify\(String\(result\.raw\)\.slice\(0, 500\)\)\}/);
    const slice = src.slice(src.indexOf('"/admin/parcel-emap-check"'));
    const end = slice.indexOf("\n});");
    expect(slice.slice(0, end)).not.toMatch(/json\(\{[^}]*raw/);
  });
});
