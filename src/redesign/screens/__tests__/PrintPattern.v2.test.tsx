// LIVE layout v2 (admin preview): time under the date, comment full width, two sample
// test prints. Hidden entirely when the layout is off (sellers see today's screen).
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TProvider } from "../../i18n";
import PrintPattern, { DEFAULT_PP, V2_SAMPLE_LATIN, V2_SAMPLE_CJK } from "../PrintPattern";

const view = (props: Partial<Parameters<typeof PrintPattern>[0]> = {}) =>
  render(<TProvider lang="en"><PrintPattern onBack={() => {}} pp={DEFAULT_PP} onToggle={() => {}} onStep={() => {}} {...props} /></TProvider>);

describe("PrintPattern — LIVE layout v2 preview", () => {
  it("off (sellers): today's preview, no v2 time/comment, no sample buttons", () => {
    const v = view();
    expect(v.queryByTestId("pp-v2-time")).toBeNull();
    expect(v.queryByTestId("pp-v2-comment")).toBeNull();
    expect(v.queryByTestId("pp-v2-tests")).toBeNull();
    expect(v.getByText("Comment")).toBeTruthy();
  });
  it("on (admin): time under the date, long comment full width, sample test prints send the samples", () => {
    const onSample = vi.fn();
    const v = view({ layoutV2: true, onTestPrintSample: onSample });
    expect(v.getByTestId("pp-v2-time").textContent).toBe("14:05");
    expect(v.getByTestId("pp-v2-comment").textContent).toBe(V2_SAMPLE_CJK);
    fireEvent.click(v.getByTestId("pp-v2-test-latin"));
    fireEvent.click(v.getByTestId("pp-v2-test-cjk"));
    expect(onSample.mock.calls).toEqual([[V2_SAMPLE_LATIN], [V2_SAMPLE_CJK]]);
  });
});
