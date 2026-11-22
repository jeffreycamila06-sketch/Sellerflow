// Settings → Channels 2×2 (sql/199 preview) — the four boxes' words, pure (components/ChannelsGrid.tsx draws them).
import type { RedesignT } from "../i18n";

export type GridChan = "tiktok" | "facebook" | "instagram" | "shopee";
export interface GridInput {
  tiktokNames: string[];
  facebookName: string | null;
  instagram: { open: boolean; name: string | null };
  shopee: { state: "open" | "soon" | "locked"; name: string | null; lockText?: string };
}
export interface GridTile { key: GridChan; name: string; line: string; registered: boolean; disabled: boolean }

export function channelTiles(i: GridInput, t: RedesignT): GridTile[] {
  const tt = i.tiktokNames[0] ? `@${i.tiktokNames[0].replace(/^@+/, "")}` : null;
  return [
    { key: "tiktok", name: t.rd_pf_plat_tiktok, line: tt ?? t.rd_ch_not_connected, registered: !!tt, disabled: false },
    { key: "facebook", name: t.rd_cg_facebook, line: i.facebookName ?? t.rd_ch_not_connected, registered: !!i.facebookName, disabled: false },
    i.instagram.open
      ? { key: "instagram", name: t.rd_pf_plat_instagram, line: i.instagram.name ?? t.rd_ch_not_connected, registered: !!i.instagram.name, disabled: false }
      : { key: "instagram", name: t.rd_pf_plat_instagram, line: t.rd_ls_soon, registered: false, disabled: true },
    i.shopee.state === "open"
      ? { key: "shopee", name: t.rd_cg_shopee, line: i.shopee.name ?? t.rd_ch_not_connected, registered: !!i.shopee.name, disabled: false }
      : { key: "shopee", name: t.rd_cg_shopee, line: i.shopee.state === "locked" ? (i.shopee.lockText || t.rd_sh_lock_ended) : t.rd_ls_soon, registered: false, disabled: true },
  ];
}

