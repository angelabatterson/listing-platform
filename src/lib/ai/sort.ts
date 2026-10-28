import { z } from "zod";

export const sortSchema = z.object({
  items: z.array(
    z.object({
      photos: z.array(z.number().int()).describe("Photo numbers that show this item, in the order given."),
      label: z.string().describe("A few words naming the item, e.g. 'Blue Nike hoodie'."),
    }),
  ),
});

export type SortedGroup = { photos: number[]; label: string };

export const SORT_SYSTEM = `You help a reseller turn a pile of product photos into listings.

You will see numbered photos from one photo session. Group them by the physical item they show, so each group becomes one listing. Sellers usually shoot one item at a time, so neighbouring photos often belong together, but check what is actually in each photo. Close-ups of tags, labels, flaws, soles or backs belong with the item they show. A photo that shows several items together goes with the item it best shows.

Every photo number must appear in exactly one group. Keep each group's photos in their original order, and order the groups by their first photo.`;

// Turn the model's 1-based groups into 0-based photo indexes, making sure every
// photo lands in exactly one group even if the answer skipped or repeated some.
export function normalizeGroups(groups: SortedGroup[], photoCount: number): SortedGroup[] {
  const seen = new Set<number>();
  const result: SortedGroup[] = [];
  for (const group of groups) {
    const photos = group.photos
      .map((n) => n - 1)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < photoCount && !seen.has(i));
    const unique = [...new Set(photos)].sort((a, b) => a - b);
    unique.forEach((i) => seen.add(i));
    if (unique.length) result.push({ photos: unique, label: group.label.trim() });
  }
  for (let i = 0; i < photoCount; i++) {
    if (!seen.has(i)) result.push({ photos: [i], label: "" });
  }
  return result.sort((a, b) => a.photos[0] - b.photos[0]);
}
