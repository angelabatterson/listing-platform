"use client";

import { useState, useTransition, type RefObject } from "react";
import {
  checkCategorySpecifics,
  checkPrices,
  fillSpecifics,
  findCategories,
} from "@/app/(app)/items/assist-actions";
import type { PriceCheck } from "@/lib/marketplaces/ebay/browse";
import type { CategoryOption } from "@/lib/marketplaces/ebay/taxonomy";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function field(form: HTMLFormElement | null, name: string): Field | null {
  const el = form?.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
    ? el
    : null;
}

// Helpers shown under a store's category box: find the category, check and fill
// eBay's item specifics, and compare prices. They read and write the form's
// fields directly, so nothing is saved until the seller presses Save.
export function StoreAssist(props: {
  formRef: RefObject<HTMLFormElement | null>;
  itemId: string | null;
  connectionId: string;
  marketplace: "ebay" | "etsy";
  ready: boolean;
  categoryHint?: string;
}) {
  const { formRef, connectionId } = props;
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<CategoryOption[] | null>(null);
  const [specifics, setSpecifics] = useState<{ missing: string[]; recommended: string[] } | null>(null);
  const [prices, setPrices] = useState<PriceCheck | null | undefined>(undefined);

  const read = (name: string) => field(formRef.current, name)?.value ?? "";
  const categoryField = `category_${connectionId}`;

  function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    startTransition(async () => {
      await work();
      setBusy(null);
    });
  }

  const checkSpecifics = (categoryId: string) =>
    run("Checking item specifics…", async () => {
      const result = await checkCategorySpecifics(connectionId, categoryId, read("specifics"), read("brand"));
      if (result.error !== undefined) setError(result.error);
      else setSpecifics(result);
    });

  const find = () =>
    run("Finding categories…", async () => {
      const query = [props.categoryHint, read("title")].filter(Boolean)[0] ?? "";
      const result = await findCategories(connectionId, query);
      if (result.error !== undefined) setError(result.error);
      else setOptions(result.options);
    });

  const choose = (option: CategoryOption) => {
    const input = field(formRef.current, categoryField);
    if (input) input.value = option.id;
    setOptions(null);
    if (props.marketplace === "ebay") checkSpecifics(option.id);
  };

  const fill = () =>
    run("Filling in item specifics…", async () => {
      const categoryId = read(categoryField);
      const result = await fillSpecifics(props.itemId, connectionId, categoryId, {
        title: read("title"),
        description: read("description"),
        brand: read("brand"),
        specifics: read("specifics"),
      });
      if (result.error !== undefined) return setError(result.error);
      const textarea = field(formRef.current, "specifics");
      if (textarea) textarea.value = result.specifics;
      const check = await checkCategorySpecifics(connectionId, categoryId, result.specifics, read("brand"));
      if (check.error === undefined) setSpecifics(check);
    });

  const comparePrices = () =>
    run("Looking up similar listings…", async () => {
      const result = await checkPrices(connectionId, read("title"), read(categoryField), read("condition"));
      if (result.error !== undefined) setError(result.error);
      else setPrices(result.check);
    });

  const applyPrice = (cents: number) => {
    const input = field(formRef.current, "price");
    if (input) input.value = (cents / 100).toFixed(2);
  };

  if (!props.ready) return null;
  const disabled = pending || Boolean(busy);

  return (
    <div className="mt-2 flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={find} disabled={disabled}>
          Find category
        </button>
        {props.marketplace === "ebay" && (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => (read(categoryField) ? checkSpecifics(read(categoryField)) : setError("Choose a category first."))}
              disabled={disabled}
            >
              Check item specifics
            </button>
            <button type="button" className="btn-secondary" onClick={comparePrices} disabled={disabled}>
              Compare prices
            </button>
          </>
        )}
      </div>
      {busy && <p className="text-zinc-600">{busy}</p>}
      {error && <p className="text-red-600">{error}</p>}

      {options && (
        <div className="rounded-md border border-zinc-200">
          {options.length === 0 && <p className="px-3 py-2 text-zinc-600">No matches. Try different words in the title.</p>}
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => choose(o)}
              className="block w-full border-b border-zinc-100 px-3 py-2 text-left last:border-0 hover:bg-zinc-50"
            >
              <span className="font-medium">{o.name}</span>
              <span className="block text-xs text-zinc-500">{o.path}</span>
            </button>
          ))}
        </div>
      )}

      {specifics && (
        <div className={`rounded-md px-3 py-2 ${specifics.missing.length ? "bg-amber-50 text-amber-900" : "bg-green-50 text-green-900"}`}>
          {specifics.missing.length
            ? `eBay requires: ${specifics.missing.join(", ")}.`
            : "All the item specifics eBay requires are filled in."}
          {specifics.recommended.length > 0 && (
            <span className="block text-xs">Buyers also filter by: {specifics.recommended.slice(0, 12).join(", ")}.</span>
          )}
          {(specifics.missing.length > 0 || specifics.recommended.length > 0) && (
            <button type="button" className="mt-2 block underline" onClick={fill} disabled={disabled}>
              Fill them in with AI
            </button>
          )}
        </div>
      )}

      {prices === null && <p className="text-zinc-600">No similar listings found. Try a shorter title.</p>}
      {prices && (
        <div className="rounded-md bg-zinc-50 px-3 py-2">
          <p>
            {prices.count} similar listings are asking {dollars(prices.lowCents)} to {dollars(prices.highCents)}, typically{" "}
            {dollars(prices.medianCents)}.{" "}
            <button type="button" className="underline" onClick={() => applyPrice(prices.medianCents)}>
              Use {dollars(prices.medianCents)}
            </button>
          </p>
          <p className="text-xs text-zinc-500">These are current asking prices, not sold prices.</p>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {prices.examples.map((e) => (
              <li key={e.url}>
                <a href={e.url} target="_blank" rel="noreferrer" className="underline">
                  {dollars(e.priceCents)}: {e.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
