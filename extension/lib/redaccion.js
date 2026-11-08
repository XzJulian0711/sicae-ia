// Pestaña "Redactar" (paso 6.3): lógica pura. Sin DOM ni Chrome: se prueba con node --test.
//
// - Arma la petición a POST /redactar (API del paso 6.2) e interpreta su respuesta. Los mensajes
//   de error son FIJOS de la extensión (según el "codigo" de la API): nunca se muestra el
//   "detalle" que manda la API.
// - Arma el borrador para Gmail (MIME, RFC 2822) a mano:
//   * cada valor de cabecera se limpia de saltos de línea y caracteres de control, así nadie puede
//     "inyectar" cabeceras (por ejemplo un Bcc) desde el asunto o el Message-ID del correo;
//   * el asunto va codificado según el RFC 2047 si no es ASCII;
//   * el cuerpo va en UTF-8 y base64; el mensaje entero, en base64url (lo que pide la API de Gmail).
// Nada de esto se guarda: el correo, la indicación y el borrador viven solo en la memoria del panel.

export const LARGO_MAX_INDICACION = 500; // igual que la API (esquemas.py)
const LARGO_MAX_ASUNTO = 1_000; // SICAE_MAX_ASUNTO por defecto
const LARGO_MAX_CUERPO = 50_000; // SICAE_MAX_CUERPO por defecto (la API recorta a lo que lee la IA)
const LARGO_MAX_BORRADOR = 20_000;
const PATRON_MODELO = /^[\w.:/-]{1,100}$/;
export const MODELO_LOCAL_POR_DEFECTO = "gemma4:e4b";

export const TONOS = Object.freeze(["formal", "breve", "cordial"]);
export const TEXTO_PROGRESO = "Generando borrador… La primera vez puede tardar mientras carga el modelo.";
export const NADA_SE_ENVIA = "Nada se envía sin tu revisión.";
export const AVISO_DEMO = "El texto se envía a Google Gemini (capa gratuita). Personas de Google pueden leerlo. "
  + "Úsalo solo con correos de prueba.";
export const MENSAJE_BORRADOR_GUARDADO = "Borrador guardado en Gmail. Revísalo antes de enviarlo.";
export const MENSAJE_COPIADO = "Copiado.";
export const MENSAJE_NO_COPIADO = "No se pudo copiar: selecciona el texto y cópialo con Ctrl+C.";

export const MENSAJES_REDACCION = Object.freeze({
  ollamaApagado: "No se pudo conectar con Ollama. Si no lo tienes, descárgalo de ollama.com; si ya lo tienes, ábrelo.",
  geminiSinConexion: "No se pudo conectar con Gemini (modo demostración). Revisa tu conexión a internet.",
  tiempo: "La IA tardó demasiado. Inténtalo de nuevo.",
  configuracion: "La API no está configurada para redactar: revisa SICAE_IA_URL en su archivo .env.",
  demoDesactivado: "El modo demostración no está disponible ahora.",
  demoCuenta: "El modo demostración solo está disponible para la cuenta de prueba del proyecto.",
  geminiClave: "Gemini rechazó la clave del modo demostración. Avísale al equipo.",
  geminiLimite: "Gemini limitó las peticiones gratuitas: espera un minuto e inténtalo de nuevo.",
  entrada: "No se pudo generar: revisa lo que quieres decir (máximo 500 caracteres).",
  inesperada: "La IA respondió de forma inesperada. Inténtalo de nuevo.",
  sinConexionApi: "Sin conexión con la API. ¿Está encendida?",
  sinIndicacion: "Escribe qué quieres decir.",
  sinCorreo: "Abre un correo en Gmail para responderlo.",
});

const avisoEnlaces = (n) => (n === 1
  ? "Se quitó 1 enlace que no estaba en tu indicación."
  : `Se quitaron ${n} enlaces que no estaban en tu indicación.`);
const AVISO_RECORTE = "El correo era largo: la IA leyó solo el inicio.";

// ----- Formulario -----

/** "123/500" para el contador de "¿Qué quieres decir?". */
export function textoContador(texto) {
  return `${String(texto ?? "").length}/${LARGO_MAX_INDICACION}`;
}

