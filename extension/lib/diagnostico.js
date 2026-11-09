// Paso 7.1 (prueba funcional), SOLO para la cuenta de prueba del proyecto. Lógica pura (sin
// APIs de Chrome ni DOM: se prueba con node --test).
//
// 1. Diagnóstico página vs. API: el mismo correo leído de la página de Gmail (el respaldo de
//    Analizar) y de la API de Gmail (lo que usan Analizar y la Bandeja) se envía a
//    POST /diagnostico, que separa el puntaje del modelo en sus partes. Aquí se comparan: SOLO
//    números, nunca texto del correo.
// 2. Exportar la Bandeja a un CSV local (asunto, categoría, confianza, prioridad y si el cuerpo
//    llegó completo), para llenar evaluacion/funcional/resultados.csv sin copiar a mano. Sin
//    remitentes ni cuerpos.
//
// La API decide quién es la cuenta de prueba (GET /diagnostico/disponible): la extensión no
// guarda ni compara correos.

export function urlDiagnostico(base) {
  return `${base.replace(/\/+$/, "")}/diagnostico`;
}

export function urlDiagnosticoDisponible(base) {
  return `${base.replace(/\/+$/, "")}/diagnostico/disponible`;
}

/** Respuesta de GET /diagnostico/disponible → true solo si dice exactamente true. */
export function interpretarDisponible(estadoHttp, cuerpo) {
  return estadoHttp === 200 && cuerpo !== null && typeof cuerpo === "object" && cuerpo.disponible === true;
}

// Lo que devuelve POST /diagnostico (api/app/esquemas.py, Diagnostico).
export const DECIMALES = ["puntaje", "base", "aporte_texto", "aporte_n_urls", "aporte_n_adjuntos", "aporte_long_cuerpo"];
export const ENTEROS = ["n_urls", "n_adjuntos", "long_cuerpo", "largo_texto_limpio", "terminos"];

const ERRORES = {
  401: "La API no aceptó la sesión: vuelve a iniciar sesión.",
  403: "Falta tu consentimiento en la API: cierra sesión y vuelve a aceptar los permisos.",
  413: "El correo es demasiado grande para la API.",
  422: "La API no aceptó los datos del correo.",
  429: "Demasiadas peticiones seguidas: espera un minuto e inténtalo de nuevo.",
  503: "El modelo no está cargado en la API. Revisa la conexión con «Probar conexión».",
};
export const MENSAJE_SOLO_PRUEBA = "El diagnóstico solo funciona con la cuenta de prueba del proyecto.";
const INESPERADA = { tipo: "error", mensaje: "La API respondió de forma inesperada." };

/**
 * Respuesta de POST /diagnostico → {tipo: "diagnostico", datos} o {tipo: "error", mensaje}.
 * `datos` tiene SOLO las claves conocidas, y todas deben ser números.
 */
export function interpretarDiagnostico(estadoHttp, cuerpo) {
  if (estadoHttp === 403 && cuerpo?.codigo === "solo_cuenta_prueba") return { tipo: "error", mensaje: MENSAJE_SOLO_PRUEBA };
  if (estadoHttp !== 200) return { tipo: "error", mensaje: ERRORES[estadoHttp] ?? "No se pudo hacer el diagnóstico." };
  if (!cuerpo || typeof cuerpo !== "object") return INESPERADA;
  const datos = {};
  for (const clave of DECIMALES) {
    if (typeof cuerpo[clave] !== "number" || !Number.isFinite(cuerpo[clave])) return INESPERADA;
    datos[clave] = cuerpo[clave];
  }
  for (const clave of ENTEROS) {
    if (!Number.isInteger(cuerpo[clave]) || cuerpo[clave] < 0) return INESPERADA;
    datos[clave] = cuerpo[clave];
  }
  return { tipo: "diagnostico", datos };
}

/** Número con coma decimal ("0,14"); con signo si se pide ("+0,85", "−0,30"). */
export function formatoNumero(valor, { decimales = 2, signo = false } = {}) {
  const redondeado = Number(valor.toFixed(decimales));
  const texto = Math.abs(redondeado).toFixed(decimales).replace(".", ",");
  if (redondeado < 0) return `−${texto}`;
  return signo && redondeado > 0 ? `+${texto}` : texto;
}

function entero(valor, { signo = false } = {}) {
  if (valor < 0) return `−${Math.abs(valor)}`;
  return signo && valor > 0 ? `+${valor}` : String(valor);
}

const si = (valor) => (valor ? "sí" : "no");

// Las partes del puntaje que se comparan, con su frase.
export const PARTES = {
  aporte_texto: "del texto (las palabras del asunto y el cuerpo)",
  aporte_n_urls: "de la cantidad de enlaces",
  aporte_n_adjuntos: "de la cantidad de adjuntos",
  aporte_long_cuerpo: "del largo del cuerpo",
};

