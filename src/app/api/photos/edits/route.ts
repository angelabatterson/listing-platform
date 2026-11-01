import { getCurrentUser } from "@/lib/auth";
import { writeProblem } from "@/lib/billing/access";
import { saveEditedPhoto } from "@/lib/photos/edits";

// Saves a photo the browser edited (see lib/photos/background.ts) as a new photo.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Please log in again." }, { status: 401 });
  const blocked = await writeProblem(user);
  if (blocked) return Response.json({ error: blocked }, { status: 402 });

  const form = await request.formData();
  const source = form.get("source");
  const photo = form.get("photo");
  const thumb = form.get("thumb");
  if (typeof source !== "string" || !(photo instanceof File) || !(thumb instanceof File)) {
    return Response.json({ error: "Missing photo." }, { status: 400 });
  }
  const [data, thumbData] = await Promise.all([photo.arrayBuffer(), thumb.arrayBuffer()]).then((b) =>
    b.map((x) => Buffer.from(x)),
  );
  const result = await saveEditedPhoto(user.organizationId, source, data, thumbData);
  return Response.json(result, { status: "error" in result ? 400 : 200 });
}
