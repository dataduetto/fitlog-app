// Sugestão diária de calorias e macronutrientes, calculada no próprio app (sem IA, sem custo
// de tokens e sem depender de internet). Recalcula sempre que o peso mais recente muda.
//
// Método (estimativa; não substitui acompanhamento de nutricionista):
//  1. Metabolismo basal (BMR):
//       - com altura, idade e sexo: Mifflin-St Jeor
//           homem:  10·peso + 6,25·altura − 5·idade + 5
//           mulher: 10·peso + 6,25·altura − 5·idade − 161
//       - sem isso, mas com % de massa magra (ou de gordura): Katch-McArdle = 370 + 21,6·massa magra (kg)
//       - sem nada disso: 22 kcal por kg (bem aproximado)
//  2. Gasto total (TDEE) = BMR × fator de atividade, onde
//       fator = base do dia a dia (sentado 1,2 · em pé 1,3 · físico 1,4) + 0,05 por dia de treino na semana (máx. 1,9)
//  3. Calorias-alvo = TDEE ajustado pela meta, nunca abaixo do BMR estimado (nem de 1200 kcal)
//       emagrecimento −20% · recomposição −5% · manutenção/resistência 0% · hipertrofia +10%
//  4. Proteína por kg de peso de referência: emagrecimento e recomposição 2,0 g/kg ·
//     hipertrofia 1,8 g/kg · manutenção e resistência 1,6 g/kg.
//     Com IMC > 27 e gordura corporal alta (ou desconhecida), o peso de referência é o peso ajustado
//     (peso ideal para IMC 25 + 40% do excesso), para não inflar a proteína.
//  5. Gordura = o maior entre 0,6 g/kg de referência e 25% das calorias (22% em resistência, 28% em manutenção)
//  6. Carboidratos = o que sobra das calorias (mínimo de 50 g)

import { num } from "./analytics.js";

export const PAL_BASE = { sentado: 1.2, em_pe: 1.3, fisico: 1.4 };

const GOAL_RULES = {
  emagrecimento: { ajuste: -0.2, protGKg: 2.0, gorduraPct: 0.25 },
  recomposicao: { ajuste: -0.05, protGKg: 2.0, gorduraPct: 0.25 },
  hipertrofia: { ajuste: 0.1, protGKg: 1.8, gorduraPct: 0.25 },
  manutencao: { ajuste: 0, protGKg: 1.6, gorduraPct: 0.28 },
  resistencia: { ajuste: 0, protGKg: 1.6, gorduraPct: 0.22 },
};

const round = (x, step = 1) => Math.round(x / step) * step;
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Todos os campos são opcionais, exceto o peso. Quanto mais dados (altura, idade, sexo,
 * % de gordura), mais precisa é a estimativa; sem eles a função usa aproximações e avisa.
 */
