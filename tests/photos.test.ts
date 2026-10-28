import { describe, expect, it } from "vitest";
import { isJpeg, parsePhotoFileName, photoFileName, photoUrl } from "@/lib/photos/links";
import { eachLimited, scaledSize } from "@/lib/photos/resize";

const id = "3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b";

describe("signed photo links", () => {
  it("round-trips full and thumbnail links", () => {
    expect(parsePhotoFileName(photoFileName(id))).toEqual({ photoId: id, size: "full" });
    expect(parsePhotoFileName(photoFileName(id, "thumb"))).toEqual({ photoId: id, size: "thumb" });
    expect(photoUrl(id)).toMatch(/^https:\/\/app\.example\/api\/photos\/.+\.jpg$/);
  });

  it("rejects a guessed or altered link", () => {
    const other = "3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6c";
    const sig = photoFileName(id).split("-").slice(5).join("-");
    expect(parsePhotoFileName(`${other}-${sig}`)).toBeNull();
    expect(parsePhotoFileName(`${id}-${"A".repeat(22)}.jpg`)).toBeNull();
    expect(parsePhotoFileName(`${id}.jpg`)).toBeNull();
  });

  it("recognises JPEG bytes", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe("resizing", () => {
  it("shrinks the longest edge and never enlarges", () => {
    expect(scaledSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(scaledSize(3000, 4000, 400)).toEqual({ width: 300, height: 400 });
    expect(scaledSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("runs uploads a few at a time", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      running--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
