// Lógica pura del análisis de un correo (sin APIs de Chrome ni DOM: se prueba con node --test).
//
// - esPestanaGmail(): ¿la pestaña activa es Gmail?
// - interpretarLectura(): convierte la respuesta del content script en {ok, correo} o un mensaje.
// - contarEnlaces(): cuenta los href/src distintos, como url_count de SpaPhish.
// - recortarCuerpo(): deja el cuerpo dentro del límite de la API.
// - armarPeticion(): arma el JSON exacto que pide POST /analizar (api/app/esquemas.py).
// - armarPeticionGmail() y prepararAnalisis(): el mismo armado en todo el panel (paso 7.1).
// - interpretarAnalisis(): convierte la respuesta de /analizar en lo que se muestra.
//
// Nada de esto guarda el correo: solo transforma datos que viven en memoria.

// Límites de la API (valores por defecto de api/app/config.py y esquemas.py). Si se cambian en
// el .env de la API, la API responde 422/413 y el panel lo explica.
export const MAX_ASUNTO = 1_000;
export const MAX_CUERPO = 50_000;
export const MAX_DESTINATARIOS = 100;
export const LARGO_MAX_DIRECCION = 320;
// Tamaño máximo de la petición completa en bytes (max_bytes de config.py; más = 413). Puede
// llegar antes que MAX_CUERPO: un carácter de control ocupa 6 bytes en el JSON (\u0001) y uno
// chino ocupa 3.
export const MAX_BYTES = 200_000;
// Lote (paso 4.4, pestaña Bandeja): POST /analizar/lote admite hasta MAX_LOTE correos y
// MAX_BYTES_LOTE bytes (max_lote y max_bytes_lote de config.py). Cada correo del lote se
// recorta a su parte, dejando 1 KB para las llaves y comas del JSON.
export const MAX_LOTE = 50;
export const MAX_BYTES_LOTE = 2_000_000;
export const MAX_BYTES_POR_CORREO_LOTE = Math.floor((MAX_BYTES_LOTE - 1_000) / MAX_LOTE);

const ORIGEN_GMAIL = "https://mail.google.com/";

// ----- Pestaña y lectura -----

/**
 * La URL de la pestaña solo llega si la extensión tiene permiso para ese sitio
 * (host_permissions): en cualquier otra pestaña llega undefined.
 */
export function esPestanaGmail(url) {
  return typeof url === "string" && url.startsWith(ORIGEN_GMAIL);
}

export function resultadoNoGmail() {
  return { tipo: "error", mensaje: "Abre un correo en Gmail para analizarlo." };
}

export function resultadoRecargarGmail() {
  return { tipo: "error", mensaje: "Recarga la pestaña de Gmail (F5) y vuelve a intentarlo." };
}

const FALTANTES = {
  remitente: "No se encontró el remitente del correo.",
  cuerpo: "No se encontró el texto del correo.",
};

/**
 * Respuesta del content script → {ok: true, correo} o {ok: false, resultado}.
 * Mensajes claros, sin fallar, si no hay correo abierto o falta algo.
 */
export function interpretarLectura(respuesta) {
  if (respuesta?.ok === true && respuesta.correo && typeof respuesta.correo === "object") {
    return { ok: true, correo: respuesta.correo };
  }
  if (respuesta?.motivo === "sin_correo") {
    return { ok: false, resultado: resultadoNoGmail() };
  }
  if (respuesta?.motivo === "incompleto" && FALTANTES[respuesta.falta]) {
    return { ok: false, resultado: { tipo: "error", mensaje: `${FALTANTES[respuesta.falta]} Abre el correo completo e inténtalo de nuevo.` } };
  }
  return { ok: false, resultado: { tipo: "error", mensaje: "No se pudo leer el correo: puede que Gmail haya cambiado su página." } };
}

// ----- Armar la petición -----

/** Cantidad de href/src DISTINTOS y no vacíos (SpaPhish cuenta enlaces, imágenes, "#" y mailto:). */
export function contarEnlaces(lista) {
  if (!Array.isArray(lista)) return 0;
  const unicos = new Set();
  for (const valor of lista) {
    if (typeof valor === "string" && valor.trim()) unicos.add(valor.trim());
  }
  return unicos.size;
}

/**
 * Recorta el texto a `maximo` caracteres sin partir un emoji (par sustituto de UTF-16).
 * Devuelve {texto, recortado}.
 */
export function recortarCuerpo(texto, maximo = MAX_CUERPO) {
  const valor = typeof texto === "string" ? texto : "";
  if (valor.length <= maximo) {
    return { texto: valor, recortado: false };
  }
  let corte = maximo;
  const ultimo = valor.charCodeAt(corte - 1);
  if (ultimo >= 0xd800 && ultimo <= 0xdbff) corte -= 1; // mitad de un emoji: se deja fuera
  return { texto: valor.slice(0, corte), recortado: true };
}

/** Bytes UTF-8 del JSON, igual al cuerpo que envía panel.js (JSON.stringify de la petición). */
export function bytesJson(valor) {
  return new TextEncoder().encode(JSON.stringify(valor)).length;
}

