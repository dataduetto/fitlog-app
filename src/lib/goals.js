// Metas disponíveis na Avaliação, com uma explicação em linguagem simples de cada uma.
// Os percentuais citados aqui são os mesmos usados em nutrition.js (a calculadora de macros).

export const GOALS = {
  hipertrofia: "Hipertrofia",
  emagrecimento: "Emagrecimento",
  recomposicao: "Recomposição corporal",
  resistencia: "Resistência / condicionamento",
  manutencao: "Manutenção",
};

export const GOAL_INFO = {
  hipertrofia:
    "Ganhar massa muscular. Calorias um pouco acima da manutenção (+10%), proteína alta e treino de força com aumento gradual de carga. Um pequeno ganho de gordura junto com o músculo é normal.",
  emagrecimento:
    "Perder gordura preservando ao máximo a massa magra. Déficit moderado de calorias (−20%), proteína alta e treino de força mantido. O ritmo saudável costuma ficar entre 0,5% e 1% do peso por semana.",
  recomposicao:
    "Perder gordura e ganhar músculo ao mesmo tempo. Calorias próximas da manutenção (−5%), proteína alta e treino de força com progressão. Funciona melhor para quem está começando, voltando a treinar depois de uma pausa ou tem bastante gordura a perder. É mais lento do que focar em uma coisa de cada vez, e o peso na balança quase não muda: acompanhe pela cintura, pelas medidas e pelo % de gordura.",
  resistencia:
    "Melhorar o condicionamento (corrida, provas, esportes). Calorias na manutenção com mais carboidratos para sustentar o volume de treino, mantendo a musculação para força e prevenção de lesões.",
  manutencao:
    "Manter o peso e a composição corporal atuais. Calorias na manutenção e treino suficiente para conservar a massa muscular.",
};

export const SEXO_OPCOES = [
  { id: "masculino", label: "Masculino" },
  { id: "feminino", label: "Feminino" },
];

export const ATIVIDADE_DIARIA_OPCOES = [
  { id: "sentado", label: "Maior parte do dia sentado (escritório, estudo)" },
  { id: "em_pe", label: "Bastante em pé ou caminhando (comércio, professor)" },
  { id: "fisico", label: "Trabalho físico pesado" },
];

export const EXPERIENCIA_OPCOES = [
  { id: "iniciante", label: "Iniciante (menos de 6 meses seguidos)" },
  { id: "intermediario", label: "Intermediário (6 meses a 2 anos)" },
  { id: "avancado", label: "Avançado (mais de 2 anos seguidos)" },
];

export const LOCAL_OPCOES = [
  { id: "academia_completa", label: "Academia completa" },
  { id: "academia_basica", label: "Academia básica / poucos aparelhos" },
  { id: "casa_halteres", label: "Em casa com halteres e barras" },
  { id: "peso_corporal", label: "Peso do corpo, sem equipamentos" },
];

export const DIVISAO_OPCOES = [
  { id: "", label: "Deixar o plano escolher pelos dias (recomendado)" },
  { id: "fullbody", label: "Corpo inteiro (full body)" },
  { id: "upper_lower", label: "Superior / inferior" },
  { id: "ab", label: "AB (2 treinos: ex. superior e inferior)" },
  { id: "abc", label: "ABC" },
  { id: "abcd", label: "ABCD" },
  { id: "abcde", label: "ABCDE" },
  { id: "ppl", label: "Empurrar / puxar / pernas" },
];

export const TECNICAS_OPCOES = [
  { id: "nao", label: "Não usar" },
  { id: "poucas", label: "Poucas (nas últimas séries de alguns exercícios)" },
  { id: "frequentes", label: "Frequentes (drop set, bi-set, pirâmide, rest-pause)" },
];

export const CICLO_OPCOES = [
  { id: "", label: "Deixar o plano escolher" },
  { id: "4", label: "4 semanas" },
  { id: "6", label: "6 semanas" },
  { id: "8", label: "8 semanas" },
  { id: "12", label: "12 semanas" },
];

export const ORGANIZACAO_OPCOES = [
  { id: "", label: "Deixar o plano escolher (sequência)" },
  { id: "sequencia", label: "Sequência: A, B, C… continua de onde parou" },
  { id: "fixo", label: "Dias fixos da semana" },
];

export const CARDIO_OPCOES = [
  { id: "sem_preferencia", label: "Sem preferência" },
  { id: "corrida", label: "Corrida" },
  { id: "bike", label: "Bicicleta" },
  { id: "esteira", label: "Esteira (caminhada inclinada)" },
  { id: "eliptico", label: "Elíptico" },
  { id: "natacao", label: "Natação" },
];

export const PRIORIDADES_OPCOES = [
  { id: "peito", label: "Peito" },
  { id: "costas", label: "Costas" },
  { id: "ombros", label: "Ombros" },
  { id: "bracos", label: "Braços" },
  { id: "pernas", label: "Pernas" },
  { id: "gluteos", label: "Glúteos" },
  { id: "abdomen", label: "Abdômen" },
];

export const TEMPO_SESSAO_OPCOES = [30, 45, 60, 75, 90];
