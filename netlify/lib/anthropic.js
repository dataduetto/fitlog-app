// Código compartilhado pelas Netlify Functions (fica fora de netlify/functions para não virar endpoint).
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export const ALLOWED_EFFORT = ["low", "medium", "high"];

export const json = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(obj),
});

/**
 * Lista de e-mails autorizados (variável ALLOWED_EMAILS, separados por vírgula).
 * Se a variável não existir, qualquer usuário logado passa (comportamento antigo);
 * o README recomenda sempre configurá-la.
 */
export function isEmailAllowed(email, list = process.env.ALLOWED_EMAILS) {
  const allowed = String(list || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(String(email || "").trim().toLowerCase());
}

/** Valida o token Supabase do cabeçalho e o e-mail. Retorna { user, token } ou { error: resposta }. */
export async function authenticate(event) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { error: json(500, { error: "Variáveis do Supabase não configuradas no servidor." }) };
  }
  const h = event.headers || {};
  const authHeader = h.authorization || h.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json(401, { error: "Não autenticado." }) };

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: json(401, { error: "Sessão inválida ou expirada." }) };
  if (!isEmailAllowed(data.user.email)) {
    return { error: json(403, { error: "Este e-mail não está autorizado a usar a IA do app." }) };
  }
  return { user: data.user, token };
}

/** Cliente Supabase que age como o usuário (respeita as políticas RLS). */
export function userClient(token) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Como desligar o "thinking" varia conforme o modelo: claude-sonnet-5-5 exige
 * {"type":"between_tools"}; modelos anteriores aceitam {"type":"disabled"}.
 * Tentamos em ordem e, se a API responder 400 citando "thinking", passamos para a próxima.
 */
export function thinkingCandidates(model, noThinking) {
  if (!noThinking) return [null];
  const modern = /-5-5/.test(model);
  return modern
    ? [{ type: "between_tools" }, { type: "disabled" }, null]
    : [{ type: "disabled" }, { type: "between_tools" }, null];
}

async function callAnthropic(body, signal) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

/** Chama a API com as tentativas de thinking/effort. Retorna { status, data }. Pode lançar AbortError. */
export async function callModel({ system, user, tools, max_tokens, noThinking, effort, signal, model = ANTHROPIC_MODEL }) {
  const baseBody = { model, max_tokens, system, messages: [{ role: "user", content: user }] };
  if (tools) baseBody.tools = tools;
  let useEffort = ALLOWED_EFFORT.includes(effort);
  let last = null;
  const errorText = () => JSON.stringify(last.data?.error || "").toLowerCase();

  for (const thinking of thinkingCandidates(model, !!noThinking)) {
    while (true) {
      const body = { ...baseBody };
      if (thinking) body.thinking = thinking;
      if (useEffort) body.output_config = { effort };
      last = await callAnthropic(body, signal);
      const effortRejected = last.status === 400 && useEffort && /effort|output_config/.test(errorText());
      if (!effortRejected) break;
      useEffort = false;
    }
    const thinkingRejected = last.status === 400 && errorText().includes("thinking");
    if (!thinkingRejected) break;
  }
  return last;
}

/** Extrai o objeto JSON dos blocos de texto da resposta (último bloco, todos juntos, ou entre { e }). */
export function parseJsonFromContent(content) {
  const textBlocks = (content || []).filter((b) => b.type === "text").map((b) => b.text);
  if (textBlocks.length === 0) throw new Error("Resposta sem conteúdo de texto.");
  const clean = (s) => s.replace(/```json|```/g, "").trim();
  const joined = clean(textBlocks.join("\n"));
  const attempts = [clean(textBlocks[textBlocks.length - 1]), joined];
  const start = joined.indexOf("{");
  const end = joined.lastIndexOf("}");
  if (start !== -1 && end > start) attempts.push(joined.slice(start, end + 1));
  for (const c of attempts) {
    try { return JSON.parse(c); } catch (e) { /* tenta o próximo */ }
  }
  throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
}
