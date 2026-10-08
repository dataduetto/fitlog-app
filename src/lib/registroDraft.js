// Rascunho do Registro: o que você está lançando e ainda não salvou como sessão.
// Fica dentro do estado do app (state.rascunhos[data]) e é gravado no banco com o resto,
// por isso não some ao trocar de aba, recarregar a página ou fechar o app no meio do treino.

export function emptyDraft() {
  return {
    treino: null, // id da sessão do plano escolhida (A, B, C…); null = sugestão automática
    exerciseList: [],
    exerciseDraft: { nome: "", carga_kg: "", esquema: "" },
    sessionDraft: { duracao: "", hr_avg: "", hr_max: "", calorias: "", rpe: "7" },
    cardioDraft: { tipo: "corrida", duracao: "", hr_avg: "", hr_max: "", pace: "", calorias: "", rpe: "6" },
  };
}

export function normalizeDraft(d) {
  const e = emptyDraft();
  if (!d) return e;
  return {
    treino: d.treino ?? null,
    exerciseList: Array.isArray(d.exerciseList) ? d.exerciseList : [],
    exerciseDraft: { ...e.exerciseDraft, ...(d.exerciseDraft || {}) },
    sessionDraft: { ...e.sessionDraft, ...(d.sessionDraft || {}) },
    cardioDraft: { ...e.cardioDraft, ...(d.cardioDraft || {}) },
  };
}

const filled = (v) => v !== "" && v != null;

/** Vazio = nada que valha guardar (RPE, tipo de cardio e esquema repetido são só padrões). */
export function draftIsEmpty(d) {
  const x = normalizeDraft(d);
  if (x.treino) return false;
  if (x.exerciseList.length) return false;
  if (filled(x.exerciseDraft.nome) || filled(x.exerciseDraft.carga_kg)) return false;
  const s = x.sessionDraft;
  if ([s.duracao, s.hr_avg, s.hr_max, s.calorias].some(filled)) return false;
  const c = x.cardioDraft;
  if ([c.duracao, c.hr_avg, c.hr_max, c.pace, c.calorias].some(filled)) return false;
  return true;
}

/** Grava/remove o rascunho de uma data dentro do mapa de rascunhos. */
export function setDraftFor(rascunhos, date, draft) {
  const r = { ...(rascunhos || {}) };
  if (draftIsEmpty(draft)) delete r[date];
  else r[date] = draft;
  return r;
}

/** Repetições da fase indicada (o plano guarda uma por fase). */
export function repsFor(ex, phaseIdx = 0) {
  const r = Array.isArray(ex?.reps) ? ex.reps : ex?.reps != null ? [ex.reps] : [];
  if (!r.length) return "";
  return String(r[Math.min(Math.max(phaseIdx, 0), r.length - 1)] ?? "");
}

/** "3x10-12" — formato do campo Esquema de séries. */
export function esquemaFromPlan(ex, phaseIdx) {
  const reps = repsFor(ex, phaseIdx);
  if (ex?.series && reps) return `${ex.series}x${reps}`;
  return reps || (ex?.series ? `${ex.series} séries` : "");
}

const key = (s) => String(s || "").trim().toLowerCase();

/** Última carga lançada para cada exercício até a data (inclusive). */
export function lastLoadsUntil(logs, untilISO) {
  const out = {};
  for (const date of Object.keys(logs || {}).sort()) {
    if (date > untilISO) break;
    for (const s of logs[date].strengthWorkouts || []) {
      for (const ex of s.exercicios || []) {
        if (filled(ex.carga_kg)) out[key(ex.nome)] = { carga: String(ex.carga_kg), date };
      }
    }
  }
  return out;
}

/** Próximo treino da rotação (A → B → C → A…) a partir do último lançado até a data. */
export function suggestNextTreino(logs, untilISO, sessoes) {
  const ids = (sessoes || []).map((s) => s.id);
  if (!ids.length) return null;
  const dates = Object.keys(logs || {}).filter((d) => d <= untilISO).sort().reverse();
  for (const d of dates) {
    const list = (logs[d].strengthWorkouts || []).filter((s) => s.treino && ids.includes(s.treino));
    if (list.length) return ids[(ids.indexOf(list[list.length - 1].treino) + 1) % ids.length];
  }
  return ids[0];
}

/** Acha a prescrição do plano para um nome de exercício (qualquer treino). */
export function findInPlan(sessoes, nome) {
  const k = key(nome);
  if (!k) return null;
  for (const s of sessoes || []) {
    for (const ex of s.exercicios || []) {
      if (key(ex.nome) === k) return { sessao: s.id, ex };
    }
  }
  return null;
}

export { key as exerciseKey };
