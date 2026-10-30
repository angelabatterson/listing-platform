import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { batches, photos } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getAccess, writeProblem } from "@/lib/billing/access";
import { MAX_PHOTO_BYTES, MAX_THUMB_BYTES } from "@/lib/photos/limits";
import { isJpeg, photoUrl } from "@/lib/photos/links";

// One photo per request. The browser has already resized it and made the thumbnail,
// so each request stays well under hosting body-size limits.
export async function POST(request: Request, ctx: RouteContext<"/api/batches/[id]/photos">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please log in again." }, { status: 401 });
  const blocked = await writeProblem(user);
  if (blocked) return Response.json({ error: blocked }, { status: 402 });
  const { id } = await ctx.params;

  const batch = await db.query.batches.findFirst({
    where: and(eq(batches.id, id), eq(batches.organizationId, user.organizationId)),
    columns: { id: true },
  });
  if (!batch) return Response.json({ error: "Batch not found." }, { status: 404 });

  const form = await request.formData();
  const photo = form.get("photo");
  const thumb = form.get("thumb");
  if (!(photo instanceof File) || !(thumb instanceof File)) {
    return Response.json({ error: "Missing photo." }, { status: 400 });
  }
  const [data, thumbData] = await Promise.all([photo.arrayBuffer(), thumb.arrayBuffer()]).then((b) =>
    b.map((x) => Buffer.from(x)),
  );
  if (!isJpeg(data) || !isJpeg(thumbData) || data.length > MAX_PHOTO_BYTES || thumbData.length > MAX_THUMB_BYTES) {
    return Response.json({ error: `${photo.name || "A photo"} couldn't be read as an image.` }, { status: 400 });
  }

  const [{ n }] = await db.select({ n: count() }).from(photos).where(eq(photos.batchId, batch.id));
  const { photosPerBatch } = (await getAccess(user)).limits;
  if (n >= photosPerBatch) {
    return Response.json({ error: `Your plan allows up to ${photosPerBatch} photos per batch. Start a new batch for the rest.` }, { status: 400 });
  }

  const [saved] = await db
    .insert(photos)
    .values({
      organizationId: user.organizationId,
      batchId: batch.id,
      position: Number(form.get("position") ?? n),
      fileName: photo.name || null,
      data,
      thumb: thumbData,
    })
    .returning({ id: photos.id });
  return Response.json({ id: saved.id, thumbUrl: photoUrl(saved.id, "thumb") });
}
