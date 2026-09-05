import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  useLibraryRoots,
  useRatedFiles,
  useRecentFiles,
  useRootFolder,
  useRandomFiles,
  randomFilesQueryKey,
} from "../api/hooks/library";
import { useSetRating, useClearRating } from "../api/hooks/ratings";
import { api } from "../api/client";
import { usePlayerStore } from "../player/usePlayerStore";
import FileRow from "../components/FileRow";
import TagEditor from "../components/TagEditor";
import TranscriptModal from "../components/TranscriptModal";
import PlayHistoryList from "../components/PlayHistoryList";
import FilterBox from "../components/FilterBox";
import { filterTerms, matchesTerms, trackFields } from "../utils/listFilter";
import { useUrlBool, useUrlEnum, useUrlNumber, useUrlText } from "../utils/urlState";
import type { LibraryRoot, FileDetail, FileRow as FileRowType, RandomFile } from "../api/types";

const RANDOM_BATCH_SIZE = 10;

/** Every list on this screen takes the same filter, driven by the one box above the tabs. */
interface FilterProps {
  filter: string;
  onFilterChange: (value: string) => void;
}

/** Shown in place of a list that the filter has emptied — a dead end otherwise, since the row
 * you wanted may simply not be in this tab. */
function NoMatches({ filter }: { filter: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-400">
      Nothing here matches "{filter}".{" "}
      <Link to={`/search?q=${encodeURIComponent(filter)}`} className="text-indigo-400 underline">
        Search the whole library
      </Link>
      .
    </div>
  );
}

/** Which list the Library home is showing, held in the URL as ?tab= so that leaving the screen
 * and coming back — the player's ← Back, the browser back button, a reload — returns to the same
 * tab instead of dumping you at the top-level folder list. */
const LIBRARY_TABS = ["folders", "rated", "recent", "random", "history"] as const;

function LibraryRootCard({ root }: { root: LibraryRoot }) {
  const { data: rootFolder, isError } = useRootFolder(root.id);

  return (
    <div className="rounded-lg border border-slate-800 p-4">
      <div className="flex items-center justify-between">
        <div className="font-medium">{root.name}</div>
        <span
          className={`text-xs ${
            root.lastScanStatus === "error"
              ? "text-red-400"
              : root.lastScanStatus === "running"
                ? "text-yellow-400"
                : "text-slate-500"
          }`}
        >
          {root.lastScanStatus ?? "never scanned"}
        </span>
      </div>
      <div className="mt-1 truncate text-xs text-slate-500">{root.containerPath}</div>
      {rootFolder ? (
        <Link to={`/library/folder/${rootFolder.id}`} className="mt-3 inline-block text-sm text-indigo-400">
          Browse →
        </Link>
      ) : isError ? (
        <div className="mt-3 text-sm text-slate-500">
          Not scanned yet — trigger a scan from <Link to="/settings" className="underline">Settings</Link>.
        </div>
      ) : null}
    </div>
  );
}

/** null = the default view: everything rated, highest first. A number = only that star rating,
 * which is how a 1-star pile gets reviewed before deletion and how a "2 star = look at this
 * later" pot gets found again. Kept in the URL (?stars=2) so the pile you are working through is
 * still there when you come back from the player. */
