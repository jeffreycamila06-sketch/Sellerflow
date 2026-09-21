// /api/geo parsing + the hook's present/absent behaviour (prefill source, never a gate).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { parseGeo, useGeoCountry, __resetGeoCache } from "../useGeoCountry";

describe("parseGeo", () => {
  it("valid ISO-2 → uppercased; anything else → null", () => {
    expect(parseGeo({ country: "tw" })).toBe("TW");
    expect(parseGeo({ country: "PH" })).toBe("PH");
    expect(parseGeo({ country: null })).toBeNull();
    expect(parseGeo({ country: "TWN" })).toBeNull(); // not 2 letters
    expect(parseGeo({})).toBeNull();
    expect(parseGeo(null)).toBeNull();
  });
});

describe("useGeoCountry", () => {
  beforeEach(() => { __resetGeoCache(); vi.restoreAllMocks(); });

  it("resolves the country when /api/geo returns one (Taiwan IP)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ country: "TW" }) })));
    const { result } = renderHook(() => useGeoCountry());
    await waitFor(() => expect(result.current).toBe("TW"));
  });

  it("absent header / fetch failure → null (picker keeps its default)", async () => {
    __resetGeoCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const { result } = renderHook(() => useGeoCountry());
    await waitFor(() => expect(result.current).toBeNull());
  });
});
