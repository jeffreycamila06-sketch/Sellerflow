// 1.16.0 logging fix (worker): the tab-choice line, the recovery line and the re-mint line
// log origin + path only — never the query string, which can carry the E-Map session value.
import { describe, it, expect } from "vitest";
import { bootWorker } from "./parcelCheckerHarness";

const SECRET = "SECRET-GUID-IN-QUERY-0002";
const MIN = 60 * 1000;

describe("worker log lines never carry a full address", () => {
  it("tab choice + recovery lines: path only", async () => {
    let t = Date.parse("2026-10-06T06:00:00Z");
    const { sb, calls, booted } = bootWorker({
      now: () => t,
      emapTabs: [{ id: 7, url: `https://emap.unipcsc.com.tw/mobilemap/default.aspx?eshopGuid=${SECRET}&k=1`, guid: false }],
      storeVerdict: () => "unknown",
    });
    await booted;
    for (let i = 0; i < 6; i++) { await sb.pcTick(); t += MIN; }
    const all = calls.logs.join("\n");
    expect(all).toMatch(/\[PC-EMAP\] using tab 7 https:\/\/emap\.unipcsc\.com\.tw\/mobilemap\/default\.aspx guid=false/);
    expect(all).toMatch(/\[PC-EMAP\] recover .* via=GET https:\/\/emap\.unipcsc\.com\.tw\/mobilemap\/default\.aspx$/m);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("eshopGuid=");
  });
  it("pcSafeUrl keeps origin + path only", async () => {
    const { sb, booted } = bootWorker();
    await booted;
    const f = sb.pcSafeUrl as unknown as (u: string) => string;
    expect(f(`https://emap.unipcsc.com.tw/ecmap/default.aspx?eshopGuid=${SECRET}#x`)).toBe("https://emap.unipcsc.com.tw/ecmap/default.aspx");
    expect(f("")).toBe("");
    expect(f(`not a url?${SECRET}`)).toBe("not a url");
  });
});
