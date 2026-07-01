// ContactChip — parse/format helpers + render (pill / plain / placeholder) and
// inline click-to-edit save (parity with App.tsx ContactDisplay/ContactEditor).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ContactChip, { parseContact, formatContact } from "../ContactChip";
import { TProvider } from "../../i18n";

const renderChip = (note: string, onSave?: (n: string) => void) =>
  render(<TProvider lang="en"><ContactChip note={note} onSave={onSave} /></TProvider>);

describe("parseContact", () => {
  it("structured fb/telegram/line prefix → platform + name", () => {
    expect(parseContact("telegram:Cherry Go")).toEqual({ platform: "telegram", name: "Cherry Go", legacy: false });
    expect(parseContact("fb:lhey")).toEqual({ platform: "fb", name: "lhey", legacy: false });
    expect(parseContact("LINE: JuanD ")).toEqual({ platform: "line", name: "JuanD", legacy: false }); // case-insensitive + trim
  });
  it("unknown prefix / plain text → legacy (preserved as-is)", () => {
    expect(parseContact("skype:xx")).toEqual({ platform: "", name: "skype:xx", legacy: true });
    expect(parseContact("just a note")).toEqual({ platform: "", name: "just a note", legacy: true });
  });
  it("empty → blank, not legacy", () => {
    expect(parseContact("")).toEqual({ platform: "", name: "", legacy: false });
  });
});

describe("formatContact", () => {
  it("composes <platform>:<name>, plain when no platform, '' when empty", () => {
    expect(formatContact("telegram", " Cherry ")).toBe("telegram:Cherry");
    expect(formatContact("", "just text")).toBe("just text");
    expect(formatContact("fb", "   ")).toBe("");
  });
});

describe("ContactChip render", () => {
  it("structured note → pill with the name", () => {
    renderChip("telegram:Cherry Go");
    expect(screen.getByText("Cherry Go")).toBeTruthy();
  });
  it("legacy note → shows the raw text", () => {
    renderChip("call her at noon");
    expect(screen.getByText("call her at noon")).toBeTruthy();
  });
  it("empty + editable → 'add contact…' placeholder", () => {
    renderChip("", () => {});
    expect(screen.getByText("add contact…")).toBeTruthy();
  });
  it("empty + NOT editable → no placeholder (read-only)", () => {
    renderChip("");
    expect(screen.queryByText("add contact…")).toBeNull();
  });
});

describe("ContactChip inline edit", () => {
  it("click → edit mode; pick platform + type name + Enter → onSave('platform:name')", () => {
    const onSave = vi.fn();
    renderChip("", onSave);
    fireEvent.click(screen.getByText("add contact…"));       // enter edit
    fireEvent.click(screen.getByTitle("Telegram"));           // pick platform
    const input = screen.getByPlaceholderText("name / handle") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Cherry" } });
    fireEvent.keyDown(input.parentElement as HTMLElement, { key: "Enter" });
    expect(onSave).toHaveBeenCalledWith("telegram:Cherry");
  });
  it("Escape cancels without saving", () => {
    const onSave = vi.fn();
    renderChip("fb:lhey", onSave);
    fireEvent.click(screen.getByText("lhey"));                // enter edit (pill click)
    const input = screen.getByPlaceholderText("name / handle") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input.parentElement as HTMLElement, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("lhey")).toBeTruthy();            // reverted to display
  });
});
