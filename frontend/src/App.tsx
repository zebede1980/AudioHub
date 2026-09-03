import type { ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./api/hooks/auth";
import PlayerHost from "./player/PlayerHost";
import MiniPlayer, { useMiniPlayerVisible } from "./components/MiniPlayer";
import TranscriptionWatcher from "./components/TranscriptionWatcher";
import NavBar from "./components/NavBar";
import { useScrollRestoration } from "./utils/navigation";
import Login from "./routes/Login";
import LibraryRoots from "./routes/LibraryRoots";
import FolderBrowser from "./routes/FolderBrowser";
import Search from "./routes/Search";
import Tags from "./routes/Tags";
import PlayerScreen from "./routes/PlayerScreen";
import Settings from "./routes/Settings";
import FolderCleanupReview from "./routes/FolderCleanupReview";
import ImportSoundgasm from "./routes/ImportSoundgasm";
import History from "./routes/History";

function RequireAuth({ children }: { children: ReactElement }) {
  const { data: session, isLoading } = useSession();
  const location = useLocation();

  if (isLoading) return <div className="p-6 text-slate-400">Loading…</div>;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export default function App() {
  // Every screen remembers where it was scrolled to, so returning to a long list (back from the
  // player, back out of a folder) puts you where you left off rather than at the top.
  useScrollRestoration();
  // Reserved here rather than in each screen: the mini player is fixed to the bottom of the
  // viewport, so without it the last row of any list sits underneath the bar. One place means a
  // new screen can't forget it, and nothing wastes the space when nothing is playing.
  const miniPlayerVisible = useMiniPlayerVisible();

  return (
    <>
      <NavBar />
      <div className={miniPlayerVisible ? "pb-24" : undefined}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/library"
            element={
              <RequireAuth>
                <LibraryRoots />
              </RequireAuth>
            }
          />
          <Route
            path="/library/folder/:folderId"
            element={
              <RequireAuth>
                <FolderBrowser />
              </RequireAuth>
            }
          />
          <Route
            path="/search"
            element={
              <RequireAuth>
                <Search />
              </RequireAuth>
            }
          />
          <Route
            path="/tags"
            element={
              <RequireAuth>
                <Tags />
              </RequireAuth>
            }
          />
          <Route
            path="/player"
            element={
              <RequireAuth>
                <PlayerScreen />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
          <Route
            path="/settings/cleanup/folders"
            element={
              <RequireAuth>
                <FolderCleanupReview />
              </RequireAuth>
            }
          />
          <Route
            path="/history"
            element={
              <RequireAuth>
                <History />
              </RequireAuth>
            }
          />
          <Route
            path="/import/soundgasm"
            element={
              <RequireAuth>
                <ImportSoundgasm />
              </RequireAuth>
            }
          />
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="*" element={<Navigate to="/library" replace />} />
        </Routes>
      </div>
      {/* Rendered as siblings of the routed content, never inside a <Route> element, so the
          single persistent <audio> element and mini-player survive every navigation. */}
      <PlayerHost />
      <MiniPlayer />
      <TranscriptionWatcher />
    </>
  );
}
