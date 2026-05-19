import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.sellerflow.live",
  appName: "SellerFlow",
  webDir: "www",
  server: {
    url: "https://sellerflowlive.com",
    cleartext: false,
    androidScheme: "https"
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: "#f5f3ef",
      androidScaleType: "CENTER_CROP",
      showSpinner: false
    }
  }
};

export default config;
