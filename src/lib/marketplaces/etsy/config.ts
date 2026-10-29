export const ETSY_API = "https://api.etsy.com";
export const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";

export const ETSY_SCOPES = ["listings_r", "listings_w", "listings_d", "shops_r", "transactions_r", "transactions_w"];

export const ETSY_STATE_COOKIE = "lp_etsy_oauth";

export function etsyCredentials() {
  const keystring = process.env.ETSY_KEYSTRING;
  const sharedSecret = process.env.ETSY_SHARED_SECRET;
  if (!keystring || !sharedSecret) {
    throw new Error("Etsy keys are not configured (ETSY_KEYSTRING, ETSY_SHARED_SECRET)");
  }
  return { keystring, sharedSecret };
}

export function etsyIsConfigured(): boolean {
  return Boolean(process.env.ETSY_KEYSTRING && process.env.ETSY_SHARED_SECRET);
}

export function etsyRedirectUri(): string {
  return `${process.env.APP_URL}/api/etsy/oauth/callback`;
}

// Etsy's "when made" choices. Resellers on Etsy mostly sell vintage (20+ years old).
export const ETSY_WHEN_MADE = [
  { value: "made_to_order", label: "Made to order" },
  { value: "2020_2026", label: "2020 to 2026" },
  { value: "2010_2019", label: "2010 to 2019" },
  { value: "2007_2009", label: "2007 to 2009" },
  { value: "before_2007", label: "Before 2007" },
  { value: "2000_2006", label: "2000 to 2006" },
  { value: "1990s", label: "1990s" },
  { value: "1980s", label: "1980s" },
  { value: "1970s", label: "1970s" },
  { value: "1960s", label: "1960s" },
  { value: "1950s", label: "1950s" },
  { value: "1940s", label: "1940s" },
  { value: "1930s", label: "1930s" },
  { value: "1920s", label: "1920s" },
  { value: "1910s", label: "1910s" },
  { value: "1900s", label: "1900s" },
  { value: "1800s", label: "1800s" },
  { value: "1700s", label: "1700s" },
  { value: "before_1700", label: "Before 1700" },
] as const;

export const ETSY_WHO_MADE = [
  { value: "someone_else", label: "Another company or person" },
  { value: "i_did", label: "I did" },
  { value: "collective", label: "A member of my shop" },
] as const;
