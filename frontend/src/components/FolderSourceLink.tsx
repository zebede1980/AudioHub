import { useState } from "react";
import { useSetFolderSourceUrl } from "../api/hooks/folder";

/** Trims the scheme and any trailing slash so a profile URL reads as a name, not a URL bar. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/**
 * The folder's "where did this come from" link. Populated automatically by the Soundgasm
 * importer, and editable here so a folder assembled by hand — or one whose uploader moved — can
 * still point somewhere useful.
 */
export default function FolderSourceLink({
  folderId,
  sourceUrl,
}: {
  folderId: number;
  sourceUrl: string | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(sourceUrl ?? "");
  const save = useSetFolderSourceUrl(folderId);

  function commit(value: string | null) {
    save.mutate(value, { onSuccess: () => setIsEditing(false) });
  }

  if (isEditing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          commit(draft.trim() || null);
        }}
        className="flex flex-wrap items-center gap-2 text-xs"
      >
        <input
          autoFocus
          type="url"
          inputMode="url"
          placeholder="https://soundgasm.net/u/username"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 rounded bg-slate-800 px-2 py-1 outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded bg-indigo-600 px-2 py-1 font-medium disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(sourceUrl ?? "");
            setIsEditing(false);
          }}
          className="rounded bg-slate-800 px-2 py-1 text-slate-300"
        >
          Cancel
        </button>
        {save.isError && <span className="basis-full text-red-400">{save.error.message}</span>}
      </form>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
      {sourceUrl ? (
        <>
          <a
            href={sourceUrl}
            target="_blank"
            // noreferrer as well as noopener: this points off-site, and the target page has no
            // business knowing which library page linked to it.
            rel="noopener noreferrer"
            className="min-w-0 truncate text-indigo-400 hover:underline"
            title={sourceUrl}
          >
            {displayUrl(sourceUrl)}
          </a>
          <button onClick={() => setIsEditing(true)} className="shrink-0 hover:text-slate-200">
            Edit
          </button>
          <button
            onClick={() => commit(null)}
            disabled={save.isPending}
            className="shrink-0 hover:text-red-400 disabled:opacity-50"
          >
            Remove
          </button>
        </>
      ) : (
        <button onClick={() => setIsEditing(true)} className="hover:text-slate-200">
          + Add source link
        </button>
      )}
    </div>
  );
}
