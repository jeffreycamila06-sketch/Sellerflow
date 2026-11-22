// The Shopee paste box — button states (Jeff's approved design, 2026-11-22):
//   Connecting… (not tappable) · ✓ Connected (green outline, not tappable) while green AND the box
//   holds the connected link · Connect again as soon as the box holds another link.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { TProvider } from "../../i18n";
import ShopeeLinkForm, { type ShopeeLinkProps } from "../ShopeeLinkForm";

const LINK = "https://ph.shp.ee/AbCdEf12";
const mount = (p: Partial<ShopeeLinkProps> = {}) => {
  const onConnect = vi.fn();
  const props: ShopeeLinkProps = { daysLeft: null, error: null, onConnect, ...p };
  const r = render(<TProvider lang="en"><ShopeeLinkForm {...props} /></TProvider>);
  return { ...r, onConnect, rerender: (q: Partial<ShopeeLinkProps>) => r.rerender(<TProvider lang="en"><ShopeeLinkForm {...props} {...q} /></TProvider>) };
};
const btn = () => screen.getByTestId("sh-link-connect") as HTMLButtonElement;
const input = () => screen.getByTestId("sh-link-input") as HTMLInputElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

describe("ShopeeLinkForm — button", () => {
  it("Connect: tappable with a link, sends the trimmed link", () => {
    const { onConnect } = mount();
    type(`  ${LINK}  `);
    expect(btn().textContent).toBe("Connect");
    expect(btn().disabled).toBe(false);
    fireEvent.click(btn());
    expect(onConnect).toHaveBeenCalledWith(LINK);
  });
  it("Connecting…: not tappable, a tap or Enter sends nothing", () => {
    const { onConnect, rerender } = mount();
    type(LINK);
    rerender({ connecting: true });
    expect(btn().textContent).toBe("Connecting…");
    expect(btn().disabled).toBe(true);
    expect(btn().dataset.state).toBe("connecting");
    fireEvent.click(btn());
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onConnect).not.toHaveBeenCalled();
  });
  it("✓ Connected: green outline, not tappable, while green and the box holds the connected link", () => {
    const { onConnect, rerender } = mount();
    type(LINK);
    rerender({ connected: true, connectedLink: LINK });
    expect(btn().textContent).toBe("✓ Connected");
    expect(btn().disabled).toBe(true);
    expect(btn().dataset.state).toBe("connected");
    expect(btn().className).toContain("sfl-sh-connected");
    fireEvent.click(btn());
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onConnect).not.toHaveBeenCalled();
  });
  it("editing the box to another link → Connect again (tappable, sends the new link)", () => {
    const { onConnect } = mount({ connected: true, connectedLink: LINK });
    type(LINK);
    expect(btn().textContent).toBe("✓ Connected");
    type("https://ph.shp.ee/NewLive99");
    expect(btn().textContent).toBe("Connect");
    expect(btn().disabled).toBe(false);
    fireEvent.click(btn());
    expect(onConnect).toHaveBeenCalledWith("https://ph.shp.ee/NewLive99");
  });
  it("connecting wins over connected (a change of link is under way)", () => {
    mount({ connected: true, connectedLink: LINK, connecting: true });
    type(LINK);
    expect(btn().textContent).toBe("Connecting…");
  });
  it("not green → Connect even with the old link in the box; green with no connected link → Connect", () => {
    const { rerender } = mount({ connected: false, connectedLink: LINK });
    type(LINK);
    expect(btn().textContent).toBe("Connect");
    rerender({ connected: true, connectedLink: "" });
    expect(btn().textContent).toBe("Connect");
  });
});
