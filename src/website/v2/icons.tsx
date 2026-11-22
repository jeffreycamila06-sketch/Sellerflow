// Seller Website v2 — the storefront's icons (the same drawings as the preview's i-* symbols).
const P: Record<string, string> = {
  cart: "M3 4h2.5l2.2 11h10.6L20.5 7H7",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.4A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  search: "M16 16l4.5 4.5",
  home: "M4 11 12 4l8 7v9h-5v-6H9v6H4z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  box: "M4 8 12 4l8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  chat: "M4 6h16v10H10l-4 4v-4H4z",
  truck: "M2 6h11v10H2zM13 10h5l3 3v3h-8z",
  cash: "M3 6h18v12H3z",
  shield: "M12 3 5 6v6c0 4.4 3 7.5 7 9 4-1.5 7-4.6 7-9V6zM9 12l2 2 4-4",
  bolt: "M13 3 5 13h6l-1 8 8-10h-6z",
  back: "M15 5 8 12l7 7",
  // v4 (the new look draws these where the older looks have an emoji)
  check: "m5 12.5 4.5 4.5L19 7.5",
  clock: "M12 7.5V12l3 2",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  pin: "M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z",
};
export type IconName = keyof typeof P;
export function VIcon({ n, size = 22, filled = false }: { n: IconName; size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d={P[n]} fill={filled ? "currentColor" : "none"} />
      {n === "cart" && <><circle cx="9.5" cy="19" r="1.5" fill="currentColor" stroke="none" /><circle cx="17" cy="19" r="1.5" fill="currentColor" stroke="none" /></>}
      {n === "search" && <circle cx="11" cy="11" r="6.5" />}
      {n === "truck" && <><circle cx="7" cy="18" r="1.8" fill="currentColor" stroke="none" /><circle cx="17" cy="18" r="1.8" fill="currentColor" stroke="none" /></>}
      {n === "cash" && <circle cx="12" cy="12" r="2.6" />}
      {n === "clock" && <circle cx="12" cy="12" r="9" />}
      {n === "pin" && <circle cx="12" cy="10.5" r="2.2" />}
    </svg>
  );
}
