import { ANTHROPIC_API_KEY, authenticate, callModel, json } from "../lib/anthropic.js";

// Proxy para tarefas curtas (classificar exercício). O plano de treino, que é longo,
// roda em plan-background.js. A chave ANTHROPIC_API_KEY só existe aqui, no servidor.
const ANTHROPIC_TIMEOUT_MS = 55000; // Netlify encerra funções síncronas em 60s
const MAX_TOKENS_CEILING = 4000;
const MAX_TOKENS_DEFAULT = 1000;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  if (!ANTHROPIC_API_KEY) return json(500, { error: "ANTHROPIC_API_KEY não configurada no servidor." });

  const auth = await authenticate(event);
  if (auth.error) return auth.error;

  let payload;
  try { payload = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "JSON inválido no corpo da requisição." }); }

  const { system, user, tools, maxTokens, noThinking, effort } = payload;
  if (!system || !user) return json(400, { error: "Campos 'system' e 'user' são obrigatórios." });
  if (tools) return json(400, { error: "Ferramentas não são aceitas neste endpoint." });

  const requested = Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : MAX_TOKENS_DEFAULT;
  const max_tokens = Math.max(100, Math.min(MAX_TOKENS_CEILING, Math.floor(requested)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);
  try {
    const last = await callModel({ system, user, max_tokens, noThinking: !!noThinking, effort, signal: controller.signal });
    return json(last.status, last.data);
  } catch (e) {
    if (e && e.name === "AbortError") return json(504, { error: "A API demorou demais para responder. Tente novamente." });
    return json(502, { error: "Falha ao contactar a API da Anthropic.", detail: String(e) });
  } finally {
    clearTimeout(timer);
  }
};
