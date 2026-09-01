import { useEffect, useRef } from "react";
import { usePlayerStore } from "./usePlayerStore";
import {
  setupMediaSessionHandlers,
  updateMediaSessionMetadata,
  updateMediaSessionPlaybackState,
  updateMediaSessionPositionState,
} from "./mediaSession";

const POSITION_SAVE_INTERVAL_MS = 10_000;

function savePosition(fileId: number, positionSec: number, isPlaying: boolean, useBeacon = false): void {
  const payload = JSON.stringify({ fileId, positionSec, isPlaying });
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon("/api/playback/position", new Blob([payload], { type: "application/json" }));
    return;
  }
  fetch("/api/playback/position", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: payload,
  }).catch(() => {});
}

/**
 * Owns the single <audio> element for the entire app lifetime. Mounted once in App.tsx, as a
 * sibling of the router outlet — never inside a route element — so navigating the library never
 * interrupts playback. See the plan's iOS lock-screen section for why this matters.
 */
export default function PlayerHost() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSaveRef = useRef(0);
  const registerAudioElement = usePlayerStore((s) => s.registerAudioElement);
  const currentFile = usePlayerStore((s) => s.currentFile);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  useEffect(() => {
    if (audioRef.current) {
      registerAudioElement(audioRef.current);
      setupMediaSessionHandlers();
    }
    // Intentionally runs only once for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (currentFile) updateMediaSessionMetadata(currentFile);
  }, [currentFile?.id]);

  useEffect(() => {
    updateMediaSessionPlaybackState(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    function onTimeUpdate() {
      const state = usePlayerStore.getState();
      updateMediaSessionPositionState(el!.duration, state.playbackRate, el!.currentTime);

      const now = Date.now();
      if (state.currentFile && now - lastSaveRef.current > POSITION_SAVE_INTERVAL_MS) {
        lastSaveRef.current = now;
        savePosition(state.currentFile.id, el!.currentTime, state.isPlaying);
      }
    }
    function onPause() {
      const state = usePlayerStore.getState();
      if (state.currentFile) savePosition(state.currentFile.id, el!.currentTime, false);
    }
    function onPageHide() {
      const state = usePlayerStore.getState();
      if (state.currentFile) savePosition(state.currentFile.id, el!.currentTime, state.isPlaying, true);
    }

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("pause", onPause);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("pause", onPause);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return <audio ref={audioRef} preload="metadata" playsInline style={{ display: "none" }} />;
}
