import { describe, expect, it } from "vitest";
import { isSafePublicUrl } from "@/lib/safe-url";

describe("isSafePublicUrl", () => {
  it("allows public https links", () => {
    expect(isSafePublicUrl("https://i.ebayimg.com/images/g/abc/s-l1600.jpg")).toBe(true);
    expect(isSafePublicUrl("https://8.8.8.8/photo.jpg")).toBe(true);
  });

  it("refuses http, credentials, and internal hosts", () => {
    for (const url of [
      "http://example.com/a.jpg",
      "https://user:pw@example.com/a.jpg",
      "https://localhost/a.jpg",
      "https://intranet/a.jpg",
      "https://printer.local/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://10.1.2.3/a.jpg",
      "https://172.20.0.1/a.jpg",
      "https://192.168.1.1/a.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/a.jpg",
      "https://[fd00::1]/a.jpg",
      "not a url",
    ]) {
      expect(isSafePublicUrl(url), url).toBe(false);
    }
  });
});
