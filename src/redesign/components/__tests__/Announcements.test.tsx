// U3 — the bell sheet must distinguish LOADING from EMPTY. Before, an empty list
// during the initial async read showed "No announcements yet" (a false empty
// state); now it shows a loading placeholder while ann.loading is true.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { AnnouncementsSheet } from "../Announcements";
import { TProvider } from "../../i18n";
import type { Announcement } from "../../adapters/useAnnouncements";

const wrap = (ui: ReactNode) => render(<TProvider lang="en">{ui}</TProvider>);

describe("AnnouncementsSheet — loading vs empty (U3)", () => {
  it("empty + loading → shows the loading placeholder, NOT the empty state", () => {
    wrap(<AnnouncementsSheet list={[]} loading onClose={() => {}} />);
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("No announcements yet")).toBeNull();
  });
  it("empty + not loading → shows the real empty state", () => {
    wrap(<AnnouncementsSheet list={[]} loading={false} onClose={() => {}} />);
    expect(screen.getByText("No announcements yet")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
  });
  it("has rows → shows neither placeholder", () => {
    const list: Announcement[] = [{ id: "a1", message: "Hi all", active: true, createdAt: "2026-07-02T00:00:00Z" }];
    wrap(<AnnouncementsSheet list={list} loading onClose={() => {}} />);
    expect(screen.getByText("Hi all")).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.queryByText("No announcements yet")).toBeNull();
  });

  it("sheet close × is labeled for screen readers (U6)", () => {
    wrap(<AnnouncementsSheet list={[]} onClose={() => {}} />);
    expect(screen.getByLabelText("Close")).toBeTruthy();
  });
});
