import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

const COLORS = {
  bg: "#10161A",
  surface: "#182024",
  line: "#26332F",
  textHi: "#F2F5F4",
  textMid: "#9FB0AF",
  teal: "#3FA796",
  tealSoft: "#2A4A44",
  red: "#D9695B",
  redSoft: "#241A18",
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setErrorMsg("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  };

  return (
    <div
      style={{
        background: COLORS.bg,
        color: COLORS.textHi,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Sans', sans-serif",
        padding: 20,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
      `}</style>
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          background: COLORS.surface,
          border: `1px solid ${COLORS.line}`,
          borderRadius: 6,
          padding: 28,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 20, fontWeight: 700 }}>FitLog</div>
          <div style={{ fontSize: 13, color: COLORS.textMid, marginTop: 4 }}>
            Entre com seu e-mail para acessar seu diário de treino e alimentação.
          </div>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, color: COLORS.textMid }}>E-mail</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@email.com"
            style={{
              background: COLORS.bg,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 4,
              color: COLORS.textHi,
              padding: "10px 12px",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>

        {status === "error" && (
          <div
            style={{
              border: "1px solid #5C332E",
              background: COLORS.redSoft,
              borderRadius: 4,
              padding: "10px 12px",
              fontSize: 13,
              color: "#E8A79A",
            }}
          >
            {errorMsg || "Não foi possível enviar o link. Tente novamente."}
          </div>
        )}

        {status === "sent" ? (
          <div
            style={{
              border: `1px solid ${COLORS.line}`,
              borderRadius: 4,
              padding: "10px 12px",
              fontSize: 13.5,
              color: COLORS.textHi,
            }}
          >
            Link de acesso enviado para <strong>{email}</strong>. Abra o e-mail neste dispositivo e clique no link
            para entrar.
          </div>
        ) : (
          <button
            type="submit"
            disabled={status === "sending"}
            style={{
              background: status === "sending" ? COLORS.tealSoft : COLORS.teal,
              color: "#0B1614",
              border: "none",
              borderRadius: 4,
              padding: "11px 16px",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "'Space Grotesk', sans-serif",
              cursor: status === "sending" ? "default" : "pointer",
            }}
          >
            {status === "sending" ? "Enviando…" : "Enviar link de acesso"}
          </button>
        )}
      </form>
    </div>
  );
}
