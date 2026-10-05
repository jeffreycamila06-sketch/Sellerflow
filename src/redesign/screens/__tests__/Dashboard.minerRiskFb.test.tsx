// Miner-risk chip ("?" / CHECK / NEW) is never shown for Facebook comments — Facebook gives no
// follower count, so every FB comment would read "?". TikTok behaviour is unchanged.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { TProvider } from "../../i18n";

vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import { buildMinerRiskMap, minerRiskKey, type RiskLevel } from "../../adapters/minerRisk";
import type { Comment } from "../../data";

const comment = (handle: string, platform: string): Comment =>
  ({ id: `${platform}-${handle}`, name: handle, handle: `@${handle}`, text: "mine", mine: true, time: "9:41:00 PM", platform });

const noop = () => {};
const renderFeed = (comments: Comment[], minerRisk: Map<string, RiskLevel>) => render(
  <TProvider lang="en">
    <Dashboard {...({
      comments, cur: "NT$", minerRisk,
      ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
      onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
      ttConnected: false, fbConnected: false, ttConnecting: false, fbConnecting: false,
      onConnectTT: noop, onConnectFB: noop,
      printed: {}, entId: null, entPrice: "",
      onOneClick: noop, onOpenEnt: noop, onEntPrice: noop, onEntKey: noop,
    } as unknown as ComponentProps<typeof Dashboard>)} />
  </TProvider>,
);
const chips = () => [...document.querySelectorAll("[data-testid='miner-risk']")] as HTMLElement[];

describe("miner-risk chip per platform", () => {
  it("a Facebook comment (no follower data) renders no miner-risk chip", () => {
    const fb = comment("ben", "Facebook");
    const map = buildMinerRiskMap([fb]);
    expect(map.get(minerRiskKey(fb.handle, fb.platform))).toBe("unknown"); // the map still says "?"
    renderFeed([fb], map);
    expect(chips()).toHaveLength(0);
  });
  it("a Facebook comment never shows a chip, even when the map holds a level for it", () => {
    const fb = comment("ben", "Facebook");
    renderFeed([fb], new Map<string, RiskLevel>([[minerRiskKey(fb.handle, fb.platform), "risky"]]));
    expect(chips()).toHaveLength(0);
  });
  it("a TikTok comment with no follower data still renders \"?\"", () => {
    const tt = comment("maria", "TikTok");
    const fb = comment("ben", "Facebook");
    renderFeed([tt, fb], buildMinerRiskMap([tt, fb]));
    const c = chips();
    expect(c).toHaveLength(1);
    expect(c[0].dataset.level).toBe("unknown");
    expect(c[0].textContent).toBe("?");
  });
});
