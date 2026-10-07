import assert from "node:assert/strict";
import { makeState, TODAY } from "./sample.mjs";
import * as A from "../src/lib/analytics.js";

// --- datas
assert.equal(A.mondayOf("2026-10-05"), "2026-10-05"); // segunda
assert.equal(A.mondayOf("2026-10-11"), "2026-10-05"); // domingo
assert.equal(A.mondayOf("2026-10-04"), "2026-09-28"); // domingo anterior
assert.equal(A.addDays("2026-03-01", -1), "2026-02-28");
assert.equal(A.periodStart("2026-10-05", 30), "2026-09-06");

// --- parseSets
const cases = [["3x10-12", 3], ["4x6-8", 4], ["3 x 10", 3], ["3x8 com queda de carga na última série até a falha", 3], ["Drop set", null], ["Pirâmide crescente", null], ["", null], ["30x5", null], ["5X5", 5]];
for (const [s, exp] of cases) assert.equal(A.parseSets(s), exp, s);

// --- média móvel com datas esparsas (janela de 7 dias corridos)
const ser = [
  { date: "2026-10-01", peso: 80 }, { date: "2026-10-03", peso: 82 }, { date: "2026-10-05", peso: 81 },
  { date: "2026-10-12", peso: 90 },
];
const ma = A.withMovingAverage(ser, "peso", 7);
assert.equal(ma[0].pesoMedia, 80);
assert.equal(ma[1].pesoMedia, 81);       // (80+82)/2
assert.equal(ma[2].pesoMedia, 81);       // (80+82+81)/3
assert.equal(ma[3].pesoMedia, 90);       // 12/10 - 6 = 6/10: só o próprio ponto (5/10 fica fora)
// --- delta
assert.deepEqual(A.firstLastDelta([{ peso: null }, { peso: 80 }, { peso: 78.5 }], "peso"), { first: 80, last: 78.5, delta: -1.5, count: 2 });
assert.equal(A.firstLastDelta([{ peso: null }], "peso"), null);

// --- kg derivados só com os dois dados no mesmo dia
const logsB = { "2026-10-01": { weight: "80", leanMassPct: "75", bodyFatPct: "20" }, "2026-10-02": { weight: "", bodyFatPct: "19" }, "2026-10-03": { weight: "" } };
const body = A.buildBodySeries(logsB, Object.keys(logsB).sort());
assert.equal(body.length, 2);
assert.equal(body[0].massaMagraKg, 60); assert.equal(body[0].gorduraKg, 16);
assert.equal(body[1].peso, null); assert.equal(body[1].gorduraKg, null);

// --- medidas: log diário + complemento de avaliação antiga (sem sobrescrever)
const logsM = { "2026-09-01": { medidas: { cintura: "90", biceps: "" } }, "2026-09-20": { medidas: { cintura: "88.5" } } };
const ms = A.buildMeasureSeries(logsM, Object.keys(logsM).sort(), [{ date: "2026-08-01", cintura: "92" }, { date: "2026-09-01", cintura: "99", biceps: "35" }]);
assert.deepEqual(ms.cintura.map((p) => [p.date, p.valor]), [["2026-08-01", 92], ["2026-09-01", 90], ["2026-09-20", 88.5]]);
assert.deepEqual(ms.biceps.map((p) => [p.date, p.valor]), [["2026-09-01", 35]]);
const lm = A.latestMeasures(ms);
assert.equal(lm.cintura, "88.5"); assert.equal(lm.peito, "");
assert.equal(A.measureHistoryForPlan(ms).length, 3);

// --- carga: maior carga do dia, ignora vazia/zero, nome case-insensitive
const logsL = {
  "2026-09-01": { strengthWorkouts: [{ exercicios: [{ nome: "Supino reto", carga_kg: "40" }, { nome: "Prancha", carga_kg: "" }] }, { exercicios: [{ nome: "supino RETO ", carga_kg: "42.5" }] }] },
  "2026-09-08": { strengthWorkouts: [{ exercicios: [{ nome: "Supino reto", carga_kg: "45" }, { nome: "Rosca", carga_kg: "0" }] }] },
};
const ls = A.buildLoadSeries(logsL, Object.keys(logsL).sort());
assert.equal(ls.length, 1);
assert.deepEqual(ls[0].pontos.map((p) => p.carga), [42.5, 45]);

