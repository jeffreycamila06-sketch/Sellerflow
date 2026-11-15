// Seller Website — buyer-side look: the 6 shop colors, the page CSS (mobile first, laptop column), icon paths.
import type { CSSProperties } from "react";

export const SHOP_COLORS = ["#EE4D2D", "#E11D48", "#7C3AED", "#0D9488", "#2563EB", "#111827"] as const;
export const shopColor = (c: string | undefined) => (SHOP_COLORS as readonly string[]).includes(String(c)) ? (c as string) : SHOP_COLORS[0];

export const SHOP_CSS = `
.sfl-shop{--sc:#EE4D2D;font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif;color:#111827;background:#F5F5F7;min-height:100vh;-webkit-text-size-adjust:100%}
.sfl-shop *{box-sizing:border-box}
.sfl-shop button,.sfl-shop input,.sfl-shop textarea,.sfl-shop select{font-family:inherit}
.sfl-shop input,.sfl-shop textarea,.sfl-shop select{font-size:16px}
.sfl-wrap{width:100%;max-width:1120px;margin:0 auto}
.sfl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media (min-width:760px){.sfl-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}
@media (min-width:1024px){.sfl-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.sfl-two{display:block}
@media (min-width:900px){.sfl-two{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:28px;align-items:start}}
.sfl-side{display:block}
@media (min-width:900px){.sfl-side{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}}
.sfl-only-phone{display:flex}
@media (min-width:900px){.sfl-only-phone{display:none}}
.sfl-only-wide{display:none}
@media (min-width:900px){.sfl-only-wide{display:block}}
.sfl-btn{min-height:46px;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;border:none}
.sfl-btn-main{background:var(--sc);color:#fff}
.sfl-btn-line{background:#fff;color:var(--sc);border:1.5px solid var(--sc)}
.sfl-btn:disabled{opacity:.45;cursor:not-allowed}
.sfl-card{background:#fff;border-radius:16px;border:1px solid #ECECF1}
.sfl-chip{flex-shrink:0;min-height:36px;padding:7px 14px;border-radius:999px;border:1px solid #E5E7EB;background:#fff;font-size:13.5px;font-weight:700;color:#111827;cursor:pointer}
.sfl-chip[aria-pressed=true]{background:#111827;color:#fff;border-color:#111827}
.sfl-hscroll{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}
.sfl-hscroll::-webkit-scrollbar{display:none}
`;

export const mutedText: CSSProperties = { fontSize: 12.5, color: "#6B7280", lineHeight: 1.45 };

export const IC = {
  back: "M15 18l-6-6 6-6",
  cart: "M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2M10 20.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Zm8 0a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0Z",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Zm9 2-4-4",
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  chat: "M4 5h16v11H8l-4 4z",
  check: "M5 12l5 5 9-10",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
};

