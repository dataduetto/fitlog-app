# FitLog

Diário de treino, composição corporal e alimentação com sugestões geradas por IA.
Stack: **Vite + React** (front-end) · **Supabase** (banco + autenticação) · **Netlify** (hospedagem + function de proxy da IA).

## Como está organizado

```
src/
  App.jsx              # decide entre tela de login e o app, com base na sessão do Supabase
  main.jsx             # ponto de entrada React
  components/
    Login.jsx           # login por magic link (sem senha)
    FitLog.jsx           # o app inteiro: registro, avaliação, plano, painel, histórico
  lib/
    supabaseClient.js    # cliente do Supabase (usa VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
    storage.js            # loadState/persistState -> tabela app_state no Postgres
    claude.js              # chamadas de IA -> sempre via /.netlify/functions/claude-proxy
    debounce.js             # evita gravar no banco a cada tecla digitada
    analytics.js            # cálculos puros dos gráficos do Painel (séries, médias, volume, constância)
netlify/
  functions/
    claude-proxy.js    # guarda a ANTHROPIC_API_KEY no servidor e valida a sessão antes de chamar a Anthropic
supabase/
  schema.sql            # tabela app_state + Row Level Security (cada usuário só vê os próprios dados)
```

## Passo a passo do deploy

### 1. Supabase (banco + login)

