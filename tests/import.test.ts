import { afterEach, describe, expect, it, vi } from "vitest";
import { ebayAdapter } from "@/lib/marketplaces/ebay/adapter";
import { fetchActiveEbayListings, fromTradingItem, htmlToText } from "@/lib/marketplaces/ebay/trading";
import { fromEtsyListing } from "@/lib/marketplaces/etsy/listings";
import { makeConnection, makeItem, makeListing } from "./fixtures";

describe("reading eBay listings", () => {
  it("turns a description's HTML into plain text", () => {
    expect(htmlToText("<style>p{}</style><p>Levi&#39;s jacket</p><ul><li>Size M</li><li>Blue &amp; white</li></ul>Ships<br>fast")).toBe(
      "Levi's jacket\n\n- Size M\n- Blue & white\nShips\nfast",
    );
  });

  it("maps a Trading API item, leaving out multi-variation listings", () => {
    const l = fromTradingItem({
      ItemID: "1234",
      Title: "Denim &amp; lace jacket",
      SKU: " J-1 ",
      Quantity: "3",
      SellingStatus: { CurrentPrice: "45.5", QuantitySold: "1" },
      ConditionID: "3000",
      PrimaryCategory: { CategoryID: "57988" },
      PictureDetails: { PictureURL: ["https://i.ebayimg.com/1.jpg", "http://old.example/2.jpg"] },
      ItemSpecifics: { NameValueList: [{ Name: "Brand", Value: ["Levi's"] }, { Name: "Size", Value: ["M"] }] },
    });
    expect(l).toMatchObject({
      remoteListingId: "1234",
      sku: "J-1",
      title: "Denim & lace jacket",
      priceCents: 4550,
      quantity: 2,
      condition: "USED_GOOD",
      brand: "Levi's",
      attributes: { Size: ["M"] },
      photos: ["https://i.ebayimg.com/1.jpg"],
      overrides: { categoryId: "57988" },
    });
    expect(fromTradingItem({ ItemID: "9", Variations: { Variation: [{}, {}] } })).toBeNull();
  });

  it("maps an Etsy listing, leaving out ones with variations", () => {
    const l = fromEtsyListing({
      listing_id: 77,
      title: "Vintage &quot;Pyrex&quot; bowl",
      quantity: 1,
      price: { amount: 2500, divisor: 100, currency_code: "USD" },
      skus: ["", "PX-1"],
      taxonomy_id: 1050,
      when_made: "1970s",
      images: [
        { url_fullxfull: "https://i.etsystatic.com/b.jpg", rank: 2 },
        { url_fullxfull: "https://i.etsystatic.com/a.jpg", rank: 1 },
      ],
    });
    expect(l).toMatchObject({
      remoteListingId: "77",
      sku: "PX-1",
      title: 'Vintage "Pyrex" bowl',
      priceCents: 2500,
      photos: ["https://i.etsystatic.com/a.jpg", "https://i.etsystatic.com/b.jpg"],
      overrides: { categoryId: "1050", whenMade: "1970s" },
    });
    expect(fromEtsyListing({ listing_id: 78, has_variations: true })).toBeNull();
  });
});

describe("listings made on eBay's website", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubTrading(replies: Record<string, string>) {
    const calls: { name: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        const name = (init.headers as Record<string, string>)["X-EBAY-API-CALL-NAME"];
        expect(url.pathname).toBe("/ws/api.dll");
        expect((init.headers as Record<string, string>)["X-EBAY-API-IAF-TOKEN"]).toBe("access-token");
        calls.push({ name, body: String(init.body) });
        const reply = replies[name];
        if (reply === undefined) throw new Error(`Unexpected call: ${name}`);
        return new Response(`<?xml version="1.0"?><${name}Response xmlns="urn:ebay:apis:eBLBaseComponents">${reply}</${name}Response>`);
      }),
    );
    return calls;
  }

  const website = makeListing({ remoteListingId: "1234", remoteOfferId: null, status: "listed", overrides: {} });

  it("only needs a price, since the listing's other details stay on eBay", () => {
    expect(ebayAdapter.validate(makeItem({ images: [] }), website, makeConnection({ settings: {} }))).toEqual([]);
  });

  it("keeps price and quantity in sync, and ends it with the Trading API", async () => {
    const calls = stubTrading({ ReviseInventoryStatus: "<Ack>Success</Ack>", EndFixedPriceItem: "<Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>1047</ErrorCode><LongMessage>Already ended.</LongMessage></Errors>" });
    await expect(ebayAdapter.upsertListing(makeItem({ quantity: 2 }), website, makeConnection())).resolves.toEqual({ remoteListingId: "1234" });
    expect(calls[0].body).toContain("<InventoryStatus><ItemID>1234</ItemID><StartPrice>45.50</StartPrice><Quantity>2</Quantity></InventoryStatus>");
    // Ending a listing eBay already ended isn't an error.
    await ebayAdapter.endListing(website, makeConnection());
    expect(calls.map((c) => c.name)).toEqual(["ReviseInventoryStatus", "EndFixedPriceItem"]);
  });

  it("relists an ended one under its new item number", async () => {
    const calls = stubTrading({ RelistFixedPriceItem: "<Ack>Success</Ack><ItemID>5555</ItemID>", ReviseInventoryStatus: "<Ack>Success</Ack>" });
    const result = await ebayAdapter.upsertListing(makeItem(), { ...website, status: "ended" }, makeConnection());
    expect(result).toEqual({ remoteListingId: "5555" });
    expect(calls[1].body).toContain("<ItemID>5555</ItemID>");
  });

  it("reports eBay's error message", async () => {
    stubTrading({ ReviseInventoryStatus: "<Ack>Failure</Ack><Errors><SeverityCode>Error</SeverityCode><ErrorCode>21916</ErrorCode><LongMessage>Price too low.</LongMessage></Errors>" });
    await expect(ebayAdapter.upsertListing(makeItem(), website, makeConnection())).rejects.toThrow("Price too low.");
  });

  it("reads a page of active listings with each item's details", async () => {
    const calls = stubTrading({
      GetMyeBaySelling:
        "<Ack>Success</Ack><ActiveList><ItemArray><Item><ItemID>1</ItemID></Item><Item><ItemID>2</ItemID></Item></ItemArray><PaginationResult><TotalNumberOfPages>1</TotalNumberOfPages><TotalNumberOfEntries>2</TotalNumberOfEntries></PaginationResult></ActiveList>",
      GetItem: "<Ack>Success</Ack><Item><ItemID>1</ItemID><Title>Lamp</Title><Description>&lt;p&gt;Brass&lt;/p&gt;</Description></Item>",
    });
    const page = await fetchActiveEbayListings(makeConnection(), 1);
    expect(page).toMatchObject({ total: 2, done: true });
    expect(page.items).toHaveLength(2);
    expect(fromTradingItem(page.items[0])?.description).toBe("Brass");
    expect(calls.filter((c) => c.name === "GetItem")).toHaveLength(2);
  });
});
