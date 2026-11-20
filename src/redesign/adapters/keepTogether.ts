// PURE — splits a short label into pieces so the screen can let it wrap ONLY between pieces
// (2026-11-19, Pickup Status right-hand column). Without it a narrow cell broke Chinese anywhere:
// "請在 11月26日 前寄 ⏎ 件" left one character alone, and English / Thai / Indonesian / Vietnamese
// cut the date itself ("Nov ⏎ 26", "26 ⏎ Nov").
//   · the date is ONE piece, never cut;
//   · the text between spaces is ONE piece when it has at most SHORT_CHUNK characters (請在, 前寄件,
//     移出清單, "Drop", "พ.ย.");
//   · a longer run with no space (下次檢查時移出清單, ออกจากรายการเมื่อตรวจครั้งถัดไป) is split into the
//     words the language has, and a one-character word is joined to its neighbour — so no line can
//     ever hold a single character;
//   · spaces stay as they are (the places where a line may break).
// Joined back together, the pieces are exactly the text the template gives (nothing added or lost).
// No Intl.Segmenter (old phone browser): a long run is left to the browser, as before.
export const SHORT_CHUNK = 6;

// Languages of the app written without spaces between words (the screen evens out their two lines).
export const NO_SPACE_LANGS = ["zh", "zh-TW", "th"] as const;
export const keepTogetherBalanced = (lang: string): boolean => (NO_SPACE_LANGS as readonly string[]).includes(lang);

export interface KeepPiece {
  text: string;
  keep: boolean;   // true = must not be cut (the screen draws it with white-space: nowrap)
  date?: true;     // the date itself
}

type SegmenterCtor = new (lang?: string, opts?: { granularity: "grapheme" | "word" }) => { segment(s: string): Iterable<{ segment: string }> };
const Segmenter = (): SegmenterCtor | null => {
  const S = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  return typeof S === "function" ? S : null;
};

export function graphemeCount(s: string): number {
  const S = Segmenter();
  if (!S) return Array.from(s).length;
  let n = 0;
  for (const _ of new S(undefined, { granularity: "grapheme" }).segment(s)) n++;
  return n;
}

// A long run without spaces → the language's words, no one-character word left on its own.
function wordsOf(run: string, lang: string): string[] | null {
  const S = Segmenter();
  if (!S) return null;
  let seg: Iterable<{ segment: string }>;
  try { seg = new S(lang, { granularity: "word" }).segment(run); } catch { seg = new S(undefined, { granularity: "word" }).segment(run); }
  const words: string[] = [];
  for (const { segment } of seg) {
    if (!segment) continue;
    if (words.length && graphemeCount(segment) === 1) words[words.length - 1] += segment; // join to the word before
    else words.push(segment);
  }
  if (words.length > 1 && graphemeCount(words[0]) === 1) words.splice(0, 2, words[0] + words[1]); // a first one-character word → the next
  return words;
}

export function keepTogetherPieces(template: string, date: string | null, lang: string): KeepPiece[] {
  const out: KeepPiece[] = [];
  const parts = date === null ? [template] : template.split("{date}");
  parts.forEach((part, i) => {
    if (i > 0) out.push({ text: date as string, keep: true, date: true });
    for (const tok of part.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) { out.push({ text: tok, keep: false }); continue; }
      if (graphemeCount(tok) <= SHORT_CHUNK) { out.push({ text: tok, keep: true }); continue; }
      const words = wordsOf(tok, lang);
      if (!words) { out.push({ text: tok, keep: false }); continue; }
      for (const w of words) out.push({ text: w, keep: true });
    }
  });
  return out;
}
