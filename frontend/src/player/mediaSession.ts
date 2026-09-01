import { fileCoverUrl } from "../api/client";
import type { FileDetail } from "../api/types";
import { usePlayerStore } from "./usePlayerStore";

const supported = typeof navigator !== "undefined" && "mediaSession" in navigator;

/** Registered once, alongside the single persistent <audio> element. */
export function setupMediaSessionHandlers(): void {
  if (!supported) return;
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => usePlayerStore.getState().togglePlay());
  ms.setActionHandler("pause", () => usePlayerStore.getState().togglePlay());
  ms.setActionHandler("seekbackward", (details) => usePlayerStore.getState().skip(-(details.seekOffset ?? 15)));
  ms.setActionHandler("seekforward", (details) => usePlayerStore.getState().skip(details.seekOffset ?? 30));
  ms.setActionHandler("previoustrack", () => usePlayerStore.getState().prev());
  ms.setActionHandler("nexttrack", () => usePlayerStore.getState().next());
  ms.setActionHandler("seekto", (details) => {
    if (details.seekTime !== undefined) usePlayerStore.getState().seek(details.seekTime);
  });
}

export function updateMediaSessionMetadata(file: FileDetail): void {
  if (!supported) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: file.title ?? file.filename,
    artist: file.parsedAuthor ?? "",
    album: file.parsedSeriesOrBook ?? "",
    artwork: file.coverImagePath ? [{ src: fileCoverUrl(file.id), sizes: "512x512", type: "image/jpeg" }] : [],
  });
}

export function updateMediaSessionPlaybackState(isPlaying: boolean): void {
  if (!supported) return;
  navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
}

export function updateMediaSessionPositionState(duration: number, playbackRate: number, position: number): void {
  if (!supported || typeof navigator.mediaSession.setPositionState !== "function") return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, playbackRate, position: Math.min(position, duration) });
  } catch {
    // Throws if called with inconsistent values (e.g. mid track-change) — safe to ignore.
  }
}