export function urlRedactar(base) {
  return `${base}/redactar`;
}

export function urlProveedores(base) {
  return `${base}/redactar/proveedores`;
}

/**
 * Petición a POST /redactar con lo que se escribió y el correo abierto.
 * → {ok: true, peticion} o {ok: false, mensaje}. Nunca manda remitente, destinatarios ni cabeceras.
 */
export function armarPeticionRedactar({ indicacion, tono, correo, demo = false }) {
  const texto = String(indicacion ?? "").trim();
  if (!texto) return { ok: false, mensaje: MENSAJES_REDACCION.sinIndicacion };
  if (texto.length > LARGO_MAX_INDICACION) return { ok: false, mensaje: MENSAJES_REDACCION.entrada };
  if (!correo) return { ok: false, mensaje: MENSAJES_REDACCION.sinCorreo };
  return {
    ok: true,
    peticion: {
      indicacion: texto,
      tono: TONOS.includes(tono) ? tono : "formal",
      asunto: String(correo.asunto ?? "").slice(0, LARGO_MAX_ASUNTO),
      cuerpo: String(correo.cuerpo ?? "").slice(0, LARGO_MAX_CUERPO),
      modo: demo === true ? "demostracion" : "local",
    },
  };
}

// ----- Respuestas de la API -----

/** GET /redactar/proveedores → {demostracion, modeloLocal}. Ante cualquier duda: sin demostración. */
export function interpretarProveedores(estadoHttp, cuerpo) {
  const valido = estadoHttp === 200 && cuerpo !== null && typeof cuerpo === "object";
  const modelo = valido && typeof cuerpo.modelo_local === "string" && PATRON_MODELO.test(cuerpo.modelo_local)
    ? cuerpo.modelo_local : MODELO_LOCAL_POR_DEFECTO;
  return { demostracion: valido && cuerpo.demostracion === true, modeloLocal: modelo };
}

/** Segundos de Retry-After → minutos para mostrar (al menos 1). */
function minutosDe(retryAfter) {
  const segundos = Number.parseInt(retryAfter, 10);
  return Number.isFinite(segundos) && segundos > 0 ? Math.max(1, Math.ceil(segundos / 60)) : 60;
}

/**
 * Respuesta de POST /redactar → uno de:
 *   {tipo: "borrador", borrador, proveedor, modelo, segundos, avisos}
 *   {tipo: "pedir_permisos"} (falta el consentimiento v4)
 *   {tipo: "error", mensaje, enlaceOllama?}
 * Los avisos se arman AQUÍ con los números de la respuesta (no se muestra texto de la API).
 */
export function interpretarRedaccion(estadoHttp, cuerpo, { demo = false, modeloLocal = MODELO_LOCAL_POR_DEFECTO,
                                                           retryAfter = null } = {}) {
  const codigo = cuerpo && typeof cuerpo === "object" && typeof cuerpo.codigo === "string" ? cuerpo.codigo : "";
  if (estadoHttp === 200) return borradorDe(cuerpo);
  if (estadoHttp === 403) {
    if (codigo === "demo_cuenta") return error(MENSAJES_REDACCION.demoCuenta);
    return { tipo: "pedir_permisos" }; // "consentimiento" (v4) o sin consentimiento registrado
  }
  if (estadoHttp === 422) return error(MENSAJES_REDACCION.entrada);
  if (estadoHttp === 429) {
    return error(`Llegaste al límite de borradores por hora. Inténtalo en ${minutosDe(retryAfter)} min.`);
  }
  switch (codigo) {
    case "sin_conexion":
      return demo ? error(MENSAJES_REDACCION.geminiSinConexion) : { ...error(MENSAJES_REDACCION.ollamaApagado), enlaceOllama: true };
    case "modelo_no_descargado": {
      const modelo = PATRON_MODELO.test(modeloLocal) ? modeloLocal : MODELO_LOCAL_POR_DEFECTO;
      return error(`Falta el modelo: en una terminal ejecuta «ollama pull ${modelo}».`);
    }
    case "tiempo_agotado":
      return error(MENSAJES_REDACCION.tiempo);
    case "configuracion":
      return error(MENSAJES_REDACCION.configuracion);
    case "demo_desactivado":
    case "demo_sin_clave":
      return error(MENSAJES_REDACCION.demoDesactivado);
    case "gemini_401":
    case "gemini_403":
      return error(MENSAJES_REDACCION.geminiClave);
    case "gemini_429":
      return error(MENSAJES_REDACCION.geminiLimite);
    default:
      return error(MENSAJES_REDACCION.inesperada);
  }
}

