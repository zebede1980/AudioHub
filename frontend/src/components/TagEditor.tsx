import { useState } from "react";
import { useTags, useCreateTag, useFileTags, useSetFileTags } from "../api/hooks/tags";

interface Props {
  fileId: number;
  onClose: () => void;
}

export default function TagEditor({ fileId, onClose }: Props) {
  const { data: allTags } = useTags();
  const { data: fileTags, isLoading } = useFileTags(fileId);
  const createTag = useCreateTag();
  const setFileTags = useSetFileTags();
  const [newTagName, setNewTagName] = useState("");

  const selectedIds = new Set(fileTags?.map((t) => t.id));

  function toggle(tagId: number) {
    const next = new Set(selectedIds);
    if (next.has(tagId)) next.delete(tagId);
    else next.add(tagId);
    setFileTags.mutate({ fileId, tagIds: [...next] });
  }

  async function onCreateAndApply(e: React.FormEvent) {
    e.preventDefault();
    const name = newTagName.trim();
    if (!name) return;
    const tag = await createTag.mutateAsync(name);
    setNewTagName("");
    setFileTags.mutate({ fileId, tagIds: [...selectedIds, tag.id] });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-lg border border-slate-800 bg-slate-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-400">Tags</h2>
          <button onClick={onClose} className="text-sm text-slate-400 hover:text-slate-200">
            Close
          </button>
        </div>

        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allTags?.map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggle(tag.id)}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  selectedIds.has(tag.id) ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300"
                }`}
              >
                {tag.name}
              </button>
            ))}
            {allTags?.length === 0 && <div className="text-sm text-slate-500">No tags yet.</div>}
          </div>
        )}

        <form onSubmit={onCreateAndApply} className="mt-3 flex gap-2">
          <input
            type="text"
            placeholder="New tag…"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            className="min-w-0 flex-1 rounded bg-slate-800 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={!newTagName.trim() || createTag.isPending}
            className="shrink-0 rounded bg-indigo-600 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
