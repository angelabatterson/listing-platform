import { sha256Hex } from "@/lib/crypto";

// eBay verifies the endpoint by sending ?challenge_code=... and expecting
// SHA-256(challengeCode + verificationToken + endpointUrl) back, hex-encoded.
export function challengeResponse(challengeCode: string, verificationToken: string, endpointUrl: string) {
  return sha256Hex(challengeCode + verificationToken + endpointUrl);
}
