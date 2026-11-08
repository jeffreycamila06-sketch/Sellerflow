// ONE "still loading" memory for every sticker wait on a lazy font chunk (a bad connection).
//
// Three waits share it: the new-sticker picture (printing.ts withPictureLimit, 8 s), the all-scripts
// kana / full-width outlines (oneStickerScripts.ensureAllScriptsFonts, 8 s) and — only with
// all-scripts ON — the Chinese atlas loads of today's image paths (printing.ts cjkLoad, 8 s).
// The FIRST of them that runs out of time leaves its load running in the background and marks this
// memory; until that load settles, EVERY one of the waits goes on at once (its own fallback: today's
// sticker / the device font / the 24-cell atlas or the text sticker). So one order never waits 8 s
// twice (a kana order on a saved device: the picture times out → today's sticker → no second kana wait),
// and the next orders never wait at all. When the load settles, the memory clears by itself.
export class StuckSkip extends Error {
  readonly first: boolean;
  constructor(first: boolean) { super("one-sticker picture still loading — today's sticker"); this.first = first; }
}
let stuck: Promise<unknown> | null = null;
let reported = false; // the picture's own miss is reported once per stuck episode
export const isLoadStuck = (): boolean => stuck !== null;
function markStuck(p: Promise<unknown>): void {
  stuck = p; reported = false;
  const done = () => { if (stuck === p) { stuck = null; reported = false; } };
  p.then(done, done);
}
export const STUCK_TIMEOUT_TEXT = "one-sticker picture timeout";
/** Run `make` for at most `ms`. Already stuck → StuckSkip at once (`report`: only the first such
 *  skip says first=true). Out of time → this load becomes the stuck one and the call throws. */
export async function withLoadLimit<T>(make: () => Promise<T>, ms: number, report = false): Promise<T> {
  if (stuck) { const first = report && !reported; if (report) reported = true; throw new StuckSkip(first); }
  const p = make();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((res, rej) => {
      timer = setTimeout(() => { markStuck(p); rej(new Error(STUCK_TIMEOUT_TEXT)); }, ms);
      p.then(res, rej);
    });
  } finally { if (timer) clearTimeout(timer); }
}
export function __resetLoadStuck(): void { stuck = null; reported = false; }
