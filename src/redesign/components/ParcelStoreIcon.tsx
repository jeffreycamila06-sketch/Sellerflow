// Our own simple shop-front icon for the Parcel Scan tiles (drawn here — NOT a store logo:
// no "7", no stripe pattern copied from a sign, no wordmark). The outline follows the tile's
// text colour (light + dark theme); a small accent bar under the awning tells the stores apart.
const STORE_ACCENTS = {
  "711": ["#f58220", "#00965e", "#e4002b"], // orange · green · red
  fm: ["#00a14b", "#0072bc"],               // green · blue
} as const;

export default function ParcelStoreIcon({ store }: { store: keyof typeof STORE_ACCENTS }) {
  const colors = STORE_ACCENTS[store];
  const w = 16 / colors.length;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden data-testid={`parcel-icon-${store}`}>
      <path d="M4 9 5.6 4.5h12.8L20 9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      {colors.map((c, i) => <rect key={c} data-testid="parcel-accent" x={4 + i * w} y="8.6" width={w} height="2.4" fill={c} />)}
      <path d="M5.5 11v9h13v-9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="9" y="14.5" width="6" height="4.2" rx=".6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 14.5v4.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
