# FitLog

Diário de treino e composição corporal, com ficha de treino gerada por IA e sugestão diária de macronutrientes calculada no próprio app (sem registro de alimentos).
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
    claude.js              # IA: classificar exercício (claude-proxy) e gerar a ficha (plan-background + tabela plan_jobs)
    nutrition.js           # calculadora de calorias/macros (sem IA)
    goals.js               # metas, explicações e opções do questionário
    planStatus.js          # validade da ficha (data ou sessões cumpridas)
    debounce.js             # evita gravar no banco a cada tecla digitada
    analytics.js            # cálculos puros dos gráficos do Painel (séries, médias, volume, constância)
netlify/
  functions/
    claude-proxy.js      # chamadas curtas (classificar exercício)
    plan-background.js   # gera a ficha de treino em segundo plano (até 15 min) e grava em plan_jobs
  lib/                   # código compartilhado: login/e-mails autorizados, chamada à Anthropic, prompt da ficha
tests/                   # testes (node tests/*.test.mjs)
supabase/
  schema.sql            # tabelas app_state e plan_jobs + Row Level Security (cada usuário só vê os próprios dados)
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
   | `ALLOWED_EMAILS` | seu e-mail (vários: separe por vírgula). **Recomendado**: só esses e-mails podem usar a IA | **não** |
   | `ANTHROPIC_MODEL` | opcional, padrão `claude-sonnet-5` (também funciona `claude-sonnet-5-5`) | **não** |

4. Deploy. Pegue a URL gerada (ex. `https://fitlog-halysson.netlify.app`) e volte no Supabase para colocá-la em **Site URL** / **Redirect URLs** (passo 1.4), senão o link de login não redireciona de volta corretamente.

### 4. Primeiro acesso

1. Abra a URL do Netlify no celular ou no computador.
2. Digite seu e-mail, clique em **Enviar link de acesso**, abra o e-mail e clique no link — isso te loga (sem senha). Se o link abrir em outro navegador/app, digite no app o **código de 6 dígitos** que vem no mesmo e-mail (veja "Segurança").
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
- **Avaliação (aba Avaliação):** use ao mudar de meta ou de fase. Os campos vêm preenchidos com o seu último lançamento. Ao salvar, a ficha é gerada de novo e o que você **alterou** no formulário também vira lançamento do dia (o que veio pré-preenchido e não foi mexido não vira ponto novo nos gráficos).
- **Questionário (opcional):** sexo, idade, altura, rotina diária, experiência, local, tempo por sessão, divisão, técnicas avançadas, validade, cardio, prioridades e lesões. Nada é obrigatório; o que ficar em branco, a IA decide e lista em "O que o plano assumiu". Sexo, idade, altura e rotina também melhoram o cálculo de calorias e macros.
- **Plano (ficha):** o botão "Gerar nova ficha" usa a última avaliação mais o histórico recente (peso, % de gordura, medidas e treinos). A ficha vem com divisão A/B/C…, séries, repetições por fase, descanso, técnicas avançadas, semana tipo, cardio e **validade**.
- **Pegada, semana e troca de exercício:** cada exercício traz a pegada quando ela importa (pronada, supinada, neutra e largura). O texto "Como seguir a semana" diz se os treinos são em sequência (A, B, C… continua de onde parou) ou em dias fixos. O botão "Não tem na minha academia" pede substitutos à IA (chamada curta e barata) ou aceita um exercício digitado; o original fica guardado ("Voltar ao original") e o que você trocou não volta a ser prescrito nas próximas fichas.
- **Vídeo de execução:** cada exercício tem o link "Ver execução no YouTube", que abre a busca por "como fazer <exercício> execução correta". É uma busca, não um vídeo fixo: a IA não consegue garantir que um link específico exista, então a busca nunca quebra e acompanha o nome do exercício, inclusive depois de uma troca.
- **Divisão (AB, ABC…):** se você não escolher, a IA decide pelos dias de treino por semana (2 dias → AB, 3 → ABC, 4 → AB duas vezes ou ABCD, 5 → ABCDE, 6 → PPL duas vezes). Se a divisão escolhida não combinar com os dias, ela adapta e avisa em "O que o plano assumiu".
- **Salvar registro:** o app salva sozinho poucos segundos depois de cada alteração; o botão "Salvar registro" (fixo no fim da aba Registro) grava na hora e mostra "Registro salvo às HH:MM" ou um erro. Um aviso lembra de treinos preenchidos e ainda não salvos como sessão.
- **Validade da ficha:** vence pela data (semanas) **ou** quando as sessões de força previstas foram cumpridas, o que vier primeiro. Há aviso quando faltam 7 dias (ou 90% das sessões) e um aviso vermelho, em todas as abas, quando vence.

