// Lógica pura de la extensión: no usa APIs de Chrome, así se prueba con  node --test.
//
// - validarUrlApi(): revisa la URL de la API que escribe el usuario en Opciones.
// - validarClave(): revisa la clave de la API antes de guardarla.
// - interpretarSalud(): convierte la respuesta de GET /salud en un resultado para mostrar.
// - interpretarClave(): convierte el código de GET /estadisticas en "clave correcta/incorrecta".
//
// Los mensajes son genéricos a propósito: nunca se muestra el texto crudo de un error.

export const URL_POR_DEFECTO = "http://127.0.0.1:8000";
export const TIEMPO_ESPERA_MS = 5000; // si la API no responde en 5 s, se da por "sin conexión"

// Direcciones de la API que la extensión tiene permiso de usar. DEBE coincidir con
// "host_permissions" de manifest.json (sin mail.google.com): una prueba lo comprueba.
// Cuando se agregue una API por https, se agrega en los dos lugares.
export const ORIGENES_PERMITIDOS = ["http://127.0.0.1:8000"];

const CLAVE_MIN = 16;
const CLAVE_MAX = 256;
const VERSION_VALIDA = /^[\w.-]{1,20}$/;

// ----- URL de la API -----

/**
 * Valida y normaliza la URL base de la API.
 * Devuelve {ok: true, url} (sin "/" al final) o {ok: false, error}.
 * - Sin usuario/contraseña, sin ?consulta ni #fragmento y sin ruta (solo el origen).
 * - Solo se aceptan las direcciones de ORIGENES_PERMITIDOS (las del manifest): con otra,
 *   Chrome no dejaría a la extensión llamar a la API. El mensaje explica por qué.
 */
export function validarUrlApi(texto) {
  const valor = typeof texto === "string" ? texto.trim() : "";
  if (!valor) {
    return { ok: false, error: "Escribe la URL de la API." };
  }
  let url;
  try {
    url = new URL(valor);
  } catch {
    return { ok: false, error: "La URL no es válida. Ejemplo: http://127.0.0.1:8000" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "La URL debe empezar con http:// o https://." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "La URL no debe incluir usuario ni contraseña." };
  }
  if (url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    return { ok: false, error: "Escribe solo la dirección base, sin rutas ni parámetros. Ejemplo: http://127.0.0.1:8000" };
  }
  if (!ORIGENES_PERMITIDOS.includes(url.origin)) {
    return { ok: false, error: motivoNoPermitida(url) };
  }
  return { ok: true, url: url.origin };
}

/** Explica por qué una URL bien escrita no está entre las permitidas por el manifest. */
function motivoNoPermitida(url) {
  if (url.hostname === "localhost") {
    return "Usa 127.0.0.1 en lugar de localhost: es la dirección que la extensión tiene permiso de usar (manifest.json).";
  }
  if (url.protocol === "http:" && url.hostname === "127.0.0.1") {
    return "La API debe estar en el puerto 8000: es el único que la extensión tiene permiso de usar (http://127.0.0.1:8000).";
  }
  if (url.protocol === "https:") {
    return "Por ahora la extensión solo tiene permiso para http://127.0.0.1:8000. Para usar otra dirección https hay que agregarla al manifest.";
  }
  return "La extensión solo tiene permiso para usar la API en http://127.0.0.1:8000 (manifest.json).";
}

/** URL completa de GET /salud a partir de la URL base ya validada. */
export function urlSalud(base) {
  return `${base.replace(/\/+$/, "")}/salud`;
}

// ----- Clave de la API -----

/**
 * Valida la clave antes de guardarla.
 * Debe tener entre 16 y 256 caracteres ASCII visibles (sin espacios): así se puede enviar
 * en el encabezado X-API-Key sin que fetch falle.
 */
export function validarClave(texto) {
  const clave = typeof texto === "string" ? texto.trim() : "";
  if (!clave) {
    return { ok: false, error: "Escribe la clave de la API." };
  }
  if (clave.length < CLAVE_MIN || clave.length > CLAVE_MAX) {
    return { ok: false, error: `La clave debe tener entre ${CLAVE_MIN} y ${CLAVE_MAX} caracteres.` };
  }
  if (!/^[\x21-\x7e]+$/.test(clave)) {
    return { ok: false, error: "La clave solo puede tener letras, números y símbolos, sin espacios ni tildes." };
  }
  return { ok: true, clave };
}

// ----- Respuesta de GET /salud -----

/**
 * Convierte la respuesta de /salud en {tipo, mensaje, version}.
 * tipo: "conectado" | "sin_modelo" | "error".
 * La versión solo se muestra si tiene una forma esperada (ej. "v1.0"); si no, "desconocida".
 */
export function interpretarSalud(estadoHttp, cuerpo) {
  const esObjeto = cuerpo !== null && typeof cuerpo === "object";
  if (estadoHttp !== 200 || !esObjeto) {
    return { tipo: "error", mensaje: "La API respondió de forma inesperada. Revisa la URL en Opciones.", version: null };
  }
  if (cuerpo.estado === "ok" && cuerpo.modelo_cargado === true) {
    const version = typeof cuerpo.version === "string" && VERSION_VALIDA.test(cuerpo.version)
      ? cuerpo.version
      : "desconocida";
    return { tipo: "conectado", mensaje: `Conectado · modelo ${version}`, version };
  }
  if (cuerpo.estado === "sin_modelo" && cuerpo.modelo_cargado === false) {
    return { tipo: "sin_modelo", mensaje: "Conectado, pero el modelo no está disponible.", version: null };
  }
  return { tipo: "error", mensaje: "La API respondió de forma inesperada. Revisa la URL en Opciones.", version: null };
}

/** URL completa de GET /estadisticas (se usa solo para comprobar la clave). */
export function urlEstadisticas(base) {
  return `${base.replace(/\/+$/, "")}/estadisticas`;
}

// ----- Comprobar la clave con GET /estadisticas -----

/**
 * Convierte el código HTTP de GET /estadisticas (con X-API-Key) en {tipo, mensaje}.
 * Solo importa el código: los conteos de la respuesta no se leen ni se muestran.
 * tipo: "clave_correcta" | "clave_incorrecta" | "error".
 */
export function interpretarClave(estadoHttp) {
  if (estadoHttp === 200) {
    return { tipo: "clave_correcta", mensaje: "Clave correcta." };
  }
  if (estadoHttp === 401) {
    return { tipo: "clave_incorrecta", mensaje: "Clave incorrecta. Revísala en Opciones." };
  }
  if (estadoHttp === 429) {
    return { tipo: "error", mensaje: "Demasiadas pruebas seguidas: espera un minuto e inténtalo de nuevo." };
  }
  return { tipo: "error", mensaje: "No se pudo comprobar la clave." };
}

/** Resultado de la clave cuando la petición no llegó (red o tiempo agotado). */
export function resultadoClaveSinConexion() {
  return { tipo: "error", mensaje: "No se pudo comprobar la clave." };
}

/** Resultado de la clave cuando todavía no hay una guardada. */
export function resultadoSinClave() {
  return { tipo: "error", mensaje: "Falta la clave: configúrala en Opciones." };
}

/** Resultado para fallos de red o tiempo agotado (sin detalles técnicos). */
export function resultadoSinConexion() {
  return {
    tipo: "sin_conexion",
    mensaje: "Sin conexión con la API. Revisa que esté encendida y la URL en Opciones.",
    version: null,
  };
}
