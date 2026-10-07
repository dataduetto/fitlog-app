import assert from "node:assert/strict";
import { planStatus, currentPhaseIndex } from "../src/lib/planStatus.js";
const DAY = 86400000;
const gen = "2026-10-01T12:00:00.000Z";
const plan = { generatedAt: gen, validade: { semanas: 4, sessoes_previstas: 12 } };
const t0 = new Date(gen).getTime();
assert.equal(planStatus({ generatedAt: gen }, {}), null);
let s = planStatus(plan, {}, t0 + 2 * DAY);
assert.deepEqual([s.expired, s.soon, s.daysLeft, s.semanaAtual], [false, false, 26, 1]);
s = planStatus(plan, {}, t0 + 22 * DAY); assert.ok(s.soon && !s.expired);
s = planStatus(plan, {}, t0 + 28 * DAY); assert.ok(s.expired && s.byDate);
const logs = {}; for (let i = 0; i < 12; i++) logs[`2026-10-${String(2 + i).padStart(2, "0")}`] = { strengthWorkouts: [{}] };
logs["2026-09-20"] = { strengthWorkouts: [{}, {}] }; // antes do plano: não conta
s = planStatus(plan, logs, t0 + 14 * DAY); assert.ok(s.expired && s.bySessions && s.done === 12);
const fases = [{ semanas: "1-2" }, { semanas: "3-4" }, { semanas: "5+" }];
assert.deepEqual([1, 2, 3, 4, 5, 9].map((w) => currentPhaseIndex(fases, w)), [0, 0, 1, 1, 2, 2]);
console.log("planStatus ok");
