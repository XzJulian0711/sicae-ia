// API de Gmail: lectura de la bandeja (paso 4.4) y, desde el paso 4.5, mover a la PAPELERA,
// deshacerlo y la CUARENTENA de phishing (alcance gmail.modify).
//
// NUNCA hay borrado definitivo ni envío: el cliente solo hace GET y POST, y los POST solo van a
// las rutas de RUTAS_POST_PERMITIDAS (trash, untrash, batchModify y crear la etiqueta). Cualquier
// otra ruta se rechaza antes de pedir nada. Una prueba revisa todo el código.
//
// - El token de Google sale de chrome.identity y va SOLO en Authorization: Bearer (nunca en la
//   URL, en chrome.storage ni en la consola). Si Gmail responde 401, se renueva UNA vez.
// - Los correos leídos viven solo en memoria (el panel los muestra y los manda a la API para
//   clasificarlos). No se guardan en ningún lado.
// - Todo recibe `identidad` (chrome.identity) y `pedir` (fetch) por parámetro: así se prueba
//   con dobles en node --test, sin red.
// - Ante 429, 5xx o los 403 de límite, se REINTENTA hasta 5 veces con espera exponencial y
//   aleatoria (como recomienda Google). Solo al agotar los reintentos se informa el error.

export const URL_GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const MAX_CORREOS = 50; // últimos 50 de Recibidos
// Pedidos a Gmail a la vez. Gmail limita los pedidos simultáneos por usuario y la cuota es de
// 6.000 unidades por minuto (leer un correo completo cuesta 60): con 5 aparecían 429.
export const CONCURRENCIA = 3;
export const TOPE_PUBLICIDAD = 100; // cuántos de Promociones se miden para el tamaño
const TIEMPO_GMAIL_MS = 10_000;

// Reintentos (truncated exponential backoff de Google, con jitter).
export const REINTENTOS_MAX = 5;
export const ESPERA_BASE_MS = 1_000; // Google: esperar al menos 1 s después del error
export const ESPERA_MAX_MS = 32_000;
export const RETRY_AFTER_MAX_MS = 60_000; // si Gmail pide más, se espera 60 s y se reintenta

const CABECERAS_LEIDAS = ["List-Unsubscribe", "List-Unsubscribe-Post", "List-Id", "Precedence", "In-Reply-To"];
const LARGO_MAX_CABECERA = 2_000;

export const MENSAJES_GMAIL = Object.freeze({
  sinPermiso: "Falta el permiso para leer tus correos. Pulsa «Dar permiso» y acéptalo en la ventana de Google.",
  vencido: "Tu sesión de Google venció: vuelve a iniciar sesión.",
  apiApagada: "La API de Gmail no está habilitada en el proyecto de Google Cloud. Avísale al equipo.",
  cuota: "Gmail limitó las consultas: espera un minuto e inténtalo de nuevo.",
  sinRed: "Sin conexión a internet. Revísala e inténtalo de nuevo.",
  inesperada: "Gmail respondió de forma inesperada. Inténtalo de nuevo.",
  reintentando: "Gmail pidió esperar, reintentando…",
});

/** Error de Gmail con un código para el panel ("sin_permiso", "vencido", "cuota"…). */
export class ErrorGmail extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

// ----- Decodificar un mensaje (lógica pura) -----

/** base64url (como lo entrega Gmail) → texto, con el charset de la parte si se conoce. */
export function decodificarBase64Url(datos, charset = "utf-8") {
  if (typeof datos !== "string" || !datos) return "";
  const base64 = datos.replace(/-/g, "+").replace(/_/g, "/");
  const binario = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes); // charset desconocido
  }
}

// Entidades con nombre más comunes en correos en español (el resto se escribe con &#…;).
const ENTIDADES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  iquest: "¿", iexcl: "¡", laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", euro: "€", copy: "©", reg: "®", middot: "·",
};

