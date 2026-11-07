// Admin country label: phone-shape guess + the order (admin pick > saved > guess > unknown).
import { describe, it, expect } from "vitest";
import { guessCountryFromPhone, resolveUserCountry, normIso, searchCountries, allCountryOptions, countryName } from "../adminCountry";

describe("guessCountryFromPhone", () => {
  it("09 + 8 digits (10 total) = Taiwan", () => {
    expect(guessCountryFromPhone("0912345678")).toBe("TW");
    expect(guessCountryFromPhone("0912 345 678")).toBe("TW");
    expect(guessCountryFromPhone("0912-345-678")).toBe("TW");
  });
  it("09 + 9 digits (11 total) = Philippines", () => {
    expect(guessCountryFromPhone("09171234567")).toBe("PH");
    expect(guessCountryFromPhone("0917 123 4567")).toBe("PH");
  });
  it("+ calling code → that country", () => {
    expect(guessCountryFromPhone("+1 604 555 1234")).toBe("CA");
    expect(guessCountryFromPhone("+12125551234")).toBe("US");
    expect(guessCountryFromPhone("+886912345678")).toBe("TW");
    expect(guessCountryFromPhone("+886 912 345 678")).toBe("TW");
    expect(guessCountryFromPhone("+639171234567")).toBe("PH");
    expect(guessCountryFromPhone("+63 917 123 4567")).toBe("PH");
  });
  it("a calling code shared by several countries with no valid number → unknown", () => {
    expect(guessCountryFromPhone("+1555")).toBeNull();
  });
  it("junk / other shapes → unknown", () => {
    for (const v of [null, undefined, "", "   ", "abc", "0912abc678", "12345", "091234567", "091234567890", "0812345678", "60123456789", "+", "+999123", "++++", "N/A"]) {
      expect(guessCountryFromPhone(v as string | null | undefined)).toBeNull();
    }
  });
});

describe("resolveUserCountry — order", () => {
  it("admin pick beats saved and phone", () => {
    expect(resolveUserCountry({ adminPick: "CA", saved: "TW", phone: "0912345678" })).toEqual({ iso: "CA", source: "admin" });
  });
  it("saved beats phone", () => {
    expect(resolveUserCountry({ adminPick: null, saved: "ph", phone: "0912345678" })).toEqual({ iso: "PH", source: "saved" });
  });
  it("phone guess when nothing saved", () => {
    expect(resolveUserCountry({ saved: null, phone: "09171234567" })).toEqual({ iso: "PH", source: "phone" });
  });
  it("unknown when nothing fits", () => {
    expect(resolveUserCountry({ saved: "", phone: "12345" })).toEqual({ iso: null, source: "unknown" });
    expect(resolveUserCountry({})).toEqual({ iso: null, source: "unknown" });
  });
  it("a bad stored value is skipped, not shown", () => {
    expect(resolveUserCountry({ adminPick: "Canada", saved: "X", phone: "0912345678" })).toEqual({ iso: "TW", source: "phone" });
  });
  it("normIso", () => {
    expect(normIso(" tw ")).toBe("TW");
    expect(normIso("TWN")).toBeNull();
    expect(normIso(null)).toBeNull();
  });
});

describe("picker search", () => {
  it('"Can" finds Canada first', () => {
    const r = searchCountries(allCountryOptions(), "Can");
    expect(r[0].iso).toBe("CA");
  });
  it("matches by code too, empty query = all", () => {
    expect(searchCountries(allCountryOptions(), "ph").some((c) => c.iso === "PH")).toBe(true);
    expect(searchCountries(allCountryOptions(), "").length).toBe(allCountryOptions().length);
  });
  it("English names", () => {
    expect(countryName("TW")).toBe("Taiwan");
    expect(countryName("PH")).toBe("Philippines");
    expect(countryName("US")).toBe("United States");
  });
});
