import { eq } from "drizzle-orm";
import { db } from "@/db";
import { photos } from "@/db/schema";
import { parsePhotoFileName } from "@/lib/photos/links";

// Public, signed photo links. eBay and Etsy download listing photos from here.
export async function GET(_request: Request, ctx: RouteContext<"/api/photos/[file]">) {
  const { file } = await ctx.params;
  const parsed = parsePhotoFileName(file);
  if (!parsed) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({ bytes: parsed.size === "thumb" ? photos.thumb : photos.data })
    .from(photos)
    .where(eq(photos.id, parsed.photoId));
  if (!row) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(row.bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
