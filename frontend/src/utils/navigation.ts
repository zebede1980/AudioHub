import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

const SCROLL_KEY_PREFIX = "audiohub:scroll:";
/** Lists are fetched after the route renders, so the page is often still too short to scroll to
 * the saved offset on the first frame. Keep re-applying it for a beat while content arrives. */
const RESTORE_WINDOW_MS = 1200;

/**
 * Goes back one history entry, falling back to a sensible screen when there is nothing to go
 * back to. React Router keeps its own index into this tab's history stack in `window.history`;
 * index 0 means the current entry is the first one this tab ever had — a deep link, a reload, or
 * a cold PWA launch — where navigate(-1) would either do nothing or leave the app entirely.
 */
export function useGoBack(fallback: string) {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}

/**
 * Remembers how far down each screen was scrolled and puts you back there when you return to it.
 * Mounted once, app-wide.
 *
 * Rules by navigation type: POP (back/forward) restores the saved offset, PUSH starts a new
 * screen at the top, and REPLACE — which is every in-place filter/tab/page change, see
 * `urlState.ts` — deliberately leaves the scroll position alone, so changing a filter doesn't
 * yank you to the top of the list you are working through.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const locationKey = location.key;
  const savedForKey = useRef<string>(locationKey);

  // The browser's own restoration fights ours: it fires before the routed content has been
  // fetched, so it lands on a page that is still too short and then we would overwrite it.
  useEffect(() => {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  }, []);

  useEffect(() => {
    savedForKey.current = locationKey;
    let frame = 0;
    function record() {
      frame = 0;
      try {
        sessionStorage.setItem(SCROLL_KEY_PREFIX + savedForKey.current, String(window.scrollY));
      } catch {
        // Private-mode / quota failures are not worth breaking scrolling over.
      }
    }
    function onScroll() {
      if (frame === 0) frame = requestAnimationFrame(record);
    }
    // A REPLACE gets a fresh history key while the user stays put on the page, so the position
    // saved under the old key is now unreachable. Seed the new key with where they already are,
    // or a filter change followed straight by a trip to the player would come back at the top.
    // Only on REPLACE: on a POP the scroll offset still belongs to the page being left, and
    // writing it here would clobber the value the restore effect below is about to read.
    if (navigationType === "REPLACE") record();

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
      // Capture the final position for the entry we are leaving, before its key changes.
      record();
    };
  }, [locationKey, navigationType]);

  useEffect(() => {
    if (navigationType === "REPLACE") return;

    if (navigationType !== "POP") {
      window.scrollTo(0, 0);
      return;
    }

    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(SCROLL_KEY_PREFIX + locationKey);
    } catch {
      saved = null;
    }
    const target = saved === null ? 0 : Number(saved);
    if (!Number.isFinite(target) || target <= 0) {
      window.scrollTo(0, 0);
      return;
    }

    let frame = 0;
    let cancelled = false;
    const deadline = Date.now() + RESTORE_WINDOW_MS;

    // Any real input from the user means they have taken over — stop nudging the page.
    function cancel() {
      cancelled = true;
    }
    const cancelEvents = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    cancelEvents.forEach((e) => window.addEventListener(e, cancel, { passive: true, once: true }));

    function attempt() {
      if (cancelled) return;
      window.scrollTo(0, target);
      // Content may still be loading; keep trying until the page is tall enough to honour it.
      if (Math.abs(window.scrollY - target) > 1 && Date.now() < deadline) {
        frame = requestAnimationFrame(attempt);
      }
    }
    attempt();

    return () => {
      cancelled = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      cancelEvents.forEach((e) => window.removeEventListener(e, cancel));
    };
  }, [locationKey, navigationType]);
}
