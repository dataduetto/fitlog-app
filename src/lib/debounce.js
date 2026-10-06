/**
 * Debounce simples: atrasa a chamada e descarta chamadas intermediárias.
 * Usado para não gravar no Supabase a cada tecla digitada — só a última
 * mudança dentro da janela de `delay` ms é persistida.
 */
export function debounce(fn, delay = 600) {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delay);
  };
  debounced.flush = (...args) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fn(...args);
  };
  return debounced;
}