## Macronutrientes

Não há registro de alimentos. O app calcula uma meta diária de calorias, proteínas, carboidratos e gorduras no próprio navegador (arquivo `src/lib/nutrition.js`), sem IA e sem custo de tokens, e recalcula sempre que o peso mais recente muda. Use-a como referência na sua ferramenta de contagem. É uma estimativa (Mifflin-St Jeor ou Katch-McArdle, fator de atividade e ajuste pela meta); o cartão tem "Como é calculado".

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
- **Function exige login e e-mail autorizado**: as functions verificam o token de sessão do Supabase e, se `ALLOWED_EMAILS` estiver definido, se o e-mail está na lista, antes de chamar a Anthropic.
- **Um blob JSONB por usuário** (`app_state.state`): é a forma mais direta de portar o protótipo (que guardava tudo num único objeto) sem redesenhar o modelo de dados agora. Se no futuro você quiser relatórios mais ricos (ex.: "todos os treinos de peito dos últimos 6 meses" via SQL), vale migrar para tabelas relacionais (`daily_logs`, `strength_sessions`, `meals`, `assessments`) — mas para uso pessoal diário o blob é suficiente e mais simples de manter.
- **PWA via `vite-plugin-pwa`**: gera o manifest e o service worker automaticamente no build; os ícones estão em `public/icon-192.png` e `public/icon-512.png` (troque por algo com sua cara quando quiser).

## Segurança

- **Não existe senha**: o login é por link/código enviado ao seu e-mail, que só você abre. É um modelo seguro e mais simples que senha.
- **Feche o cadastro aberto.** No Supabase: Authentication -> Sign In / Providers (ou Settings) -> desligue **Allow new users to sign up**. Crie antes o seu usuário (já existe se você já entrou). Assim ninguém mais consegue criar conta no seu site público.
- **Defina `ALLOWED_EMAILS`** no Netlify (e faça redeploy): mesmo que alguém consiga uma conta, a IA só responde aos e-mails da lista.
- **Código de 6 dígitos (celular):** em Authentication -> Email Templates -> **Magic Link**, inclua `{{ .Token }}` no texto, por exemplo: `Seu código: {{ .Token }}`. O app aceita o código na tela de login. Isso resolve o caso do app instalado na tela inicial, que não compartilha a sessão com o navegador onde o link abriu.
- A sessão fica salva no aparelho; use o botão de sair (canto superior direito) em aparelhos compartilhados.

## Limites e custo das chamadas de IA

- **A ficha roda em segundo plano.** O app grava um pedido na tabela `plan_jobs`, chama `plan-background` (a Netlify responde na hora e deixa a função trabalhar por até 15 minutos, inclusive no plano gratuito) e consulta o resultado a cada 3 segundos. A ficha completa leva de 1 a 3 minutos; mantenha o app aberto. O limite de 60 s das functions comuns não se aplica.
- **Raciocínio ligado na ficha** (esforço `medium`; se a API recusar o parâmetro, refaz sem ele) e desligado na classificação de exercício. O `claude-sonnet-5-5` exige `thinking: {"type":"between_tools"}` para desligar; a function tenta as variantes em ordem (ver `netlify/lib/anthropic.js`).
- **Teto de tokens:** 16000 na ficha (raciocínio + JSON) e 300 na classificação de exercício; `claude-proxy` nunca aceita mais de 4000.
- **Custo:** uma ficha custa na ordem de alguns centavos de dólar. Registrar peso, treino e cardio, e ver macros, gráficos e validade **não** chama a IA. A única chamada automática é classificar o grupo muscular de cada exercício novo (barata).

## Custos

Tudo isso roda nos planos gratuitos do GitHub, Netlify e Supabase para uso pessoal. O único custo real é o consumo da **API da Anthropic** (classificação de exercício e geração da ficha) — cobrado por uso, sem plano gratuito próprio; para uso pessoal (uma ficha a cada poucas semanas), o custo tende a ficar na casa de poucos dólares por mês. Você pode acompanhar em [console.anthropic.com](https://console.anthropic.com) e configurar limites de gasto lá.