/**
 * Si la petición pasa MAX_BYTES, recorta el cuerpo al largo más grande que cabe (búsqueda
 * binaria; recortarCuerpo no parte emojis). Devuelve la petición o null si ni vacía cabe.
 */
function ajustarABytes(peticion, maxBytes) {
  if (bytesJson(peticion) <= maxBytes) return peticion;
  const original = peticion.cuerpo;
  const conLargo = (largo) => ({ ...peticion, cuerpo: recortarCuerpo(original, largo).texto });
  if (bytesJson(conLargo(0)) > maxBytes) return null;
  let cabe = 0; // este largo cabe
  let noCabe = original.length; // este largo no cabe
  while (noCabe - cabe > 1) {
    const medio = Math.floor((cabe + noCabe) / 2);
    if (bytesJson(conLargo(medio)) <= maxBytes) cabe = medio;
    else noCabe = medio;
  }
  return conLargo(cabe);
}

function esDireccion(valor) {
  return typeof valor === "string" && valor.length <= LARGO_MAX_DIRECCION && /^[^\s@]+@[^\s@]+$/.test(valor);
}

// Cabeceras que se envían a la API cuando el correo viene de la API de Gmail (paso 4.4). Desde
// la página no se ven, así que en Analizar van vacías. Límites de api/app/config.py.
export const CABECERAS_PERMITIDAS = ["List-Unsubscribe", "List-Unsubscribe-Post", "List-Id", "Precedence", "In-Reply-To"];
export const MAX_VALOR_CABECERA = 2_000;

/** Solo las cabeceras permitidas, como texto y recortadas. */
function limpiarCabeceras(cabeceras) {
  const limpias = {};
  if (!cabeceras || typeof cabeceras !== "object") return limpias;
  for (const nombre of CABECERAS_PERMITIDAS) {
    const valor = cabeceras[nombre];
    if (typeof valor === "string" && valor.trim()) limpias[nombre] = valor.trim().slice(0, MAX_VALOR_CABECERA);
  }
  return limpias;
}

/**
 * Datos leídos de Gmail → {ok: true, peticion, recortado} o {ok: false, resultado}.
 * `peticion` tiene exactamente los campos de CorreoEntrada (la API rechaza campos de más).
 * maxBytes: tope de la petición (por defecto MAX_BYTES; en un lote, la parte de cada correo).
 */
export function armarPeticion(correo, { maxBytes = MAX_BYTES } = {}) {
  if (!correo || typeof correo !== "object") {
    return { ok: false, resultado: { tipo: "error", mensaje: "No se pudo leer el correo." } };
  }
  const remitente = typeof correo.remitente === "string" ? correo.remitente.trim() : "";
  if (!esDireccion(remitente)) {
    return { ok: false, resultado: { tipo: "error", mensaje: FALTANTES.remitente } };
  }

  const vistos = new Set();
  const destinatarios = [];
  for (const valor of Array.isArray(correo.destinatarios) ? correo.destinatarios : []) {
    const direccion = typeof valor === "string" ? valor.trim() : "";
    if (esDireccion(direccion) && !vistos.has(direccion.toLowerCase())) {
      vistos.add(direccion.toLowerCase());
      destinatarios.push(direccion);
    }
  }

  const asunto = typeof correo.asunto === "string" ? correo.asunto.trim() : "";
  const cuerpo = recortarCuerpo(correo.cuerpo);
  const nAdjuntos = Number.isInteger(correo.nAdjuntos) && correo.nAdjuntos >= 0 ? correo.nAdjuntos : 0;

  const armada = {
    asunto: recortarCuerpo(asunto, MAX_ASUNTO).texto,
    cuerpo: cuerpo.texto,
    remitente,
    destinatarios: destinatarios.slice(0, MAX_DESTINATARIOS),
    cabeceras: limpiarCabeceras(correo.cabeceras), // desde la página de Gmail llegan vacías
    n_urls: contarEnlaces(correo.enlaces),
    n_adjuntos: nAdjuntos,
  };

  // Segundo límite: los bytes de la petición completa (el primero fue MAX_CUERPO caracteres).
  const peticion = ajustarABytes(armada, maxBytes);
  if (peticion === null) {
    return { ok: false, resultado: { tipo: "error", mensaje: "El correo es demasiado grande para la API." } };
  }
  return { ok: true, recortado: cuerpo.recortado || peticion !== armada, peticion };
}

/**
 * La ÚNICA forma de armar la petición en el panel (paso 7.1): Analizar, Bandeja, Liberar espacio
 * y el diagnóstico usan el mismo límite, el de cada correo del lote. Así el mismo correo llega
 * igual a la API venga de donde venga.
 */
export function armarPeticionGmail(correo) {
  return armarPeticion(correo, { maxBytes: MAX_BYTES_POR_CORREO_LOTE });
}

/**
 * Analizar (paso 7.1): el correo abierto se lee con la API de Gmail, con el MISMO lector que la
 * Bandeja. La página es solo el respaldo (sin id, sin permiso de Gmail, sin red, o si falla).
 * - pagina: lo que leyó el content script (trae idGmail).
 * - leerDeGmail(id): devuelve el mensaje interpretado (interpretarMensaje) o null; puede lanzar.
 * → lo de armarPeticionGmail() + {fuente: "api" | "pagina", correo}.
 */