function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entera, nombre) => {
    if (nombre[0] === "#") {
      const codigo = nombre[1].toLowerCase() === "x" ? Number.parseInt(nombre.slice(2), 16) : Number.parseInt(nombre.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : entera;
    }
    return ENTIDADES[nombre] ?? ENTIDADES[nombre.toLowerCase()] ?? entera;
  });
}

/** HTML → texto plano, sin DOM: quita script/style, respeta saltos de línea y párrafos. */
export function htmlATexto(html) {
  if (typeof html !== "string") return "";
  const texto = html
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return decodificarEntidades(texto)
    .split("\n")
    .map((linea) => linea.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Valores de href (en <a>) y src (en <img>) de un HTML, como cuenta SpaPhish. */
export function enlacesDeHtml(html) {
  if (typeof html !== "string") return [];
  const valores = [];
  const patron = /<(a|img)\b[^>]*?\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const m of html.matchAll(patron)) {
    const etiqueta = m[1].toLowerCase();
    const atributo = m[2].toLowerCase();
    if ((etiqueta === "a" && atributo === "href") || (etiqueta === "img" && atributo === "src")) {
      valores.push(decodificarEntidades(m[3] ?? m[4] ?? m[5] ?? ""));
    }
  }
  return valores;
}

/** URLs escritas en un texto plano (cuando el correo no tiene HTML). */
export function enlacesDeTexto(texto) {
  if (typeof texto !== "string") return [];
  return [...texto.matchAll(/(?:https?:\/\/|www\.)[^\s<>"')]+/gi)].map((m) => m[0]);
}

/** Valor de una cabecera (sin importar mayúsculas), o "". */
export function cabecera(cabeceras, nombre) {
  const buscada = nombre.toLowerCase();
  const encontrada = (cabeceras || []).find((c) => typeof c?.name === "string" && c.name.toLowerCase() === buscada);
  return typeof encontrada?.value === "string" ? encontrada.value : "";
}

/** Direcciones de correo de una cabecera como To o Cc ("Ana <a@x>, b@y" → ["a@x", "b@y"]). */
export function direcciones(valor) {
  if (typeof valor !== "string") return [];
  return [...valor.matchAll(/[^\s<>,;"'()]+@[^\s<>,;"'()]+/g)].map((m) => m[0]);
}

/** Cabecera From → {nombre, direccion}. */
export function remitenteDe(valor) {
  const texto = typeof valor === "string" ? valor.trim() : "";
  const conAngulos = /^(.*?)<([^>]+)>\s*$/.exec(texto);
  const direccion = (conAngulos ? conAngulos[2] : direcciones(texto)[0] ?? "").trim();
  const nombre = (conAngulos ? conAngulos[1] : "").trim().replace(/^"(.*)"$/, "$1").trim();
  return { nombre: nombre || direccion, direccion };
}

function charsetDe(parte) {
  const tipo = cabecera(parte?.headers, "Content-Type");
  return /charset\s*=\s*"?([\w.:-]+)/i.exec(tipo)?.[1] ?? "utf-8";
}

/** Recorre las partes MIME: primer text/plain, primer text/html y cantidad de adjuntos. */
function recorrerPartes(parte, acumulado = { plano: null, html: null, adjuntos: 0 }) {
  if (!parte || typeof parte !== "object") return acumulado;
  const tipo = String(parte.mimeType || "").toLowerCase();
  if (parte.filename) {
    acumulado.adjuntos += 1; // un adjunto: no se abre ni se lee
  } else if (tipo === "text/plain" && acumulado.plano === null && parte.body?.data) {
    acumulado.plano = decodificarBase64Url(parte.body.data, charsetDe(parte));
  } else if (tipo === "text/html" && acumulado.html === null && parte.body?.data) {
    acumulado.html = decodificarBase64Url(parte.body.data, charsetDe(parte));
  }
  for (const hija of Array.isArray(parte.parts) ? parte.parts : []) recorrerPartes(hija, acumulado);
  return acumulado;
}

/**
 * Mensaje de Gmail (format=full) → lo que usa el panel:
 * {id, fecha (ms), tamano, etiquetas, remitenteNombre, correo: {asunto, remitente,
 *  destinatarios, cuerpo, enlaces, nAdjuntos, cabeceras}}.
 * `correo` tiene la forma que espera armarPeticion() (lib/correo.js).
 */
export function interpretarMensaje(mensaje) {
  const payload = mensaje?.payload ?? {};
  const cabeceras = payload.headers ?? [];
  const partes = recorrerPartes(payload);
  const cuerpo = partes.plano ?? htmlATexto(partes.html ?? "");
  const enlaces = partes.html !== null ? enlacesDeHtml(partes.html) : enlacesDeTexto(cuerpo);
  const de = remitenteDe(cabecera(cabeceras, "From"));

  const leidas = {};
  for (const nombre of CABECERAS_LEIDAS) {
    const valor = cabecera(cabeceras, nombre).trim();
    if (valor) leidas[nombre] = valor.slice(0, LARGO_MAX_CABECERA);
  }

  return {
    id: String(mensaje?.id ?? ""),
    fecha: Number(mensaje?.internalDate) || 0,
    tamano: Number(mensaje?.sizeEstimate) || 0,
    etiquetas: Array.isArray(mensaje?.labelIds) ? mensaje.labelIds : [],
    remitenteNombre: de.nombre,
    correo: {
      asunto: cabecera(cabeceras, "Subject"),
      remitente: de.direccion,
      destinatarios: [...direcciones(cabecera(cabeceras, "To")), ...direcciones(cabecera(cabeceras, "Cc"))],
      cuerpo,
      enlaces,
      nAdjuntos: partes.adjuntos,
      cabeceras: leidas,
    },
  };
}

// ----- Errores de Gmail -----

/** Las razones que trae el cuerpo de error de Gmail, en minúsculas. */
function razonesDe(cuerpo) {
  return [
    ...(Array.isArray(cuerpo?.error?.errors) ? cuerpo.error.errors : []).map((e) => e?.reason),
    ...(Array.isArray(cuerpo?.error?.details) ? cuerpo.error.details : []).map((d) => d?.reason),
    cuerpo?.error?.status,
  ].filter(Boolean).map((r) => String(r).toLowerCase());
}

// Razones con las que Gmail avisa de un límite de uso: se muestran como "cuota".
const RAZONES_LIMITE = ["ratelimitexceeded", "userratelimitexceeded", "resource_exhausted"];
// Un 403 se REINTENTA solo con estas dos (las que documenta "Handle errors" de Gmail). Cualquier
// otro 403, en especial el de permiso insuficiente, sale enseguida para mostrar "Dar permiso".
export const RAZONES_403_REINTENTABLES = Object.freeze(["ratelimitexceeded", "userratelimitexceeded"]);
const ESTADOS_SERVIDOR = [500, 502, 503, 504];

/** Respuesta de error de Gmail → ErrorGmail con un código y un mensaje claro. */
export function interpretarErrorGmail(estadoHttp, cuerpo) {
  const razones = razonesDe(cuerpo);
  const hay = (...nombres) => nombres.some((n) => razones.includes(n.toLowerCase()));

  if (estadoHttp === 401) return new ErrorGmail("vencido", MENSAJES_GMAIL.vencido);
  if (estadoHttp === 429 || RAZONES_LIMITE.some((r) => razones.includes(r))) {
    return new ErrorGmail("cuota", MENSAJES_GMAIL.cuota);
  }
  if (estadoHttp === 403 && hay("accessNotConfigured", "SERVICE_DISABLED")) {
    return new ErrorGmail("api_apagada", MENSAJES_GMAIL.apiApagada);
  }
  if (estadoHttp === 403) return new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  return new ErrorGmail("inesperada", MENSAJES_GMAIL.inesperada);
}

// ----- Reintentos (lógica pura) -----

/**
 * ¿Vale la pena reintentar? Sí con 429, con el 403 SOLO si trae rateLimitExceeded o
 * userRateLimitExceeded (Gmail no hizo nada) y, salvo `soloLimite`, con 500, 502, 503 y 504.
 * Nunca con 401 (tiene su propia renovación), 400, 404 ni los otros 403 (permiso insuficiente,
 * API apagada): repetirlos daría lo mismo.
 */
export function esReintentable(estadoHttp, cuerpo, { soloLimite = false } = {}) {
  if (estadoHttp === 429) return true;
  if (estadoHttp === 403) return RAZONES_403_REINTENTABLES.some((r) => razonesDe(cuerpo).includes(r));
  return !soloLimite && ESTADOS_SERVIDOR.includes(estadoHttp);
}

const FECHA_HTTP = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * Cabecera Retry-After → ms de espera (entre 1 s y 60 s), o null si no viene o no se entiende.
 * Acepta segundos ("7") o una fecha HTTP ("Wed, 04 Nov 2026 15:00:00 GMT").
 */
export function esperaRetryAfter(valor, ahora = Date.now()) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  let ms;
  if (/^\d+$/.test(texto)) ms = Number(texto) * 1_000;
  else if (FECHA_HTTP.test(texto)) ms = Date.parse(texto) - ahora;
  else return null;
  if (!Number.isFinite(ms)) return null;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(ESPERA_BASE_MS, ms));
}

/**
 * Cuánto esperar antes del reintento número `intento` (0, 1, 2…): lo que pida Retry-After o,
 * si no viene, 2^intento segundos + hasta 1 s al azar (jitter), con tope de 32 s.
 * El azar evita que los pedidos que fallaron juntos reintenten todos en el mismo instante.
 */
export function esperaReintento(intento, { retryAfterMs = null, azar = Math.random } = {}) {
  if (Number.isFinite(retryAfterMs)) return retryAfterMs;
  const jitter = Math.floor(Math.min(Math.max(Number(azar()) || 0, 0), 0.999) * ESPERA_BASE_MS);
  return Math.min(ESPERA_MAX_MS, ESPERA_BASE_MS * 2 ** intento + jitter);
}

const esperarDeVerdad = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// ----- Cliente de Gmail (con el token en memoria, nunca expuesto) -----

async function tokenDe(identidad) {
  if (typeof identidad?.getAuthToken !== "function") throw new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  let respuesta;
  try {
    respuesta = await identidad.getAuthToken({ interactive: false });
  } catch {
    // Sin token o sin el alcance de Gmail (gmail.modify) aceptado todavía.
    throw new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  }
  const token = typeof respuesta === "string" ? respuesta : respuesta?.token;
  if (!token) throw new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  return token;
}

// Las ÚNICAS rutas a las que se puede hacer POST (paso 4.5). Nada de delete, batchDelete,
// send, drafts ni import: con ellas no se borra de forma definitiva ni se envía nada.
export const RUTAS_POST_PERMITIDAS = Object.freeze([
  /^\/messages\/[\w-]+\/trash$/, // mover a la papelera (se puede deshacer 30 días)
  /^\/messages\/[\w-]+\/untrash$/, // sacar de la papelera (Deshacer)
  /^\/messages\/batchModify$/, // cuarentena: agregar/quitar etiquetas (no la papelera)
  /^\/labels$/, // crear la etiqueta "SICAE/Cuarentena"
]);

export function rutaPostPermitida(ruta) {
  return typeof ruta === "string" && RUTAS_POST_PERMITIDAS.some((patron) => patron.test(ruta));
}

/**
 * Cliente de Gmail: get(ruta) y post(ruta, cuerpo), con el token en la cabecera.
 * Si Gmail responde 401, quita el token de la caché y lo intenta UNA vez más (para todo el
 * cliente). El token queda en esta función: ningún resultado lo devuelve.
 * post() solo acepta las rutas de RUTAS_POST_PERMITIDAS.
 * Ante 429, 5xx o 403 de límite reintenta hasta REINTENTOS_MAX veces: avisa con
 * alReintentar(intento, ms), espera y repite. `esperar` y `azar` se inyectan para las pruebas.
 */
export function crearClienteGmail({ identidad, pedir, esperar = esperarDeVerdad, azar = Math.random, alReintentar = () => {} }) {
  let token = null;
  let renovado = false;

  async function llamar(metodo, ruta, cuerpoJson, intento = 0) {
    if (!token) token = await tokenDe(identidad);
    const usado = token;
    const cabeceras = { Authorization: `Bearer ${usado}` };
    if (cuerpoJson !== undefined) cabeceras["Content-Type"] = "application/json";
    let respuesta;
    try {
      respuesta = await pedir(`${URL_GMAIL}${ruta}`, {
        method: metodo,
        headers: cabeceras,
        body: cuerpoJson === undefined ? undefined : JSON.stringify(cuerpoJson),
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(TIEMPO_GMAIL_MS),
      });
    } catch {
      throw new ErrorGmail("sin_red", MENSAJES_GMAIL.sinRed);
    }
    if (respuesta.status === 401) {
      if (!renovado) {
        renovado = true;
        await identidad.removeCachedAuthToken({ token: usado });
        token = null;
        return llamar(metodo, ruta, cuerpoJson, intento);
      }
      // Otro pedido ya lo renovó mientras este esperaba: se reintenta con el token nuevo.
      if (!token) token = await tokenDe(identidad);
      if (token !== usado) return llamar(metodo, ruta, cuerpoJson, intento);
    }
    let cuerpo = null;
    try {
      cuerpo = await respuesta.json();
    } catch {
      cuerpo = null; // p. ej. 204 sin cuerpo (batchModify)
    }
    if (respuesta.status === 200 || respuesta.status === 204) return cuerpo ?? {};
    if (respuesta.status === 404 && metodo === "GET") return null; // p. ej. sin la categoría Promociones

    // Crear la etiqueta no se repite ante un 5xx: pudo haberse creado y saldría duplicada.
    const soloLimite = metodo === "POST" && ruta === "/labels";
    if (intento < REINTENTOS_MAX && esReintentable(respuesta.status, cuerpo, { soloLimite })) {
      const retryAfter = typeof respuesta.headers?.get === "function" ? respuesta.headers.get("Retry-After") : null;
      const ms = esperaReintento(intento, { retryAfterMs: esperaRetryAfter(retryAfter), azar });
      alReintentar(intento + 1, ms);
      await esperar(ms);
      return llamar(metodo, ruta, cuerpoJson, intento + 1);
    }
    throw interpretarErrorGmail(respuesta.status, cuerpo);
  }

  return {
    get: (ruta) => llamar("GET", ruta),
    post: (ruta, cuerpo = {}) => {
      if (!rutaPostPermitida(ruta)) {
        return Promise.reject(new ErrorGmail("ruta_no_permitida", "Acción de Gmail no permitida."));
      }
      return llamar("POST", ruta, cuerpo);
    },
  };
}

/** Aplica `fn` a cada elemento con como máximo `limite` a la vez; mantiene el orden. */
export async function enParalelo(elementos, limite, fn) {
  const resultados = new Array(elementos.length);
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < elementos.length) {
      const i = siguiente;
      siguiente += 1;
      resultados[i] = await fn(elementos[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, elementos.length) }, trabajador));
  return resultados;
}

/**
 * Últimos MAX_CORREOS de Recibidos, interpretados. alProgresar(leidos, total) avisa el avance.
 * Devuelve {ok: true, mensajes} o {ok: false, codigo, mensaje}.
 */
export async function leerBandeja({ identidad, pedir, alProgresar = () => {}, esperar, azar, alReintentar }) {
  const cliente = crearClienteGmail({ identidad, pedir, esperar, azar, alReintentar });
  try {
    const lista = await cliente.get(`/messages?labelIds=INBOX&maxResults=${MAX_CORREOS}`);
    const ids = (lista?.messages ?? []).map((m) => m.id).filter((id) => typeof id === "string" && /^[\w-]+$/.test(id));
    let leidos = 0;
    alProgresar(0, ids.length);
    const mensajes = await enParalelo(ids, CONCURRENCIA, async (id) => {
      const detalle = await cliente.get(`/messages/${id}?format=full`);
      leidos += 1;
      alProgresar(leidos, ids.length);
      return detalle ? interpretarMensaje(detalle) : null;
    });
    return { ok: true, mensajes: mensajes.filter(Boolean), cliente };
  } catch (error) {
    return error instanceof ErrorGmail
      ? { ok: false, codigo: error.codigo, mensaje: error.message }
      : { ok: false, codigo: "inesperada", mensaje: MENSAJES_GMAIL.inesperada };
  }
}

/**
 * Datos de Promociones para "Sobrecarga de publicidad":
 * {total (messagesTotal, exacto), tamanos: [sizeEstimate de hasta TOPE_PUBLICIDAD], ids}.
 * Si la cuenta no tiene la categoría, total = 0. Errores → null (la tarjeta usa lo detectado).
 */
export async function datosPromociones(cliente) {
  try {
    const etiqueta = await cliente.get("/labels/CATEGORY_PROMOTIONS");
    const total = Number(etiqueta?.messagesTotal) || 0;
    if (total === 0) return { total: 0, tamanos: [], ids: [] };
    const lista = await cliente.get(`/messages?labelIds=CATEGORY_PROMOTIONS&maxResults=${TOPE_PUBLICIDAD}`);
    const ids = (lista?.messages ?? []).map((m) => m.id).filter((id) => typeof id === "string" && /^[\w-]+$/.test(id));
    const tamanos = await enParalelo(ids, CONCURRENCIA, async (id) => {
      const minimo = await cliente.get(`/messages/${id}?format=minimal`);
      return Number(minimo?.sizeEstimate) || 0;
    });
    return { total, tamanos, ids };
  } catch {
    return null;
  }
}

// ===================== Paso 4.5: buscar, mover a la papelera y cuarentena =====================

const ID_SEGURO = /^[\w-]+$/;
const MAX_POR_PAGINA = 500; // máximo de users.messages.list

/**
 * Ids de mensajes de una búsqueda, con páginas, hasta `max`. labelIds: etiquetas (todas deben
 * estar); q: búsqueda de Gmail (older_than, larger). Spam necesita includeSpamTrash.
 * cancelado(): si devuelve true, se para antes de la siguiente página.
 */
export async function listarIds(cliente, { labelIds = [], q = "", includeSpamTrash = false, max = 50 }, cancelado = () => false) {
  const ids = [];
  let pagina = null;
  do {
    if (cancelado()) break;
    const parametros = new URLSearchParams();
    for (const etiqueta of labelIds) parametros.append("labelIds", etiqueta);
    if (q) parametros.set("q", q);
    if (includeSpamTrash) parametros.set("includeSpamTrash", "true");
    parametros.set("maxResults", String(Math.min(MAX_POR_PAGINA, max - ids.length)));
    if (pagina) parametros.set("pageToken", pagina);
    const respuesta = await cliente.get(`/messages?${parametros.toString()}`);
    for (const m of respuesta?.messages ?? []) {
      if (typeof m.id === "string" && ID_SEGURO.test(m.id) && !ids.includes(m.id)) ids.push(m.id);
    }
    pagina = typeof respuesta?.nextPageToken === "string" ? respuesta.nextPageToken : null;
  } while (pagina && ids.length < max);
  return ids.slice(0, max);
}

/** Lee e interpreta cada mensaje (format=full), 5 a la vez, con progreso y cancelar. */
export async function leerMensajes(cliente, ids, { alProgresar = () => {}, cancelado = () => false } = {}) {
  let leidos = 0;
  const mensajes = await enParalelo(ids.filter((id) => ID_SEGURO.test(id)), CONCURRENCIA, async (id) => {
    if (cancelado()) return null;
    const detalle = await cliente.get(`/messages/${id}?format=full`);
    leidos += 1;
    alProgresar(leidos, ids.length);
    return detalle ? interpretarMensaje(detalle) : null;
  });
  return mensajes.filter(Boolean);
}

/**
 * Hace `accion` ("trash" o "untrash") a cada id; si alguno falla, sigue.
 * → {hechos, fallidos, sinPermiso}: sinPermiso es true si alguno falló por falta de permiso.
 */
async function aCadaUno(cliente, ids, accion, alProgresar) {
  const hechos = [];
  const fallidos = [];
  let sinPermiso = false;
  let listos = 0;
  await enParalelo(ids, CONCURRENCIA, async (id) => {
    try {
      if (!ID_SEGURO.test(id)) throw new ErrorGmail("inesperada", MENSAJES_GMAIL.inesperada);
      await cliente.post(`/messages/${id}/${accion}`);
      hechos.push(id);
    } catch (error) {
      fallidos.push(id);
      if (error?.codigo === "sin_permiso") sinPermiso = true; // el panel ofrece "Dar permiso"
    }
    listos += 1;
    alProgresar(listos, ids.length);
  });
  // Mismo orden que `ids`.
  return { hechos: ids.filter((id) => hechos.includes(id)), fallidos: ids.filter((id) => fallidos.includes(id)), sinPermiso };
}

/** Mueve a la PAPELERA (users.messages.trash, se puede deshacer). Nunca borra de forma definitiva. */
export function moverAPapelera(cliente, ids, alProgresar = () => {}) {
  return aCadaUno(cliente, ids, "trash", alProgresar);
}

/** Deshacer: saca de la papelera esos mismos ids (users.messages.untrash). */
export function sacarDePapelera(cliente, ids, alProgresar = () => {}) {
  return aCadaUno(cliente, ids, "untrash", alProgresar);
}

export const NOMBRE_CUARENTENA = "SICAE/Cuarentena";

/** Id de la etiqueta "SICAE/Cuarentena": la busca y, si no existe, la crea. */
export async function asegurarEtiquetaCuarentena(cliente) {
  const lista = await cliente.get("/labels");
  const existente = (lista?.labels ?? []).find((l) => l?.name === NOMBRE_CUARENTENA && typeof l.id === "string");
  if (existente) return existente.id;
  const creada = await cliente.post("/labels", {
    name: NOMBRE_CUARENTENA,
    labelListVisibility: "labelShow",
    messageListVisibility: "show",
  });
  if (typeof creada?.id !== "string") throw new ErrorGmail("inesperada", MENSAJES_GMAIL.inesperada);
  return creada.id;
}

/** Cuarentena: etiqueta "SICAE/Cuarentena" + quitar de Recibidos. NUNCA a la papelera. */
export async function ponerEnCuarentena(cliente, ids) {
  const seguros = ids.filter((id) => ID_SEGURO.test(id));
  const etiqueta = await asegurarEtiquetaCuarentena(cliente);
  await cliente.post("/messages/batchModify", { ids: seguros, addLabelIds: [etiqueta], removeLabelIds: ["INBOX"] });
  return { etiqueta, ids: seguros };
}

/** "Devolver a Recibidos": lo contrario de la cuarentena. */
export async function devolverARecibidos(cliente, ids) {
  const seguros = ids.filter((id) => ID_SEGURO.test(id));
  const etiqueta = await asegurarEtiquetaCuarentena(cliente);
  await cliente.post("/messages/batchModify", { ids: seguros, addLabelIds: ["INBOX"], removeLabelIds: [etiqueta] });
  return { etiqueta, ids: seguros };
}
