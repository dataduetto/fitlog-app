import { supabase } from "./supabaseClient";

/**
 * Chama a Netlify Function que faz proxy para a API da Anthropic.
 * A chave da API nunca aparece no front-end — fica só na variável de
 * ambiente ANTHROPIC_API_KEY do site no Netlify (ver netlify/functions/claude-proxy.js).
 * A function exige um token de sessão Supabase válido, então só o usuário
 * autenticado consegue disparar chamadas (evita abuso da chave por terceiros).
 */
/**
 * Extrai o objeto JSON da resposta. Com busca na web ativa, o modelo costuma escrever
 * um texto antes de pesquisar ("Vou buscar...") e só no último bloco entrega o JSON,
 * então juntar todos os blocos quebraria o JSON.parse. Tentamos, em ordem:
 * o último bloco de texto, todos os blocos juntos e, por fim, o trecho entre o
 * primeiro "{" e o último "}".
 */
function parseJsonFromTextBlocks(textBlocks) {
  const clean = (s) => s.replace(/```json|```/g, "").trim();
  const attempts = [
    clean(textBlocks[textBlocks.length - 1]),
    clean(textBlocks.join("\n")),
  ];
  const joined = clean(textBlocks.join("\n"));
  const start = joined.indexOf("{");
  const end = joined.lastIndexOf("}");
  if (start !== -1 && end > start) attempts.push(joined.slice(start, end + 1));

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // tenta o próximo
    }
  }
  throw new Error("Não foi possível interpretar a resposta da IA como JSON.");
}

/**
 * maxTokens: teto de tokens de saída desta chamada (a function limita a 6000).
 * noThinking: pede para não gastar tokens com raciocínio — para tarefas simples de
 * extração e geração de JSON isso deixa a resposta mais rápida e mais barata.
 */
