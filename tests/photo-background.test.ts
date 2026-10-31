import { describe, expect, it } from "vitest";
import { relisticPhotoFile } from "@/lib/photos/background";

describe("which photos can have their background removed", () => {
  const file = `${"a".repeat(8)}-${"b".repeat(4)}-${"c".repeat(4)}-${"d".repeat(4)}-${"e".repeat(12)}-${"S".repeat(22)}.jpg`;

  it("accepts Relistic's own full-size photo links", () => {
    expect(relisticPhotoFile(`https://app.getrelistic.com/api/photos/${file}`)).toBe(file);
  });

  it("skips thumbnails, other sites and text that isn't a link", () => {
    expect(relisticPhotoFile(`https://app.getrelistic.com/api/photos/${file.replace(".jpg", "-thumb.jpg")}`)).toBeNull();
    expect(relisticPhotoFile("https://i.ebayimg.com/images/g/abc/s-l1600.jpg")).toBeNull();
    expect(relisticPhotoFile("not a link")).toBeNull();
  });
});
