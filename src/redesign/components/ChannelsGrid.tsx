// Settings → Channels as 4 boxes, 2 per row (sql/199 preview, Jeff's approved design 2026-11-22:
// claude.ai/artifact/AegK5uxSUv6ajQSbx2YbRu). Order TikTok, Facebook / Instagram, Shopee.
// Phone: compact — one row per box, small icon, name + status dot, the account line under it (long names "…").
// Laptop (≥ 900 px): the same 2×2 with wider rows, the status word, the Beta chip on Shopee and a chevron.
// The dot is green when an account is REGISTERED (not "live now"). Instagram = Coming soon unless open (admin);
// Shopee follows the Live tile (beta → its shops screen; ended → the lock line; else Coming soon).
import { useT } from "../i18n";
import { channelTiles, type GridChan, type GridInput } from "../adapters/channelsGrid";

export type { GridChan, GridInput } from "../adapters/channelsGrid";

const ICON: Record<GridChan, { bg: string; ch: string }> = {
  tiktok: { bg: "#111111", ch: "t" }, facebook: { bg: "#2F6FEB", ch: "f" }, instagram: { bg: "#C13584", ch: "ig" }, shopee: { bg: "#EE4D2D", ch: "S" },
};

export default function ChannelsGrid({ input, onOpen }: { input: GridInput; onOpen: (c: GridChan) => void }) {
  const t = useT();
  return (
    <div className="sfl-cg-grid" data-testid="cg-grid">
      {channelTiles(input, t).map((tile) => (
        <button key={tile.key} type="button" className="sfl-cg-tile" data-testid={`cg-${tile.key}`} data-registered={tile.registered ? "1" : "0"}
          disabled={tile.disabled} aria-disabled={tile.disabled} onClick={() => { if (!tile.disabled) onOpen(tile.key); }}>
          <span className="sfl-cg-icon" style={{ background: ICON[tile.key].bg }} aria-hidden="true">{ICON[tile.key].ch}</span>
          <span className="sfl-cg-text">
            <span className="sfl-cg-head">
              <span className="sfl-cg-name">{tile.name}</span>
              <span className={`sfl-cg-dot${tile.registered ? " on" : ""}`} data-testid={`cg-${tile.key}-dot`} aria-hidden="true" />
              {tile.beta && <span className="sfl-cg-beta">{t.rd_sh_beta}</span>}
            </span>
            <span className={`sfl-cg-line${tile.registered ? " on" : ""}`} data-testid={`cg-${tile.key}-line`}>{tile.line}</span>
          </span>
          {!tile.disabled && <span className={`sfl-cg-status${tile.registered ? " on" : ""}`}>{tile.registered ? t.rd_ch_connected : t.rd_ch_not_connected}</span>}
          {!tile.disabled && <span className="sfl-cg-chev" aria-hidden="true">›</span>}
        </button>
      ))}
    </div>
  );
}
