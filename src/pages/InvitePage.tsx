import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../context/Session";

export default function InvitePage({ token }: { token: string }) {
  const { refresh, setCurrent, session } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
      if (error) return setError(error.message);
      setCurrent(data as string);
      await refresh();
      navigate("/", { replace: true });
    })();
  }, [token]);

  return (
    <div className="center-screen">
      <div className="card narrow">
        {error ? (
          <>
            <h2>Couldn't join</h2>
            <div className="notice error">{error}</div>
            <p className="muted small">Signed in as {session?.user.email}.</p>
            <button className="btn" onClick={() => supabase.auth.signOut()}>Use another account</button>{" "}
            <button className="btn ghost" onClick={() => navigate("/", { replace: true })}>Go to my workspace</button>
          </>
        ) : (
          <><div className="spinner" /><p className="muted center">Joining workspace…</p></>
        )}
      </div>
    </div>
  );
}
