// Phase 5j — CSV export. The serializer is copied VERBATIM from App.tsx:280-282
// (csvDL) so the redesign produces byte-identical CSV. Pure `toCSV` is unit-tested;
// `csvDL` adds the browser download. Client-side only — exports already-loaded real
// data, no new backend/query.

// VERBATIM CSV serialization from App.tsx:281 (quote every cell, escape quotes).
export function toCSV(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function csvDL(filename: string, headers: string[], rows: (string | number)[][]): void {
  const csv = toCSV(headers, rows);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

// Today's date stamp for filenames (matches production's `new Date().toISOString().slice(0,10)`).
export const dayStamp = (): string => new Date().toISOString().slice(0, 10);