function error(mensaje) {
  return { tipo: "error", mensaje };
}

function borradorDe(cuerpo) {
  const c = cuerpo && typeof cuerpo === "object" ? cuerpo : {};
  const valido = typeof c.borrador === "string" && c.borrador.trim() && c.borrador.length <= LARGO_MAX_BORRADOR
    && ["ollama", "demostracion"].includes(c.proveedor)
    && typeof c.modelo === "string" && PATRON_MODELO.test(c.modelo)
    && Number.isFinite(c.segundos) && c.segundos >= 0;
  if (!valido) return error(MENSAJES_REDACCION.inesperada);
  const quitados = Number.isInteger(c.enlaces_quitados) && c.enlaces_quitados > 0 ? c.enlaces_quitados : 0;
  const avisos = [];
  if (c.cuerpo_recortado === true) avisos.push(AVISO_RECORTE);
  if (quitados) avisos.push(avisoEnlaces(quitados));
  return { tipo: "borrador", borrador: c.borrador, proveedor: c.proveedor, modelo: c.modelo, segundos: c.segundos, avisos };
}

/** "Ollama (gemma4:e4b) en tu equipo · 1,4 s" o "Google Gemini (modo demostración) · 2,1 s". */
export function textoProveedor({ proveedor, modelo, segundos }) {
  const tiempo = `${(Math.round(Number(segundos) * 10) / 10).toString().replace(".", ",")} s`;
  return proveedor === "demostracion"
    ? `Google Gemini (modo demostración) · ${tiempo}`
    : `Ollama (${modelo}) en tu equipo · ${tiempo}`;
}

// ----- Borrador para Gmail (MIME armado a mano) -----

const LARGO_MAX_CABECERA = 900; // por debajo de las 998 del RFC 5322
// Caracteres de control y separadores de línea Unicode (U+2028 y U+2029), que también cortan una línea.
const CONTROL = new RegExp(`[\\x00-\\x1f\\x7f${String.fromCharCode(0x2028, 0x2029)}]+`, "g");

/** Quita saltos de línea, tabuladores y caracteres de control: evita la inyección de cabeceras. */
export function limpiarCabecera(valor) {
  return String(valor ?? "")
    .replace(CONTROL, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, LARGO_MAX_CABECERA);
}

/** "Re: " al principio, sin duplicarlo ("Re:", "RE:" y "re :" ya cuentan). */
export function asuntoRespuesta(asunto) {
  const limpio = limpiarCabecera(asunto);
  if (/^re\s*:/i.test(limpio)) return limpio;
  return limpio ? `Re: ${limpio}` : "Re:";
}

function bytesUtf8(texto) {
  return new TextEncoder().encode(texto);
}

