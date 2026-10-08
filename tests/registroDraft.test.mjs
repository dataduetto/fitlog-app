import assert from "node:assert/strict";
import { emptyDraft, normalizeDraft, draftIsEmpty, setDraftFor, repsFor, esquemaFromPlan, lastLoadsUntil, suggestNextTreino, findInPlan } from "../src/lib/registroDraft.js";

// rascunho vazio x preenchido
assert.equal(draftIsEmpty(emptyDraft()), true);
assert.equal(draftIsEmpty({ exerciseDraft: { esquema: "3x10" } }), true); // esquema repetido sozinho não conta
assert.equal(draftIsEmpty({ exerciseList: [{ nome: "Supino" }] }), false);
assert.equal(draftIsEmpty({ exerciseDraft: { nome: "Sup" } }), false);
assert.equal(draftIsEmpty({ treino: "B" }), false);
assert.equal(normalizeDraft({ sessionDraft: { duracao: "50" } }).sessionDraft.rpe, "7");

// setDraftFor remove a data quando esvazia
let r = setDraftFor({}, "2026-10-08", { exerciseList: [{ nome: "Supino" }] });
assert.ok(r["2026-10-08"]);
r = setDraftFor(r, "2026-10-08", emptyDraft());
assert.equal(r["2026-10-08"], undefined);

// reps por fase
const ex = { nome: "Supino reto", series: 4, reps: ["12", "10", "8"] };
assert.equal(repsFor(ex, 0), "12");
assert.equal(repsFor(ex, 5), "8");
assert.equal(repsFor({ reps: "10" }, 2), "10");
assert.equal(esquemaFromPlan(ex, 1), "4x10");

// última carga e rotação A→B→C
const logs = {
  "2026-10-01": { strengthWorkouts: [{ treino: "A", exercicios: [{ nome: "Supino reto", carga_kg: "30" }] }] },
  "2026-10-03": { strengthWorkouts: [{ treino: "B", exercicios: [{ nome: "supino reto", carga_kg: "32.5" }] }] },
  "2026-10-09": { strengthWorkouts: [{ treino: "C", exercicios: [{ nome: "Supino reto", carga_kg: "40" }] }] },
};
assert.deepEqual(lastLoadsUntil(logs, "2026-10-08")["supino reto"], { carga: "32.5", date: "2026-10-03" });
const sessoes = [{ id: "A" }, { id: "B" }, { id: "C" }];
assert.equal(suggestNextTreino(logs, "2026-10-08", sessoes), "C");
assert.equal(suggestNextTreino(logs, "2026-10-09", sessoes), "A");
assert.equal(suggestNextTreino({}, "2026-10-08", sessoes), "A");
assert.equal(suggestNextTreino(logs, "2026-10-08", []), null);

assert.equal(findInPlan([{ id: "A", exercicios: [ex] }], "  SUPINO reto ").sessao, "A");
assert.equal(findInPlan([{ id: "A", exercicios: [ex] }], "Leg press"), null);
console.log("rascunho ok");
