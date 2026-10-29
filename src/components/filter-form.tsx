"use client";

// A plain GET form that applies itself as soon as a dropdown changes.
export function FilterForm(props: { children: React.ReactNode; className?: string }) {
  return (
    <form
      action="/items"
      className={props.className}
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit();
      }}
    >
      {props.children}
    </form>
  );
}