function base64DeBytes(bytes) {
  let binario = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

/** base64url sin "=" (lo que pide message.raw de la API de Gmail). */
export function base64Url(texto) {
  return base64DeBytes(bytesUtf8(texto)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Asunto según el RFC 2047: si es ASCII imprimible queda igual; si no, "=?UTF-8?B?…?=" en
 * palabras de hasta 75 caracteres, sin partir nunca un carácter UTF-8 (ni un emoji) por la mitad.
 */
export function codificarRFC2047(texto) {
  const limpio = limpiarCabecera(texto);
  if (/^[\x20-\x7e]*$/.test(limpio)) return limpio;
  const MAX_BYTES = 45; // 45 bytes → 60 caracteres base64 + 12 de "=?UTF-8?B?" y "?=" = 72 ≤ 75
  const palabras = [];
  let actual = [];
  let largo = 0;
  for (const caracter of limpio) { // for…of recorre caracteres completos (también emojis)
    const bytes = bytesUtf8(caracter);
    if (largo + bytes.length > MAX_BYTES && actual.length) {
      palabras.push(actual);
      actual = [];
      largo = 0;
    }
    actual.push(...bytes);
    largo += bytes.length;
  }
  if (actual.length) palabras.push(actual);
  // Las palabras se separan con CRLF + espacio (plegado del RFC 5322): los lectores lo ignoran.
  return palabras.map((p) => `=?UTF-8?B?${base64DeBytes(Uint8Array.from(p))}?=`).join("\r\n ");
}

const PATRON_DIRECCION = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[^\s@<>()[\]",;:\\]+$/;

/** "Ana <ana@x.co>" o "ana@x.co" → "ana@x.co"; si no es una dirección válida, null. */
export function direccionDe(valor) {
  const limpio = limpiarCabecera(valor);
  const conAngulos = /<([^<>]+)>\s*$/.exec(limpio);
  const direccion = (conAngulos ? conAngulos[1] : limpio).trim();
  return direccion.length <= 320 && PATRON_DIRECCION.test(direccion) ? direccion : null;
}

const PATRON_ID_MENSAJE = /^<[^<>\s@]+@[^<>\s@]+>$/;

/** Message-ID válido ("<algo@dominio>") o null. */
export function idMensajeValido(valor) {
  const limpio = limpiarCabecera(valor);
  return limpio.length <= 250 && PATRON_ID_MENSAJE.test(limpio) ? limpio : null;
}

/** References de la respuesta: los anteriores + el Message-ID respondido, sin repetir y con tope de largo. */
export function referenciasRespuesta(references, messageId) {
  // Sin recortar antes de leer: los ids más recientes están al final.
  const texto = String(references ?? "").replace(CONTROL, " ").slice(0, 20_000);
  const ids = (texto.match(/<[^<>\s]+>/g) ?? []).filter((id) => PATRON_ID_MENSAJE.test(id));
  const propio = idMensajeValido(messageId);
  if (propio && !ids.includes(propio)) ids.push(propio);
  const unicos = [...new Set(ids)];
  // Si son demasiados, se quedan los más recientes (los últimos), que son los que unen el hilo.
  while (unicos.join(" ").length > LARGO_MAX_CABECERA) unicos.shift();
  return unicos.join(" ");
}

function envolver(texto, ancho) {
  const lineas = [];
  for (let i = 0; i < texto.length; i += ancho) lineas.push(texto.slice(i, i + ancho));
  return lineas.join("\r\n");
}

/**
 * Mensaje RFC 2822 de la respuesta, listo para drafts.create (message.raw, en base64url).
 * → {ok: true, raw} o {ok: false, motivo}. De y Para deben ser direcciones válidas.
 */
export function armarMime({ de, para, asunto, inReplyTo, references, cuerpo }) {
  const desde = direccionDe(de);
  const hacia = direccionDe(para);
  if (!desde) return { ok: false, motivo: "remitente" };
  if (!hacia) return { ok: false, motivo: "destinatario" };
  const respondeA = idMensajeValido(inReplyTo);
  const referencias = referenciasRespuesta(references, inReplyTo);
  const cabeceras = [
    `From: ${desde}`,
    `To: ${hacia}`,
    `Subject: ${codificarRFC2047(asuntoRespuesta(asunto))}`,
    ...(respondeA ? [`In-Reply-To: ${respondeA}`] : []),
    ...(referencias ? [`References: ${referencias}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const texto = String(cuerpo ?? "").replace(/\r\n|\r|\n/g, "\r\n");
  const crudo = `${cabeceras.join("\r\n")}\r\n\r\n${envolver(base64DeBytes(bytesUtf8(texto)), 76)}\r\n`;
  return { ok: true, raw: base64Url(crudo) };
}

/** Enlace a Borradores de la MISMA cuenta de la pestaña (/mail/u/N/). Si no se reconoce, el general. */
export function enlaceBorradores(urlPestana) {
  const cuenta = /^https:\/\/mail\.google\.com\/mail\/u\/(\d{1,2})\//.exec(String(urlPestana ?? ""));
  return cuenta ? `https://mail.google.com/mail/u/${cuenta[1]}/#drafts` : "https://mail.google.com/mail/#drafts";
}
