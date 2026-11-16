import { BRANDS, type BrandKey } from "./brandData";
export type { BrandKey };

export function BrandIcon({ brand, size = 18, color }: { brand: BrandKey; size?: number; color?: string }) {
  const b = BRANDS[brand];
  return <svg role="img" aria-label={b.title} width={size} height={size} viewBox="0 0 24 24" fill={color || b.hex}><path d={b.path} /></svg>;
}
