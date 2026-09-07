import { api } from "../api/client";
import type { FileDetail } from "../api/types";
import { usePlayerStore } from "./usePlayerStore";

/**
 * Starts a track from a list that is on screen, and makes that list the play queue: what you can
 * see is what plays next. Every list screen goes through this rather than calling play() itself,
 * so none of them can quietly leave the queue behind and drop playback back into folder order.
 *
 * `ids` must be the list exactly as rendered — same sort, same filtering, same page — because
 * that ordering is the whole promise being made to the user.
 */
export async function playFromList(
  fileId: number,
  ids: number[],
  label: string,
  options?: { continueInFolder?: boolean }
): Promise<void> {
  const file = await api.get<FileDetail>(`/files/${fileId}`);
  usePlayerStore.getState().play(file, { queue: { ids, label, ...options } });
}
