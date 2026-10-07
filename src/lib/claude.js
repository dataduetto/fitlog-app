import { supabase } from "./supabaseClient";

/**
 * Chamadas à IA. A chave da Anthropic nunca aparece no front-end: fica só nas variáveis de
 * ambiente do Netlify. As functions exigem um token de sessão Supabase válido e um e-mail
 * autorizado (ALLOWED_EMAILS), então só você consegue disparar chamadas.
 */

function parseJsonText(text) {
  const clean = (s) => s.replace(/```json|```/g, "").trim();
  const c = clean(text);
  try { return JSON.parse(c); } catch (e) { /* tenta o trecho entre chaves */ }
  const a = c.indexOf("{"), b = c.lastIndexOf("}");
  if (a !== -1 && b > a) return JSON.parse(c.slice(a, b + 1));
  throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
}

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Sessão expirada. Faça login novamente.");
  return session.access_token;
}

async function httpError(response) {
  let detail = "";
  try { detail = await response.text(); } catch (e) { /* ignore */ }
  let msg = detail;
  try { msg = JSON.parse(detail).error || detail; } catch (e) { /* texto puro */ }
  return new Error(`Falha na resposta da API (${response.status})${msg ? `: ${msg}` : ""}`);
}

/** Chamada curta e síncrona (classificação de exercício). */
async function callClaude({ system, user, maxTokens = 1000, noThinking = true, effort }) {
  const token = await getToken();
  const response = await fetch("/.netlify/functions/claude-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ system, user, maxTokens, noThinking, effort }),
  });
  if (!response.ok) throw await httpError(response);
  const data = await response.json();
  if (data.stop_reason === "max_tokens") throw new Error("Resposta da IA cortada por limite de tokens.");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  if (!text) throw new Error("Resposta sem conteúdo de texto");
  return parseJsonText(text);
}

export async function classifyExercise(nome) {
  return callClaude({
    system: `Você é um especialista em treinamento de força. Dado o nome de um exercício de academia — que pode ser um nome específico de aparelho de uma academia comercial, nem sempre um nome padrão de livro-texto — identifique o grupo muscular principal e o padrão de movimento.
Responda APENAS com um JSON válido, sem markdown, sem crase, no formato exato:
{"grupo_muscular": "peito|costas|ombro|biceps|triceps|perna|gluteos|panturrilha|core|corpo_inteiro|outro", "padrao_movimento": "string curto, ex: empurrar horizontal, puxar vertical, agachamento"}`,
    user: `Exercício: ${nome}`,
    maxTokens: 300,
    noThinking: true,
  });
}

const POLL_MS = 3000;
const POLL_LIMIT_MS = 8 * 60 * 1000;

/**
 * Gera o plano em segundo plano: grava o pedido em plan_jobs, aciona a função da Netlify
 * (que responde na hora e continua trabalhando por até 15 min) e consulta o resultado.
 * `sleep` e `now` são injetáveis para teste.
 */
export async function generatePlanFromContext(context, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const token = await getToken();
  const { data: job, error: insErr } = await supabase.from("plan_jobs").insert({ context }).select("id").single();
  if (insErr || !job) throw new Error(`Não foi possível iniciar o plano: ${insErr?.message || "sem resposta"}. O script SQL mais recente foi executado no Supabase?`);

  const response = await fetch("/.netlify/functions/plan-background", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId: job.id }),
  });
  if (!response.ok) {
    await supabase.from("plan_jobs").delete().eq("id", job.id);
    throw await httpError(response);
  }

  const started = now();
  while (now() - started < POLL_LIMIT_MS) {
    await sleep(POLL_MS);
    const { data, error } = await supabase.from("plan_jobs").select("status,result,error").eq("id", job.id).maybeSingle();
    if (error) continue; // falha de rede momentânea: tenta de novo
    if (data?.status === "done" && data.result) {
      supabase.from("plan_jobs").delete().eq("id", job.id).then(() => {}, () => {});
      return data.result;
    }
    if (data?.status === "failed") {
      supabase.from("plan_jobs").delete().eq("id", job.id).then(() => {}, () => {});
      throw new Error(data.error || "A geração do plano falhou.");
    }
  }
  throw new Error("O plano está demorando mais que o normal. Aguarde alguns minutos e tente novamente.");
}
