import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { ETSY_STATE_COOKIE } from "@/lib/marketplaces/etsy/config";
import { buildAuthorizeUrl, createPkce } from "@/lib/marketplaces/etsy/oauth";

export async function GET() {
  await requireUser();
  const state = randomToken(16);
  const { verifier, challenge } = createPkce();
  (await cookies()).set(ETSY_STATE_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  redirect(buildAuthorizeUrl(state, challenge));
}