export async function prepararAnalisis(pagina, leerDeGmail) {
  if (pagina?.idGmail && typeof leerDeGmail === "function") {
    try {
      const mensaje = await leerDeGmail(pagina.idGmail);
      const armado = mensaje?.correo ? armarPeticionGmail(mensaje.correo) : null;
      if (armado?.ok) return { ...armado, fuente: "api", correo: mensaje.correo };
    } catch {
      // Sin permiso de Gmail, sin red o Gmail falló: se usa la página (sin detalles).
    }
  }
  return { ...armarPeticionGmail(pagina), fuente: "pagina", correo: pagina };
}

// Nota gris de la tarjeta cuando Analizar usó el respaldo (paso 7.1). Textos fijos.
export const NOTA_RESPALDO = "Leído desde la página de Gmail (no se pudo usar la API de Gmail): el resultado puede variar un poco respecto a la Bandeja.";
export const NOTA_RESPALDO_PARCIAL = "Leído desde la página de Gmail (no se pudo usar la API de Gmail). No se pudo separar del todo el aviso de Gmail del texto del correo: el resultado puede variar más respecto a la Bandeja.";

/**
 * Lo que devolvió prepararAnalisis() → la nota de la tarjeta, o null si se leyó con la API.
 * limpiezaParcial lo pone gmail/lector.js cuando tuvo que usar su protección.
 */
export function notaRespaldo(armado) {
  if (armado?.fuente !== "pagina") return null;
  return armado.correo?.limpiezaParcial === true ? NOTA_RESPALDO_PARCIAL : NOTA_RESPALDO;
}

/** URL completa de POST /analizar a partir de la URL base ya validada. */
export function urlAnalizar(base) {
  return `${base.replace(/\/+$/, "")}/analizar`;
}

// ----- Respuesta de POST /analizar -----

const CATEGORIAS = ["legitimo", "publicidad", "phishing"];
const PRIORIDADES = ["alta", "media", "baja"];
const CONFIANZAS = ["alta", "dudosa"];

const ERRORES = {
  401: "La API no aceptó la sesión: vuelve a iniciar sesión.",
  403: "Falta tu consentimiento en la API: cierra sesión y vuelve a aceptar los permisos.",
  413: "El correo es demasiado grande para la API.",
  422: "La API no aceptó los datos del correo.",
  429: "Demasiados análisis seguidos: espera un minuto e inténtalo de nuevo.",
  503: "El modelo no está cargado en la API. Revisa la conexión con «Probar conexión».",
};

const INESPERADA = { tipo: "error", mensaje: "La API respondió de forma inesperada." };

/**
 * Respuesta de /analizar → {tipo: "resultado", categoria, confianza, prioridad, motivos} o
 * {tipo: "error", mensaje}. Solo se aceptan categorías, confianzas y prioridades conocidas.
 * Los motivos pasan crudos: tarjeta.js los filtra y el panel los muestra como texto.
 */
export function interpretarAnalisis(estadoHttp, cuerpo) {
  if (estadoHttp !== 200) {
    return ERRORES[estadoHttp] ? { tipo: "error", mensaje: ERRORES[estadoHttp] } : { tipo: "error", mensaje: "No se pudo analizar el correo." };
  }
  if (!cuerpo || typeof cuerpo !== "object") return INESPERADA;

  const { categoria, prioridad, confianza, motivos } = cuerpo;
  if (!CATEGORIAS.includes(categoria) || !CONFIANZAS.includes(confianza)) return INESPERADA;
  if (prioridad !== null && !PRIORIDADES.includes(prioridad)) return INESPERADA;

  return { tipo: "resultado", categoria, confianza, prioridad, motivos: Array.isArray(motivos) ? motivos : [] };
}

/** URL completa de POST /analizar/lote (paso 4.4). */
export function urlAnalizarLote(base) {
  return `${base.replace(/\/+$/, "")}/analizar/lote`;
}

/**
 * Respuesta de /analizar/lote → {tipo: "lote", resultados} o {tipo: "error", mensaje}.
 * `resultados` tiene un elemento por correo enviado (`cantidad`), en el mismo orden: el
 * resultado validado por interpretarAnalisis(), o null si ese correo no se pudo analizar o
 * llegó algo inesperado.
 */
export function interpretarLote(estadoHttp, cuerpo, cantidad) {
  if (estadoHttp !== 200) return interpretarAnalisis(estadoHttp, null);
  const lista = cuerpo?.resultados;
  if (!Array.isArray(lista) || lista.length !== cantidad) return INESPERADA;
  return {
    tipo: "lote",
    resultados: lista.map((r) => {
      const validado = interpretarAnalisis(200, r);
      return validado.tipo === "resultado" ? validado : null;
    }),
  };
}

/** Resultado para fallos de red o tiempo agotado (sin detalles técnicos). */
export function resultadoAnalisisSinConexion() {
  return { tipo: "error", mensaje: "Sin conexión con la API. Revisa que esté encendida y la URL en Opciones." };
}
