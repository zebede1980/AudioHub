import { create } from "zustand";
import { api } from "../api/client";
import type { FileDetail } from "../api/types";

/** "one" loops the current track, "all" plays the current queue (or folder) round and round. */
export type RepeatMode = "off" | "one" | "all";

/**
 * The list playback came from. Starting a track from a list on screen — search results, a tag's
 * tracks, your history, a sorted folder page — makes that list the playlist, so ⏭ and the end of
 * a track carry on down the list you were actually looking at rather than through the folder the
 * track happens to live in. With no queue (a resumed session, say) the folder order still
 * applies, via the file's own prev/next ids.
 */
export interface PlayQueue {
  /** File ids in the order the list showed them. */
  ids: number[];
  /** Where they came from, e.g. `Search "storm"` — shown on the player screen. */
  label: string;
  /** Set when the list is one page of a longer one: running off either end then carries on in
   * folder order rather than stopping dead, so a 200-chapter audiobook doesn't halt at the
   * 50th file just because that is where the page ended. */
  continueInFolder?: boolean;
}

export const SLEEP_TIMER_MINUTES = [5, 10, 15, 30, 45, 60, 90] as const;

interface PlayerState {
  currentFile: FileDetail | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  repeatMode: RepeatMode;
  queue: PlayQueue | null;
  /** Minutes the running sleep timer was set to, or null when there isn't one. */
  sleepTimerMinutes: number | null;
  /** Whole seconds left on the sleep timer — display only; the deadline itself is kept outside
   * React state so the countdown can't drift as renders are batched or skipped. */
  sleepSecondsLeft: number | null;
  audioEl: HTMLAudioElement | null;

  registerAudioElement: (el: HTMLAudioElement) => void;
  /** Starts a track. `queue` makes the list it came from the playlist; omitting it (playing
   * something that isn't part of a list) falls back to folder order. */
  play: (file: FileDetail, options?: { startAtSec?: number; queue?: PlayQueue }) => void;
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
  setRepeatMode: (mode: RepeatMode) => void;
  cycleRepeatMode: () => void;
  /** Pauses playback after this many minutes of actual playing; pausing by hand holds it. */
  startSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  setCurrentFileRating: (fileId: number, rating: number | null) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  /** Everything play/next/prev funnel through, so only play() decides what the queue is. */
  function startPlayback(file: FileDetail, startAtSec?: number) {
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
  }

  function loadAndPlay(fileId: number) {
    api.get<FileDetail>(`/files/${fileId}`).then((file) => startPlayback(file));
  }

  /** Where the current track sits in the queue, or -1 when it isn't in one — which is how a track
   * played on its own (or one left over from a queue you have since replaced) falls back to
   * folder order. */
  function queueIndex(): number {
    const { queue, currentFile } = get();
    if (!queue || !currentFile) return -1;
    return queue.ids.indexOf(currentFile.id);
  }

  function idAfterCurrent(): number | null {
    const { queue, currentFile } = get();
    const index = queueIndex();
    const folderNext = currentFile?.nextFileId ?? null;
    if (index < 0) return folderNext;
    if (index + 1 < queue!.ids.length) return queue!.ids[index + 1];
    return queue!.continueInFolder ? folderNext : null;
  }

  function idBeforeCurrent(): number | null {
    const { queue, currentFile } = get();
    const index = queueIndex();
    const folderPrev = currentFile?.prevFileId ?? null;
    if (index < 0) return folderPrev;
    if (index > 0) return queue!.ids[index - 1];
    return queue!.continueInFolder ? folderPrev : null;
  }

  /** What repeat-all wraps back to once the end is reached: the top of the queue, or of the
   * folder when playback didn't come from a list. */
  function idAtStart(): number | null {
    const { queue, currentFile } = get();
    return queueIndex() >= 0 ? queue!.ids[0] : (currentFile?.firstFileId ?? null);
  }

