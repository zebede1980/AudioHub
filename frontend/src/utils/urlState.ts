import { useSearchParams } from "react-router-dom";

/**
 * View state — which tab, which filter, which page — lives in the URL's query string rather than
 * in component state, so it survives leaving a screen and coming back. Routes unmount when you
 * navigate away, which throws away useState; the URL is the one piece of screen state the
 * browser remembers for us, so back (the player's ← Back, the browser/Android back button), a
 * reload and a bookmark all land on the exact view you left.
 *
 * Every setter here replaces the current history entry instead of pushing a new one: changing a
 * filter refines where you already are, it isn't a new place. Pushing would mean one back press
 * only undid the last filter tweak, and the history stack would fill with near-identical entries
 * before you could get back out to the screen you came from.
 */
function useParamSetter(key: string) {
  const [, setSearchParams] = useSearchParams();
  return (formatted: string | null) => {
    // Built from the live URL rather than from the params this render closed over: two setters
    // fired from one handler (changing a sort *and* resetting the page, say) both run before
    // React re-renders, and useSearchParams' own updater would hand the second one the
    // pre-change params — silently discarding the first change.
    const next = new URLSearchParams(window.location.search);
    if (formatted === null) next.delete(key);
    else next.set(key, formatted);
    setSearchParams(next, { replace: true });
  };
}

/** One of a fixed set of string values, e.g. which tab or which sort order is showing. Anything
 * else in the URL (hand-edited, or left over from an older build) falls back to the default. */
export function useUrlEnum<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T
): [T, (value: T) => void] {
  const [searchParams] = useSearchParams();
  const setParam = useParamSetter(key);
  const raw = searchParams.get(key) as T | null;
  const value = raw !== null && allowed.includes(raw) ? raw : defaultValue;
  return [value, (next) => setParam(next === defaultValue ? null : next)];
}

/** A number, or null for "no value" — which is how an optional filter says "show everything". */
export function useUrlNumber(key: string, defaultValue: number | null = null): [number | null, (value: number | null) => void] {
  const [searchParams] = useSearchParams();
  const setParam = useParamSetter(key);
  const raw = searchParams.get(key);
  const parsed = raw === null || raw === "" ? null : Number(raw);
  const value = parsed === null || !Number.isFinite(parsed) ? defaultValue : parsed;
  return [value, (next) => setParam(next === null ? null : String(next))];
}

/** A boolean flag, present in the URL only when it differs from the default. */
export function useUrlBool(key: string, defaultValue = false): [boolean, (value: boolean) => void] {
  const [searchParams] = useSearchParams();
  const setParam = useParamSetter(key);
  const raw = searchParams.get(key);
  const value = raw === null ? defaultValue : raw === "1" || raw === "true";
  return [value, (next) => setParam(next === defaultValue ? null : next ? "1" : "0")];
}

/** A comma-separated list of ids, e.g. the tags currently selected as a filter. */
export function useUrlNumberList(key: string): [number[], (value: number[]) => void] {
  const [searchParams] = useSearchParams();
  const setParam = useParamSetter(key);
  const raw = searchParams.get(key);
  const value =
    raw === null || raw === ""
      ? []
      : raw
          .split(",")
          .map((part) => Number(part))
          .filter((n) => Number.isFinite(n));
  return [value, (next) => setParam(next.length === 0 ? null : next.join(","))];
}
