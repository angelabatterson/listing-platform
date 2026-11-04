import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { writeProblem } from "@/lib/billing/access";
import { MAX_PHOTO_BYTES, MAX_THUMB_BYTES } from "@/lib/photos/limits";
import { isJpeg, photoUrl } from "@/lib/photos/links";
import { deletePhotoFiles, savePhotoFiles } from "@/lib/photos/store";
import { canUse } from "@/lib/team";

// A photo added straight to an item (dragged onto its photos), outside any batch. The
// browser has already resized it; the item keeps it once the seller presses Save.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please log in again." }, { status: 401 });
  if (!canUse(user, "items") && !canUse(user, "batches")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const blocked = await writeProblem(user);
  if (blocked) return Response.json({ error: blocked }, { status: 402 });

  const form = await request.formData();
  const photo = form.get("photo");
  const thumb = form.get("thumb");
  if (!(photo instanceof File) || !(thumb instanceof File)) return Response.json({ error: "Missing photo." }, { status: 400 });
  const [data, thumbData] = await Promise.all([photo.arrayBuffer(), thumb.arrayBuffer()]).then((b) => b.map((x) => Buffer.from(x)));
  if (!isJpeg(data) || !isJpeg(thumbData) || data.length > MAX_PHOTO_BYTES || thumbData.length > MAX_THUMB_BYTES) {
    return Response.json({ error: `${photo.name || "A photo"} couldn't be read as an image.` }, { status: 400 });
  }

  const photoId = randomUUID();
  await savePhotoFiles(user.organizationId, photoId, data, thumbData);
  try {
    await db.insert(photos).values({ id: photoId, organizationId: user.organizationId, position: 0, fileName: photo.name || null });
  } catch (err) {
    await deletePhotoFiles(user.organizationId, [photoId]);
    throw err;
  }
  return Response.json({ url: photoUrl(photoId) });
}
