// Testa plan-background.js contra um "Supabase" falso (servidor HTTP local) e uma "Anthropic" falsa.
import assert from "node:assert/strict";
import http from "node:http";

const jobs = {};
const server = http.createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const auth = req.headers.authorization || "";
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/auth/v1/user")) {
      if (auth === "Bearer good") return res.end(JSON.stringify({ id: "u1", email: "Halysson@Example.com" }));
      if (auth === "Bearer other") return res.end(JSON.stringify({ id: "u2", email: "intruso@example.com" }));
      res.statusCode = 401; return res.end(JSON.stringify({ message: "bad" }));
    }
    if (req.url.startsWith("/rest/v1/plan_jobs")) {
      const id = /id=eq\.([^&]+)/.exec(req.url)?.[1];
      if (req.method === "GET") { const j = jobs[id]; return res.end(JSON.stringify(j ? j : null)); }
      if (req.method === "PATCH") { Object.assign(jobs[id], body); return res.end("[]"); }
    }
    res.statusCode = 404; res.end("{}");
  });
});
await new Promise((r) => server.listen(0, r));
process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.VITE_SUPABASE_ANON_KEY = "anon";
process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.ALLOWED_EMAILS = "halysson@example.com, outro@x.com";

const calls = [];
const realFetch = globalThis.fetch;
let anthropicReply;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://api.anthropic.com")) {
    calls.push(JSON.parse(opts.body));
    const r = anthropicReply.shift();
    return { status: r.status, json: async () => r.data };
  }
  return realFetch(url, opts);
};

const { handler } = await import("../netlify/functions/plan-background.js");
const { isEmailAllowed } = await import("../netlify/lib/anthropic.js");
const { validatePlan } = await import("../netlify/lib/planPrompt.js");

assert.equal(isEmailAllowed("A@b.com", "a@b.com"), true);
assert.equal(isEmailAllowed("x@b.com", "a@b.com"), false);
assert.equal(isEmailAllowed("x@b.com", ""), true);

const plan = {
  resumoMeta: "x", divisao: "ABC", validade: { semanas: 8 },
  fases: [{ nome: "Adaptação", semanas: "1-4", foco: "" }, { nome: "Força", semanas: "5-8", foco: "" }],
  sessoes: [{ id: "A", foco: "Peito", exercicios: [{ nome: "Supino", series: 4, reps: "10", descanso_s: 90, tecnica: "" }] }],
};
const okReply = () => ({ status: 200, data: { stop_reason: "end_turn", content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "```json\n" + JSON.stringify(plan) + "\n```" }] } });
const call = (token, jobId) => handler({ httpMethod: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ jobId }) });

// sucesso
jobs.j1 = { id: "j1", status: "pending", context: { avaliacaoAtual: { meta: "hipertrofia" } } };
anthropicReply = [okReply()];
let r = await call("good", "j1");
assert.equal(r.statusCode, 200);
assert.equal(jobs.j1.status, "done");
assert.equal(jobs.j1.result.sessoes[0].exercicios[0].reps.length, 2);   // reps normalizadas por fase
assert.equal(jobs.j1.result.validade.sessoes_previstas, 8);              // 1 sessão × 8 semanas
assert.equal(jobs.j1.result.versao, 2);
assert.equal(calls[0].max_tokens, 16000);
assert.equal(calls[0].thinking, undefined);                              // raciocínio ligado
assert.ok(calls[0].messages[0].content.includes("hipertrofia"));

// reexecução do mesmo job não gasta de novo
r = await call("good", "j1"); assert.equal(calls.length, 1);

// erro da API
jobs.j2 = { id: "j2", status: "pending", context: {} };
anthropicReply = [{ status: 529, data: { error: { message: "overloaded" } } }];
await call("good", "j2"); assert.equal(jobs.j2.status, "failed"); assert.match(jobs.j2.error, /overloaded/);

// resposta cortada
jobs.j3 = { id: "j3", status: "pending", context: {} };
anthropicReply = [{ status: 200, data: { stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] } }];
await call("good", "j3"); assert.equal(jobs.j3.status, "failed");

// JSON inválido / plano sem sessões
jobs.j4 = { id: "j4", status: "pending", context: {} };
anthropicReply = [{ status: 200, data: { stop_reason: "end_turn", content: [{ type: "text", text: "desculpe" }] } }];
await call("good", "j4"); assert.equal(jobs.j4.status, "failed");
assert.throws(() => validatePlan({ sessoes: [] }), /sem sessões/);

// autenticação e allowlist
assert.equal((await call("bad", "j1")).statusCode, 401);
const n = calls.length;
assert.equal((await call("other", "j1")).statusCode, 403);
assert.equal(calls.length, n);
assert.equal((await handler({ httpMethod: "POST", headers: {}, body: "{}" })).statusCode, 401);
assert.equal((await handler({ httpMethod: "GET", headers: {} })).statusCode, 405);

console.log("background ok");
server.close();