// --- volume por grupo (semanas Seg-Dom, séries default = 3)
const logsV = {
  "2026-10-05": { strengthWorkouts: [{ exercicios: [{ nome: "Supino reto", esquema: "4x8" }, { nome: "Crucifixo", esquema: "Drop set" }] }] }, // seg desta semana
  "2026-10-04": { strengthWorkouts: [{ exercicios: [{ nome: "Supino reto", esquema: "3x10" }] }] },                                         // dom semana passada
  "2026-08-01": { strengthWorkouts: [{ exercicios: [{ nome: "Supino reto", esquema: "3x10" }] }] },                                         // fora de 4 semanas
};
const vol = A.buildMuscleVolume(logsV, Object.keys(logsV).sort(), { "supino reto": { grupo_muscular: "peito" } }, "2026-10-05", 4);
assert.equal(vol.rows.length, 4);
assert.equal(vol.rows[3].peito, 4); assert.equal(vol.rows[3].sem_classificacao, 3);
assert.equal(vol.rows[2].peito, 3); assert.equal(vol.rows[0].peito, 0);
assert.deepEqual(vol.groups, ["peito", "sem_classificacao"]);

// --- constância: meta 3 dias/semana
const mk = (dates) => Object.fromEntries(dates.map((d) => [d, { strengthWorkouts: [{}], cardioWorkouts: [] }]));
const logsK = mk([
  "2026-10-05",                                    // semana atual: 1 dia (em andamento)
  "2026-09-28", "2026-09-30", "2026-10-02",        // semana passada: 3 ✔
  "2026-09-21", "2026-09-23", "2026-09-25",        // retrasada: 3 ✔
  "2026-09-14", "2026-09-16",                      // 2 ✘ quebra
]);
const cons = A.buildConsistency(logsK, "2026-10-05", 17, 3);
assert.equal(cons.streak, 2);
assert.equal(cons.columns.length, 17); assert.equal(cons.columns[16].start, "2026-10-05");
assert.equal(cons.columns[16].cells[0].level, "forca"); assert.equal(cons.columns[16].cells[1].level, "futuro");
assert.equal(A.buildConsistency(logsK, "2026-10-05", 17, null).streak, null);
// semana atual cumprindo a meta soma na sequência
const logsK2 = { ...logsK, "2026-10-06": { strengthWorkouts: [{}] }, "2026-10-07": { cardioWorkouts: [{}] } };
assert.equal(A.buildConsistency(logsK2, "2026-10-07", 17, 3).streak, 3);
assert.equal(cons.treinos30, 9);

// --- dados de exemplo completos: roda sem lançar e dá números plausíveis
const st = makeState();
const dates = Object.keys(st.logs).sort();
const b = A.buildBodySeries(st.logs, dates);
console.log("pontos corpo:", b.length, "| kg magra último:", b.filter(x=>x.massaMagraKg).at(-1).massaMagraKg);
const msS = A.buildMeasureSeries(st.logs, dates, st.assessments);
console.log("cintura:", A.firstLastDelta(msS.cintura.map(p => ({...p, v: p.valor})), "valor"));
const volS = A.buildMuscleVolume(st.logs, dates, st.exerciseCatalog, TODAY, 12);
console.log("grupos:", volS.groups.join(","), "totais:", JSON.stringify(volS.totals));
const consS = A.buildConsistency(st.logs, TODAY, 17, 4);
console.log("constância: treinos30", consS.treinos30, "média/sem", consS.mediaSemanal, "sequência", consS.streak);
console.log("TODOS OS TESTES PASSARAM");

// --- minutos por semana
const logsW = {
  "2026-10-05": { strengthWorkouts: [{ duracao: 60 }], cardioWorkouts: [{ duracao: "30" }] },
  "2026-10-04": { strengthWorkouts: [{ duracao: 45 }, { duracao: null }] },
  "2026-09-01": { cardioWorkouts: [{ duracao: 20 }] },
};
const wm = A.buildWeeklyMinutes(logsW, Object.keys(logsW).sort(), "2026-10-05", 3);
assert.deepEqual(wm.map((r) => [r.forca, r.cardio]), [[0, 0], [45, 0], [60, 30]]);
console.log("minutos/semana OK");