  /**
   * Sleep timer. Deliberately driven by the audio element's "timeupdate" rather than by
   * setTimeout: on a locked iPhone the page's timers are throttled to a crawl (or stopped
   * outright), but timeupdate keeps firing several times a second for as long as audio is
   * actually playing — which is exactly when the timer needs to be counting.
   */
  let sleepDeadlineAt: number | null = null;
  // When playback is paused the deadline is pushed back by however long the pause lasts, so a
  // 30-minute timer means 30 minutes of listening, not 30 minutes of wall clock.
  let sleepPausedAt: number | null = null;

  function publishSleepSecondsLeft() {
    const left = sleepDeadlineAt === null ? null : Math.max(0, Math.ceil((sleepDeadlineAt - Date.now()) / 1000));
    if (get().sleepSecondsLeft !== left) set({ sleepSecondsLeft: left });
  }

  function clearSleepTimer() {
    sleepDeadlineAt = null;
    sleepPausedAt = null;
    set({ sleepTimerMinutes: null, sleepSecondsLeft: null });
  }

  function tickSleepTimer() {
    if (sleepDeadlineAt === null || sleepPausedAt !== null) return;
    if (Date.now() >= sleepDeadlineAt) {
      clearSleepTimer();
      get().audioEl?.pause();
      return;
    }
    publishSleepSecondsLeft();
  }

  function onTimeUpdate() {
    const el = get().audioEl;
    if (el) set({ currentTime: el.currentTime });
    tickSleepTimer();
  }
  function onLoadedMetadata() {
    const el = get().audioEl;
    if (el) set({ duration: el.duration });
  }
  function onPlay() {
    set({ isPlaying: true });
    if (sleepDeadlineAt !== null && sleepPausedAt !== null) {
      sleepDeadlineAt += Date.now() - sleepPausedAt;
      sleepPausedAt = null;
      publishSleepSecondsLeft();
    }
  }
  function onPause() {
    set({ isPlaying: false });
    if (sleepDeadlineAt !== null && sleepPausedAt === null) sleepPausedAt = Date.now();
  }
  function onEnded() {
    // Repeat-one never gets here: it loops through the audio element itself (see setRepeatMode).
    const id = idAfterCurrent() ?? (get().repeatMode === "all" ? idAtStart() : null);
    if (id !== null) loadAndPlay(id);
  }

  return {
    currentFile: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    playbackRate: 1,
    repeatMode: "off",
    queue: null,
    sleepTimerMinutes: null,
    sleepSecondsLeft: null,
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

    play: (file, options) => {
      // Playing from a list replaces the queue; playing something that came from no list at all
      // clears it, so the old list can't keep steering ⏭ long after you left the screen.
      set({ queue: options?.queue ?? null });
      startPlayback(file, options?.startAtSec);
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
      const id = idAfterCurrent();
      if (id !== null) loadAndPlay(id);
    },

    prev: () => {
      const id = idBeforeCurrent();
      if (id !== null) loadAndPlay(id);
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

    setRepeatMode: (mode) => {
      const el = get().audioEl;
      // Repeating a single track is left to the audio element's own loop flag rather than to an
      // "ended" handler, so it keeps looping on a locked phone where our JS may not get to run.
      if (el) el.loop = mode === "one";
      set({ repeatMode: mode });
    },

    cycleRepeatMode: () => {
      const order: RepeatMode[] = ["off", "one", "all"];
      const next = order[(order.indexOf(get().repeatMode) + 1) % order.length];
      get().setRepeatMode(next);
    },

    startSleepTimer: (minutes) => {
      sleepDeadlineAt = Date.now() + minutes * 60_000;
      sleepPausedAt = get().isPlaying ? null : Date.now();
      set({ sleepTimerMinutes: minutes, sleepSecondsLeft: minutes * 60 });
    },

    cancelSleepTimer: () => clearSleepTimer(),

    // The player screen renders currentFile from this store, not from a query, so a rating
    // saved via useSetRating never reaches it through query invalidation alone.
    setCurrentFileRating: (fileId, rating) => {
      const file = get().currentFile;
      if (file && file.id === fileId) set({ currentFile: { ...file, rating } });
    },
  };
});
