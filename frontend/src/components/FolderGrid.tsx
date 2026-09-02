import { Link } from "react-router-dom";
import { folderCoverUrl } from "../api/client";
import RatingStars from "./RatingStars";
import type { FolderSummary } from "../api/types";

interface Props {
  folders: FolderSummary[];
  onRate?: (folderId: number, rating: number) => void;
  onClearRating?: (folderId: number) => void;
}

export default function FolderGrid({ folders, onRate, onClearRating }: Props) {
  if (folders.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {folders.map((folder) => (
        <Link
          key={folder.id}
          to={`/library/folder/${folder.id}`}
          className="flex flex-col items-center gap-2 rounded p-2 hover:bg-slate-800"
        >
          {folder.coverImagePath ? (
            <img src={folderCoverUrl(folder.id)} alt="" className="aspect-square w-full rounded object-cover" />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded bg-slate-800 text-3xl text-slate-600">
              📁
            </div>
          )}
          <div className="w-full truncate text-center text-sm">{folder.name}</div>
          <div className="text-xs text-slate-500">
            {folder.fileCount} file{folder.fileCount === 1 ? "" : "s"}
          </div>
          {onRate && (
            <RatingStars
              value={folder.rating}
              onChange={(rating) => onRate(folder.id, rating)}
              onClear={onClearRating ? () => onClearRating(folder.id) : undefined}
              size="sm"
            />
          )}
        </Link>
      ))}
    </div>
  );
}
