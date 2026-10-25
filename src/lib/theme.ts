import { useEffect, useState } from "react";

/** Day, night, or follow the device. Stored per browser. */
export type ThemeMode = "auto" | "light" | "dark";

const KEY = "leadnest-theme";
const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch { /* storage blocked */ }
  return "auto";
}

function isDark(mode: ThemeMode) {
  return mode === "dark" || (mode === "auto" && !!media()?.matches);
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", isDark(mode) ? "#18181b" : "#ffffff");
}

const listeners = new Set<(m: ThemeMode) => void>();

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch { /* storage blocked: still applies for this visit */ }
  applyTheme(mode);
  listeners.forEach((fn) => fn(mode));
}

/** Current mode plus whether the screen is dark right now (for logos etc.). */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);
  const [systemDark, setSystemDark] = useState(() => !!media()?.matches);

  useEffect(() => {
    const fn = (m: ThemeMode) => setMode(m);
    listeners.add(fn);
    const mq = media();
    const onChange = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
      if (getThemeMode() === "auto") applyTheme("auto");
    };
    mq?.addEventListener?.("change", onChange);
    return () => { listeners.delete(fn); mq?.removeEventListener?.("change", onChange); };
  }, []);

  const dark = mode === "dark" || (mode === "auto" && systemDark);
  return { mode, dark, setMode: setThemeMode };
}
