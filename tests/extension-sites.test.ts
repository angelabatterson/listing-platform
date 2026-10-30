import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { EXTENSION_MARKETPLACES } from "@/lib/marketplaces/labels";

type Site = {
  domain: string;
  signInCookies: string[];
  createUrl: string;
  editUrl: (t: { remoteListingId?: string; remoteUrl?: string }) => string | undefined;
  listingFromUrl: (url: URL) => { remoteListingId: string; url: string } | null;
  isFormPage: (url: URL) => boolean;
};

// sites.js is a plain browser script, so run it the way the extension loads it.
const sites: Record<string, Site> = runInNewContext(
  `${readFileSync(new URL("../extension/sites.js", import.meta.url), "utf8")}; RELISTIC_SITES`,
);

describe("extension store pages", () => {
  it("knows every extension store", () => {
    expect(Object.keys(sites).sort()).toEqual([...EXTENSION_MARKETPLACES].sort());
    for (const site of Object.values(sites)) {
      expect(site.isFormPage(new URL(site.createUrl))).toBe(true);
      expect(new URL(site.createUrl).hostname.endsWith(site.domain)).toBe(true);
      expect(site.signInCookies.length).toBeGreaterThan(0);
    }
  });

  it("reads a Grailed listing link, but not its edit page", () => {
    const grailed = sites.grailed;
    expect(grailed.listingFromUrl(new URL("https://www.grailed.com/listings/12345678-levis-denim-jacket"))).toEqual({
      remoteListingId: "12345678",
      url: "https://www.grailed.com/listings/12345678",
    });
    const edit = new URL(grailed.editUrl({ remoteListingId: "12345678" })!);
    expect(edit.pathname).toBe("/listings/12345678/edit");
    expect(grailed.listingFromUrl(edit)).toBeNull();
    expect(grailed.isFormPage(edit)).toBe(true);
    expect(grailed.isFormPage(new URL("https://www.grailed.com/listings/12345678-levis-denim-jacket"))).toBe(false);
  });
});
