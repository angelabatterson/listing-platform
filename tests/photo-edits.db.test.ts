import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { batches, organizations, photos } from "@/db/schema";
import { saveEditedPhoto } from "@/lib/photos/edits";
import { parsePhotoFileName, photoFileName } from "@/lib/photos/links";
import { photoDir, readPhoto } from "@/lib/photos/store";

const jpeg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, n]);

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("saving an edited photo", () => {
  let org: string;
  let source: typeof photos.$inferSelect;

  beforeEach(async () => {
    await db.delete(organizations);
    await rm(photoDir(), { recursive: true, force: true });
    [{ id: org }] = await db.insert(organizations).values({ name: "Mine" }).returning();
    const [batch] = await db.insert(batches).values({ organizationId: org, number: 1 }).returning();
    [source] = await db
      .insert(photos)
      .values({ organizationId: org, batchId: batch.id, position: 3, groupKey: 2, fileName: "IMG_1.jpg" })
      .returning();
  });

  afterAll(async () => {
    await db.delete(organizations);
    await rm(photoDir(), { recursive: true, force: true });
  });

  it("saves the edit as a new photo next to the original, with its own link", async () => {
    const result = await saveEditedPhoto(org, photoFileName(source.id), jpeg(1), jpeg(2));
    if ("error" in result) throw new Error(result.error);
    const file = result.url.split("/").pop()!;
    const parsed = parsePhotoFileName(file);
    expect(parsed?.photoId).not.toBe(source.id);
    const [copy] = await db.select().from(photos).where(eq(photos.id, parsed!.photoId));
    expect(copy).toMatchObject({ batchId: source.batchId, position: 3, groupKey: 2, fileName: "IMG_1.jpg" });
    expect(await readPhoto(copy)).toEqual(jpeg(1));
    expect(await readPhoto(copy, "thumb")).toEqual(jpeg(2));
    expect(await db.select().from(photos)).toHaveLength(2);
  });

  it("refuses another account's photo, a forged link, or a file that isn't a JPEG", async () => {
    const [other] = await db.insert(organizations).values({ name: "Other" }).returning();
    expect(await saveEditedPhoto(other.id, photoFileName(source.id), jpeg(1), jpeg(2))).toHaveProperty("error");
    expect(await saveEditedPhoto(org, `${source.id}-${"x".repeat(22)}.jpg`, jpeg(1), jpeg(2))).toHaveProperty("error");
    expect(await saveEditedPhoto(org, photoFileName(source.id), Buffer.from("png"), jpeg(2))).toHaveProperty("error");
    expect(await db.select().from(photos)).toHaveLength(1);
  });
});
