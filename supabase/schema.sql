-- Execute este script no Supabase: Dashboard -> SQL Editor -> New query -> Run.
--
-- Guarda o estado inteiro do FitLog (logs diários, avaliações, plano atual e
-- catálogo de exercícios) como um único JSONB por usuário. É a forma mais
-- direta de portar o protótipo (que usava um único blob no window.storage)
-- sem redesenhar o modelo de dados agora. Uma evolução natural futura é
-- quebrar "state" em tabelas relacionais (daily_logs, strength_sessions,
-- meals, assessments...) para permitir consultas e relatórios mais ricos.

create table if not exists public.app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

-- Cada usuário só pode ler e escrever a própria linha.
drop policy if exists "app_state_select_own" on public.app_state;
create policy "app_state_select_own"
  on public.app_state for select
  using (auth.uid() = user_id);

drop policy if exists "app_state_insert_own" on public.app_state;
create policy "app_state_insert_own"
  on public.app_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "app_state_update_own" on public.app_state;
create policy "app_state_update_own"
  on public.app_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Mantém updated_at em dia a cada escrita, mesmo que o cliente esqueça de setar.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_state_set_updated_at on public.app_state;
create trigger app_state_set_updated_at
  before update on public.app_state
  for each row execute function public.set_updated_at();