function RatedFilesList({ filter, onFilterChange }: FilterProps) {
  const { data, isLoading } = useRatedFiles();
  const [starFilter, setStarFilter] = useUrlNumber("stars");
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;

  const all = data ?? [];
  const countFor = (rating: number) => all.filter((f) => f.rating === rating).length;
  const byRating = starFilter === null ? all : all.filter((f) => f.rating === starFilter);
  const terms = filterTerms(filter);
  const visible = byRating.filter((f) => matchesTerms(terms, trackFields(f)));

  const picker = (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs text-slate-500" htmlFor="rating-filter">
        Show
      </label>
      <select
        id="rating-filter"
        value={starFilter === null ? "all" : String(starFilter)}
        onChange={(e) => setStarFilter(e.target.value === "all" ? null : Number(e.target.value))}
        className="rounded bg-slate-800 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <option value="all">All ratings, highest first ({all.length})</option>
        {[5, 4, 3, 2, 1].map((rating) => (
          <option key={rating} value={rating}>
            {"★".repeat(rating)} {rating} star{rating === 1 ? "" : "s"} only ({countFor(rating)})
          </option>
        ))}
      </select>
    </div>
  );

  if (all.length === 0) {
    return <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">No rated files yet.</div>;
  }

  return (
    <div className="space-y-2">
      {picker}

      <FilterBox
        value={filter}
        onChange={onFilterChange}
        placeholder="Filter rated tracks…"
        matchCount={visible.length}
        totalCount={byRating.length}
      />

      {starFilter === 1 && visible.length > 0 && (
        <div className="rounded-lg border border-slate-800 p-3 text-xs text-slate-500">
          Deleting these: Settings → Cleanup removes all 1-star <em>files</em> from disk. Whole
          folders rated 1 star are handled separately, in{" "}
          <Link to="/settings/cleanup/folders" className="text-indigo-400 hover:underline">
            Review 1-star folders
          </Link>
          .
        </div>
      )}

      {visible.length === 0 ? (
        terms.length > 0 ? (
          <NoMatches filter={filter} />
        ) : (
          <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">
            No files rated {starFilter} star{starFilter === 1 ? "" : "s"}.
          </div>
        )
      ) : null}

      {visible.map((entry) => {
        const file: FileRowType = {
          id: entry.id,
          filename: entry.filename,
          title: entry.title,
          trackNumber: entry.trackNumber,
          durationSec: entry.durationSec,
          coverImagePath: entry.coverImagePath,
          rating: entry.rating,
          hasTranscript: entry.hasTranscript,
          tags: entry.tags,
        };
        return (
          <FileRow
            key={entry.id}
            file={file}
            isCurrent={currentFile?.id === entry.id}
            onPlay={() => playFile(entry.id)}
            onRate={(rating) => setRating.mutate({ fileId: entry.id, rating })}
            onClearRating={() => clearRating.mutate(entry.id)}
            onViewTranscript={() => setViewingTranscriptFileId(entry.id)}
            onEditTags={() => setEditingTagsFileId(entry.id)}
            subtitle={
              <div className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-400">
                <Link
                  to={`/library/folder/${entry.folderId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate hover:text-indigo-400 hover:underline"
                >
                  {entry.folderName}
                </Link>
                {starFilter !== null && (
                  <>
                    <span>·</span>
                    <span className="flex-shrink-0">rated {new Date(entry.ratedAt).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            }
          />
        );
      })}

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}

function RecentFilesList({ filter, onFilterChange }: FilterProps) {
  const { data, isLoading } = useRecentFiles();
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;

  const all = data ?? [];
  if (all.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">
        Nothing scanned in yet.
      </div>
    );
  }

  const terms = filterTerms(filter);
  const visible = all.filter((f) => matchesTerms(terms, trackFields(f)));

  return (
    <div className="space-y-2">
      <FilterBox
        value={filter}
        onChange={onFilterChange}
        placeholder="Filter recently added…"
        matchCount={visible.length}
        totalCount={all.length}
      />

      {visible.length === 0 && <NoMatches filter={filter} />}

      <div className="space-y-1">
      {visible.map((entry) => {
        const file: FileRowType = {
          id: entry.id,
          filename: entry.filename,
          title: entry.title,
          trackNumber: entry.trackNumber,
          durationSec: entry.durationSec,
          coverImagePath: entry.coverImagePath,
          rating: entry.rating,
          hasTranscript: entry.hasTranscript,
          tags: entry.tags,
        };
        return (
          <FileRow
            key={entry.id}
            file={file}
            isCurrent={currentFile?.id === entry.id}
            onPlay={() => playFile(entry.id)}
            onRate={(rating) => setRating.mutate({ fileId: entry.id, rating })}
            onClearRating={() => clearRating.mutate(entry.id)}
            onViewTranscript={() => setViewingTranscriptFileId(entry.id)}
            onEditTags={() => setEditingTagsFileId(entry.id)}
            subtitle={
              <div className="flex min-w-0 items-center gap-1 truncate text-xs text-slate-400">
                <Link
                  to={`/library/folder/${entry.folderId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="truncate hover:text-indigo-400 hover:underline"
                >
                  {entry.folderName}
                </Link>
                <span>·</span>
                <span>{new Date(entry.firstSeenAt).toLocaleString()}</span>
              </div>
            }
          />
        );
      })}
      </div>

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}

function RandomFilesList({ filter, onFilterChange }: FilterProps) {
  const queryClient = useQueryClient();
  const [includeRated, setIncludeRated] = useUrlBool("rated");
  const { data, isLoading, isFetching, refetch } = useRandomFiles(RANDOM_BATCH_SIZE, includeRated);
  const setRating = useSetRating();
  const clearRating = useClearRating();
  const play = usePlayerStore((s) => s.play);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const [editingTagsFileId, setEditingTagsFileId] = useState<number | null>(null);
  const [viewingTranscriptFileId, setViewingTranscriptFileId] = useState<number | null>(null);

  async function playFile(fileId: number) {
    const file = await api.get<FileDetail>(`/files/${fileId}`);
    play(file);
  }

  // Patches the currently-displayed batch in place rather than invalidating it — invalidating
  // would refetch, and since this list is ORDER BY RANDOM() server-side, that would reshuffle the
  // whole batch out from under the user right after they rated one track in it.
  function patchLocalRating(fileId: number, rating: number | null) {
    queryClient.setQueryData<RandomFile[]>(randomFilesQueryKey(RANDOM_BATCH_SIZE, includeRated), (old) =>
      old?.map((f) => (f.id === fileId ? { ...f, rating } : f))
    );
  }

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;

  const all = data ?? [];
  const terms = filterTerms(filter);
  const visible = all.filter((f) => matchesTerms(terms, trackFields(f)));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={includeRated}
            onChange={(e) => setIncludeRated(e.target.checked)}
            className="rounded"
          />
          Include already-rated files
        </label>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded bg-slate-800 px-3 py-1 text-sm text-slate-300 disabled:opacity-50"
        >
          {isFetching ? "Shuffling…" : "🔀 New batch"}
        </button>
      </div>

      {all.length > 0 && (
        <FilterBox
          value={filter}
          onChange={onFilterChange}
          placeholder="Filter this batch…"
          matchCount={visible.length}
          totalCount={all.length}
        />
      )}

      {all.length > 0 && visible.length === 0 && <NoMatches filter={filter} />}

      {data && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">
          {includeRated
            ? "No files in your library yet."
            : "No unrated files left — nice work! Turn on \"Include already-rated files\" to shuffle through everything."}
        </div>
      )}

      <div className="space-y-1">
        {visible.map((entry) => {
          const file: FileRowType = {
            id: entry.id,
            filename: entry.filename,
            title: entry.title,
            trackNumber: entry.trackNumber,
            durationSec: entry.durationSec,
            coverImagePath: entry.coverImagePath,
            rating: entry.rating,
            hasTranscript: entry.hasTranscript,
            tags: entry.tags,
          };
          return (
            <FileRow
              key={entry.id}
              file={file}
              isCurrent={currentFile?.id === entry.id}
              onPlay={() => playFile(entry.id)}
              onRate={(rating) => {
                setRating.mutate({ fileId: entry.id, rating });
                patchLocalRating(entry.id, rating);
              }}
              onClearRating={() => {
                clearRating.mutate(entry.id);
                patchLocalRating(entry.id, null);
              }}
              onViewTranscript={() => setViewingTranscriptFileId(entry.id)}
              onEditTags={() => setEditingTagsFileId(entry.id)}
              subtitle={
                <Link
                  to={`/library/folder/${entry.folderId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="block truncate text-xs text-slate-400 hover:text-indigo-400 hover:underline"
                >
                  {entry.folderName}
                </Link>
              }
            />
          );
        })}
      </div>

      {viewingTranscriptFileId !== null && (
        <TranscriptModal fileId={viewingTranscriptFileId} onClose={() => setViewingTranscriptFileId(null)} />
      )}
      {editingTagsFileId !== null && (
        <TagEditor fileId={editingTagsFileId} onClose={() => setEditingTagsFileId(null)} />
      )}
    </div>
  );
}

export default function LibraryRoots() {
  const { data: roots, isLoading } = useLibraryRoots();
  const [mode, setMode] = useUrlEnum("tab", LIBRARY_TABS, "folders");
  // One filter for the whole screen, shared across tabs: having typed "storm" into Recently
  // Added, flipping to Rated to see whether it is in there too should not mean typing it again.
  const [filter, setFilter] = useUrlText("find");

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;

  // A handful of roots rarely needs filtering, so the box only appears once there are enough of
  // them for it to be worth the row — and the filter only applies while that box is on screen,
  // so a term carried over from another tab can't empty this one with no way to clear it.
  const rootFilterShown = (roots?.length ?? 0) > 3;
  const rootTerms = rootFilterShown ? filterTerms(filter) : [];
  const visibleRoots = (roots ?? []).filter((root) => matchesTerms(rootTerms, [root.name, root.containerPath]));

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Library</h1>
        <Link to="/settings" className="text-sm text-indigo-400">
          Manage folders
        </Link>
      </div>

      {/* Wraps rather than overflowing: five tabs including "Recently Added" don't fit one phone row. */}
      <div className="flex flex-wrap gap-1">
        <button
          onClick={() => setMode("folders")}
          className={`rounded px-3 py-1 text-sm ${mode === "folders" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          Folders
        </button>
        <button
          onClick={() => setMode("rated")}
          className={`rounded px-3 py-1 text-sm ${mode === "rated" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          Rated
        </button>
        <button
          onClick={() => setMode("recent")}
          className={`rounded px-3 py-1 text-sm ${mode === "recent" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          Recently Added
        </button>
        <button
          onClick={() => setMode("random")}
          className={`rounded px-3 py-1 text-sm ${mode === "random" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          Random
        </button>
        <button
          onClick={() => setMode("history")}
          className={`rounded px-3 py-1 text-sm ${mode === "history" ? "bg-slate-800 text-white" : "text-slate-400"}`}
        >
          History
        </button>
      </div>

      {mode === "rated" ? (
        <RatedFilesList filter={filter} onFilterChange={setFilter} />
      ) : mode === "recent" ? (
        <RecentFilesList filter={filter} onFilterChange={setFilter} />
      ) : mode === "random" ? (
        <RandomFilesList filter={filter} onFilterChange={setFilter} />
      ) : mode === "history" ? (
        <PlayHistoryList filter={filter} onFilterChange={setFilter} />
      ) : !roots || roots.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-slate-400">
          No library folders added yet.{" "}
          <Link to="/settings" className="text-indigo-400 underline">
            Add one
          </Link>
          .
        </div>
      ) : (
        <>
          {rootFilterShown && (
            <FilterBox
              value={filter}
              onChange={setFilter}
              placeholder="Filter library folders…"
              matchCount={visibleRoots.length}
              totalCount={roots.length}
            />
          )}
          {visibleRoots.length === 0 ? (
            <NoMatches filter={filter} />
          ) : (
            visibleRoots.map((root) => <LibraryRootCard key={root.id} root={root} />)
          )}
        </>
      )}
    </div>
  );
}
