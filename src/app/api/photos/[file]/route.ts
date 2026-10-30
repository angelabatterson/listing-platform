import { eq } from "drizzle-orm";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { parsePhotoFileName } from "@/lib/photos/links";
import { readPhoto } from "@/lib/photos/store";

// Public, signed photo links. eBay and Etsy download listing photos from here.
export async function GET(_request: Request, ctx: RouteContext<"/api/photos/[file]">) {
  const { file } = await ctx.params;
  const parsed = parsePhotoFileName(file);
  if (!parsed) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({ id: photos.id, organizationId: photos.organizationId, data: photos.data, thumb: photos.thumb })
    .from(photos)
    .where(eq(photos.id, parsed.photoId));
  const bytes = row && (await readPhoto(row, parsed.size));
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
