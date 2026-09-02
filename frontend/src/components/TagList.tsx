import type { FileTagSummary } from "../api/types";

interface Props {
  tags: FileTagSummary[];
  max?: number;
}

export default function TagList({ tags, max = 3 }: Props) {
  if (!tags || tags.length === 0) return null;

  const visible = tags.slice(0, max);
  const overflow = tags.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((tag) => (
        <span key={tag.id} className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
          {tag.name}
        </span>
      ))}
      {overflow > 0 && (
        <span className="group relative rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
          +{overflow}
          <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 shadow-lg group-hover:block">
            {tags.map((t) => t.name).join(", ")}
          </span>
        </span>
      )}
    </div>
  );
}