/**
 * Compara el diagnóstico del respaldo (página de Gmail) y de la API de Gmail (Analizar y Bandeja).
 * recortes = {pagina: ¿Gmail mostró "Mensaje recortado"?, api: ¿se recortó al límite del lote?}.
 * → {filas: [{nombre, pagina, api, diferencia}] (textos listos para mostrar),
 *    principal: clave de PARTES o null, frase}.
 * La diferencia es API − página. Solo números: nada del texto del correo.
 */
export function compararDiagnosticos(pagina, api, recortes = {}) {
  const dif = (clave) => api[clave] - pagina[clave];
  const filaEntero = (nombre, clave) => ({
    nombre, pagina: entero(pagina[clave]), api: entero(api[clave]), diferencia: entero(dif(clave), { signo: true }),
  });
  const filaDecimal = (nombre, clave) => ({
    nombre, pagina: formatoNumero(pagina[clave]), api: formatoNumero(api[clave]),
    diferencia: formatoNumero(dif(clave), { signo: true }),
  });

  const filas = [
    filaEntero("Enlaces (n_urls)", "n_urls"),
    filaEntero("Adjuntos (n_adjuntos)", "n_adjuntos"),
    filaEntero("Largo del cuerpo (caracteres)", "long_cuerpo"),
    { nombre: "Cuerpo recortado", pagina: si(recortes.pagina), api: si(recortes.api), diferencia: "" },
    filaEntero("Términos del modelo en el texto", "terminos"),
    filaDecimal("Puntaje (mayor que 0 = phishing)", "puntaje"),
    filaDecimal("Aporte del texto", "aporte_texto"),
    filaDecimal("Aporte de los enlaces", "aporte_n_urls"),
    filaDecimal("Aporte de los adjuntos", "aporte_n_adjuntos"),
    filaDecimal("Aporte del largo del cuerpo", "aporte_long_cuerpo"),
    filaDecimal("Base (igual en los dos)", "base"),
  ];

  // La parte que más cambia (en valor absoluto). Por debajo de 0,005 no se nota en la tabla.
  let principal = null;
  for (const clave of Object.keys(PARTES)) {
    if (Math.abs(dif(clave)) >= 0.005 && (principal === null || Math.abs(dif(clave)) > Math.abs(dif(principal)))) {
      principal = clave;
    }
  }
  const cambio = `El puntaje pasa de ${formatoNumero(pagina.puntaje)} (página) a ${formatoNumero(api.puntaje)} (API de Gmail).`;
  const frase = principal === null
    ? `${cambio} Las partes del puntaje son iguales en los dos caminos.`
    : `${cambio} La mayor diferencia viene ${PARTES[principal]}: ${formatoNumero(dif(principal), { signo: true })}.`;
  return { filas, principal, frase };
}

// ----- Exportar la Bandeja (CSV local) -----

// BOM de UTF-8 al inicio (como los CSV del proyecto): Excel reconoce las tildes.
const BOM = String.fromCharCode(0xfeff);

export const COLUMNAS_CSV = ["asunto", "categoria", "confianza", "prioridad", "cuerpo_completo"];

/**
 * Una celda de CSV. Si empieza con = + - @, tabulador o retorno, se le antepone ' para que
 * Excel o Sheets no la ejecuten como fórmula (el asunto lo escribe quien envía el correo).
 * Con comas, comillas o saltos de línea va entre comillas.
 */
export function celdaCsv(valor) {
  let texto = String(valor ?? "");
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

/**
 * Items de la Bandeja ({correo: {asunto}, resultado, recortado}) → texto del CSV (con BOM y CRLF,
 * como los CSV del proyecto). SOLO asunto, categoría, confianza, prioridad y cuerpo_completo:
 * nunca el remitente, los destinatarios ni el cuerpo.
 * Sin clasificar: categoría, confianza y prioridad vacías. Phishing: prioridad vacía.
 */
export function csvBandeja(items) {
  const lineas = [COLUMNAS_CSV.join(",")];
  for (const item of Array.isArray(items) ? items : []) {
    const r = item?.resultado ?? null;
    const completo = item?.recortado === true ? "no" : item?.recortado === false ? "si" : "";
    lineas.push([
      typeof item?.correo?.asunto === "string" ? item.correo.asunto.trim() : "",
      r?.categoria ?? "",
      r?.confianza ?? "",
      r && r.categoria !== "phishing" ? (r.prioridad ?? "") : "",
      completo,
    ].map(celdaCsv).join(","));
  }
  return `${BOM}${lineas.join("\r\n")}\r\n`;
}

/** Nombre del archivo con la fecha local: sicae-bandeja-AAAA-MM-DD.csv. */
export function nombreArchivoCsv(fecha = new Date()) {
  const dos = (n) => String(n).padStart(2, "0");
  return `sicae-bandeja-${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}.csv`;
}
