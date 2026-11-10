// Vitest setup — runs before every test file.
// Registers @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
// for the component tests planned in Phase 2.
import "@testing-library/jest-dom/vitest";

// Parcel Scan bridge drafts live in memory for the whole app session (= a whole test file here).
// Forget them after every test so one test's open manual entry never shows up in the next.
import { afterEach } from "vitest";
import { clearParcelDrafts } from "./redesign/adapters/parcelDrafts";
afterEach(() => { clearParcelDrafts(); });
