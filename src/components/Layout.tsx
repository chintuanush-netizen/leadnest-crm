import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useSession } from "../context/Session";
import { supabase } from "../lib/supabase";
import { contactLink, planState } from "../lib/plan";
import logoDark from "../assets/leadnest-logo.webp";
import logoWhite from "../assets/leadnest-logo-white.webp";
import { useTheme } from "../lib/theme";
import ThemeSwitch from "./ThemeSwitch";

export function Logo({ onDark = false }: { onDark?: boolean }) {
  const { dark } = useTheme();
  return (
    <div className="logo">
      <img src={onDark || dark ? logoWhite : logoDark} alt="Leadnest" className="logo-img" />
      <span className="logo-tag">CRM</span>
    </div>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { session, workspaces, current, setCurrent, isAdmin, isPlatformAdmin } = useSession();
  const plan = current ? planState(current) : null;

  const nav = [
    { to: "/", label: "Leads", icon: "◉", show: true },
    { to: "/ask", label: "Ask AI", icon: "✦", show: true },
    { to: "/integrations", label: "Lead sources", icon: "⇄", show: isAdmin },
    { to: "/team", label: "Team", icon: "☺", show: isAdmin },
    { to: "/settings", label: "Settings", icon: "⚙", show: true },
    { to: "/admin", label: "Admin", icon: "▣", show: isPlatformAdmin },
  ].filter((n) => n.show);

  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        {workspaces.length > 1 ? (
          <select className="ws-switch" value={current?.id} onChange={(e) => setCurrent(e.target.value)}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        ) : (
          <div className="ws-name">{current?.name}</div>
        )}
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="nav-icon" aria-hidden>{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ThemeSwitch compact />
          {plan && (current?.plan !== "active" || plan.tone !== "ok") && (
            isAdmin && plan.tone !== "ok"
              ? <a className={`trial ${plan.tone}`} href={contactLink(current, "choose a plan")} target="_blank" rel="noreferrer">{plan.label} · Upgrade</a>
              : <div className={`trial ${plan.tone}`}>{plan.label}</div>
          )}
          <div className="muted small ellipsis">{session?.user.email}</div>
          <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
