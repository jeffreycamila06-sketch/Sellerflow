// A screen's short timers: a toast that hides itself, a "Copied" note, a button's short rest.
//
//   const later = useScreenTimers();
//   setToast("Saved"); later(() => setToast(""), 2500);
//
// later(fn, ms) is setTimeout with two differences that nobody can see:
//   • when the screen closes, every timer still waiting is stopped;
//   • after the screen has closed, nothing new is started.
// A timer left running sets state on a screen that is gone. In the tests that is an error after the
// test page is removed ("window is not defined" — CI run 1843, Pickup Status, fixed the same way
// inside that screen).
//
// While the screen is open it is exactly setTimeout: the same delay, and nothing is stopped early
// (an older toast's timer still hides a newer toast, as before).
import { useCallback, useEffect, useRef } from "react";

export type Later = (fn: () => void, ms: number) => void;

export function useScreenTimers(): Later {
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const open = useRef(true);
  useEffect(() => {
    const waiting = timers.current;
    open.current = true;
    return () => {
      open.current = false;
      for (const id of waiting) clearTimeout(id);
      waiting.clear();
    };
  }, []);
  return useCallback((fn: () => void, ms: number) => {
    if (!open.current) return;
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
  }, []);
}
