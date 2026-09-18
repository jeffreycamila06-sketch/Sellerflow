// Branded SellerFlowLive export — REUSABLE across Products / Orders / Miners.
// Two outputs from one column/row spec: a styled .xlsx (exceljs, dynamically
// imported so the main bundle is unaffected) and a print-friendly PDF (a branded
// HTML doc printed via a hidden iframe → the browser's "Save as PDF"; zero dep).
//
// The CALLER owns all formatting decisions (currency strings, status labels, which
// cells get a color) so this module stays generic. Pure builders (branding lines,
// summary shape, HTML escaping) are exported + unit-tested; the two download
// functions are thin impure wrappers.

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ExportColumn {
  header: string;
  width?: number;                               // excel char width (default 16)
  align?: "left" | "right" | "center";
  // Per-cell font color (hex, no '#') e.g. status Active→green. Return undefined
  // for the default text color. Same fn feeds BOTH xlsx and PDF so they match.
  color?: (value: string | number) => string | undefined;
}
export interface BrandedExportInput {
  title: string;                                // e.g. "Products"
  seller?: { name?: string; email?: string };
  columns: ExportColumn[];
  rows: (string | number)[][];                  // aligned to columns
  summary?: { label: string; value: string | number }[];
  filename: string;                             // base name, no extension
  dateISO?: string;                             // default today (YYYY-MM-DD)
}

export const BRAND_NAME = "SellerFlowLive";
export const BRAND_HEX = "4F46E5";              // indigo (matches --accent)

// ── Pure builders (unit-tested) ───────────────────────────────────────────────
export const exportDateISO = (d?: string): string => d || new Date().toISOString().slice(0, 10);

// "Products — exported 2026-09-18 · Jeff (jeff@x.com)". Seller parts are optional.
export function subtitleLine(title: string, seller?: { name?: string; email?: string }, dateISO?: string): string {
  const who = [seller?.name, seller?.email].filter((x) => x && String(x).trim()).join(" · ");
  const base = `${title} — exported ${exportDateISO(dateISO)}`;
  return who ? `${base} · ${who}` : base;
}

export function escapeHtml(v: string | number): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

// exceljs wants ARGB ('FF' + 6 hex). Guard bad input → undefined (default color).
export function toARGB(hex?: string): string | undefined {
  if (!hex) return undefined;
  const h = hex.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? `FF${h.toUpperCase()}` : undefined;
}

// ── XLSX (exceljs, dynamic import) ────────────────────────────────────────────
export async function exportBrandedXlsx(input: BrandedExportInput): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND_NAME;
  const ws = wb.addWorksheet(input.title, { views: [{ state: "frozen", ySplit: 4 }] }); // freeze through the header row
  const nCols = input.columns.length;

  // Row 1: brand. Row 2: subtitle. Row 3: blank. Row 4: column headers.
  ws.mergeCells(1, 1, 1, nCols);
  const brand = ws.getCell(1, 1);
  brand.value = BRAND_NAME;
  brand.font = { bold: true, size: 16, color: { argb: toARGB(BRAND_HEX) } };
  ws.mergeCells(2, 1, 2, nCols);
  const sub = ws.getCell(2, 1);
  sub.value = subtitleLine(input.title, input.seller, input.dateISO);
  sub.font = { size: 10, color: { argb: "FF6B7280" } };

  const headerRow = ws.getRow(4);
  input.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: toARGB(BRAND_HEX) } };
    cell.alignment = { horizontal: c.align || "left", vertical: "middle" };
    ws.getColumn(i + 1).width = c.width || 16;
  });
  headerRow.commit();

  // Data rows (from row 5). Per-cell font color via column.color().
  input.rows.forEach((r) => {
    const row = ws.addRow(r);
    input.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const argb = toARGB(c.color?.(r[i]));
      if (argb) cell.font = { color: { argb }, bold: true };
      if (c.align) cell.alignment = { horizontal: c.align };
    });
  });

  // Summary block: blank row, bold "Summary" label, then one row per item.
  if (input.summary?.length) {
    ws.addRow([]);
    const head = ws.addRow(["Summary"]);
    head.getCell(1).font = { bold: true };
    input.summary.forEach((s) => {
      const row = ws.addRow([s.label, s.value]);
      row.getCell(1).font = { bold: true };
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${input.filename}.xlsx`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── PDF (branded print doc → hidden iframe → browser print / Save as PDF) ──────
// Pure: build the full printable HTML (exported for tests). A4, print-friendly,
// repeating table header, color-coded status cells (same color fn as the xlsx).
export function buildPrintHtml(input: BrandedExportInput): string {
  const head = input.columns.map((c) => `<th style="text-align:${c.align || "left"}">${escapeHtml(c.header)}</th>`).join("");
  const body = input.rows.map((r) =>
    `<tr>${input.columns.map((c, i) => {
      const hex = c.color?.(r[i]);
      const style = `text-align:${c.align || "left"}${hex ? `;color:#${hex.replace(/^#/, "")};font-weight:700` : ""}`;
      return `<td style="${style}">${escapeHtml(r[i])}</td>`;
    }).join("")}</tr>`).join("");
  const summary = input.summary?.length
    ? `<div class="summary"><div class="sh">Summary</div>${input.summary.map((s) => `<div class="si"><span>${escapeHtml(s.label)}</span><b>${escapeHtml(s.value)}</b></div>`).join("")}</div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.filename)}</title><style>
@page{size:A4;margin:14mm}
*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111;margin:0}
.brand{font-size:22px;font-weight:800;color:#${BRAND_HEX}}
.sub{font-size:11px;color:#6b7280;margin:2px 0 14px}
table{width:100%;border-collapse:collapse;font-size:11px}
thead{display:table-header-group}
th{background:#${BRAND_HEX};color:#fff;text-align:left;padding:7px 8px;font-weight:700}
td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
tr:nth-child(even) td{background:#f9fafb}
.summary{margin-top:16px}
.sh{font-weight:800;font-size:12px;margin-bottom:6px}
.si{display:inline-block;margin-right:22px;font-size:11px}.si b{margin-left:6px}
</style></head><body>
<div class="brand">${BRAND_NAME}</div>
<div class="sub">${escapeHtml(subtitleLine(input.title, input.seller, input.dateISO))}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
${summary}
</body></html>`;
}

export function exportBrandedPdf(input: BrandedExportInput): void {
  const html = buildPrintHtml(input);
  // Hidden iframe (more reliable than window.open — no popup block). Print, then
  // clean up. The browser's print dialog offers "Save as PDF".
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const cleanup = () => { setTimeout(() => iframe.remove(), 1000); };
  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); return; }
      win.focus();
      win.print();
    } catch { /* ignore */ }
    cleanup();
  };
  iframe.srcdoc = html;
}
