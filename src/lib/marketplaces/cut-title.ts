// Cut a title at the last whole word that fits.
export function cutTitle(title: string, max: number): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : clean.slice(0, max)).replace(/[\s,;:\-–|/]+$/, "");
}
