// International phone validation (validateTaiwanPhone → validatePhone). BEHAVIORAL:
// every claim actually CALLS validatePhone and asserts accept/reject + the national
// output (the lesson of the 1234567890 slip — never a structural pin). Covers each
// core country valid+invalid, the 1234567890 regression, and the REAL existing DB
// values (backward-compat: they must stay valid in-country).
import { describe, it, expect } from "vitest";
import { validatePhone, listCountries, filterCountries, flagOf, CORE_COUNTRIES, DEFAULT_COUNTRY } from "../phone";

describe("validatePhone — per core country, valid + invalid (BEHAVIORAL)", () => {
  const cases: Array<[string, string, string, boolean]> = [
    // country, input, label, expectValid
    ["TW", "0912345678", "TW mobile 10-digit", true],
    ["TW", "0912 345 678", "TW with spaces", true],
    ["TW", "+886912345678", "TW E.164", true],
    ["TW", "1234567890", "the 2026-07-16 prod bug: 10 digits non-09", false],
    ["TW", "0912345", "too short", false],
    ["PH", "09154081462", "PH mobile 11-digit", true],
    ["PH", "+639154081462", "PH E.164", true],
    ["PH", "0912345678", "TW number under PH ctx", false],
    ["VN", "0912345678", "VN mobile", true],
    ["TH", "0812345678", "TH mobile", true],
    ["ID", "081234567890", "ID mobile", true],
    ["SG", "81234567", "SG mobile", true],
    ["MY", "0123456789", "MY mobile", true],
    ["CN", "13012345678", "CN mobile", true],
    ["TW", "abcd", "garbage", false],
    ["TW", "", "empty", false],
  ];
  for (const [country, input, label, expected] of cases) {
    it(`${country}: "${input}" (${label}) → ${expected ? "VALID" : "reject"}`, () => {
      expect(validatePhone(input, country).valid).toBe(expected);
    });
  }

  it("REGRESSION: '1234567890' (TW) stays INVALID — go red if a loose rule returns", () => {
    expect(validatePhone("1234567890", "TW").valid).toBe(false);
  });

  it("valid input → national is clean local digits (backward-compatible storage)", () => {
    expect(validatePhone("0912 345 678", "TW").national).toBe("0912345678");
    expect(validatePhone("+886912345678", "TW").national).toBe("0912345678"); // E.164 → national
    expect(validatePhone("0915 408 1462", "PH").national).toBe("09154081462");
  });

  it("never throws on bad input (empty / garbage / bad country)", () => {
    expect(() => validatePhone("", "TW")).not.toThrow();
    expect(() => validatePhone("!!!", "TW")).not.toThrow();
    expect(() => validatePhone("0912345678", "ZZ")).not.toThrow();
    expect(validatePhone("0912345678", "").valid).toBe(false);
  });
});

describe("BACKWARD-COMPAT: the REAL existing DB values stay valid in-country", () => {
  // These are the actual stored phones (from the investigation). They must NOT be
  // rejected in their country context (grandfather = validate-on-change; if a seller
  // re-types the same number under the right country, it still validates).
  const existing: Array<[string, string]> = [
    ["0937521195", "TW"], ["0903360752", "TW"], ["0912345678", "TW"],
    ["09154081462", "PH"], ["09556183469", "PH"], ["09123456789", "PH"],
    ["+886913009223", "TW"], ["+886975024627", "TW"],
    ["01111939251", "MY"],
  ];
  for (const [phone, country] of existing) {
    it(`existing "${phone}" (${country}) → still valid`, () => {
      expect(validatePhone(phone, country).valid).toBe(true);
    });
  }
});

describe("country list helpers", () => {
  it("DEFAULT_COUNTRY is TW; core countries are pinned first", () => {
    expect(DEFAULT_COUNTRY).toBe("TW");
    const list = listCountries("en");
    expect(list.slice(0, CORE_COUNTRIES.length).map((c) => c.iso)).toEqual(CORE_COUNTRIES);
    expect(list.length).toBeGreaterThan(200); // all countries present (future-proof)
  });
  it("each option has flag + localized name + dial code", () => {
    const tw = listCountries("en").find((c) => c.iso === "TW")!;
    expect(tw.dial).toBe("+886");
    expect(tw.name.length).toBeGreaterThan(0);
    expect(tw.flag).toBe("🇹🇼");
  });
  it("names localize with the app language (zh-TW vs en differ)", () => {
    const en = listCountries("en").find((c) => c.iso === "JP")!.name;
    const zh = listCountries("zh-TW").find((c) => c.iso === "JP")!.name;
    expect(en).not.toBe(zh); // Japan vs 日本
  });
  it("filterCountries matches name / iso / dial", () => {
    const list = listCountries("en");
    expect(filterCountries(list, "phil").some((c) => c.iso === "PH")).toBe(true);
    expect(filterCountries(list, "TW").some((c) => c.iso === "TW")).toBe(true);
    expect(filterCountries(list, "+63").some((c) => c.iso === "PH")).toBe(true);
    expect(filterCountries(list, "").length).toBe(list.length);
  });
  it("flagOf computes the emoji from ISO", () => {
    expect(flagOf("PH")).toBe("🇵🇭");
    expect(flagOf("xx")).toBe("🇽🇽");
    expect(flagOf("bad!")).toBe("");
  });
});
