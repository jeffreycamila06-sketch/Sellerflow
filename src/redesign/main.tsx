// Redesign preview entry (Phase 2). Loaded ONLY by redesign.html, mounted at
// /redesign.html. Completely separate from the production entry (src/main.tsx ->
// App.tsx), which is untouched. Imports the scoped tokens + redesign styles.
import { createRoot } from "react-dom/client";
import "../styles/design-tokens.css";
import "./redesign.css";
import RedesignApp from "./RedesignApp";

createRoot(document.getElementById("redesign-root")!).render(<RedesignApp />);