1. Crie um projeto em [supabase.com](https://supabase.com) (gratuito).
2. Vá em **SQL Editor -> New query**, cole o conteúdo de `supabase/schema.sql` e rode. Isso cria a tabela `app_state` já com Row Level Security (cada usuário só lê/escreve a própria linha).
3. Em **Authentication -> Providers**, confirme que **Email** está habilitado (vem habilitado por padrão).
4. Em **Authentication -> URL Configuration**, adicione a URL do seu site Netlify (depois do passo 3) em **Site URL** e **Redirect URLs** — é para onde o link mágico de login vai te trazer de volta.
5. Em **Project Settings -> API**, copie a **Project URL** e a chave **anon public** — vai usar as duas em `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

### 2. GitHub

1. Crie um repositório novo (ex.: `fitlog-app`) e suba esta pasta:
   ```bash
   git init
   git add .
   git commit -m "FitLog: primeira versão portada para Vite + Supabase + Netlify"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/fitlog-app.git
   git push -u origin main
   ```

### 3. Netlify

1. Em [app.netlify.com](https://app.netlify.com), **Add new site -> Import an existing project**, conecte o GitHub e escolha o repositório.
2. O Netlify já vai detectar `netlify.toml` (build command `npm run build`, publish `dist`, functions em `netlify/functions`) — não precisa mudar nada.
3. Antes do primeiro deploy (ou depois, e redeploy), configure em **Site settings -> Environment variables**:

   | Nome | Valor | Visível no front-end? |
   |---|---|---|
   | `VITE_SUPABASE_URL` | URL do seu projeto Supabase | sim (é público, tudo bem) |
   | `VITE_SUPABASE_ANON_KEY` | chave anon do Supabase | sim (é pública por design) |
   | `ANTHROPIC_API_KEY` | sua chave da API da Anthropic ([console.anthropic.com](https://console.anthropic.com)) | **não** — só a function usa |
   | `ANTHROPIC_MODEL` | opcional, padrão `claude-sonnet-5` (também funciona `claude-sonnet-5-5`) | **não** |

4. Deploy. Pegue a URL gerada (ex. `https://fitlog-halysson.netlify.app`) e volte no Supabase para colocá-la em **Site URL** / **Redirect URLs** (passo 1.4), senão o link de login não redireciona de volta corretamente.

### 4. Primeiro acesso

1. Abra a URL do Netlify no celular ou no computador.
2. Digite seu e-mail, clique em **Enviar link de acesso**, abra o e-mail e clique no link — isso te loga (sem senha).
3. No celular (Android ou iPhone), use **Adicionar à tela de início** do navegador para instalar como app (PWA) — abre em tela cheia, como um app nativo.

## Rodando localmente (opcional, para testar antes de subir)

```bash
cp .env.example .env
# preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env
npm install
npm run dev
```

A Netlify Function (`claude-proxy.js`) só roda de verdade quando publicada no Netlify, ou localmente via [Netlify CLI](https://docs.netlify.com/cli/get-started/) (`netlify dev`, que precisa da `ANTHROPIC_API_KEY` configurada em `netlify env:set` ou num `.env` lido pelo CLI). Sem isso, as telas de Alimentação/Avaliação/Plano vão dar erro ao chamar a IA — o resto do app (registro de peso, treino, navegação) funciona normalmente.

## Registro diário x Avaliação

- **Registro (aba Registro):** peso, % de massa magra, % de gordura e **medidas corporais** (bíceps, peito, cintura, quadril, coxa, panturrilha) podem ser lançados no dia que você quiser. Isso só grava no banco: não chama a IA e não gera plano. Todos os campos são opcionais.
- **Avaliação (aba Avaliação):** use ao mudar de meta ou de fase. Os campos vêm preenchidos com o seu último lançamento. Ao salvar, o plano é gerado de novo e o que você **alterou** no formulário também vira lançamento do dia (o que veio pré-preenchido e não foi mexido não vira ponto novo nos gráficos).
- **Plano:** o botão "Atualizar com dados recentes" usa a última avaliação mais o histórico recente (peso, % de gordura, medidas, treinos, alimentação), então as medidas lançadas no Registro já entram sem precisar de avaliação nova.

## Painel (gráficos)

Um seletor de período (30 dias, 90 dias, 1 ano, tudo) vale para todo o painel:

1. **Peso**, com média móvel de 7 dias (a linha forte) sobre os pontos diários.
2. **Gordura e massa magra**, em % ou em kg (kg só nos dias em que peso e percentual foram lançados juntos). Cada linha tem o seu eixo.
3. **Medidas corporais**, uma por vez, com a variação no período.
4. **Constância:** calendário das últimas 17 semanas (força, cardio ou os dois) e quantas semanas seguidas você cumpriu a meta de dias por semana da última avaliação. A semana corrente não quebra a sequência enquanto está em andamento.
5. **Séries por grupo muscular, por semana**, usando a classificação automática dos exercícios. Conta as séries do esquema (4x8 = 4); esquemas sem o formato NxM (ex.: "Drop set") contam como 3.
6. **Minutos de treino por semana** (força e cardio).
7. **Progressão de carga** por exercício: a maior carga lançada em cada dia. Só entram exercícios com carga em kg.
8. **Calorias por dia** contra a meta do plano. Dias do lixo e dias com só calorias totais têm cor própria e ficam fora das médias de calorias e proteína. Mostra no máximo 90 dias.

## Por que essa arquitetura

- **Nada obrigatório de campo**: mantido do protótipo original — todo dado é opcional, dias sem peso/treino/comida continuam funcionando.
- **Chave da Anthropic nunca no navegador**: fica só na variável de ambiente do Netlify, usada exclusivamente dentro da function `claude-proxy.js`, que roda no servidor.
- **Function exige login**: a function verifica o token de sessão do Supabase antes de chamar a Anthropic — evita que outra pessoa na internet use sua cota de API sem estar logada no seu app.
- **Um blob JSONB por usuário** (`app_state.state`): é a forma mais direta de portar o protótipo (que guardava tudo num único objeto) sem redesenhar o modelo de dados agora. Se no futuro você quiser relatórios mais ricos (ex.: "todos os treinos de peito dos últimos 6 meses" via SQL), vale migrar para tabelas relacionais (`daily_logs`, `strength_sessions`, `meals`, `assessments`) — mas para uso pessoal diário o blob é suficiente e mais simples de manter.
- **PWA via `vite-plugin-pwa`**: gera o manifest e o service worker automaticamente no build; os ícones estão em `public/icon-192.png` e `public/icon-512.png` (troque por algo com sua cara quando quiser).

## Limites e custo das chamadas de IA (já tratados no código)

- **Raciocínio desligado em macros e classificação de exercício; ligado no plano.** Estimar macros e classificar exercício são tarefas simples de extração de JSON; deixar o modelo "pensar" só gastaria tokens de saída (cobrados) e tempo. Já o plano é gerado raramente e se beneficia de raciocínio, então ele roda com o raciocínio padrão do modelo e esforço `medium` (parâmetro `output_config.effort`; se a API recusar o parâmetro, a function refaz a chamada sem ele). Para desligar, a function (`claude-proxy.js`) se adapta ao modelo: o `claude-sonnet-5-5` exige `thinking: {"type":"between_tools"}` (e rejeita `disabled`), os anteriores aceitam `disabled`. Ela tenta as variantes em ordem e usa a que a API aceitar. Fonte: [guia de migração do Sonnet 5.5](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide).
- **Teto de tokens por tipo de chamada**, definido em `src/lib/claude.js`: 1200 para macros, 300 para classificar exercício, 8000 para o plano (o JSON do plano tem ~2500 tokens e o raciocínio conta dentro do mesmo teto). A function nunca aceita mais de 8000.
- **Se o plano estourar os 60s:** o raciocínio deixa a resposta mais lenta. Se isso acontecer com frequência, as saídas são baixar `effort` para `"low"` em `generatePlanFromContext`, dividir o plano em duas chamadas, ou mover a geração para uma Netlify Background Function (limite de 15 min), que grava o resultado no Supabase e o app consulta.
- **Limite de tempo.** Funções síncronas da Netlify têm limite fixo de 60 segundos ([docs](https://docs.netlify.com/build/functions/configuration/)). A function aborta aos 55s e devolve um erro claro em vez de travar.
- **Busca na web.** Com a busca ativa, o modelo costuma escrever um texto antes de pesquisar; o parser em `claude.js` extrai o JSON mesmo assim.

## Custos

Tudo isso roda nos planos gratuitos do GitHub, Netlify e Supabase para uso pessoal. O único custo real é o consumo da **API da Anthropic** (estimativa de macros, classificação de exercício e geração do plano) — cobrado por uso, sem plano gratuito próprio; para um uso pessoal diário (algumas refeições e um plano por semana), o custo tende a ficar na casa de poucos dólares por mês. Você pode acompanhar em [console.anthropic.com](https://console.anthropic.com) e configurar limites de gasto lá.
