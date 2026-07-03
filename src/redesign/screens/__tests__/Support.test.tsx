// Support — the 4 user-guide rows are tap-to-expand accordions (were dead rows).
// Verifies expand/collapse, single-open behavior, body content, and the renamed
// item #2 title ("mine" → "Auto Mode").
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Support from "../Support";
import { TProvider } from "../../i18n";

const renderSupport = () => render(<TProvider lang="en"><Support onLegal={() => {}} /></TProvider>);

describe("Support user-guide accordions", () => {
  it("item #2 title is 'Auto Mode' (stale 'mine' wording removed)", () => {
    renderSupport();
    expect(screen.getByText("How Auto Mode works")).toBeTruthy();
    expect(screen.queryByText(/auto-capture/)).toBeNull();
  });

  it("body is hidden until the row is tapped, then shown", () => {
    renderSupport();
    expect(screen.queryByText(/Announce a code/)).toBeNull();   // collapsed by default
    fireEvent.click(screen.getByText("How Auto Mode works"));
    expect(screen.getByText(/Announce a code/)).toBeTruthy();    // expanded
  });

  it("tapping again collapses it", () => {
    renderSupport();
    const row = screen.getByText("Connecting TikTok & Facebook live");
    fireEvent.click(row);
    expect(screen.getByText(/add your account in Channels/)).toBeTruthy();
    fireEvent.click(row);
    expect(screen.queryByText(/add your account in Channels/)).toBeNull();
  });

  it("g5 shipping-export guide is present and expands to the step list", () => {
    renderSupport();
    expect(screen.queryByText(/grouped by buyer number/)).toBeNull();  // collapsed
    fireEvent.click(screen.getByText("How to use: 7-11 shipping export"));
    expect(screen.getByText(/grouped by buyer number/)).toBeTruthy();
    expect(screen.getByText(/NT\$38/)).toBeTruthy();
    expect(screen.getByText(/Ship within 4 days/)).toBeTruthy();
  });

  it("only one accordion is open at a time", () => {
    renderSupport();
    fireEvent.click(screen.getByText("Connecting TikTok & Facebook live"));
    expect(screen.getByText(/add your account in Channels/)).toBeTruthy();
    fireEvent.click(screen.getByText("Renewing your subscription"));
    expect(screen.queryByText(/add your account in Channels/)).toBeNull();   // first closed
    expect(screen.getByText(/free to download/)).toBeTruthy();               // second open
  });
});
