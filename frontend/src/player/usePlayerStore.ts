import { create } from "zustand";
import { api } from "../api/client";
import type { FileDetail } from "../api/types";

interface PlayerState {
  currentFile: FileDetail | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  audioEl: HTMLAudioElement | null;

  registerAudioElement: (el: HTMLAudioElement) => void;
  play: (file: FileDetail, startAtSec?: number) => void;
  /** Loads a file and seeks to a saved position without starting playback — used to restore the
   * mini-player to a previous session on app load without fighting browser autoplay policies. */
  loadForResume: (file: FileDetail, positionSec: number) => void;
  togglePlay: () => void;
  seek: (sec: number) => void;
  skip: (deltaSec: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (r: number) => void;
  setCurrentFileRating: (fileId: number, rating: number | null) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  function onTimeUpdate() {
    const el = get().audioEl;
    if (el) set({ currentTime: el.currentTime });
  }
  function onLoadedMetadata() {
    const el = get().audioEl;
    if (el) set({ duration: el.duration });
  }
  function onPlay() {
    set({ isPlaying: true });
  }
  function onPause() {
    set({ isPlaying: false });
  }
  function onEnded() {
    get().next();
  }

  return {
    currentFile: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    playbackRate: 1,
    audioEl: null,

    // Called exactly once, by PlayerHost, for the single <audio> element that lives for the
    // whole app lifetime — route changes must never cause this to be called again.
    registerAudioElement: (el) => {
      if (get().audioEl === el) return;
      set({ audioEl: el, volume: el.volume, playbackRate: el.playbackRate });
      el.addEventListener("timeupdate", onTimeUpdate);
      el.addEventListener("loadedmetadata", onLoadedMetadata);
      el.addEventListener("play", onPlay);
      el.addEventListener("pause", onPause);
      el.addEventListener("ended", onEnded);
    },

    play: (file, startAtSec) => {
      const el = get().audioEl;
      if (!el) return;
      const isSameFile = get().currentFile?.id === file.id;
      set({ currentFile: file });
      if (!isSameFile) {
        el.src = `/api/files/${file.id}/stream`;
        if (startAtSec) el.currentTime = startAtSec;
      }
      el.play().catch(() => {
        // Autoplay can be blocked (e.g. a programmatic next() without a fresh tap on iOS) — the
        // native "pause" event already keeps isPlaying in sync, nothing else to do here.
      });
      if (!isSameFile) {
        // Best-effort — a failed history log shouldn't disrupt playback.
        api.post("/history", { fileId: file.id }).catch(() => {});
      }
    },

    loadForResume: (file, positionSec) => {
      const el = get().audioEl;
      if (!el) return;
      set({ currentFile: file });
      el.src = `/api/files/${file.id}/stream`;
      el.currentTime = positionSec;
      set({ currentTime: positionSec });
      // Deliberately no el.play() (autoplay-on-load would be blocked by the browser anyway, and
      // would be a surprising way for audio to start) and no history log — this only restores UI
      // state; playing it for real happens when the user taps the mini-player's play button.
    },

    togglePlay: () => {
      const el = get().audioEl;
      if (!el) return;
      if (el.paused) el.play().catch(() => {});
      else el.pause();
    },

    seek: (sec) => {
      const el = get().audioEl;
      if (!el) return;
      el.currentTime = sec;
      set({ currentTime: sec });
    },

    skip: (deltaSec) => {
      const el = get().audioEl;
      if (!el) return;
      const max = Number.isFinite(el.duration) ? el.duration : Infinity;
      el.currentTime = Math.max(0, Math.min(max, el.currentTime + deltaSec));
    },

    next: () => {
      const file = get().currentFile;
      if (!file?.nextFileId) return;
      api.get<FileDetail>(`/files/${file.nextFileId}`).then((nextFile) => get().play(nextFile));
    },

    prev: () => {
      const file = get().currentFile;
      if (!file?.prevFileId) return;
      api.get<FileDetail>(`/files/${file.prevFileId}`).then((prevFile) => get().play(prevFile));
    },

    setVolume: (v) => {
      const el = get().audioEl;
      if (el) el.volume = v;
      set({ volume: v });
    },

    setPlaybackRate: (r) => {
      const el = get().audioEl;
      if (el) el.playbackRate = r;
      set({ playbackRate: r });
    },

    // The player screen renders currentFile from this store, not from a query, so a rating
    // saved via useSetRating never reaches it through query invalidation alone.
    setCurrentFileRating: (fileId, rating) => {
      const file = get().currentFile;
      if (file && file.id === fileId) set({ currentFile: { ...file, rating } });
    },
  };
});
