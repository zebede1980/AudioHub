import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { playTestSound } from "../utils/testSound";
import SyncButton from "./SyncButton";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded px-2 py-1 text-sm sm:px-3 ${isActive ? "bg-slate-800 text-white" : "text-slate-400"}`;

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [navQuery, setNavQuery] = useState("");

  if (location.pathname === "/login") return null;

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = navQuery.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-800 bg-slate-900/95 px-2 py-2 backdrop-blur">
      {/* One row at every width. The links scroll sideways rather than wrapping if they ever
          outgrow a narrow screen, so the bar stays a fixed height. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <NavLink to="/library" className={linkClass}>
          Library
        </NavLink>
        <NavLink to="/search" className={linkClass}>
          Search
        </NavLink>
        <NavLink to="/tags" className={linkClass}>
          Tags
        </NavLink>
        <NavLink to="/import/soundgasm" className={linkClass}>
          Import
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          Settings
        </NavLink>
      </div>

      {/* Search and Sync are hidden on phones: there isn't room for them beside the links, and
          both have a full equivalent elsewhere (the Search tab, Settings -> Cloud sync). */}
      <form onSubmit={onSearchSubmit} className="hidden min-w-0 flex-1 justify-center sm:flex sm:px-2">
        <input
          type="search"
          placeholder="Search…"
          value={navQuery}
          onChange={(e) => setNavQuery(e.target.value)}
          className="w-full min-w-0 max-w-xs rounded bg-slate-800 px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </form>

      <div className="hidden shrink-0 sm:block">
        <SyncButton />
      </div>

      <button
        onClick={playTestSound}
        title="Play a test sound to check audio output"
        aria-label="Play test sound"
        className="shrink-0 rounded bg-slate-800 px-2 py-1 text-sm text-slate-300 sm:px-3"
      >
        🔔<span className="hidden sm:inline"> Test sound</span>
      </button>
    </div>
  );
}
