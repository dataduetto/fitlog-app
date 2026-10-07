// Funções puras que transformam os registros (logs) em séries para os gráficos do Painel.
// Datas são sempre strings "YYYY-MM-DD" e a aritmética é feita em UTC, para não sofrer
// com fuso horário ou horário de verão.

const DAY_MS = 86400000;

export const MEDIDAS = [
  { key: "biceps", label: "Bíceps" },
  { key: "peito", label: "Peito" },
  { key: "cintura", label: "Cintura" },
  { key: "quadril", label: "Quadril" },
  { key: "coxa", label: "Coxa" },
  { key: "panturrilha", label: "Panturrilha" },
];

// Séries que não têm formato "NxM" (ex.: "Drop set", "Pirâmide crescente") contam como 3.
export const DEFAULT_SETS = 3;

// ---------------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------------
const toMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso, k) => toISO(toMs(iso) + k * DAY_MS);
export const labelOf = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Segunda-feira da semana da data informada. */
export function mondayOf(iso) {
  const dow = new Date(toMs(iso)).getUTCDay(); // 0 = domingo
  return addDays(iso, -((dow + 6) % 7));
}

/** Primeira data (inclusive) do período: 30, 90, 365 dias ou "all". */
export function periodStart(today, period) {
  return period === "all" ? "0000-01-01" : addDays(today, -(Number(period) - 1));
}

export function num(v) {
  if (v === "" || v == null) return null;
  const x = Number(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
}
const round1 = (x) => Math.round(x * 10) / 10;
const round2 = (x) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Composição corporal
// ---------------------------------------------------------------------------
/** Um ponto por dia que tenha peso, % de massa magra ou % de gordura. */
export function buildBodySeries(logs, dates) {
  const out = [];
  for (const d of dates) {
    const e = logs[d] || {};
    const peso = num(e.weight);
    const massaMagra = num(e.leanMassPct);
    const gordura = num(e.bodyFatPct);
    if (peso == null && massaMagra == null && gordura == null) continue;
    out.push({
      date: d,
      label: labelOf(d),
      peso,
      massaMagra,
      gordura,
      // kg só fazem sentido quando peso e percentual foram medidos no mesmo dia
      massaMagraKg: peso != null && massaMagra != null ? round1((peso * massaMagra) / 100) : null,
      gorduraKg: peso != null && gordura != null ? round1((peso * gordura) / 100) : null,
    });
  }
  return out;
}

/** Acrescenta `${key}Media`: média dos valores dos últimos `windowDays` dias corridos. */
export function withMovingAverage(series, key, windowDays = 7) {
  return series.map((p) => {
    if (p[key] == null) return { ...p, [`${key}Media`]: null };
    const from = addDays(p.date, -(windowDays - 1));
    const vals = series.filter((q) => q[key] != null && q.date >= from && q.date <= p.date).map((q) => q[key]);
    return { ...p, [`${key}Media`]: round2(vals.reduce((a, b) => a + b, 0) / vals.length) };
  });
}

export function filterFrom(items, startISO) {
  return items.filter((i) => i.date >= startISO);
}

/** Primeiro e último valor não nulo de `key`, e a diferença entre eles. */
export function firstLastDelta(series, key) {
  const vals = series.filter((p) => p[key] != null);
  if (vals.length === 0) return null;
  const first = vals[0][key];
  const last = vals[vals.length - 1][key];
  return { first, last, delta: round1(last - first), count: vals.length };
}

// ---------------------------------------------------------------------------
// Medidas (circunferências)
// ---------------------------------------------------------------------------
/**
 * Séries por medida, a partir do registro diário (logs[d].medidas). Avaliações antigas,
 * que tinham as medidas só no formulário, entram como complemento nas suas datas.
 */
export function buildMeasureSeries(logs, dates, assessments = []) {
  const byKey = Object.fromEntries(MEDIDAS.map((m) => [m.key, {}]));
  for (const d of dates) {
    const medidas = (logs[d] && logs[d].medidas) || {};
    for (const { key } of MEDIDAS) {
      const v = num(medidas[key]);
      if (v != null) byKey[key][d] = v;
    }
  }
  for (const a of assessments) {
    for (const { key } of MEDIDAS) {
      const v = num(a[key]);
      if (v != null && a.date && byKey[key][a.date] == null) byKey[key][a.date] = v;
    }
  }
  return Object.fromEntries(
    MEDIDAS.map(({ key }) => [
      key,
      Object.keys(byKey[key]).sort().map((d) => ({ date: d, label: labelOf(d), valor: byKey[key][d] })),
    ])
  );
}

/** Último valor lançado de cada medida, como string (para pré-preencher formulários). */
export function latestMeasures(measureSeries) {
  return Object.fromEntries(
    MEDIDAS.map(({ key }) => {
      const s = measureSeries[key] || [];
      return [key, s.length ? String(s[s.length - 1].valor) : ""];
    })
  );
}

/** Histórico compacto das medidas (uma linha por data) para o contexto do plano. */
export function measureHistoryForPlan(measureSeries, maxRows = 12) {
  const byDate = {};
  for (const { key } of MEDIDAS) {
    for (const p of measureSeries[key] || []) {
      byDate[p.date] = { ...(byDate[p.date] || { data: p.date }), [key]: p.valor };
    }
  }
  return Object.keys(byDate).sort().slice(-maxRows).map((d) => byDate[d]);
}

// ---------------------------------------------------------------------------
// Carga por exercício
// ---------------------------------------------------------------------------
/** Maior carga (kg) por dia, para cada exercício que tenha carga numérica. */
export function buildLoadSeries(logs, dates) {
  const map = new Map();
  for (const d of dates) {
    for (const s of (logs[d] && logs[d].strengthWorkouts) || []) {
      for (const ex of s.exercicios || []) {
        const nome = String(ex.nome || "").trim();
        const carga = num(ex.carga_kg);
        if (!nome || carga == null || carga <= 0) continue;
        const key = nome.toLowerCase();
        if (!map.has(key)) map.set(key, { key, nome, byDate: {} });
        const entry = map.get(key);
        entry.nome = nome;
        entry.byDate[d] = Math.max(entry.byDate[d] || 0, carga);
      }
    }
  }
  return [...map.values()]
    .map((e) => ({
      key: e.key,
      nome: e.nome,
      pontos: Object.keys(e.byDate).sort().map((d) => ({ date: d, label: labelOf(d), carga: e.byDate[d] })),
    }))
    .sort((a, b) => b.pontos.length - a.pontos.length || b.pontos[b.pontos.length - 1].date.localeCompare(a.pontos[a.pontos.length - 1].date));
}

// ---------------------------------------------------------------------------
// Volume por grupo muscular
// ---------------------------------------------------------------------------
export function parseSets(esquema) {
  const m = /(\d{1,2})\s*[x×]\s*\d/i.exec(String(esquema || ""));
  const s = m ? Number(m[1]) : null;
  return s && s >= 1 && s <= 20 ? s : null;
}

/** Séries por grupo muscular em cada uma das últimas `weeks` semanas (segunda a domingo). */
export function buildMuscleVolume(logs, dates, catalog, today, weeks) {
  const thisMonday = mondayOf(today);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - 1 - i)));
  const rows = starts.map((s) => ({ semana: labelOf(s), inicio: s }));
  const idx = new Map(starts.map((s, i) => [s, i]));
  const totals = {};
  for (const d of dates) {
    const i = idx.get(mondayOf(d));
    if (i == null || d > today) continue;
    for (const s of (logs[d] && logs[d].strengthWorkouts) || []) {
      for (const ex of s.exercicios || []) {
        const nome = String(ex.nome || "").trim();
        if (!nome) continue;
        const sets = parseSets(ex.esquema) ?? DEFAULT_SETS;
        const grupo = (catalog && catalog[nome.toLowerCase()] && catalog[nome.toLowerCase()].grupo_muscular) || "sem_classificacao";
        rows[i][grupo] = (rows[i][grupo] || 0) + sets;
        totals[grupo] = (totals[grupo] || 0) + sets;
      }
    }
  }
  const groups = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  for (const r of rows) for (const g of groups) r[g] = r[g] || 0;
  return { rows, groups, totals };
}

