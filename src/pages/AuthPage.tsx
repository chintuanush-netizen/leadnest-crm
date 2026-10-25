import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { Logo } from "../components/Layout";

export default function AuthPage({ inviteMode }: { inviteMode: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup">(inviteMode ? "signup" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const redirect = window.location.href;
    const { data, error } = mode === "signup"
      ? await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name }, emailRedirectTo: redirect },
        })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMsg({ kind: "error", text: error.message });
    if (mode === "signup" && !data.session) {
      setMsg({ kind: "ok", text: "Check your inbox to confirm your email, then sign in." });
    }
  }

  async function forgot() {
    if (!email) return setMsg({ kind: "error", text: "Enter your email first" });
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/settings?reset=1` });
    setBusy(false);
    setMsg(error ? { kind: "error", text: error.message } : { kind: "ok", text: "Password reset link sent. Open it, then set a new password in Settings." });
  }

  async function magicLink() {
    if (!email) return setMsg({ kind: "error", text: "Enter your email first" });
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.href },
    });
    setBusy(false);
    setMsg(error ? { kind: "error", text: error.message } : { kind: "ok", text: "Login link sent. Check your email." });
  }

  return (
    <div className="auth">
      <div className="auth-pitch">
        <Logo />
        <h1>Every real estate lead, live, in one place.</h1>
        <p>Meta Lead Ads, Google Ads, WhatsApp, your landing pages and property portals flow straight into one inbox your sales team actually uses.</p>
        <ul>
          <li>Leads appear the second they're submitted</li>
          <li>Repeat enquiries flagged automatically</li>
          <li>Round-robin assignment to your sales team</li>
          <li>Status pipeline from enquiry to booking</li>
        </ul>
      </div>
      <form className="auth-card card" onSubmit={submit}>
        <h2>{mode === "signup" ? "Create your account" : "Sign in"}</h2>
        {inviteMode && <p className="muted small">Sign in or create an account with the email your invite was sent to.</p>}
        {mode === "signup" && (
          <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        )}
        <label>Work email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Password<input type="password" value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === "signup" ? "new-password" : "current-password"} /></label>
        {mode === "signin" && <button type="button" className="link small forgot" onClick={forgot} disabled={busy}>Forgot password?</button>}
        {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Start free trial" : "Sign in"}</button>
        {mode === "signin" && <button type="button" className="btn ghost block" onClick={magicLink} disabled={busy}>Email me a login link</button>}
        {mode === "signup" && (
          <p className="muted small center">
            By creating an account you agree to our <a href="/terms.html" target="_blank" rel="noreferrer">Terms of Service</a> and <a href="https://leadnestmarketingco.com/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>.
          </p>
        )}
        <p className="muted small center">
          {mode === "signup" ? "Already have an account? " : "New to Leadnest? "}
          <button type="button" className="link" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setMsg(null); }}>
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </form>
    </div>
  );
}
