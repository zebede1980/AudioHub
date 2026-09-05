/**
 * The Library home's "type a few letters" filter. It narrows the list already on screen rather
 * than asking the server for anything, which is what makes it feel instant — and it is a
 * different job from the navbar's Search, which goes and finds tracks you are *not* currently
 * looking at.
 */

/** Case- and accent-insensitive, so "beguiled" finds "Béguiled" and vice versa. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Whitespace-separated words, each of which must appear somewhere in the row. Typing
 * "jane storm" therefore finds a track by Jane in the Storm folder, in either order — which is
 * how people actually half-remember what they are looking for. */
export function filterTerms(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

/** True when every term appears in at least one of the row's fields. Fields are matched
 * separately rather than joined, so a term can't accidentally straddle two of them. */
export function matchesTerms(terms: string[], fields: (string | null | undefined)[]): boolean {
  if (terms.length === 0) return true;
  const haystacks = fields.filter((f): f is string => !!f).map(normalize);
  return terms.every((term) => haystacks.some((field) => field.includes(term)));
}

/** The fields a track row is matched on: what is shown on it, plus its filename and tags —
 * everything the user can see or reasonably remember about it. */
export function trackFields(entry: {
  title: string | null;
  filename: string;
  folderName?: string;
  tags?: { name: string }[];
}): (string | null | undefined)[] {
  return [entry.title, entry.filename, entry.folderName, ...(entry.tags ?? []).map((t) => t.name)];
}
