// Branded export — PURE builder tests (the xlsx/pdf download wrappers are impure
// browser calls; the exceljs binary + iframe print are not exercised here).
import { describe, it, expect } from "vitest";
import {
  BRAND_NAME, BRAND_HEX, exportDateISO, subtitleLine, escapeHtml, toARGB, buildPrintHtml,
  type BrandedExportInput,
} from "../brandedExport";

describe("subtitleLine + exportDateISO", () => {
  it("includes title + date; appends seller name/email when present", () => {
    expect(subtitleLine("Products", { name: "Jeff", email: "j@x.com" }, "2026-09-18"))
      .toBe("Products — exported 2026-09-18 · Jeff · j@x.com");
  });
  it("omits the seller clause when no seller info", () => {
    expect(subtitleLine("Products", {}, "2026-09-18")).toBe("Products — exported 2026-09-18");
    expect(subtitleLine("Products", undefined, "2026-09-18")).toBe("Products — exported 2026-09-18");
  });
  it("exportDateISO falls back to today (YYYY-MM-DD)", () => {
    expect(exportDateISO("2020-01-02")).toBe("2020-01-02");
    expect(exportDateISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("toARGB", () => {
  it("prefixes FF + upper-cases a 6-hex color; strips a leading #", () => {
    expect(toARGB("4f46e5")).toBe("FF4F46E5");
    expect(toARGB("#16a34a")).toBe("FF16A34A");
  });
  it("returns undefined for empty / malformed input (→ default color)", () => {
    expect(toARGB(undefined)).toBeUndefined();
    expect(toARGB("nothex")).toBeUndefined();
    expect(toARGB("12345")).toBeUndefined();
  });
});

describe("escapeHtml", () => {
  it("neutralizes HTML metacharacters (buyer-supplied names are untrusted)", () => {
    expect(escapeHtml('<b>&"\'')).toBe("&lt;b&gt;&amp;&quot;&#39;");
    expect(escapeHtml(500)).toBe("500");
  });
});

const input: BrandedExportInput = {
  title: "Products",
  seller: { name: "Jeff", email: "j@x.com" },
  columns: [
    { header: "Name", width: 20 },
    { header: "Price", align: "right" },
    { header: "Status", color: (v) => (v === "Active" ? "16A34A" : v === "Out of stock" ? "DC2626" : undefined) },
  ],
  rows: [
    ["Red dress", "NT$350", "Active"],
    ["<script>", "NT$0", "Out of stock"],
  ],
  summary: [{ label: "Total", value: 2 }, { label: "Out", value: 1 }],
  filename: "sellerflow-products-2026-09-18",
  dateISO: "2026-09-18",
};

describe("buildPrintHtml (PDF doc)", () => {
  const html = buildPrintHtml(input);
  it("carries the SellerFlowLive brand + indigo + A4 print CSS", () => {
    expect(html).toContain(BRAND_NAME);
    expect(html).toContain(BRAND_HEX);
    expect(html).toContain("@page{size:A4");
  });
  it("renders the column headers, subtitle, and every data value", () => {
    expect(html).toContain("<th style=\"text-align:left\">Name</th>");
    expect(html).toContain("Products — exported 2026-09-18 · Jeff · j@x.com");
    expect(html).toContain("Red dress");
    expect(html).toContain("NT$350");
  });
  it("color-codes the status cell via the column color fn", () => {
    expect(html).toContain("color:#16A34A;font-weight:700"); // Active → green
    expect(html).toContain("color:#DC2626;font-weight:700"); // Out → red
  });
  it("escapes untrusted cell content (no raw <script>)", () => {
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("renders the summary block", () => {
    expect(html).toContain("Summary");
    expect(html).toContain("Total");
    expect(html).toContain("Out");
  });
});
