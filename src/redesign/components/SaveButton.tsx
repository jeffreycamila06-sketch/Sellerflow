// The seller app's Save button (adapters/buttonFeedback.ts):
//   Save → "Saving…" (not tappable) → "✓ Saved" (green) for 2 s → Save
//   nothing changed since the last save (`dirty` false) → "Saved", not tappable
//   failed → "Couldn't save — tap to try again" (red); the form is not touched
//   a second tap while saving sends nothing.
// `onSave` answers true (saved), false (failed) or "blocked" (nothing sent — the form shows why).
import type { CSSProperties, ReactNode } from "react";
import { FB_GREEN, FB_RED, saveLook, useSaveFeedback, type SaveOutcome } from "../adapters/buttonFeedback";

type T = Record<string, string>;
export default function SaveButton({ label, onSave, dirty, disabled = false, t, style, testid }: {
  /** what the button says when there is something to save ("Save", "Save changes") */
  label: ReactNode;
  onSave: () => Promise<SaveOutcome> | SaveOutcome;
  /** false = nothing changed since the last save. Leave out for a form that closes or clears after saving. */
  dirty?: boolean;
  /** off for another reason (a picture is uploading) */
  disabled?: boolean;
  t: T; style?: CSSProperties; testid?: string;
}) {
  const fb = useSaveFeedback();
  const s = saveLook(fb.phase, dirty, disabled);
  const paint: CSSProperties | null =
    s.look === "done" ? { background: FB_GREEN, borderColor: FB_GREEN, color: "#fff", opacity: 1, cursor: "default", boxShadow: "none" }
    : s.look === "failed" ? { background: FB_RED, borderColor: FB_RED, color: "#fff", opacity: 1, boxShadow: "none" }
    : s.look === "clean" ? { background: "var(--surface-2)", border: "1px solid var(--border-strong)", color: "var(--text-muted)", opacity: 1, cursor: "default", boxShadow: "none" }
    : s.look === "saving" ? { opacity: 0.7, cursor: "default" }
    : s.disabled ? { opacity: 0.6, cursor: "default" } : null;
  return (
    <button type="button" data-testid={testid} data-state={s.look} disabled={s.disabled} aria-busy={s.look === "saving"} aria-live="polite"
      onClick={() => void fb.run(onSave)} style={{ ...style, ...paint }}>
      {s.look === "saving" ? t.rd_fb_saving : s.look === "done" ? `✓ ${t.rd_fb_saved}` : s.look === "failed" ? t.rd_fb_save_failed : s.look === "clean" ? t.rd_fb_saved : label}
    </button>
  );
}
