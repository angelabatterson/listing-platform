import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { Connection, EbayAutomations } from "@/db/schema";
import { decodeEntities, type ImportedListing } from "../imported";
import { accessTokenFor } from "../tokens";
import { DEFAULT_MARKETPLACE_ID, ebayHosts } from "./config";
import { bestOfferPrices } from "./mapping";
import { refreshAccessToken } from "./oauth";

// eBay's older XML "Trading" API. Listings a seller made on eBay's own website aren't
// visible to the newer Inventory API, so importing and managing them goes through here.

const COMPATIBILITY_LEVEL = "1349";

const SITE_IDS: Record<string, string> = {
  EBAY_US: "0",
  EBAY_CA: "2",
  EBAY_GB: "3",
  EBAY_AU: "15",
  EBAY_DE: "77",
};

export class EbayTradingError extends Error {
  constructor(
    message: string,
    public codes: string[],
  ) {
    super(message);
  }
}

// Lists that eBay may send as one object or an array always come back as arrays.
const ALWAYS_LISTS = new Set(["Item", "PictureURL", "NameValueList", "Value", "Errors", "Variation"]);

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => ALWAYS_LISTS.has(name),
});
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type Errors = { Errors?: { SeverityCode?: string; ErrorCode?: string; LongMessage?: string; ShortMessage?: string }[] };

export async function tradingCall<T>(connection: Connection, call: string, body: Record<string, unknown>): Promise<T> {
  const token = await accessTokenFor(connection, refreshAccessToken);
  const xml = `<?xml version="1.0" encoding="utf-8"?>${builder.build({
    [`${call}Request`]: { "@_xmlns": "urn:ebay:apis:eBLBaseComponents", ...body },
  })}`;
  const res = await fetch(new URL("/ws/api.dll", ebayHosts().api), {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-IAF-TOKEN": token,
      "X-EBAY-API-CALL-NAME": call,
      "X-EBAY-API-SITEID": SITE_IDS[connection.settings.marketplaceId ?? DEFAULT_MARKETPLACE_ID] ?? "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
    },
    body: xml,
  });
  const parsed = parser.parse(await res.text());
  const reply = (parsed[`${call}Response`] ?? {}) as T & Errors & { Ack?: string };
  if (!res.ok || reply.Ack === "Failure" || reply.Ack === "PartialFailure") {
    const errors = (reply.Errors ?? []).filter((e) => e.SeverityCode !== "Warning");
    throw new EbayTradingError(
      errors.map((e) => e.LongMessage ?? e.ShortMessage).filter(Boolean).join(" ") || `eBay error ${res.status}`,
      errors.map((e) => e.ErrorCode ?? ""),
    );
  }
  return reply;
}

// The building blocks for importing, kept free of network calls so they can be tested.

export type TradingItem = {
  ItemID?: string;
  Title?: string;
  Description?: string;
  SKU?: string;
  Quantity?: string;
  QuantityAvailable?: string;
  ListingType?: string;
  ConditionID?: string;
  PrimaryCategory?: { CategoryID?: string };
  SellingStatus?: { CurrentPrice?: string | { "#text"?: string }; QuantitySold?: string; ListingStatus?: string };
  StartPrice?: string | { "#text"?: string };
  PictureDetails?: { PictureURL?: string[]; GalleryURL?: string };
  ItemSpecifics?: { NameValueList?: { Name?: string; Value?: string[] }[] };
  Variations?: { Variation?: unknown[] };
};

const CONDITIONS: Record<string, string> = {
  "1000": "NEW",
  "1500": "NEW_OTHER",
  "1750": "NEW_WITH_DEFECTS",
  "2750": "USED_EXCELLENT",
  "3000": "USED_GOOD",
  "4000": "USED_VERY_GOOD",
  "5000": "USED_GOOD",
  "6000": "USED_ACCEPTABLE",
  "7000": "FOR_PARTS_OR_NOT_WORKING",
};

// eBay descriptions are HTML. Relistic keeps plain text, with line breaks where the
// HTML had paragraphs, breaks and list items.
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|tr|table|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const amount = (v: string | { "#text"?: string } | undefined) => (typeof v === "object" ? v["#text"] : v);