// ---------------------------------------------------------------------------
// Constância
// ---------------------------------------------------------------------------
const trainedFlags = (e) => ({
  forca: !!(e && (e.strengthWorkouts || []).length),
  cardio: !!(e && (e.cardioWorkouts || []).length),
});

/**
 * Grade de calendário (colunas = semanas, linhas = segunda a domingo) e estatísticas.
 * metaDias: dias de treino por semana da última avaliação (null se não houver).
 * A semana corrente, enquanto não bate a meta, não quebra a sequência (ainda está em andamento).
 */
export function buildConsistency(logs, today, weeks = 17, metaDias = null) {
  const thisMonday = mondayOf(today);
  const firstMonday = addDays(thisMonday, -7 * (weeks - 1));
  const columns = [];
  for (let w = 0; w < weeks; w++) {
    const start = addDays(firstMonday, 7 * w);
    const cells = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const { forca, cardio } = trainedFlags(logs[date]);
      const level = date > today ? "futuro" : forca && cardio ? "ambos" : forca ? "forca" : cardio ? "cardio" : "nenhum";
      cells.push({ date, level });
    }
    columns.push({ start, cells });
  }

  // contagem de dias treinados por semana, até 52 semanas atrás
  const counts = [];
  for (let w = 0; w < 52; w++) {
    const start = addDays(thisMonday, -7 * w);
    let c = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      if (date > today) break;
      const f = trainedFlags(logs[date]);
      if (f.forca || f.cardio) c++;
    }
    counts.push(c);
  }

  let streak = null;
  if (metaDias) {
    streak = 0;
    for (let w = 0; w < counts.length; w++) {
      if (counts[w] >= metaDias) streak++;
      else if (w === 0) continue;
      else break;
    }
  }

  const from30 = addDays(today, -29);
  let treinos30 = 0;
  for (let i = 0; i < 30; i++) {
    const f = trainedFlags(logs[addDays(from30, i)]);
    if (f.forca || f.cardio) treinos30++;
  }
  return { columns, streak, treinos30, mediaSemanal: round1((treinos30 / 30) * 7) };
}

// ---------------------------------------------------------------------------
// Minutos de treino por semana
// ---------------------------------------------------------------------------
export function buildWeeklyMinutes(logs, dates, today, weeks) {
  const thisMonday = mondayOf(today);
  const starts = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, -7 * (weeks - 1 - i)));
  const rows = starts.map((s) => ({ semana: labelOf(s), inicio: s, forca: 0, cardio: 0 }));
  const idx = new Map(starts.map((s, i) => [s, i]));
  for (const d of dates) {
    const i = idx.get(mondayOf(d));
    if (i == null || d > today) continue;
    for (const s of (logs[d] && logs[d].strengthWorkouts) || []) rows[i].forca += num(s.duracao) || 0;
    for (const c of (logs[d] && logs[d].cardioWorkouts) || []) rows[i].cardio += num(c.duracao) || 0;
  }
  return rows;
}
