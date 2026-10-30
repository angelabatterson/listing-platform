import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { batches, organizations, photos } from "@/db/schema";
import {
  moveDatabasePhotosToFiles,
  photoDir,
  readPhoto,
  removeOrphanPhotoFiles,
  savePhotoFiles,
} from "@/lib/photos/store";

const jpeg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, n]);

// Runs against a real Postgres when TEST_DATABASE_URL is set (see README).
describe.runIf(process.env.TEST_DATABASE_URL)("photo files on the server", () => {
  let org: string;
  let batchId: string;

  beforeEach(async () => {
    await db.delete(organizations);
    await rm(photoDir(), { recursive: true, force: true });
    [{ id: org }] = await db.insert(organizations).values({ name: "Mine" }).returning();
    [{ id: batchId }] = await db.insert(batches).values({ organizationId: org, number: 1 }).returning();
  });

  afterAll(async () => {
    await db.delete(organizations);
    await rm(photoDir(), { recursive: true, force: true });
  });

  it("reads a photo from its files, or from the database for older uploads", async () => {
    const [onDisk] = await db.insert(photos).values({ organizationId: org, batchId, position: 0 }).returning();
    await savePhotoFiles(org, onDisk.id, jpeg(1), jpeg(2));
    expect(await readPhoto(onDisk)).toEqual(jpeg(1));
    expect(await readPhoto(onDisk, "thumb")).toEqual(jpeg(2));

    const [old] = await db.insert(photos).values({ organizationId: org, batchId, position: 1, data: jpeg(3), thumb: jpeg(4) }).returning();
    expect(await readPhoto(old, "thumb")).toEqual(jpeg(4));
    expect(await readPhoto({ id: crypto.randomUUID(), organizationId: org })).toBeNull();
  });

  it("moves older photos out of the database", async () => {
    const [old] = await db.insert(photos).values({ organizationId: org, batchId, position: 0, data: jpeg(3), thumb: jpeg(4) }).returning();
    expect(await moveDatabasePhotosToFiles()).toBe(1);
    const [row] = await db.select().from(photos).where(eq(photos.id, old.id));
    expect(row).toMatchObject({ data: null, thumb: null });
    expect(await readPhoto(row)).toEqual(jpeg(3));
    expect(await readPhoto(row, "thumb")).toEqual(jpeg(4));
    expect(await moveDatabasePhotosToFiles()).toBe(0);
  });

  it("removes files of deleted photos and closed accounts", async () => {
    const [kept] = await db.insert(photos).values({ organizationId: org, batchId, position: 0 }).returning();
    await savePhotoFiles(org, kept.id, jpeg(1), jpeg(2));
    const deleted = crypto.randomUUID();
    await savePhotoFiles(org, deleted, jpeg(1), jpeg(2));
    const closedOrg = crypto.randomUUID();
    await savePhotoFiles(closedOrg, crypto.randomUUID(), jpeg(1), jpeg(2));

    await removeOrphanPhotoFiles();
    expect(existsSync(path.join(photoDir(), org, `${kept.id}.jpg`))).toBe(true);
    expect(existsSync(path.join(photoDir(), org, `${deleted}.jpg`))).toBe(false);
    expect(existsSync(path.join(photoDir(), org, `${deleted}-thumb.jpg`))).toBe(false);
    expect(existsSync(path.join(photoDir(), closedOrg))).toBe(false);
  });
});
