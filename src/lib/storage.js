import { supabase } from "./supabaseClient";

// Estado inicial vazio — mesmo formato usado dentro do componente FitLog.
export const emptyState = { logs: {}, assessments: [], currentPlan: null, exerciseCatalog: {} };

/**
 * Carrega o estado salvo do usuário logado a partir da tabela app_state.
 * Substitui o antigo window.storage.get() do protótipo em artifact.
 */
export async function loadState(userId) {
  if (!userId) return emptyState;
  const { data, error } = await supabase
    .from("app_state")
    .select("state")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Falha ao carregar estado do Supabase:", error);
    return emptyState;
  }
  if (!data) return emptyState;
  return { ...emptyState, ...data.state };
}

/**
 * Salva (upsert) o estado inteiro do usuário logado.
 * Substitui o antigo window.storage.set() do protótipo em artifact.
 * O upsert é debounced no chamador (ver hook useDebouncedPersist) para não
 * disparar uma escrita no banco a cada tecla digitada.
 */
export async function persistState(userId, state) {
  if (!userId) return;
  const { error } = await supabase
    .from("app_state")
    .upsert(
      { user_id: userId, state, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (error) {
    // eslint-disable-next-line no-console
    console.error("Falha ao salvar estado no Supabase:", error);
  }
}
