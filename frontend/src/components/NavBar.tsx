import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { playTestSound } from "../utils/testSound";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1 text-sm rounded ${isActive ? "bg-slate-800 text-white" : "text-slate-400"}`;

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [navQuery, setNavQuery] = useState("");

  if (location.pathname === "/login" || location.pathname === "/player") return null;

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = navQuery.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="sticky top-0 z-30 flex items-center gap-1 border-b border-slate-800 bg-slate-900/95 px-2 py-2 backdrop-blur">
      <div className="flex shrink-0 items-center gap-1">
        <NavLink to="/library" className={linkClass}>
          Library
        </NavLink>
        <NavLink to="/search" className={linkClass}>
          Search
        </NavLink>
        <NavLink to="/history" className={linkClass}>
          History
        </NavLink>
        <NavLink to="/import/soundgasm" className={linkClass}>
          Import
        </NavLink>
        <NavLink to="/settings" className={linkClass}>
          Settings
        </NavLink>
      </div>

      <form onSubmit={onSearchSubmit} className="flex min-w-0 flex-1 justify-center px-2">
        <input
          type="search"
          placeholder="Search…"
          value={navQuery}
          onChange={(e) => setNavQuery(e.target.value)}
          className="w-full min-w-0 max-w-xs rounded bg-slate-800 px-3 py-1 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </form>

      <button
        onClick={playTestSound}
        title="Play a test sound to check audio output"
        aria-label="Play test sound"
        className="shrink-0 rounded bg-slate-800 px-3 py-1 text-sm text-slate-300"
      >
        🔔 Test sound
      </button>
    </div>
  );
}
