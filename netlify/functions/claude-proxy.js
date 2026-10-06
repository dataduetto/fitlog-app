import { createClient } from "@supabase/supabase-js";

// Variáveis de ambiente — configure em Netlify: Site settings -> Environment variables.
// ANTHROPIC_API_KEY nunca deve ir para o front-end; só existe aqui, do lado do servidor.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// Netlify encerra funções síncronas em 60s; abortamos antes para devolver um erro claro.
const ANTHROPIC_TIMEOUT_MS = 55000;

// Teto de segurança: o cliente escolhe max_tokens por tipo de chamada, mas nunca acima disto.
const MAX_TOKENS_CEILING = 8000;

// Níveis de esforço aceitos do cliente (parâmetro output_config.effort da API).
const ALLOWED_EFFORT = ["low", "medium", "high"];
const MAX_TOKENS_DEFAULT = 1000;

/**
 * Como desligar o "thinking" varia conforme o modelo (ver guia de migração do Sonnet 5.5):
 *  - claude-sonnet-5-5 rejeita {"type":"disabled"} e exige {"type":"between_tools"};
 *  - modelos anteriores aceitam {"type":"disabled"}.
 * Como a variante exata pode mudar, tentamos em ordem e, se a API responder 400
 * citando "thinking", passamos para a próxima (a última é simplesmente omitir o campo).
 */
function thinkingCandidates(model, noThinking) {
  if (!noThinking) return [null];
  const modern = /-5-5/.test(model);
  return modern
    ? [{ type: "between_tools" }, { type: "disabled" }, null]
    : [{ type: "disabled" }, { type: "between_tools" }, null];
}

async function callAnthropic(body, signal) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(obj),
});

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }
  if (!ANTHROPIC_API_KEY) {
    return json(500, { error: "ANTHROPIC_API_KEY não configurada no servidor." });
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return json(500, { error: "Variáveis do Supabase não configuradas no servidor." });
  }

  // Exige um usuário autenticado — impede que qualquer pessoa na internet
  // use esta function (e sua cota da API da Anthropic) sem estar logada no app.
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json(401, { error: "Não autenticado." });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: userData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !userData?.user) {
    return json(401, { error: "Sessão inválida ou expirada." });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { error: "JSON inválido no corpo da requisição." });
  }

  const { system, user, tools, maxTokens, noThinking, effort } = payload;
  if (!system || !user) {
    return json(400, { error: "Campos 'system' e 'user' são obrigatórios." });
  }

  const requested = Number.isFinite(Number(maxTokens)) ? Number(maxTokens) : MAX_TOKENS_DEFAULT;
  const max_tokens = Math.max(100, Math.min(MAX_TOKENS_CEILING, Math.floor(requested)));

  const baseBody = {
    model: ANTHROPIC_MODEL,
    max_tokens,
    system,
    messages: [{ role: "user", content: user }],
  };
  if (tools) baseBody.tools = tools;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANTHROPIC_TIMEOUT_MS);

  try {
    const candidates = thinkingCandidates(ANTHROPIC_MODEL, !!noThinking);
    let useEffort = ALLOWED_EFFORT.includes(effort);
    let last = null;
    const errorText = () => JSON.stringify(last.data?.error || "").toLowerCase();

    for (const thinking of candidates) {
      // Se a API recusar o parâmetro de esforço, refazemos a chamada sem ele
      // (o esforço é só um ajuste fino; a resposta continua válida sem ele).
      while (true) {
        const body = { ...baseBody };
        if (thinking) body.thinking = thinking;
        if (useEffort) body.output_config = { effort };
        last = await callAnthropic(body, controller.signal);

        const effortRejected =
          last.status === 400 && useEffort && /effort|output_config/.test(errorText());
        if (!effortRejected) break;
        useEffort = false;
      }

      const thinkingRejected = last.status === 400 && errorText().includes("thinking");
      if (!thinkingRejected) break; // sucesso, ou erro que não tem a ver com thinking
    }

    return json(last.status, last.data);
  } catch (e) {
    if (e && e.name === "AbortError") {
      return json(504, { error: "A API demorou demais para responder. Tente novamente." });
    }
    return json(502, { error: "Falha ao contactar a API da Anthropic.", detail: String(e) });
  } finally {
    clearTimeout(timer);
  }
};
