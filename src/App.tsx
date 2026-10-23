import { Navigate, Route, Routes, useMatch } from "react-router-dom";
import { useSession } from "./context/Session";
import { configured } from "./lib/supabase";
import Layout from "./components/Layout";
import AuthPage from "./pages/AuthPage";
import Onboarding from "./pages/Onboarding";
import LeadsPage from "./pages/LeadsPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import TeamPage from "./pages/TeamPage";
import SettingsPage from "./pages/SettingsPage";
import InvitePage from "./pages/InvitePage";
import AskPage from "./pages/AskPage";
import AdminPage from "./pages/AdminPage";
import LockedScreen from "./pages/LockedScreen";
import { planState } from "./lib/plan";

export default function App() {
  const { session, loading, workspaces, isAdmin, isPlatformAdmin, current } = useSession();
  const invite = useMatch("/invite/:token");

  if (!configured) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h2>Almost there</h2>
          <p className="muted">Copy <code>.env.example</code> to <code>.env</code> and add your Supabase URL and anon key, then restart the dev server.</p>
        </div>
      </div>
    );
  }
  if (loading) return <div className="center-screen"><div className="spinner" /></div>;
  if (!session) return <AuthPage inviteMode={Boolean(invite)} />;
  if (invite) return <InvitePage token={invite.params.token!} />;
  if (!workspaces.length) return <Onboarding />;

  return (
    current && planState(current).locked && !isPlatformAdmin ? <LockedScreen /> :
    <Layout>
      <Routes>
        <Route path="/" element={<LeadsPage />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/integrations" element={isAdmin ? <IntegrationsPage /> : <Navigate to="/" />} />
        <Route path="/team" element={isAdmin ? <TeamPage /> : <Navigate to="/" />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={isPlatformAdmin ? <AdminPage /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
