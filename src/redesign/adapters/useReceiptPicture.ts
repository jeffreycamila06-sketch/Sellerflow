// Renders a receipt picture (debounced) into an object URL for an <img>. Used by the
// Receipt format screen (sample) and the Orders receipt sheet. Nothing is uploaded or sent.
// No 2D canvas (old WebView / jsdom) → state "failed" and no picture; never throws.
import { useEffect, useState } from "react";
import { renderReceiptPng, type ReceiptInput } from "./receiptImage";

export function useReceiptPicture(input: ReceiptInput | null, debounceMs = 350): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const key = input ? JSON.stringify(input) : "";
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let made: string | null = null;
    const h = setTimeout(() => {
      renderReceiptPng(JSON.parse(key) as ReceiptInput)
        .then((blob) => {
          if (!alive) return;
          made = URL.createObjectURL(blob);
          setUrl(made);
          setFailed(false);
        })
        .catch(() => { if (alive) setFailed(true); });
    }, debounceMs);
    return () => {
      alive = false;
      clearTimeout(h);
      if (made) URL.revokeObjectURL(made);
    };
  }, [key, debounceMs]);
  return { url, failed };
}
