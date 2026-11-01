import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { MAX_PHOTO_BYTES, MAX_THUMB_BYTES } from "./limits";
import { isJpeg, parsePhotoFileName, photoUrl } from "./links";
import { deletePhotoFiles, savePhotoFiles } from "./store";

// Saves an edited copy of one of the account's photos (for example with its background
// removed) as a new photo next to the original, which is kept so the edit can be undone.
// A new photo gets a new link, so stores and browsers don't show a cached old version.
export async function saveEditedPhoto(
  organizationId: string,
  sourceFile: string,
  data: Buffer,
  thumb: Buffer,
): Promise<{ url: string; thumbUrl: string } | { error: string }> {
  const parsed = parsePhotoFileName(sourceFile);
  if (!parsed) return { error: "Only photos uploaded to Relistic can be edited." };
  const source = await db.query.photos.findFirst({
    where: and(eq(photos.id, parsed.photoId), eq(photos.organizationId, organizationId)),
  });
  if (!source) return { error: "Only photos uploaded to Relistic can be edited." };
  if (!isJpeg(data) || !isJpeg(thumb) || data.length > MAX_PHOTO_BYTES || thumb.length > MAX_THUMB_BYTES) {
    return { error: "The edited photo couldn't be read as an image." };
  }

  const photoId = randomUUID();
  await savePhotoFiles(organizationId, photoId, data, thumb);
  try {
    await db.insert(photos).values({
      id: photoId,
      organizationId,
      batchId: source.batchId,
      itemId: source.itemId,
      groupKey: source.groupKey,
      position: source.position,
      fileName: source.fileName,
    });
  } catch (err) {
    await deletePhotoFiles(organizationId, [photoId]);
    throw err;
  }
  return { url: photoUrl(photoId), thumbUrl: photoUrl(photoId, "thumb") };
}
