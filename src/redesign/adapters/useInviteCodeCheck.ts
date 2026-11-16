// Live check for an invite-code box: waits until the seller stops typing (debounce), asks once,
// and ignores an answer that arrives after the text changed. Only valid-looking codes are asked.
import { useEffect, useState } from "react";
import { INVITE_CODE_RE, normInviteCode } from "./invite";

export type CodeCheckState<T> = { kind: "idle" } | { kind: "checking" } | { kind: "done"; value: T };

export function useInviteCodeCheck<T>(raw: string, ask: (code: string) => Promise<T>, delayMs = 400): CodeCheckState<T> {
  const code = normInviteCode(raw);
  const valid = INVITE_CODE_RE.test(code);
  const [state, setState] = useState<{ code: string; s: CodeCheckState<T> }>({ code: "", s: { kind: "idle" } });
  useEffect(() => {
    if (!valid) return;
    let live = true;
    const h = window.setTimeout(() => {
      setState({ code, s: { kind: "checking" } });
      void ask(code).then((value) => { if (live) setState({ code, s: { kind: "done", value } }); });
    }, delayMs);
    return () => { live = false; window.clearTimeout(h); };
  }, [code, valid, ask, delayMs]);
  if (!valid) return { kind: "idle" };
  if (state.code !== code) return { kind: "checking" };
  return state.s;
}
