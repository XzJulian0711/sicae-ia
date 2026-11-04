// Lectura de la bandeja con la API de Gmail (paso 4.4). SOLO LECTURA (alcance gmail.readonly):
// aquí solo hay peticiones GET; nada mueve, borra ni envía correos.
//
// - El token de Google sale de chrome.identity y va SOLO en Authorization: Bearer (nunca en la
//   URL, en chrome.storage ni en la consola). Si Gmail responde 401, se renueva UNA vez.
// - Los correos leídos viven solo en memoria (el panel los muestra y los manda a la API para
//   clasificarlos). No se guardan en ningún lado.
// - Todo recibe `identidad` (chrome.identity) y `pedir` (fetch) por parámetro: así se prueba
//   con dobles en node --test, sin red.

export const URL_GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
export const MAX_CORREOS = 50; // últimos 50 de Recibidos
export const CONCURRENCIA = 5; // pedidos a Gmail a la vez (cuota por usuario)
export const TOPE_PUBLICIDAD = 100; // cuántos de Promociones se miden para el tamaño
const TIEMPO_GMAIL_MS = 10_000;

const CABECERAS_LEIDAS = ["List-Unsubscribe", "List-Unsubscribe-Post", "List-Id", "Precedence", "In-Reply-To"];
const LARGO_MAX_CABECERA = 2_000;

export const MENSAJES_GMAIL = Object.freeze({
  sinPermiso: "Falta el permiso para leer tus correos. Pulsa «Dar permiso» y acéptalo en la ventana de Google.",
  vencido: "Tu sesión de Google venció: vuelve a iniciar sesión.",
  apiApagada: "La API de Gmail no está habilitada en el proyecto de Google Cloud. Avísale al equipo.",
  cuota: "Gmail limitó las consultas: espera un minuto e inténtalo de nuevo.",
  sinRed: "Sin conexión a internet. Revísala e inténtalo de nuevo.",
  inesperada: "Gmail respondió de forma inesperada. Inténtalo de nuevo.",
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

/** Respuesta de error de Gmail → ErrorGmail con un código y un mensaje claro. */
export function interpretarErrorGmail(estadoHttp, cuerpo) {
  const razones = [
    ...(cuerpo?.error?.errors ?? []).map((e) => e?.reason),
    ...(cuerpo?.error?.details ?? []).map((d) => d?.reason),
    cuerpo?.error?.status,
  ].filter(Boolean).map((r) => String(r).toLowerCase());
  const hay = (...nombres) => nombres.some((n) => razones.includes(n.toLowerCase()));

  if (estadoHttp === 401) return new ErrorGmail("vencido", MENSAJES_GMAIL.vencido);
  if (estadoHttp === 429 || hay("rateLimitExceeded", "userRateLimitExceeded", "RESOURCE_EXHAUSTED")) {
    return new ErrorGmail("cuota", MENSAJES_GMAIL.cuota);
  }
  if (estadoHttp === 403 && hay("accessNotConfigured", "SERVICE_DISABLED")) {
    return new ErrorGmail("api_apagada", MENSAJES_GMAIL.apiApagada);
  }
  if (estadoHttp === 403) return new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  return new ErrorGmail("inesperada", MENSAJES_GMAIL.inesperada);
}

// ----- Cliente de Gmail (con el token en memoria, nunca expuesto) -----

async function tokenDe(identidad) {
  if (typeof identidad?.getAuthToken !== "function") throw new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  let respuesta;
  try {
    respuesta = await identidad.getAuthToken({ interactive: false });
  } catch {
    // Sin token o sin el alcance gmail.readonly aceptado todavía.
    throw new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  }
  const token = typeof respuesta === "string" ? respuesta : respuesta?.token;
  if (!token) throw new ErrorGmail("sin_permiso", MENSAJES_GMAIL.sinPermiso);
  return token;
}

/**
 * Cliente de solo lectura: get(ruta) hace GET a la API de Gmail con el token en la cabecera.
 * Si Gmail responde 401, quita el token de la caché y lo intenta UNA vez más (para todo el
 * cliente). El token queda en esta función: ningún resultado lo devuelve.
 */
export function crearClienteGmail({ identidad, pedir }) {
  let token = null;
  let renovado = false;

  async function get(ruta) {
    if (!token) token = await tokenDe(identidad);
    const usado = token;
    let respuesta;
    try {
      respuesta = await pedir(`${URL_GMAIL}${ruta}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${usado}` },
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
        return get(ruta);
      }
      // Otro pedido ya lo renovó mientras este esperaba: se reintenta con el token nuevo.
      if (!token) token = await tokenDe(identidad);
      if (token !== usado) return get(ruta);
    }
    let cuerpo = null;
    try {
      cuerpo = await respuesta.json();
    } catch {
      cuerpo = null;
    }
    if (respuesta.status === 200) return cuerpo;
    if (respuesta.status === 404) return null; // p. ej. la cuenta no tiene la categoría Promociones
    throw interpretarErrorGmail(respuesta.status, cuerpo);
  }

  return { get };
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
export async function leerBandeja({ identidad, pedir, alProgresar = () => {} }) {
  const cliente = crearClienteGmail({ identidad, pedir });
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
