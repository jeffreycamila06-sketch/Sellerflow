// The seller app's Copy button (adapters/buttonFeedback.ts): Copy → "✓ Copied" (green) for 2 s → Copy.
// When the clipboard is refused it stays "Copy" and <CopyFailNote fb={…}/> (placed by the screen) shows the
// text selected with the press-and-hold line. `fb` is the screen's useCopyFeedback().
import type { CSSProperties, ReactNode } from "react";
import { FB_GREEN, type CopyFeedback } from "../adapters/buttonFeedback";

type T = Record<string, string>;
export default function CopyButton({ fb, text, label, t, style, testid, title }: {
  fb: CopyFeedback; text: string;
  /** what the button says at rest ("Copy", "🔗 Order link · Copy") */
  label: ReactNode; t: T; style?: CSSProperties; testid?: string; title?: string;
}) {
  const copied = fb.phase === "copied";
  return (
    <button type="button" data-testid={testid} data-state={fb.phase} title={title} aria-live="polite"
      onClick={() => void fb.copy(text)}
      style={{ ...style, ...(copied ? { background: FB_GREEN, borderColor: FB_GREEN, color: "#fff" } : null) }}>
      {copied ? `✓ ${t.rd_fb_copied}` : label}
    </button>
  );
}
