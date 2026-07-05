// Batch E (#15) — ONE generic PostgREST pager. The 2026-07-05 audit fixed the
// 1,000-row silent-cap bug three separate times (S1 sessions, S2 admin users,
// batch-c2 shipping entries) with three near-identical loops; this is the shared
// core so the next paged read can't reintroduce a drifted copy.
//
// Contract (same as every existing pager):
// • fetchPage(page) returns one page (ranged .range(page*size, ...+size-1))
//   or null on a page ERROR.
// • Pages accumulate until a SHORT page (< pageSize) — an exact-full final page
//   costs one extra (empty) fetch, by design (completeness proof).
// • ANY page error → null: NEVER a partial set (a partial read is what caused
//   the duplicate-buyer# bug). Callers map null to their own error value
//   ([] today; Batch D's session loader keeps null to tell the seller).

export async function fetchAllPages<T>(
  fetchPage: (page: number) => Promise<T[] | null>,
  pageSize: number,
): Promise<T[] | null> {
  const all: T[] = [];
  for (let page = 0; ; page++) {
    const rows = await fetchPage(page);
    if (rows === null) return null; // page error → FAILED, never partial
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}
