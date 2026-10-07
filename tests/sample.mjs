// Dados fictícios determinísticos: 120 dias até 2026-10-05
const DAY = 86400000;
const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
export const TODAY = "2026-10-05";
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const uid = () => Math.random().toString(36).slice(2, 10);

const EX = {
  peito: [["Supino reto", 40, "3x10-12"], ["Supino inclinado", 28, "3x8-10"], ["Crucifixo máquina", 35, "Drop set"]],
  costas: [["Puxada pronada", 50, "4x8-10"], ["Remada baixa", 45, "3x10-12"]],
  perna: [["Agachamento livre", 60, "4x6-8"], ["Leg press", 160, "3x12-15"]],
  ombro: [["Desenvolvimento com halteres", 18, "3x10"], ["Elevação lateral", 8, "3x12-15"]],
};
export const catalog = {
  "supino reto": { nomeOriginal: "Supino reto", grupo_muscular: "peito" },
  "supino inclinado": { nomeOriginal: "Supino inclinado", grupo_muscular: "peito" },
  "puxada pronada": { nomeOriginal: "Puxada pronada", grupo_muscular: "costas" },
  "remada baixa": { nomeOriginal: "Remada baixa", grupo_muscular: "costas" },
  "agachamento livre": { nomeOriginal: "Agachamento livre", grupo_muscular: "perna" },
  "leg press": { nomeOriginal: "Leg press", grupo_muscular: "perna" },
  "desenvolvimento com halteres": { nomeOriginal: "Desenvolvimento com halteres", grupo_muscular: "ombro" },
  "elevação lateral": { nomeOriginal: "Elevação lateral", grupo_muscular: "ombro" },
  // "crucifixo máquina" propositalmente sem classificação
};
const split = ["peito", "costas", "perna", "ombro"];

export function makeState(days = 120) {
  const logs = {};
  const end = Date.parse(TODAY + "T00:00:00Z");
  let trainIdx = 0;
  for (let k = days - 1; k >= 0; k--) {
    const d = toISO(end - k * DAY);
    const t = (days - 1 - k) / (days - 1); // 0..1
    const dow = new Date(d + "T00:00:00Z").getUTCDay();
    const e = { date: d, weight: "", leanMassPct: "", bodyFatPct: "", strengthWorkouts: [], cardioWorkouts: [], meals: [], dietMode: "detalhado", estimatedCalories: "", cheatDay: false, cheatDayNote: "", medidas: {} };
    if (rnd() < 0.8) e.weight = (82 - 4 * t + (rnd() - 0.5) * 1.2).toFixed(1);
    if (k % 4 === 0) { e.bodyFatPct = (22 - 2.5 * t + (rnd() - 0.5) * 0.4).toFixed(1); e.leanMassPct = (76.5 + 2.2 * t + (rnd() - 0.5) * 0.4).toFixed(1); }
    if (k % 7 === 0) e.medidas = { biceps: (35 + 1.5 * t).toFixed(1), peito: (100 + 2 * t).toFixed(1), cintura: (90 - 5 * t).toFixed(1), quadril: (100 - 1 * t).toFixed(1), coxa: (58 + 1 * t).toFixed(1), panturrilha: (37 + 0.5 * t).toFixed(1) };
    // força: seg/qua/sex/sáb (com falhas)
    if ([1, 3, 5, 6].includes(dow) && rnd() < 0.85) {
      const g = split[trainIdx++ % 4];
      e.strengthWorkouts.push({ id: uid(), exercicios: EX[g].map(([nome, c, esq]) => ({ id: uid(), nome, carga_kg: String(Math.round((c * (1 + 0.15 * t)) / 2.5) * 2.5), esquema: esq })), duracao: 60, hr_avg: 120, hr_max: 150, calorias: 350, rpe: 8 });
    }
    if ([2, 4].includes(dow) && rnd() < 0.7) e.cardioWorkouts.push({ id: uid(), tipo: "corrida", duracao: 35, hr_avg: 150, hr_max: 170, pace: "5:50", calorias: 380, rpe: 6 });
    // alimentação
    const r = rnd();
    if (r < 0.1) { e.dietMode = "estimado"; e.estimatedCalories = String(2000 + Math.round(rnd() * 400)); }
    else if (r < 0.15) { e.cheatDay = true; e.meals = [{ id: uid(), descricao: "festa", status: "ok", carboidratos_g: 300, proteinas_g: 90, gorduras_g: 130, calorias_kcal: 3600 }]; }
    else if (r < 0.95) {
      const kcal = 2300 + Math.round((rnd() - 0.5) * 500);
      e.meals = [{ id: uid(), descricao: "dia", status: "ok", carboidratos_g: Math.round(kcal * 0.45 / 4), proteinas_g: 140 + Math.round(rnd() * 30), gorduras_g: Math.round(kcal * 0.25 / 9), calorias_kcal: kcal }];
    }
    logs[d] = e;
  }
  const assessments = [{ id: "a1", date: toISO(end - 90 * DAY), weight: "81", leanMassPct: "77", bodyFatPct: "21", meta: "recomposicao", frequenciaSemanal: "4", metaObs: "", biceps: "35", cintura: "91" }];
  return {
    logs, assessments, exerciseCatalog: catalog,
    currentPlan: { resumoMeta: "Recomposição", metasMacro: { calorias_kcal: 2400, carboidratos_g: 270, proteinas_g: 170, gorduras_g: 70 }, generatedAt: TODAY, assessmentId: "a1",
      proximoTreino: { resumo: "ABCD", sessoes: [] }, treino: { resumo: "", itens: [] }, progressao: { resumo: "", itens: [] }, alimentacao: { resumo: "", itens: [] }, insights: [] },
  };
}
