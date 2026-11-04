import { MARKETPLACE_LABELS } from "@/lib/marketplaces/labels";
import { STORE_MARKS } from "@/lib/marketplaces/logos";
import type { Connection } from "@/db/schema";

// A store's brand mark: its glyph or initial on the store's colour.
export function StoreLogo({ marketplace, size = 20 }: { marketplace: Connection["marketplace"]; size?: number }) {
  const mark = STORE_MARKS[marketplace];
  const fg = mark.dark ? "#18181b" : "#fff";
  return (
    <span
      aria-hidden="true"
      title={MARKETPLACE_LABELS[marketplace]}
      className="inline-flex shrink-0 items-center justify-center rounded"
      style={{ width: size, height: size, background: mark.color, color: fg }}
    >
      {mark.path ? (
        <svg viewBox="0 0 24 24" width={size * 0.7} height={size * 0.7} fill="currentColor">
          <path d={mark.path} />
        </svg>
      ) : (
        <span className="font-bold leading-none" style={{ fontSize: size * 0.62 }}>{mark.letter}</span>
      )}
    </span>
  );
}
