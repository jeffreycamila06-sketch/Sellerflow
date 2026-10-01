// MANDATORY 賣貨便 SETUP status (2026-10-01) — the probe hook + pure decision
// behind MyshipSetupModal (components/MyshipSetup.tsx). Separate module so the
// component file only exports components (react-refresh).
import { useEffect, useState } from "react";
import { probeMyshipConfig } from "./parcelCheck";

export type MyshipStatus = "loading" | "missing" | "configured" | "error";

// A save from ANY MyshipConfigForm (Settings card or this modal) flips every
// mounted status hook to "configured" — so a GM saved in Settings never
// re-prompts on the next Parcel Scan tap.
const savedListeners = new Set<() => void>();
export const notifyConfigured = () => { savedListeners.forEach((f) => f()); };

// The probe runs ONCE per (enabled, user) — tile taps read the cached status,
// so the modal decision is instant and the tap never waits on the network.
export function useMyshipStatus(enabled: boolean, userKey?: string | null): MyshipStatus {
  // keyed by user so a sign-in switch never shows the previous user's status
  // (reads as "loading" = fail-open until this user's probe lands)
  const key = userKey ?? "";
  const [st, setSt] = useState<{ key: string; status: MyshipStatus }>({ key, status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const set = (status: MyshipStatus) => { if (live) setSt({ key, status }); };
    void probeMyshipConfig().then(set, () => set("error")); // fail-OPEN
    const onSaved = () => set("configured");
    savedListeners.add(onSaved);
    return () => { live = false; savedListeners.delete(onSaved); };
  }, [enabled, key]);
  if (!enabled) return "configured"; // disabled → never blocks
  return st.key === key ? st.status : "loading";
}

// Pure decision (pinned by tests): only a DEFINITE "missing" blocks.
export const mustSetupBeforeScan = (checkOn: boolean, status: MyshipStatus): boolean =>
  checkOn && status === "missing";