export function estimateMacros(input = {}) {
  const w = num(input.pesoKg);
  if (!w || w < 30 || w > 300) return { ok: false, motivo: "sem_peso" };

  const age = num(input.idade);
  if (age != null && age < 18) return { ok: false, motivo: "menor_de_idade" };

  let h = num(input.alturaCm);
  if (h != null && h > 1 && h < 2.5) h = h * 100; // veio em metros
  if (h != null && (h < 120 || h > 230)) h = null;

  const leanPct = num(input.massaMagraPct);
  const fatInput = num(input.gorduraPct);
  const leanOk = leanPct != null && leanPct >= 30 && leanPct <= 99 ? leanPct : null;
  const fatOk = fatInput != null && fatInput >= 3 && fatInput <= 60 ? fatInput : null;
  const lbm = leanOk != null ? (w * leanOk) / 100 : fatOk != null ? w * (1 - fatOk / 100) : null;
  const fatPct = fatOk != null ? fatOk : leanOk != null ? 100 - leanOk : null;

  const sexo = input.sexo === "masculino" || input.sexo === "feminino" ? input.sexo : null;
  const suposicoes = [];
  const avisos = [];
  let aproximado = false;

  // 1. metabolismo basal
  let bmr;
  let metodoBmr;
  if (h != null && age != null) {
    const base = 10 * w + 6.25 * h - 5 * age;
    if (sexo) {
      bmr = base + (sexo === "masculino" ? 5 : -161);
      metodoBmr = "Mifflin-St Jeor";
    } else {
      bmr = base - 78; // média entre homem (+5) e mulher (−161)
      metodoBmr = "Mifflin-St Jeor (sexo não informado: média entre os dois)";
      aproximado = true;
      avisos.push("Informe o sexo na Avaliação para um cálculo mais preciso.");
    }
  } else if (lbm != null) {
    bmr = 370 + 21.6 * lbm;
    metodoBmr = "Katch-McArdle (a partir da massa magra)";
    suposicoes.push("Sem altura ou idade: usando a massa magra informada. Balanças de bioimpedância variam, então trate como referência.");
  } else {
    bmr = 22 * w;
    metodoBmr = "Estimativa simples por peso (22 kcal/kg)";
    aproximado = true;
    avisos.push("Sem altura, idade ou % de gordura a estimativa é bem aproximada. Preencha esses dados na Avaliação.");
  }

  // 2. gasto total
  let pal = PAL_BASE[input.atividadeDiaria];
  if (pal == null) {
    pal = PAL_BASE.sentado;
    suposicoes.push("Atividade do dia a dia não informada: considerando rotina sentada.");
  }
  let dias = num(input.diasTreino);
  if (dias == null) {
    dias = 3;
    suposicoes.push("Dias de treino por semana não informados: considerando 3.");
  }
  dias = Math.min(7, Math.max(0, dias));
  const fator = Math.min(1.9, round2(pal + 0.05 * dias));
  const tdee = bmr * fator;

  // 3. calorias-alvo
  let meta = input.meta;
  if (!GOAL_RULES[meta]) {
    meta = "manutencao";
    suposicoes.push("Meta não definida: calculado para manutenção.");
  }
  const rule = GOAL_RULES[meta];
  let kcal = tdee * (1 + rule.ajuste);
  const piso = Math.max(bmr, 1200);
  if (kcal < piso) {
    kcal = piso;
    avisos.push("Aplicado um piso de segurança: as calorias não ficam abaixo do metabolismo basal estimado.");
  }

  // 4. proteína (peso de referência)
  let ref = w;
  let pesoAjustado = false;
  if (h != null) {
    const m = h / 100;
    const imc = w / (m * m);
    const gorduraAlta = fatPct == null || fatPct >= (sexo === "feminino" ? 32 : 25);
    if (imc > 27 && gorduraAlta) {
      const ideal = 25 * m * m;
      ref = ideal + 0.4 * (w - ideal);
      pesoAjustado = true;
    }
  }
  const prot = Math.round(rule.protGKg * ref);

  // 5. gordura e 6. carboidratos
  const gord = Math.round(Math.max(0.6 * ref, (rule.gorduraPct * kcal) / 9));
  let carb = Math.round((kcal - 4 * prot - 9 * gord) / 4);
  if (carb < 50) {
    carb = 50;
    avisos.push("Calorias muito baixas para a proteína e a gordura mínimas; carboidratos fixados em 50 g. Procure acompanhamento profissional.");
  }

  const kcalFinal = round(4 * prot + 4 * carb + 9 * gord, 10);
  return {
    ok: true,
    calorias_kcal: kcalFinal,
    proteinas_g: prot,
    carboidratos_g: carb,
    gorduras_g: gord,
    porKg: { proteina: round2(prot / w), carboidrato: round2(carb / w), gordura: round2(gord / w) },
    detalhes: {
      pesoKg: w,
      meta,
      ajustePct: Math.round(rule.ajuste * 100),
      metodoBmr,
      bmr: Math.round(bmr),
      fatorAtividade: fator,
      tdee: Math.round(tdee),
      pesoReferenciaKg: round1(ref),
      pesoAjustado,
      protGPorKgRef: rule.protGKg,
      suposicoes,
      avisos,
      aproximado,
    },
  };
}

/** Monta a entrada da calculadora a partir do peso mais recente e da última avaliação. */
export function macroInputFrom({ latestWeight, latestBodyFat, assessment }) {
  const a = assessment || {};
  return {
    pesoKg: latestWeight ? latestWeight.peso : null,
    massaMagraPct: latestWeight ? latestWeight.massaMagra : null,
    gorduraPct: latestBodyFat === "" ? null : latestBodyFat,
    alturaCm: a.alturaCm,
    idade: a.idade,
    sexo: a.sexo,
    atividadeDiaria: a.atividadeDiaria,
    diasTreino: a.frequenciaSemanal,
    meta: a.meta,
  };
}
