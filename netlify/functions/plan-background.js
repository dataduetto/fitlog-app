// Função em segundo plano (o sufixo "-background" no nome faz a Netlify aceitar o pedido na hora,
// responder 202 e deixar a função rodar por até 15 minutos). O resultado vai para a tabela
// plan_jobs do Supabase, e o app consulta essa tabela até o plano ficar pronto.
import { ANTHROPIC_API_KEY, authenticate, callModel, json, parseJsonFromContent, userClient } from "../lib/anthropic.js";
import { PLAN_SYSTEM_PROMPT, validatePlan } from "../lib/planPrompt.js";

const MAX_TOKENS = 16000;
const TIMEOUT_MS = 12 * 60 * 1000;

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
  const auth = await authenticate(event);
  if (auth.error) return auth.error;

  let jobId;
  try { jobId = JSON.parse(event.body || "{}").jobId; } catch (e) { /* abaixo */ }
  if (!jobId) return json(400, { error: "jobId ausente." });

  const db = userClient(auth.token);
  const finish = async (patch) => {
    const { error } = await db.from("plan_jobs").update(patch).eq("id", jobId);
    if (error) console.error("Falha ao gravar resultado do job:", error.message);
  };

  try {
    const { data: job, error } = await db.from("plan_jobs").select("id,status,context").eq("id", jobId).maybeSingle();
    if (error || !job) return json(404, { error: "Job não encontrado." });
    // Evita gastar duas vezes se a Netlify repetir a execução.
    if (job.status !== "pending") return json(200, { ok: true, skipped: job.status });
    if (!ANTHROPIC_API_KEY) {
      await finish({ status: "failed", error: "ANTHROPIC_API_KEY não configurada no servidor." });
      return json(200, { ok: false });
    }
    await finish({ status: "running" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let last;
    try {
      last = await callModel({
        system: PLAN_SYSTEM_PROMPT,
        user: `Contexto do usuário:\n${JSON.stringify(job.context, null, 2)}`,
        max_tokens: MAX_TOKENS,
        noThinking: false,
        effort: "medium",
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }

    if (last.status !== 200) {
      const msg = last.data?.error?.message || `a API respondeu ${last.status}`;
      await finish({ status: "failed", error: `Falha na API da Anthropic: ${msg}` });
      return json(200, { ok: false });
    }
    if (last.data?.stop_reason === "max_tokens") {
      await finish({ status: "failed", error: "A resposta da IA foi cortada por limite de tamanho. Tente novamente." });
      return json(200, { ok: false });
    }
    const plan = validatePlan(parseJsonFromContent(last.data?.content));
    await finish({ status: "done", result: plan, error: null });
    return json(200, { ok: true });
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "A IA demorou demais para responder." : String(e?.message || e);
    await finish({ status: "failed", error: msg });
    return json(200, { ok: false });
  }
};
