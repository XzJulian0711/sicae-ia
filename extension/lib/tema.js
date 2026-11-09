// Tema claro u oscuro del panel y de Opciones. Lógica pura (sin APIs de Chrome): se prueba con
// node --test.
//
// - Por defecto se sigue el tema del sistema (prefers-color-scheme).
// - Si la persona elige uno con el botón del sol/luna, se guarda en chrome.storage.local (solo
//   la palabra "claro" u "oscuro": es una preferencia, no un dato del correo) y ese manda.
// - El CSS (estilos/sicae.css) cambia los colores según data-tema en <html>.

export const TEMAS = Object.freeze(["claro", "oscuro"]);

export function esTema(valor) {
  return TEMAS.includes(valor);
}

/** Tema con el que se abre: lo guardado manda; si no hay nada válido, el del sistema. */
export function temaInicial(guardado, sistemaOscuro) {
  if (esTema(guardado)) return guardado;
  return sistemaOscuro === true ? "oscuro" : "claro";
}

export function otroTema(tema) {
  return tema === "oscuro" ? "claro" : "oscuro";
}

/** aria-label y title del botón: dice a qué tema se pasa al pulsarlo. */
export function etiquetaCambio(tema) {
  return tema === "oscuro" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
}

/** Pone data-tema en <html> (raiz = document.documentElement). Un valor raro cuenta como claro. */
export function aplicarTema(raiz, tema) {
  const valido = esTema(tema) ? tema : "claro";
  raiz.dataset.tema = valido;
  return valido;
}

/**
 * Conecta el tema de una página (el panel u Opciones). Todo se inyecta, así se prueba sin Chrome:
 * - raiz: <html>; consulta: matchMedia("(prefers-color-scheme: dark)");
 * - leer() / guardar(tema): lib/almacen.js; alCambiar(fn): avisa si otra página guarda otro tema;
 * - alPintar(tema): para actualizar el botón (aria-label y title).
 * Aplica el tema del sistema ENSEGUIDA (sin esperar a storage), luego el guardado. Mientras no
 * haya una elección, sigue los cambios del sistema.
 * → {listo (promesa: ya se leyó lo guardado), alternar() (para el botón)}.
 */
export function conectarTema({ raiz, consulta, leer, guardar, alCambiar, alPintar = () => {} }) {
  let elegido = null; // null = seguir al sistema
  const pintar = () => alPintar(aplicarTema(raiz, temaInicial(elegido, consulta?.matches === true)));
  pintar();

  const listo = (async () => {
    try {
      const guardado = await leer();
      elegido = esTema(guardado) ? guardado : null;
    } catch {
      elegido = null; // sin storage: se sigue al sistema
    }
    pintar();
  })();

  consulta?.addEventListener?.("change", pintar); // con una elección guardada, no cambia nada
  alCambiar?.((tema) => {
    elegido = esTema(tema) ? tema : null;
    pintar();
  });

  return {
    listo,
    async alternar() {
      elegido = otroTema(raiz.dataset.tema);
      pintar();
      try {
        await guardar(elegido);
      } catch {
        // No se pudo guardar: el tema cambia igual mientras la página esté abierta.
      }
      return elegido;
    },
  };
}
