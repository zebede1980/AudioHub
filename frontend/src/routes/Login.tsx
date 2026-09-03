import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLogin } from "../api/hooks/auth";
import { ApiError } from "../api/client";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();
  const navigate = useNavigate();

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // iPadOS Safari does not reliably move focus with a hardware Tab key, which
  // makes it easy to type the password onto the end of the username. Drive the
  // focus order ourselves so Tab/Shift+Tab always behave.
  function tabTo(
    next: React.RefObject<HTMLElement | null> | null,
    prev: React.RefObject<HTMLElement | null> | null
  ) {
    return (e: React.KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const target = (e.shiftKey ? prev : next)?.current;
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ username: username.trim(), password });
      navigate("/library", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-semibold">AudioHub</h1>
        <input
          ref={usernameRef}
          id="username"
          name="username"
          type="text"
          placeholder="Username"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={tabTo(passwordRef, null)}
          className="w-full rounded bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <input
          ref={passwordRef}
          id="password"
          name="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={tabTo(submitRef, usernameRef)}
          className="w-full rounded bg-slate-800 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {error && <div className="text-sm text-red-400">{error}</div>}
        <button
          ref={submitRef}
          type="submit"
          disabled={login.isPending}
          className="w-full rounded bg-indigo-600 py-2 font-medium disabled:opacity-50"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
