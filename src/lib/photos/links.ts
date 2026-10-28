import { createHmac, timingSafeEqual } from "node:crypto";
import { encryptionKey } from "@/lib/crypto";

export type PhotoSize = "full" | "thumb";

function signature(photoId: string): string {
  return createHmac("sha256", encryptionKey()).update(`photo:${photoId}`).digest("base64url").slice(0, 22);
}

// Marketplaces fetch listing photos by URL, so each photo gets a public link that
// can't be guessed: "<id>-<signature>.jpg", or "-thumb.jpg" for the small copy.
export function photoFileName(photoId: string, size: PhotoSize = "full"): string {
  return `${photoId}-${signature(photoId)}${size === "thumb" ? "-thumb" : ""}.jpg`;
}

export function photoUrl(photoId: string, size: PhotoSize = "full"): string {
  return `${process.env.APP_URL}/api/photos/${photoFileName(photoId, size)}`;
}

const FILE_PATTERN = /^([0-9a-f-]{36})-([A-Za-z0-9_-]{22})(-thumb)?\.jpg$/;

export function parsePhotoFileName(file: string): { photoId: string; size: PhotoSize } | null {
  const match = FILE_PATTERN.exec(file);
  if (!match) return null;
  const [, photoId, sig, thumb] = match;
  const expected = Buffer.from(signature(photoId));
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { photoId, size: thumb ? "thumb" : "full" };
}

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
