import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranscriptionStatus } from "../api/hooks/transcribe";

const ACTIVE = new Set(["running", "downloading-model", "cancelling"]);

/**
 * Mounted once, app-wide. Every file list carries a `hasTranscript` flag from the server, so when
 * a transcription batch finishes those lists are stale wherever the user happens to be standing —
 * this refetches them on the active → finished transition (once, not on every status poll).
 */
export default function TranscriptionWatcher() {
  const queryClient = useQueryClient();
  const { data: status } = useTranscriptionStatus(true);
  const wasActive = useRef(false);

  useEffect(() => {
    const isActive = status ? ACTIVE.has(status.status) : false;
    if (wasActive.current && !isActive) {
      for (const key of [
        ["folder"],
        ["rated-files"],
        ["recent-files"],
        ["search"],
        ["tags-tracks"],
        ["play-history"],
        ["file"],
        ["transcript"],
      ]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }
    wasActive.current = isActive;
  }, [status?.status, queryClient]);

  return null;
}
