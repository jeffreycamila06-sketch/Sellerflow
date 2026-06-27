// Step 5a — Auto Mode on/off persistence. The toggle state (autoDetect) is read from
// and written to localStorage under sfl_rd_automode, mirroring theme/currency, so it
// survives a refresh. Rendering RedesignApp (unauthed → Login) runs the real init +
// persist effect; we assert the localStorage contract.
import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import RedesignApp from "../RedesignApp";

describe("Auto Mode toggle persistence (sfl_rd_automode)", () => {
  beforeEach(() => { cleanup(); localStorage.clear(); });

  it("with no stored value, the persist effect writes the default OFF ('0')", () => {
    render(<RedesignApp />);
    expect(localStorage.getItem("sfl_rd_automode")).toBe("0");
  });

  it("a previously-saved ON ('1') is read back and stays ON after mount", () => {
    localStorage.setItem("sfl_rd_automode", "1");
    render(<RedesignApp />);
    // init reads "1" → ON; the effect re-persists the same value (idempotent, still ON)
    expect(localStorage.getItem("sfl_rd_automode")).toBe("1");
  });
});
