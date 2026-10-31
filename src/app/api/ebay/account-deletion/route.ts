import { NextResponse, type NextRequest } from "next/server";
import { challengeResponse, forgetEbayUser, isFromEbay } from "@/lib/marketplaces/ebay/account-deletion";

// eBay's Marketplace Account Deletion endpoint, required before eBay issues production keys.
// GET answers eBay's verification challenge. POST receives deletion notices.

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("challenge_code");
  const token = process.env.EBAY_DELETION_VERIFICATION_TOKEN;
  const endpoint = process.env.EBAY_DELETION_ENDPOINT_URL;
  if (!code || !token || !endpoint) return NextResponse.json({ error: "not configured" }, { status: 400 });
  return NextResponse.json({ challengeResponse: challengeResponse(code, token, endpoint) });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  let fromEbay: boolean;
  try {
    fromEbay = await isFromEbay(raw, request.headers.get("x-ebay-signature"));
  } catch (error) {
    // eBay retries when it doesn't get a 2xx, so a key lookup that failed is tried again later.
    console.error("eBay account deletion: couldn't check the signature", error);
    return new NextResponse(null, { status: 500 });
  }
  if (!fromEbay) return new NextResponse(null, { status: 412 });

  let data: { username?: string; userId?: string } | undefined;
  try {
    data = JSON.parse(raw)?.notification?.data;
  } catch {
    data = undefined;
  }
  if (data) await forgetEbayUser({ username: data.username, userId: data.userId });
  return new NextResponse(null, { status: 204 });
}
