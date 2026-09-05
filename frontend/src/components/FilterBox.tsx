/**
 * The Library home's filter input. Narrows whichever list is showing; deliberately separate from
 * the navbar's Search, which queries the whole library. The count tells you the filter is doing
 * something even when the matches are scrolled off the bottom.
 */
export default function FilterBox({
  value,
  onChange,
  placeholder,
  matchCount,
  totalCount,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  matchCount: number;
  totalCount: number;
}) {
  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          // The native search input draws its own clear cross in WebKit but not in Firefox;
          // hiding it leaves the one Clear button that looks the same everywhere.
          className="w-full rounded bg-slate-800 px-3 py-2 pr-16 text-sm outline-none focus:ring-2 focus:ring-indigo-500 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {value !== "" && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
          >
            Clear
          </button>
        )}
      </div>
      {value !== "" && (
        <div className="px-1 text-xs text-slate-500">
          {matchCount} of {totalCount} shown
        </div>
      )}
    </div>
  );
}