// Returns null for listings Relistic can't manage yet (multi-variation listings).
export function fromTradingItem(item: TradingItem): ImportedListing | null {
  if (!item.ItemID || item.Variations?.Variation?.length) return null;
  const attributes: Record<string, string[]> = {};
  for (const nv of item.ItemSpecifics?.NameValueList ?? []) {
    if (nv.Name && nv.Value?.length) attributes[nv.Name] = nv.Value.map(String);
  }
  const brand = attributes.Brand?.[0] ?? null;
  delete attributes.Brand;
  const quantity = item.QuantityAvailable ?? String(Number(item.Quantity ?? 1) - Number(item.SellingStatus?.QuantitySold ?? 0));
  const price = Number(amount(item.SellingStatus?.CurrentPrice) ?? amount(item.StartPrice) ?? 0);
  return {
    remoteListingId: String(item.ItemID),
    sku: item.SKU?.trim() || null,
    title: decodeEntities(item.Title ?? "").trim() || `eBay item ${item.ItemID}`,
    description: htmlToText(item.Description ?? ""),
    priceCents: Math.round(price * 100),
    currency: "USD",
    quantity: Math.max(0, Number(quantity) || 0),
    condition: CONDITIONS[item.ConditionID ?? ""],
    brand,
    attributes,
    photos: (item.PictureDetails?.PictureURL ?? []).filter((u) => u.startsWith("https://")),
    overrides: item.PrimaryCategory?.CategoryID ? { categoryId: String(item.PrimaryCategory.CategoryID) } : {},
  };
}

// ---- Calls ----

const PAGE_SIZE = 25;

// One page of the seller's active fixed-price listings, with full details.
export async function fetchActiveEbayListings(connection: Connection, page: number) {
  const list = await tradingCall<{
    ActiveList?: { ItemArray?: { Item?: TradingItem[] }; PaginationResult?: { TotalNumberOfPages?: string; TotalNumberOfEntries?: string } };
  }>(connection, "GetMyeBaySelling", {
    ActiveList: { Include: true, ListingType: "FixedPriceItem", Pagination: { EntriesPerPage: PAGE_SIZE, PageNumber: page } },
  });
  const summaries = list.ActiveList?.ItemArray?.Item ?? [];
  const totalPages = Number(list.ActiveList?.PaginationResult?.TotalNumberOfPages ?? 0);
  const total = Number(list.ActiveList?.PaginationResult?.TotalNumberOfEntries ?? summaries.length);

  // The summary has no description, category or item specifics, so ask for each item.
  const details: TradingItem[] = [];
  for (let i = 0; i < summaries.length; i += 5) {
    const chunk = await Promise.all(
      summaries.slice(i, i + 5).map((s) =>
        tradingCall<{ Item?: TradingItem[] }>(connection, "GetItem", {
          ItemID: s.ItemID,
          DetailLevel: "ReturnAll",
          IncludeItemSpecifics: true,
        }).then((r) => r.Item?.[0] ?? s),
      ),
    );
    details.push(...chunk);
  }
  return { items: details, total, done: page >= totalPages };
}

const ALREADY_ENDED = "1047";

// For listings made on eBay's website (no Inventory API offer).
export async function reviseEbayPriceAndQuantity(connection: Connection, itemId: string, priceCents: number, quantity: number) {
  await tradingCall(connection, "ReviseInventoryStatus", {
    InventoryStatus: { ItemID: itemId, StartPrice: (priceCents / 100).toFixed(2), Quantity: quantity },
  });
}

// Best Offer on a listing made on eBay's website. The Inventory API sets it with the offer.
export async function reviseEbayBestOffer(
  connection: Connection,
  itemId: string,
  priceCents: number,
  bestOffer: NonNullable<EbayAutomations["bestOffer"]>,
) {
  const { acceptCents, declineCents } = bestOfferPrices(priceCents, bestOffer);
  const money = (cents: number) => (cents / 100).toFixed(2);
  const prices: Record<string, string> = {};
  if (bestOffer.enabled && acceptCents) prices.BestOfferAutoAcceptPrice = money(acceptCents);
  if (bestOffer.enabled && declineCents) prices.MinimumBestOfferPrice = money(declineCents);
  await tradingCall(connection, "ReviseFixedPriceItem", {
    Item: {
      ItemID: itemId,
      BestOfferDetails: { BestOfferEnabled: bestOffer.enabled },
      ...(Object.keys(prices).length ? { ListingDetails: prices } : {}),
    },
  });
}

export async function endEbayItem(connection: Connection, itemId: string) {
  try {
    await tradingCall(connection, "EndFixedPriceItem", { ItemID: itemId, EndingReason: "NotAvailable" });
  } catch (err) {
    if (!(err instanceof EbayTradingError && err.codes.includes(ALREADY_ENDED))) throw err;
  }
}

export async function relistEbayItem(connection: Connection, itemId: string): Promise<string> {
  const res = await tradingCall<{ ItemID?: string }>(connection, "RelistFixedPriceItem", { Item: { ItemID: itemId } });
  if (!res.ItemID) throw new Error("eBay didn't return the relisted item.");
  return String(res.ItemID);
}
