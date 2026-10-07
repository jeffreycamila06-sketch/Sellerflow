// Settings → channel row: which screen opens. Facebook goes straight to the real
// authorize/remove screen ("fbpages") for accounts with Facebook on; everyone else
// keeps the old Facebook username screen ("fbchannels"). TikTok is unchanged.
export type ChannelScreen = "ttchannels" | "fbchannels" | "fbpages";

export function settingsChannelScreen(platform: "tiktok" | "facebook", fbEnabled: boolean): ChannelScreen {
  if (platform === "tiktok") return "ttchannels";
  return fbEnabled ? "fbpages" : "fbchannels";
}
