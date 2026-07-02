// RaffleWheel — empty state, spin → persistent winner box + toast, exclude/reset
// wiring. Fake timers drive the 4.2s spin settle.
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import RaffleWheel from "../RaffleWheel";
import { TProvider } from "../../i18n";
import type { RaffleEntry } from "../../adapters/raffle";

const entries: RaffleEntry[] = [
  { key: "a|TikTok", bNum: 1, label: "@ana", entries: 2, colorIndex: 0 },
  { key: "b|TikTok", bNum: 2, label: "@bea", entries: 3, colorIndex: 1 },
];

function Harness({ start = entries }: { start?: RaffleEntry[] }) {
  // minimal stateful parent mirroring Dashboard's lifted winner/excluded state
  const [winner, setWinner] = useState<RaffleEntry | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  return (
    <TProvider lang="en">
      <RaffleWheel entries={start} sinceLabel="since 10:00" winner={winner} excluded={excluded}
        onWinner={setWinner} onExclude={(k) => { setExcluded((x) => [...x, k]); setWinner(null); }}
        onReset={() => { setWinner(null); setExcluded([]); }} onClose={() => {}} />
    </TProvider>
  );
}

afterEach(() => vi.useRealTimers());

describe("RaffleWheel", () => {
  it("empty pool → no-entries message, no Spin button", () => {
    render(<Harness start={[]} />);
    expect(screen.getByText(/No entries yet/)).toBeTruthy();
    expect(screen.queryByText(/Spin/)).toBeNull();
  });

  it("renders chips + participants with entry counts", () => {
    render(<Harness />);
    expect(screen.getByText("5 entries · 2 buyers")).toBeTruthy(); // 2+3
    expect(screen.getByText("@ana")).toBeTruthy();
    expect(screen.getByText("×3")).toBeTruthy();
  });

  it("spin → after the settle timer, a PERSISTENT winner box + toast appear", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByText(/Spin/));
    expect(screen.getByText(/Spinning/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4400); });
    expect(screen.getByText("WINNER")).toBeTruthy();          // persistent box
    expect(screen.getByText(/🎉 Winner:/)).toBeTruthy();       // toast
    act(() => { vi.advanceTimersByTime(3100); });
    expect(screen.queryByText(/🎉 Winner:/)).toBeNull();       // toast fades…
    expect(screen.getByText("WINNER")).toBeTruthy();           // …box persists
  });

  it("exclude removes the winner from the pool; Reset restores", () => {
    vi.useFakeTimers();
    render(<Harness />);
    fireEvent.click(screen.getByText(/Spin/));
    act(() => { vi.advanceTimersByTime(4400); });
    fireEvent.click(screen.getByText("Exclude & spin again"));
    expect(screen.getByText(/1 entries · 1 buyers|[23] entries · 1 buyers/)).toBeTruthy(); // pool shrank to 1 buyer
    fireEvent.click(screen.getByText("Reset"));
    expect(screen.getByText("5 entries · 2 buyers")).toBeTruthy();
  });
});
