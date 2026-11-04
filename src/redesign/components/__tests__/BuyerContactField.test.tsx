// The shared picker (owner-approved UI): six round platform buttons on the label line
// (selected = ring, others dimmed; 34 px, 32 px at ≤390), one input with the platform tag
// inside + per-platform placeholder, the WhatsApp error, the LINE digits hint, "Buyer has
// no contact" (ticking clears; typing un-ticks).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { TProvider } from "../../i18n";
import BuyerContactField from "../BuyerContactField";
import type { BuyerContactPlatform } from "../../adapters/buyerContact";

function Host({ init = "tiktok" as BuyerContactPlatform, onSave }: { init?: BuyerContactPlatform; onSave?: (p: BuyerContactPlatform, v: string, none: boolean) => void }) {
  const [p, setP] = useState<BuyerContactPlatform>(init);
  const [v, setV] = useState("");
  const [none, setNone] = useState(false);
  return (
    <TProvider lang="en">
      <BuyerContactField platform={p} onPlatform={setP} value={v} onValue={setV} noContact={none} onNoContact={setNone} testId="t" inputId="t-input" />
      <button onClick={() => onSave?.(p, v, none)}>save</button>
    </TProvider>
  );
}
const setWidth = (w: number) => { Object.defineProperty(window, "innerWidth", { configurable: true, value: w }); };

beforeEach(() => { cleanup(); setWidth(412); });

describe("BuyerContactField", () => {
  it("six platforms in the approved order, TikTok selected by default, selection = ring + dimming", () => {
    const r = render(<Host />);
    const picks = r.getAllByRole("radio");
    expect(picks.map((b) => b.getAttribute("data-testid"))).toEqual(["t-pick-tiktok", "t-pick-line", "t-pick-whatsapp", "t-pick-facebook", "t-pick-instagram", "t-pick-other"]);
    expect(r.getByTestId("t-pick-tiktok").getAttribute("aria-checked")).toBe("true");
    expect(r.getByTestId("t-pick-line").getAttribute("aria-checked")).toBe("false");
    expect((r.getByTestId("t-pick-line") as HTMLElement).style.opacity).toBe("0.42");
    expect((r.getByTestId("t-pick-tiktok") as HTMLElement).style.boxShadow).toContain("var(--accent)");
    expect((r.getByTestId("t-pick-tiktok") as HTMLElement).style.width).toBe("34px");
    expect(r.getByTestId("t-tag").textContent).toBe("TikTok");
    expect((r.getByTestId("t-input") as HTMLInputElement).placeholder).toBe("@username");
  });
  it("32 px icons at ≤390 px (never wraps)", () => {
    setWidth(390);
    const r = render(<Host />);
    expect((r.getByTestId("t-pick-tiktok") as HTMLElement).style.width).toBe("32px");
  });
  it("picking a platform changes the tag, placeholder, hint and keyboard", () => {
    const r = render(<Host />);
    fireEvent.click(r.getByTestId("t-pick-whatsapp"));
    expect(r.getByTestId("t-tag").textContent).toBe("WhatsApp");
    expect((r.getByTestId("t-input") as HTMLInputElement).placeholder).toBe("+886 912 345 678");
    expect((r.getByTestId("t-input") as HTMLInputElement).inputMode).toBe("tel");
    expect(r.container.textContent).toContain("Taiwan 09… works");
    fireEvent.click(r.getByTestId("t-pick-line"));
    expect((r.getByTestId("t-input") as HTMLInputElement).placeholder).toBe("LINE ID");
    expect(r.container.textContent).not.toContain("LINE ID (not the phone number)");   // hint only once digits are typed
    fireEvent.change(r.getByTestId("t-input"), { target: { value: "0912345678" } });
    expect(r.container.textContent).toContain("LINE ID (not the phone number)");
    fireEvent.click(r.getByTestId("t-pick-facebook"));
    expect((r.getByTestId("t-input") as HTMLInputElement).placeholder).toBe("Name or profile link");
    fireEvent.click(r.getByTestId("t-pick-other"));
    expect(r.getByTestId("t-tag").textContent).toBe("…");
  });
  it("WhatsApp: an invalid number shows the error (aria-invalid); a valid one clears it", () => {
    const r = render(<Host />);
    fireEvent.click(r.getByTestId("t-pick-whatsapp"));
    fireEvent.change(r.getByTestId("t-input"), { target: { value: "12345" } });
    expect(r.getByTestId("t-err").textContent).toBe("Enter a valid phone number (8–15 digits)");
    expect(r.getByTestId("t-input").getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(r.getByTestId("t-input"), { target: { value: "0912345678" } });
    expect(r.queryByTestId("t-err")).toBeNull();
    expect(r.getByTestId("t-input").getAttribute("aria-invalid")).toBe("false");
  });
  it("'max 50' hint when the saved value would be cut; not for a Facebook link, a 50-char value or 'no contact'", () => {
    const r = render(<Host init="other" />);
    const input = r.getByTestId("t-input");
    fireEvent.change(input, { target: { value: "x".repeat(50) } });
    expect(r.queryByTestId("t-max")).toBeNull();
    fireEvent.change(input, { target: { value: "x".repeat(51) } });
    expect(r.getByTestId("t-max").textContent).toBe("Max 50 characters — only the first 50 are saved");
    fireEvent.click(r.getByTestId("t-pick-facebook"));
    fireEvent.change(input, { target: { value: "https://www.facebook.com/profile.php?id=100012345678901&x=".padEnd(70, "y") } });
    expect(r.queryByTestId("t-max")).toBeNull(); // a link is shortened to fb:<id>, nothing is cut
    fireEvent.change(input, { target: { value: "https://www.facebook.com/share/1AbCdEfGh/" } });
    expect(r.getByTestId("t-err").textContent).toBe("Open the buyer's profile and copy that link — share links can't be used.");
    expect(r.getByTestId("t-input").getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "x".repeat(60) } }); // a typed 60-char name IS cut
    expect(r.getByTestId("t-max")).toBeTruthy();
    fireEvent.click(r.getByTestId("t-none"));
    expect(r.queryByTestId("t-max")).toBeNull();
  });
  it("'Buyer has no contact' clears + dims the input; typing un-ticks it; 300-char raw cap (the 50 limit is on the saved value)", () => {
    const onSave = vi.fn();
    const r = render(<Host onSave={onSave} />);
    fireEvent.change(r.getByTestId("t-input"), { target: { value: "@maria" } });
    fireEvent.click(r.getByTestId("t-none"));
    expect((r.getByTestId("t-none") as HTMLInputElement).checked).toBe(true);
    expect((r.getByTestId("t-input") as HTMLInputElement).value).toBe("");
    expect((r.getByTestId("t-input") as HTMLElement).style.opacity).toBe("0.5");
    fireEvent.change(r.getByTestId("t-input"), { target: { value: "x" } });
    expect((r.getByTestId("t-none") as HTMLInputElement).checked).toBe(false);
    fireEvent.change(r.getByTestId("t-input"), { target: { value: "y".repeat(80) } });
    expect((r.getByTestId("t-input") as HTMLInputElement).value).toHaveLength(80); // not cut before normalising
    expect(r.getByTestId("t-input").getAttribute("maxlength")).toBe("300");
    fireEvent.change(r.getByTestId("t-input"), { target: { value: "y".repeat(350) } });
    expect((r.getByTestId("t-input") as HTMLInputElement).value).toHaveLength(300);
    fireEvent.click(r.getByText("save"));
    expect(onSave).toHaveBeenCalledWith("tiktok", "y".repeat(300), false);
  });
});
