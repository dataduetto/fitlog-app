// Validade do plano: vence pela data (semanas) OU quando as sessões previstas foram cumpridas.
const DAY = 86400000;

export function countStrengthSessionsSince(logs, sinceISO) {
  const since = String(sinceISO).slice(0, 10);
  let total = 0;
  for (const [date, entry] of Object.entries(logs || {})) {
    if (date >= since) total += (entry.strengthWorkouts || []).length;
  }
  return total;
}

/** Retorna null para planos sem validade (formato antigo). */
export function planStatus(plan, logs, nowMs = Date.now()) {
  if (!plan || !plan.validade || !plan.generatedAt) return null;
  const { semanas, sessoes_previstas } = plan.validade;
  const gen = new Date(plan.generatedAt).getTime();
  const expiresMs = gen + semanas * 7 * DAY;
  const daysLeft = Math.ceil((expiresMs - nowMs) / DAY);
  const done = countStrengthSessionsSince(logs, plan.generatedAt);
  const byDate = nowMs >= expiresMs;
  const bySessions = sessoes_previstas > 0 && done >= sessoes_previstas;
  const expired = byDate || bySessions;
  const soon = !expired && (daysLeft <= 7 || (sessoes_previstas > 0 && done >= sessoes_previstas * 0.9));
  return {
    expired, soon, byDate, bySessions, daysLeft, done, previstas: sessoes_previstas, semanas,
    expiresAt: new Date(expiresMs).toISOString(),
    // fase em curso, estimada pelo tempo decorrido
    semanaAtual: Math.max(1, Math.min(semanas, Math.floor((nowMs - gen) / (7 * DAY)) + 1)),
  };
}

/** Descobre o índice da fase atual a partir de textos como "1-2", "3-5", "6+". */
export function currentPhaseIndex(fases, semanaAtual) {
  if (!Array.isArray(fases) || fases.length === 0) return 0;
  for (let i = 0; i < fases.length; i++) {
    const m = String(fases[i].semanas || "").match(/(\d+)\s*(?:[-–a]\s*(\d+)|\+)?/);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : /\+/.test(fases[i].semanas) ? Infinity : a;
    if (semanaAtual >= a && semanaAtual <= b) return i;
  }
  return Math.min(fases.length - 1, 0);
}
