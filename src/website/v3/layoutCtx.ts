// Seller Website v3 — which layout the shop is on, for the parts shared by both layouts (the product
// card). null = a shop without a look (Build 1).
import { createContext, useContext } from "react";
import type { LookLayout } from "./look";

export const LayoutCtx = createContext<LookLayout | null>(null);
export const useLayout = () => useContext(LayoutCtx);
