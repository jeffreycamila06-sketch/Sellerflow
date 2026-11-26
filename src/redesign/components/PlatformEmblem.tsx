// The platform emblem of the Live picker (Dashboard) — ONE shape per platform with the chip's own letter
// mark and brand colour. Shared with Settings → Invoicing's tab bar (2026-11-26), so both draw the same
// thing. The markup is exactly what the Live picker has always drawn; every size comes from redesign.css
// (.sfl-lpk-shape--*), scaled by the --lpk-u unit of whatever holds it.
import type { CSSProperties } from "react";
import { EMBLEM_BRAND, EMBLEM_LETTER, EMBLEM_SLUG, type PickerPlatform } from "../adapters/livePicker";

export default function PlatformEmblem({ platform }: { platform: PickerPlatform }) {
  const bg = EMBLEM_BRAND[platform];
  return (
    <span className={`sfl-lpk-shape sfl-lpk-shape--${EMBLEM_SLUG[platform]}`} style={{ background: bg, "--lpk-brand": bg } as CSSProperties}>
      <span className="sfl-lpk-letter">{EMBLEM_LETTER[platform]}</span>
    </span>
  );
}