async function callClaude({ system, user, tools, maxTokens = 1000, noThinking = true, effort }) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Sessão expirada. Faça login novamente.");
  }

  const response = await fetch("/.netlify/functions/claude-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ system, user, tools, maxTokens, noThinking, effort }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch (e) {
      // ignore
    }
    throw new Error(`Falha na resposta da API (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  const data = await response.json();
  if (data.stop_reason === "max_tokens") {
    throw new Error("Resposta da IA cortada por limite de tokens.");
  }
  const textBlocks = (data.content || []).filter((b) => b.type === "text").map((b) => b.text);
  if (textBlocks.length === 0) throw new Error("Resposta sem conteúdo de texto");
  return parseJsonFromTextBlocks(textBlocks);
}

export async function lookupMacros(descricao) {
  return callClaude({
    system: `Você é um consultor de nutrição. Dado um alimento e sua quantidade descritos em português, pesquise na internet valores nutricionais de referência (tabelas como TACO, USDA) e estime os macronutrientes daquela porção específica.
Responda APENAS com um JSON válido, sem markdown, sem crase, no formato exato:
{"carboidratos_g": number, "proteinas_g": number, "gorduras_g": number, "calorias_kcal": number, "fonte": "string curta citando a base usada"}
Use números arredondados (sem casas decimais desnecessárias). Se a quantidade for ambígua, assuma uma porção padrão razoável.`,
    user: `Alimento: ${descricao}`,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    maxTokens: 1200,
    noThinking: true,
  });
}

export async function classifyExercise(nome) {
  return callClaude({
    system: `Você é um especialista em treinamento de força. Dado o nome de um exercício de academia — que pode ser um nome específico de aparelho de uma academia comercial, nem sempre um nome padrão de livro-texto — identifique o grupo muscular principal e o padrão de movimento.
Responda APENAS com um JSON válido, sem markdown, sem crase, no formato exato:
{"grupo_muscular": "peito|costas|ombro|biceps|triceps|perna|gluteos|panturrilha|core|corpo_inteiro|outro", "padrao_movimento": "string curta, ex: empurrar horizontal, puxar vertical, agachamento"}`,
    user: `Exercício: ${nome}`,
    maxTokens: 300,
    noThinking: true,
  });
}

export async function generatePlanFromContext(context) {
  return callClaude({
    system: `Você é um treinador físico e nutricionista experiente. Você recebe uma avaliação física com meta atual (hipertrofia, emagrecimento, recomposição, resistência ou manutenção), o histórico de avaliações anteriores (peso, massa magra, percentual de gordura, medidas corporais), o registro recente de treinos de força (exercícios, carga, esquema de séries, duração, frequência cardíaca, RPE, além de um catálogo com o grupo muscular já identificado de cada exercício citado pelo nome usado pelo usuário na academia dele), treinos cardiovasculares (tipo, pace, frequência cardíaca, RPE) e o padrão alimentar recente (dias com macronutrientes detalhados, dias com apenas calorias totais estimadas, e dias marcados como "dia do lixo" — consumo calórico alto, possivelmente com álcool, que não deve ser tratado como parte da tendência normal, mas pode ser comentado se for muito frequente). Também recebe "historicoPeso" (peso, % de massa magra e % de gordura lançados no dia a dia) e "historicoMedidas" (circunferências em cm lançadas no registro diário, que podem ser mais recentes do que as da avaliação atual: prefira o dado mais recente e use a tendência para julgar se a meta está funcionando).

Sua tarefa: (1) definir metas diárias de macronutrientes coerentes com a meta e o peso atual do usuário; (2) montar um próximo treino de força concreto e acionável (sessões com foco muscular e exercícios específicos, usando o catálogo de grupos musculares para manter equilíbrio entre grupos e decidir o que manter, aumentar carga ou substituir); (3) sugerir ajustes gerais no treino de força e cardiovascular; (4) sugerir progressão de carga por exercício específico com base no histórico (sobrecarga progressiva); (5) sugerir ajustes na alimentação; (6) trazer observações relevantes sobre a evolução do usuário.

Responda APENAS com um JSON válido, sem markdown, sem crase, sem texto antes ou depois, no formato exato:
{
  "resumoMeta": "string curta explicando a lógica da meta e das metas de macro definidas",
  "metasMacro": {"calorias_kcal": number, "carboidratos_g": number, "proteinas_g": number, "gorduras_g": number},
  "proximoTreino": {"resumo": "string curta sobre a lógica da divisão de treino", "sessoes": [{"foco": "string curta, ex: Peito e tríceps", "exercicios": [{"nome": "string", "alvo": "string curta, ex: 3x10-12", "carga_sugerida": "string curta, ex: manter 30kg ou subir para 32.5kg"}]}]},
  "treino": {"resumo": "string curta", "itens": [{"foco": "string curta", "detalhe": "string com sugestão prática"}]},
  "progressao": {"resumo": "string curta sobre sobrecarga progressiva", "itens": [{"exercicio": "nome do exercício ou grupo muscular", "sugestao": "string curta e específica, citando carga/repetições quando possível"}]},
  "alimentacao": {"resumo": "string curta", "itens": [{"foco": "string curta", "detalhe": "string com sugestão prática"}]},
  "insights": ["string curta", "string curta"]
}
Inclua de 2 a 4 sessões em "proximoTreino.sessoes" (cada uma com 3 a 6 exercícios), 2 a 4 itens em "treino.itens", 2 a 5 em "progressao.itens" e 2 a 4 em "alimentacao.itens", e de 2 a 3 "insights". Seja específico usando os dados fornecidos. Nunca dê conselhos médicos definitivos; para qualquer sinal de risco à saúde, recomende buscar um profissional.`,
    user: `Contexto do usuário:\n${JSON.stringify(context, null, 2)}`,
    // O plano é gerado raramente (a cada avaliação), então vale deixar o modelo raciocinar
    // antes de responder. O raciocínio conta dentro do max_tokens e também consome tempo,
    // por isso: teto de 8000 tokens (plano em JSON ~2500 + raciocínio) e esforço "medium"
    // para ficar dentro do limite de 60s da Netlify Function.
    maxTokens: 8000,
    noThinking: false,
    effort: "medium",
  });
}
