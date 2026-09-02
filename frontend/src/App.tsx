import type { ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./api/hooks/auth";
import PlayerHost from "./player/PlayerHost";
import MiniPlayer from "./components/MiniPlayer";
import TranscriptionWatcher from "./components/TranscriptionWatcher";
import NavBar from "./components/NavBar";
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
  return (
    <>
      <NavBar />
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
      {/* Rendered as siblings of the routed content, never inside a <Route> element, so the
          single persistent <audio> element and mini-player survive every navigation. */}
      <PlayerHost />
      <MiniPlayer />
      <TranscriptionWatcher />
    </>
  );
}
