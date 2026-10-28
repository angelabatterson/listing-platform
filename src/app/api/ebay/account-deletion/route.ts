import { NextResponse, type NextRequest } from "next/server";
import { challengeResponse } from "@/lib/marketplaces/ebay/account-deletion";

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
  // We don't store data about eBay buyers. Before launch (step 4) this will verify
  // eBay's signature and disconnect any matching seller account.
  const body = await request.json().catch(() => null);
  console.info("eBay account deletion notice", body?.notification?.notificationId);
  return new NextResponse(null, { status: 200 });
}
