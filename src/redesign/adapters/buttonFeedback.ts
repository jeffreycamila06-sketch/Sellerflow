// Button feedback — ONE pattern for every Copy and Save button of the seller app.
//
// COPY   Copy → "✓ Copied" (green) for 2 s → Copy.
//        Clipboard refused (some phone apps, older browsers): the text is shown in a box, already selected,
//        with "Couldn't copy — press and hold the link to copy" (CopyFailNote). Never "Copied" when it was not.
//
// SAVE   Save → "Saving…" (not tappable) → "✓ Saved" (green) for 2 s → Save.
//        Nothing changed since the last save → "Saved", not tappable.
//        Failed → "Couldn't save — tap to try again" (red, tappable); the form keeps what was typed.
//        A second tap while a save is on its way sends nothing.
//
// The pieces: this file (the rules, no JSX), components/CopyButton.tsx, components/CopyFailNote.tsx,
// components/SaveButton.tsx. Timers go through useScreenTimers (they stop when the screen closes).
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../components/inviteShare";
import { useScreenTimers } from "./useScreenTimers";

/** How long "✓ Copied" / "✓ Saved" stays on the button. */
export const FEEDBACK_MS = 2000;
/** White text on these reads ≥ 4.5 : 1 in the light and the dark theme. */
export const FB_GREEN = "#047857";
export const FB_RED = "#be123c";

// ── copy ──
export type CopyPhase = "idle" | "copied" | "failed";
export interface CopyFeedback {
  phase: CopyPhase;
  /** the text that could not be copied (shown selected by CopyFailNote) */
  failedText: string;
  /** copies; answers true only when it really reached the clipboard */
  copy: (text: string) => Promise<boolean>;
  clear: () => void;
}
export function useCopyFeedback(): CopyFeedback {
  const later = useScreenTimers();
  const [phase, setPhase] = useState<CopyPhase>("idle");
  const [failedText, setFailedText] = useState("");
  const turn = useRef(0);
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);
  const copy = useCallback(async (text: string): Promise<boolean> => {
    const mine = ++turn.current;
    const ok = await copyText(text);
    if (!open.current || mine !== turn.current) return ok; // the screen closed, or a newer tap owns the button
    if (ok) {
      setFailedText(""); setPhase("copied");
      later(() => { if (turn.current === mine) setPhase("idle"); }, FEEDBACK_MS);
    } else { setFailedText(text); setPhase("failed"); }
    return ok;
  }, [later]);
  const clear = useCallback(() => { turn.current++; setPhase("idle"); setFailedText(""); }, []);
  return { phase, failedText, copy, clear };
}
/** Select everything in a field (iPhone needs the range call as well). */
export function selectAll(el: HTMLInputElement | HTMLTextAreaElement | null): void {
  if (!el) return;
  try { el.focus({ preventScroll: true }); } catch { /* older browsers: no options */ }
  try { el.select(); el.setSelectionRange(0, el.value.length); } catch { /* not selectable here */ }
}

// ── save ──
export type SavePhase = "idle" | "saving" | "done" | "failed";
/** What a save answers: true = saved · false = failed (offer the retry) · "blocked" = nothing was sent, the
 *  form shows its own message (a missing field, an address already taken). */
export type SaveOutcome = boolean | "blocked";
export type SaveLook = "ready" | "saving" | "done" | "failed" | "clean";

/** What the button shows. `dirty` false = nothing changed since the last save; undefined = the form has no
 *  such idea (it closes or clears after a save). Pure. */
export function saveLook(phase: SavePhase, dirty: boolean | undefined, disabled: boolean): { look: SaveLook; disabled: boolean } {
  if (phase === "saving") return { look: "saving", disabled: true };
  // "✓ Saved" stays 2 s — unless the seller already changed something again: then Save is back at once
  if (phase === "done" && dirty !== true) return { look: "done", disabled: true };
  if (phase === "failed") return { look: "failed", disabled };
  if (dirty === false) return { look: "clean", disabled: true };
  return { look: "ready", disabled };
}

export interface SaveFeedback { phase: SavePhase; run: (save: () => Promise<SaveOutcome> | SaveOutcome) => Promise<void> }
export function useSaveFeedback(): SaveFeedback {
  const later = useScreenTimers();
  const [phase, setPhase] = useState<SavePhase>("idle");
  const flying = useRef(false);
  const turn = useRef(0);
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);
  const run = useCallback(async (save: () => Promise<SaveOutcome> | SaveOutcome) => {
    if (flying.current) return; // a second tap while saving: one request only
    flying.current = true;
    const mine = ++turn.current;
    setPhase("saving");
    let r: SaveOutcome;
    try { r = await save(); } catch { r = false; }
    flying.current = false;
    if (!open.current) return;
    if (r === true) { setPhase("done"); later(() => { if (turn.current === mine) setPhase("idle"); }, FEEDBACK_MS); }
    else setPhase(r === "blocked" ? "idle" : "failed");
  }, [later]);
  return { phase, run };
}
