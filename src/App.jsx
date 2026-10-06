import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import Login from "./components/Login";
import FitLog from "./components/FitLog";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = ainda carregando

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div
        style={{
          background: "#10161A",
          color: "#9FB0AF",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          fontSize: 14,
        }}
      >
        Carregando…
      </div>
    );
  }

  if (!session) {
    return <Login />;
  }

  return (
    <FitLog
      userId={session.user.id}
      userEmail={session.user.email}
      onLogout={() => supabase.auth.signOut()}
    />
  );
}
