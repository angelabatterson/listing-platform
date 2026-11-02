"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
const format = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// A date and time in the viewer's own time zone. The server doesn't know it, so the
// first paint shows the date only.
export function LocalTime(props: { iso: string }) {
  const text = useSyncExternalStore(
    noop,
    () => format(props.iso),
    () => new Date(props.iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
  );
  return <time dateTime={props.iso}>{text}</time>;
}
