"use client";

import { useTransition } from "react";
import { deleteBatch } from "@/app/(app)/batches/actions";

// Asks first, since the batch's loose photos are deleted for good.
export function DeleteBatchButton(props: { batchId: string; number: number; itemCount: number; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  function onClick() {
    const kept =
      props.itemCount > 0
        ? `\n\nThe ${props.itemCount} ${props.itemCount === 1 ? "item" : "items"} made from it stay in Inventory with their photos.`
        : "";
    if (!window.confirm(`Delete batch B${props.number} and its photos that haven't become items? This can't be undone.${kept}`)) return;
    startTransition(() => deleteBatch(props.batchId));
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={
        props.compact
          ? "text-sm text-red-700 underline disabled:opacity-50"
          : "inline-flex items-center justify-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      }
    >
      {pending ? "Deleting…" : "Delete batch"}
    </button>
  );
}
