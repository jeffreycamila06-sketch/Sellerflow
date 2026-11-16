// Seller Website — buyer entry (shop.html). Served for /s/<sub>/… (and <sub>.sellerflowlive.com once
// the wildcard domain is live) by the vercel.json rewrite → /api/shop (adds the link preview tags).
// No console output (the one start banner lives in the seller app's entry).
import { createRoot } from "react-dom/client";
import ShopApp from "./ShopApp";

createRoot(document.getElementById("shop-root")!).render(<ShopApp />);
