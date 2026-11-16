// Seller Website v2 — a short message at the bottom of the page.
import { useState } from "react";

export function useToast(): [string, (m: string) => void] {
  const [msg, setMsg] = useState("");
  return [msg, (m: string) => { setMsg(m); setTimeout(() => setMsg((x) => (x === m ? "" : x)), 2200); }];
}
