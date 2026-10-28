import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { EBAY_STATE_COOKIE } from "@/lib/marketplaces/ebay/config";
import { buildAuthorizeUrl } from "@/lib/marketplaces/ebay/oauth";


export async function GET() {
  await requireUser();
  const state = randomToken(16);
  (await cookies()).set(EBAY_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  redirect(buildAuthorizeUrl(state));
}
