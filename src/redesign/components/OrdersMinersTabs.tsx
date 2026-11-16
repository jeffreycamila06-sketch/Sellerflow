// The "Orders | Miners" segment shown at the top of the Orders tab (Miners moved in here). Rendered inside
// each screen's sticky header via the `topTabs` slot. (Moved out of RedesignApp unchanged; `websiteSoon` added.)
import SoonBadge from "./SoonBadge";

export type OrdersTab = "orders" | "miners" | "website";
export default function OrdersMinersTabs({ tab, onTab, ordersLabel, website, websiteSoon }: {
  tab: OrdersTab; onTab: (t: OrdersTab) => void; ordersLabel: string; website?: { label: string; count: number };
  /** Seller Website teaser (sql/170): the Website tab with "Soon" for a seller WITHOUT the website — not a button,
   *  nothing happens on a tap. Ignored when `website` is given (the real tab). */
  websiteSoon?: string;
}) {
  const seg = (on: boolean) => ({ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", fontWeight: 800 as const, fontSize: 12.5, cursor: "pointer", fontFamily: "var(--font-ui)", background: on ? "#fff" : "transparent", color: on ? "var(--accent-fg)" : "var(--on-header)" });
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 11, background: "rgba(255,255,255,.16)", borderRadius: 10, padding: 3 }}>
      <button data-testid="orders-tab-orders" onClick={() => onTab("orders")} style={seg(tab === "orders")}>{ordersLabel}</button>
      <button data-testid="orders-tab-miners" onClick={() => onTab("miners")} style={seg(tab === "miners")}>Miners</button>
      {website && <button data-testid="orders-tab-website" onClick={() => onTab("website")} style={seg(tab === "website")}>{website.label}{website.count > 0 && <span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 800, background: "var(--danger)", color: "#fff", borderRadius: 999, padding: "1px 6px" }}>{website.count}</span>}</button>}
      {!website && websiteSoon && (
        <span data-testid="orders-tab-website-soon" aria-disabled="true"
          style={{ flex: "0 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "4px 8px", borderRadius: 8, fontWeight: 800, fontSize: 12.5, fontFamily: "var(--font-ui)", color: "var(--on-header)", opacity: 0.6, cursor: "default", userSelect: "none", whiteSpace: "nowrap", overflow: "hidden" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{websiteSoon}</span>
          <SoonBadge plain style={{ fontSize: 9.5, padding: "1px 6px", gap: 4, color: "var(--on-header)", borderColor: "currentColor", background: "rgba(255,255,255,.12)" }} />
        </span>
      )}
    </div>
  );
}
