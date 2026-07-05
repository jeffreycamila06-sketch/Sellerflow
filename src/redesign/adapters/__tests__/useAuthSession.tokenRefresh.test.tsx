// REPRO + regression test for audit finding #1 (Batch C): a Supabase
// TOKEN_REFRESHED auth event (~every 50 min) for the SAME signed-in user must
// NOT flip auth status authed → loading → authed — that flip turns `authed`
// false across the async profile re-fetch, which tears down and reconnects the
// LIVE socket mid-live (comments in the gap are lost; connect chips flicker)
// and re-fires every `enabled=authed` data hook.
//
// The harness below wires the REAL useAuthSession + REAL useLiveFeed exactly
// like RedesignApp does (`useLiveFeed(auth.status === "authed", email, ...)`),
// mocking only the supabase singleton, getMyProfile, and socket.io-client. The
// recorded EVIDENCE timeline shows the full sequence.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

// ── evidence recorder ─────────────────────────────────────────────────────────
const evidence: string[] = [];

// ── socket.io mock: counts sockets created + disconnects ─────────────────────
const socketsCreated: Array<{ disconnect: ReturnType<typeof vi.fn> }> = [];
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const sock = {
      on: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(() => evidence.push("SOCKET disconnect()")),
    };
    socketsCreated.push(sock as never);
    evidence.push(`SOCKET io() created (#${socketsCreated.length})`);
    return sock;
  }),
}));

// ── supabase mock: capture the onAuthStateChange callback so the test can fire
//    TOKEN_REFRESHED exactly like supabase-js does after a token refresh ──────
type AuthCb = (event: string, session: { user: { id: string } } | null) => void;
let fireAuthEvent: AuthCb = () => {};
const SESSION = { user: { id: "user-1" } };
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: SESSION } })),
      onAuthStateChange: vi.fn((cb: AuthCb) => {
        fireAuthEvent = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  },
}));

// getMyProfile = a CONTROLLABLE deferred, modelling the real network latency
// (50–500ms in prod). Without it, the mock resolves in the same microtask and
// React 18 batches loading+authed into one render — hiding the flip that real
// latency always exposes in production.
const PROFILE = { email: "seller@x.com", plan: "basic", role: "seller", planStatus: "active", planExpiry: "", trialStartedAt: "", authUserId: "user-1", connectedAccounts: [], profile: { fullName: "S", storeName: "", phone: "", tiktok: "", facebook: "", adminContactNote: "" } };
const profileResolvers: Array<() => void> = [];
vi.mock("../../../accountDb", () => ({
  getMyProfile: vi.fn(
    () =>
      new Promise((resolve) => {
        evidence.push("getMyProfile() fetch STARTED (in flight…)");
        profileResolvers.push(() => { evidence.push("getMyProfile() resolved"); resolve(PROFILE); });
      }),
  ),
}));
const resolveProfile = async () => { await act(async () => { profileResolvers.shift()?.(); await Promise.resolve(); }); };

import { useAuthSession } from "../useAuthSession";
import { useLiveFeed } from "../useLiveFeed";

// Mirrors RedesignApp.tsx:97,169 — the live feed is enabled by `authed`.
function Harness() {
  const auth = useAuthSession();
  const authed = auth.status === "authed";
  evidence.push(`render: status=${auth.status} authed=${authed}`);
  useLiveFeed(authed, auth.profile?.email);
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { evidence.length = 0; socketsCreated.length = 0; profileResolvers.length = 0; });

describe("TOKEN_REFRESHED must not tear down the live socket (finding #1)", () => {
  it("same-user token refresh keeps authed=true and the SAME socket", async () => {
    render(<Harness />);
    await flush();
    await resolveProfile(); // boot profile fetch completes → authed → socket up
    await flush();
    // Boot: signed in, one socket up.
    expect(socketsCreated.length).toBe(1);
    const bootSocket = socketsCreated[0];

    evidence.push("--- fire TOKEN_REFRESHED (same user-1, ~every 50 min in prod) ---");
    await act(async () => { fireAuthEvent("TOKEN_REFRESHED", SESSION); });
    await flush();           // the profile re-fetch is IN FLIGHT here (real-world: 50–500ms)
    await resolveProfile();  // …then it resolves
    await flush();

    console.log("EVIDENCE TIMELINE:\n" + evidence.map((e) => `  ${e}`).join("\n"));

    // THE INVARIANT: a token refresh for the SAME user must not drop the socket.
    expect(bootSocket.disconnect).not.toHaveBeenCalled();   // socket never torn down
    expect(socketsCreated.length).toBe(1);                  // no replacement socket
    const markerIdx = evidence.findIndex((e) => e.includes("fire TOKEN_REFRESHED"));
    const authedFlipsAfterRefresh = evidence.slice(markerIdx).filter((e) => e.includes("authed=false"));
    expect(authedFlipsAfterRefresh).toEqual([]);            // authed never flipped after the refresh
  });
});
