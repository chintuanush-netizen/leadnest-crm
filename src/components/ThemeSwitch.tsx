import { useTheme, type ThemeMode } from "../lib/theme";

const OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: "light", label: "Day", icon: "☀" },
  { value: "dark", label: "Night", icon: "☾" },
  { value: "auto", label: "Auto", icon: "◐" },
];

/** Day / Night / Auto switch. `compact` shows icons only (sidebar). */
export default function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useTheme();
  return (
    <div className={`theme-switch${compact ? " compact" : ""}`} role="radiogroup" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={mode === o.value}
          className={mode === o.value ? "on" : ""} onClick={() => setMode(o.value)}
          title={o.value === "auto" ? "Auto: follows your device" : `${o.label} view`}>
          <span aria-hidden>{o.icon}</span>{compact ? <span className="sr-only">{o.label}</span> : o.label}
        </button>
      ))}
    </div>
  );
}
