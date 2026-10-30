import "server-only";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { organizations, photos } from "@/db/schema";
import type { PhotoSize } from "./links";

// Uploaded photos are kept as files on the server, one folder per account:
// <PHOTO_DIR>/<organization id>/<photo id>.jpg and <photo id>-thumb.jpg. The default
// folder sits next to the app folder, so installing a new version doesn't remove it.
// Photos uploaded before this were stored in the database; those are read from there
// until moveDatabasePhotosToFiles has moved them.
export function photoDir(): string {
  return process.env.PHOTO_DIR || path.resolve(process.cwd(), "..", "relistic-photos");
}

const UUID = /^[0-9a-f-]{36}$/;

function fileFor(organizationId: string, photoId: string, size: PhotoSize): string {
  if (!UUID.test(organizationId) || !UUID.test(photoId)) throw new Error("Bad photo id");
  return path.join(photoDir(), organizationId, `${photoId}${size === "thumb" ? "-thumb" : ""}.jpg`);
}

export async function savePhotoFiles(organizationId: string, photoId: string, data: Buffer, thumb: Buffer) {
  await mkdir(path.join(photoDir(), organizationId), { recursive: true });
  await Promise.all([
    writeFile(fileFor(organizationId, photoId, "full"), data),
    writeFile(fileFor(organizationId, photoId, "thumb"), thumb),
  ]);
}

export async function deletePhotoFiles(organizationId: string, photoIds: string[]) {
  await Promise.all(
    photoIds.flatMap((id) => (["full", "thumb"] as const).map((size) => rm(fileFor(organizationId, id, size), { force: true }))),
  );
}

export async function deleteAccountPhotoFiles(organizationId: string) {
  if (!UUID.test(organizationId)) return;
  await rm(path.join(photoDir(), organizationId), { recursive: true, force: true });
}

type PhotoRef = { id: string; organizationId: string; data?: Buffer | null; thumb?: Buffer | null };

// The photo's bytes, or null when the file is missing.
export async function readPhoto(photo: PhotoRef, size: PhotoSize = "full"): Promise<Buffer | null> {
  const stored = size === "thumb" ? photo.thumb : photo.data;
  if (stored) return stored;
  try {
    return await readFile(fileFor(photo.organizationId, photo.id, size));
  } catch {
    return null;
  }
}

// Reads several photos, dropping any whose file is missing.
export async function readPhotos(rows: PhotoRef[], size: PhotoSize = "full"): Promise<Buffer[]> {
  const bytes = await Promise.all(rows.map((r) => readPhoto(r, size)));
  return bytes.filter((b): b is Buffer => b !== null);
}

// Moves photos still stored in the database out to files, a few at a time, so the
// database stays small. Run from the scheduled job.
export async function moveDatabasePhotosToFiles(limit = 50): Promise<number> {
  const rows = await db
    .select({ id: photos.id, organizationId: photos.organizationId, data: photos.data, thumb: photos.thumb })
    .from(photos)
    .where(isNotNull(photos.data))
    .limit(limit);
  for (const row of rows) {
    await savePhotoFiles(row.organizationId, row.id, row.data!, row.thumb ?? row.data!);
    await db.update(photos).set({ data: null, thumb: null }).where(eq(photos.id, row.id));
  }
  return rows.length;
}

// Removes files left behind by deleted photos or closed accounts. Run from the
// scheduled job, as a safety net for deletes that happen through the database alone.
export async function removeOrphanPhotoFiles(): Promise<number> {
  const dir = photoDir();
  let folders: string[];
  try {
    folders = (await readdir(dir)).filter((f) => UUID.test(f));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const organizationId of folders) {
    const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, organizationId));
    if (!org) {
      await deleteAccountPhotoFiles(organizationId);
      removed++;
      continue;
    }
    const files = await readdir(path.join(dir, organizationId)).catch(() => [] as string[]);
    const ids = [...new Set(files.map((f) => f.slice(0, 36)).filter((id) => UUID.test(id)))];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const kept = await db
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.organizationId, organizationId), inArray(photos.id, chunk)));
      const keep = new Set(kept.map((k) => k.id));
      const gone = chunk.filter((id) => !keep.has(id));
      await deletePhotoFiles(organizationId, gone);
      removed += gone.length;
    }
  }
  return removed;
}
