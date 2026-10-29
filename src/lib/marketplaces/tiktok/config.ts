export const TIKTOK_API = "https://open-api.tiktokglobalshop.com";
export const TIKTOK_AUTH_API = "https://auth.tiktok-shops.com";
// Where US sellers authorize an app. Other regions use services.tiktokshop.com.
export const TIKTOK_AUTHORIZE_URL = "https://services.us.tiktokshop.com/open/authorize";

// The dated API version used for every Shop API path.
export const TIKTOK_VERSION = "202309";

export const TIKTOK_STATE_COOKIE = "lp_tiktok_oauth";

// Used when the seller hasn't set a usual package weight on the Stores page.
export const DEFAULT_PACKAGE_WEIGHT_LB = 1;

export function tiktokCredentials() {
  const appId = process.env.TIKTOK_APP_ID;
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appId || !appKey || !appSecret) {
    throw new Error("TikTok Shop keys are not configured (TIKTOK_APP_ID, TIKTOK_APP_KEY, TIKTOK_APP_SECRET)");
  }
  return { appId, appKey, appSecret };
}

export function tiktokIsConfigured(): boolean {
  return Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET);
}
