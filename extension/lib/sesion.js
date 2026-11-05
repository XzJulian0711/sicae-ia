// Inicio de sesión con Google, consentimiento (paso 4.2) y sesión con la API (paso 4.3).
// Lógica sin "chrome" global: recibe `identidad` (chrome.identity), `pedir` (fetch) y el
// almacenamiento por parámetro, así se prueba con dobles en node --test.
//
// Reglas del token de GOOGLE:
// - NUNCA se guarda (ni en chrome.storage ni en ningún otro lado), ni se muestra, ni va a la
//   consola. Chrome lo guarda en su propia caché; aquí solo se mira si llegó.
// - Ninguna función de este archivo lo devuelve.
// - Solo viaja a Google (userinfo, revocar) y a nuestra API en POST /auth/google, que lo
//   verifica con Google y entrega su propia sesión.
//
// Los mensajes son propios: nunca se muestra el texto crudo de un error.

export const VERSION_CONSENTIMIENTO = "3"; // "2" en el 4.4 (leer correos); "3" en el 4.5 (papelera y cuarentena)
export const URL_REVOCAR = "https://oauth2.googleapis.com/revoke";
export const TIEMPO_SESION_MS = 10_000; // máximo para comprobar la sesión sin ventana
const TIEMPO_REVOCAR_MS = 5_000;

export const MENSAJES_AUTH = Object.freeze({
  cerrada:
    "Cerraste la ventana de Google sin terminar. Pulsa Continuar con Google para intentarlo otra vez. "
    + "Si Google mostró «Acceso bloqueado», tu cuenta no está en la lista de usuarios de prueba.",
  noPrueba:
    "Google no permitió el acceso: tu cuenta debe estar en la lista de usuarios de prueba del proyecto. "
    + "Pídele al equipo que la agregue.",
  sinRed: "Sin conexión a internet. Revísala e inténtalo de nuevo.",
  navegador: "Este navegador no permite iniciar sesión con Google desde la extensión. Usa Google Chrome.",
  generico: "No se pudo iniciar sesión con Google. Inténtalo de nuevo.",
});

export const MENSAJES_CIERRE = Object.freeze({
  revocado: "Sesión cerrada: Google revocó el acceso de SICAE-IA.",
  sinSesion: "No había una sesión abierta.",
  noConfirmado:
    "Se cerró la sesión en este navegador, pero Google no confirmó que revocó el acceso. "
    + "Quítalo a mano en myaccount.google.com/permissions.",
});

// ----- Consentimiento -----

/** Lo único que se guarda al aceptar: {aceptado, version, fecha}. */
export function crearConsentimiento(ahora = new Date()) {
  return { aceptado: true, version: VERSION_CONSENTIMIENTO, fecha: ahora.toISOString() };
}

/** Válido solo si tiene exactamente esos 3 campos, está aceptado y es de la versión actual. */
export function consentimientoValido(guardado) {
  if (!guardado || typeof guardado !== "object" || Array.isArray(guardado)) return false;
  const campos = Object.keys(guardado).sort().join(",");
  return campos === "aceptado,fecha,version"
    && guardado.aceptado === true
    && guardado.version === VERSION_CONSENTIMIENTO
    && typeof guardado.fecha === "string"
    && !Number.isNaN(Date.parse(guardado.fecha));
}

/**
 * /analizar respondió 403 (la API no tiene registrado el consentimiento). ¿Qué hace el panel?
 * - "registrar": solo si en este equipo hay un consentimiento ACEPTADO de la MISMA versión del
 *   texto actual (consentimientoValido). Se registra en la API y se reintenta una vez.
 * - "pedir_permisos": en cualquier otro caso (sin consentimiento, otra versión, no aceptado o
 *   datos raros). NUNCA se registra automáticamente: vuelve "Revisa los permisos".
 */
export function queHacerAnte403(consentimientoLocal) {
  return consentimientoValido(consentimientoLocal) ? "registrar" : "pedir_permisos";
}

// ----- Qué pantalla se ve -----

/** Al abrir el panel: la vista principal solo con sesión Y consentimiento válido. */
export function pantallaInicial({ sesion, consentimiento }) {
  return sesion === true && consentimientoValido(consentimiento) ? "principal" : "bienvenida";
}

/** Después de iniciar sesión: si ya aceptó, a la vista principal; si no, a los permisos. */
export function pantallaTrasIniciarSesion(consentimiento) {
  return consentimientoValido(consentimiento) ? "principal" : "permisos";
}

// ----- Token (sin devolverlo nunca) -----

function puedeAutenticar(identidad) {
  return typeof identidad?.getAuthToken === "function";
}

/** Token de getAuthToken: Chrome 105+ da {token}; versiones viejas, el texto directo. */
async function pedirToken(identidad, interactive) {
  const respuesta = await identidad.getAuthToken({ interactive });
  const token = typeof respuesta === "string" ? respuesta : respuesta?.token;
  return typeof token === "string" && token ? token : null;
}

/** ¿Hay sesión? (sin abrir ventanas). Falso si no hay token, hay error o tarda demasiado. */
export async function haySesion(identidad, tiempoMs = TIEMPO_SESION_MS) {
  if (!puedeAutenticar(identidad)) return false;
  let reloj;
  const tiempo = new Promise((resolver) => { reloj = setTimeout(() => resolver(null), tiempoMs); });
  try {
    const token = await Promise.race([pedirToken(identidad, false), tiempo]);
    return token !== null;
  } catch {
    return false;
  } finally {
    clearTimeout(reloj);
  }
}

/** Error de chrome.identity → mensaje claro (aproximado: el texto de Chrome varía). */
export function interpretarErrorAuth(error, enLinea = true) {
  if (enLinea === false) return MENSAJES_AUTH.sinRed;
  const texto = String(error?.message ?? error ?? "").toLowerCase();
  if (/access_denied|\b403\b|blocked|bloquead/.test(texto)) return MENSAJES_AUTH.noPrueba;
  if (/did not approve|cancel|closed|cerr/.test(texto)) return MENSAJES_AUTH.cerrada;
  if (/network|failed to fetch|could not be loaded|offline|internet/.test(texto)) return MENSAJES_AUTH.sinRed;
  return MENSAJES_AUTH.generico;
}

/** "Continuar con Google": abre la ventana de Google. Devuelve {ok: true} o {ok: false, mensaje}. */
export async function iniciarSesion(identidad, enLinea = true) {
  if (!puedeAutenticar(identidad)) return { ok: false, mensaje: MENSAJES_AUTH.navegador };
  try {
    const token = await pedirToken(identidad, true);
    // El token se descarta aquí: Chrome lo guarda en su caché y lo vuelve a dar cuando haga falta.
    return token ? { ok: true } : { ok: false, mensaje: MENSAJES_AUTH.generico };
  } catch (error) {
    return { ok: false, mensaje: interpretarErrorAuth(error, enLinea) };
  }
}

/** "Ahora no": quita el token de la caché de Chrome, sin revocarlo. No devuelve nada. */
export async function olvidarToken(identidad) {
  if (!puedeAutenticar(identidad)) return;
  try {
    const token = await pedirToken(identidad, false);
    if (token) await identidad.removeCachedAuthToken({ token });
  } catch {
    // Sin token en caché: no hay nada que olvidar.
  }
}

// ----- Sesión con la API (paso 4.3) -----
// La API verifica el token de Google (POST /auth/google) y entrega SU PROPIA sesión, que dura
// 8 h. Esa sesión sí la conoce la extensión (va en Authorization: Bearer) y se guarda SOLO en
// chrome.storage.session (memoria; se borra al cerrar el navegador). El token de Google sigue
// sin salir de este archivo: solo viaja a la API en /auth/google.

const TIEMPO_API_MS = 5_000;
const MARGEN_VENCIMIENTO_MS = 60_000; // una sesión que vence en menos de 1 min se renueva antes
const FORMA_SESION = /^[A-Za-z0-9_-]{30,100}$/;

export const MENSAJES_API = Object.freeze({
  googleRechazo: "La API no pudo confirmar tu cuenta con Google: vuelve a iniciar sesión.",
  googleCaido: "La API no pudo verificar tu cuenta con Google. Inténtalo más tarde.",
  sinSesionGoogle: "Tu sesión de Google terminó: vuelve a iniciar sesión.",
  sinConexion: "Sin conexión con la API. Revisa que esté encendida y la URL en Opciones.",
  limite: "Demasiadas peticiones seguidas: espera un minuto e inténtalo de nuevo.",
  inesperada: "La API respondió de forma inesperada.",
});

// "Retirar consentimiento" (paso 4.6): el mensaje tiene una parte de la cuenta en la API y otra
// de Google (ver mensajeRetiro).
export const MENSAJES_CUENTA = Object.freeze({
  borrada: "Consentimiento retirado y cuenta borrada en la API.",
  noConfirmada:
    "Consentimiento retirado en este equipo, pero la API no confirmó el borrado de tu cuenta: "
    + "enciende la API, inicia sesión y retíralo otra vez.",
  sinUrl: "Consentimiento retirado en este equipo. Revisa la URL de la API para borrar tu cuenta allí.",
});

export const MENSAJES_RETIRO_GOOGLE = Object.freeze({
  revocado: "Google revocó el acceso de SICAE-IA.",
  sinSesion: "No había una sesión de Google abierta en este navegador.",
  noConfirmado: "Google no confirmó que revocó el acceso: quítalo a mano en myaccount.google.com/permissions.",
});

/**
 * Mensaje de "Retirar consentimiento" (lógica pura).
 * cuenta: "borrada" | "no_confirmada" | "sin_url"; google: "revocado" | "sin_sesion" | "no_confirmado".
 * ok solo si la cuenta se borró y Google no quedó sin confirmar.
 */
export function mensajeRetiro({ cuenta, google }) {
  const parteCuenta = { borrada: MENSAJES_CUENTA.borrada, sin_url: MENSAJES_CUENTA.sinUrl }[cuenta] ?? MENSAJES_CUENTA.noConfirmada;
  const parteGoogle = { revocado: MENSAJES_RETIRO_GOOGLE.revocado, sin_sesion: MENSAJES_RETIRO_GOOGLE.sinSesion }[google]
    ?? MENSAJES_RETIRO_GOOGLE.noConfirmado;
  const ok = cuenta === "borrada" && (google === "revocado" || google === "sin_sesion");
  return { ok, mensaje: `${parteCuenta} ${parteGoogle}` };
}

function direccion(base, ruta) {
  return `${String(base).replace(/\/+$/, "")}${ruta}`;
}

/** Petición a la API con Bearer, tiempo máximo y sin cookies. */
function llamarApi(pedir, url, { metodo = "GET", token, cuerpo } = {}) {
  const cabeceras = { Authorization: `Bearer ${token}` };
  if (cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";
  return pedir(url, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(TIEMPO_API_MS),
  });
}

/** ¿La sesión guardada sirve todavía? (forma correcta y vence en más de 1 minuto). */
export function sesionVigente(sesion, ahora = Date.now()) {
  if (!sesion || typeof sesion !== "object") return false;
  const vence = Date.parse(sesion.expira);
  return typeof sesion.token === "string" && FORMA_SESION.test(sesion.token)
    && !Number.isNaN(vence) && vence - ahora > MARGEN_VENCIMIENTO_MS;
}

/** Respuesta de POST /auth/google → {ok: true, sesion: {token, expira}} o {ok: false, mensaje}. */
export function interpretarAuthApi(estadoHttp, cuerpo) {
  if (estadoHttp === 200) {
    const sesion = { token: cuerpo?.token_sesion, expira: cuerpo?.expira };
    return typeof sesion.token === "string" && FORMA_SESION.test(sesion.token) && !Number.isNaN(Date.parse(sesion.expira))
      ? { ok: true, sesion }
      : { ok: false, mensaje: MENSAJES_API.inesperada };
  }
  if (estadoHttp === 401) return { ok: false, mensaje: MENSAJES_API.googleRechazo };
  if (estadoHttp === 503) return { ok: false, mensaje: MENSAJES_API.googleCaido };
  if (estadoHttp === 429) return { ok: false, mensaje: MENSAJES_API.limite };
  return { ok: false, mensaje: MENSAJES_API.inesperada };
}

/**
 * Abre una sesión con la API: token de Google (sin ventana) → POST /auth/google.
 * Si la API rechaza el token (401), puede ser que Chrome tuviera uno vencido en caché: se quita
 * y se intenta UNA vez más. Devuelve {ok, sesion} o {ok: false, mensaje}; nunca el token de Google.
 */
export async function abrirSesionApi(identidad, pedir, base) {
  if (!puedeAutenticar(identidad)) return { ok: false, mensaje: MENSAJES_AUTH.navegador };
  try {
    for (let intento = 0; intento < 2; intento += 1) {
      let tokenGoogle = null;
      try {
        tokenGoogle = await pedirToken(identidad, false);
      } catch {
        tokenGoogle = null;
      }
      if (!tokenGoogle) return { ok: false, mensaje: MENSAJES_API.sinSesionGoogle };

      const respuesta = await llamarApi(pedir, direccion(base, "/auth/google"), { metodo: "POST", token: tokenGoogle });
      if (respuesta.status === 401 && intento === 0) {
        await identidad.removeCachedAuthToken({ token: tokenGoogle });
        continue;
      }
      let cuerpo = null;
      if (respuesta.status === 200) {
        try {
          cuerpo = await respuesta.json();
        } catch {
          cuerpo = null;
        }
      }
      return interpretarAuthApi(respuesta.status, cuerpo);
    }
    return { ok: false, mensaje: MENSAJES_API.googleRechazo };
  } catch {
    return { ok: false, mensaje: MENSAJES_API.sinConexion };
  }
}

/** POST /consentimiento {version}. Devuelve {ok}. */
export async function registrarConsentimiento(pedir, base, sesion, version) {
  try {
    const r = await llamarApi(pedir, direccion(base, "/consentimiento"), { metodo: "POST", token: sesion.token, cuerpo: { version } });
    return { ok: r.status === 204 };
  } catch {
    return { ok: false };
  }
}

/** POST /auth/cerrar. Una sesión que ya no existe (401) cuenta como cerrada. */
export async function cerrarSesionApi(pedir, base, sesion) {
  try {
    const r = await llamarApi(pedir, direccion(base, "/auth/cerrar"), { metodo: "POST", token: sesion.token });
    return { ok: r.status === 204 || r.status === 401 };
  } catch {
    return { ok: false };
  }
}

/** DELETE /cuenta. Devuelve la respuesta (para usar con conSesion). */
export function borrarCuentaApi(pedir, base, sesion) {
  return llamarApi(pedir, direccion(base, "/cuenta"), { metodo: "DELETE", token: sesion.token });
}

/**
 * Sesión lista para usar. contexto = {identidad, pedir, base, almacen: {leer, guardar, borrar},
 * version}. Usa la guardada si sigue vigente; si no, abre una nueva, registra el consentimiento
 * (si hay `version`) y la guarda. Devuelve {ok, sesion} o {ok: false, mensaje}.
 */
export async function asegurarSesionApi({ identidad, pedir, base, almacen, version, ahora = Date.now() }) {
  const guardada = await almacen.leer();
  if (sesionVigente(guardada, ahora)) return { ok: true, sesion: guardada };
  const abierta = await abrirSesionApi(identidad, pedir, base);
  if (!abierta.ok) return abierta;
  if (version) await registrarConsentimiento(pedir, base, abierta.sesion, version);
  await almacen.guardar(abierta.sesion);
  return { ok: true, sesion: abierta.sesion };
}

/**
 * Hace `accion(sesion)` (una petición a la API) con una sesión válida. Si la API responde 401
 * (sesión vencida o cerrada), borra la guardada, abre una nueva y lo intenta UNA vez más.
 * Devuelve {ok: true, respuesta} o {ok: false, mensaje}.
 */
export async function conSesion(contexto, accion) {
  try {
    for (let intento = 0; intento < 2; intento += 1) {
      const lista = await asegurarSesionApi(contexto);
      if (!lista.ok) return lista;
      const respuesta = await accion(lista.sesion);
      if (respuesta.status === 401 && intento === 0) {
        await contexto.almacen.borrar();
        continue;
      }
      return { ok: true, respuesta };
    }
    return { ok: false, mensaje: MENSAJES_API.googleRechazo };
  } catch {
    return { ok: false, mensaje: MENSAJES_API.sinConexion };
  }
}

/**
 * "Cerrar sesión" completo: cierra la sesión de la API (si hay), la borra de storage.session y
 * luego cierra la de Google (caché de Chrome + revocar). Devuelve el resultado de cerrarSesion.
 */
export async function cerrarSesionCompleta({ identidad, pedir, base, almacen }) {
  try {
    const guardada = await almacen.leer();
    if (base && guardada?.token) await cerrarSesionApi(pedir, base, guardada); // sin URL válida no se envía
  } finally {
    await almacen.borrar();
  }
  return cerrarSesion(identidad, pedir);
}

/**
 * "Retirar consentimiento", en este orden:
 * 1. DELETE /cuenta en la API (abre sesión si hace falta; sin `base` se salta). Va PRIMERO porque
 *    abrir la sesión de la API necesita el token de Google;
 * 2. pase lo que pase, borra la sesión y el consentimiento de este equipo;
 * 3. SIEMPRE cierra la sesión de Google, como "Cerrar sesión": quita el token de la caché y lo
 *    revoca (cerrarSesion). Si Google no lo confirma, el mensaje nombra
 *    myaccount.google.com/permissions.
 * Devuelve {ok, mensaje} (mensajeRetiro).
 */
export async function retirarConsentimiento(contexto, borrarConsentimientoLocal) {
  let cuenta = contexto.base ? "no_confirmada" : "sin_url";
  try {
    if (contexto.base) {
      const r = await conSesion({ ...contexto, version: null }, (sesion) => borrarCuentaApi(contexto.pedir, contexto.base, sesion));
      if (r.ok && r.respuesta.status === 204) cuenta = "borrada";
    }
  } catch {
    // La API falló de una forma inesperada: queda "no_confirmada" y se sigue igual.
  } finally {
    await contexto.almacen.borrar();
    await borrarConsentimientoLocal();
  }
  const cierre = await cerrarSesion(contexto.identidad, contexto.pedir);
  const google = cierre.mensaje === MENSAJES_CIERRE.sinSesion ? "sin_sesion" : cierre.ok ? "revocado" : "no_confirmado";
  return mensajeRetiro({ cuenta, google });
}

// ----- Correo de la sesión (encabezado del panel) -----

export const URL_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const TIEMPO_USERINFO_MS = 5_000;
const LARGO_MAX_CORREO = 320;

/** Respuesta de userinfo → {ok: true, correo} o {ok: false}. Solo un correo con forma válida. */
export function interpretarUserinfo(estadoHttp, cuerpo) {
  if (estadoHttp !== 200 || !cuerpo || typeof cuerpo !== "object") return { ok: false };
  const { email, email_verified: verificado } = cuerpo;
  const valido = typeof email === "string" && email.length <= LARGO_MAX_CORREO && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
  return valido && verificado !== false ? { ok: true, correo: email } : { ok: false };
}

async function pedirUserinfo(pedir, token) {
  const respuesta = await pedir(URL_USERINFO, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }, // el token va en la cabecera, nunca en la URL
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(TIEMPO_USERINFO_MS),
  });
  let cuerpo = null;
  if (respuesta.status === 200) {
    try {
      cuerpo = await respuesta.json();
    } catch {
      cuerpo = null;
    }
  }
  return { estado: respuesta.status, cuerpo };
}

/**
 * Correo de la cuenta de la sesión, pedido en el momento a Google (userinfo, con el alcance
 * userinfo.email ya aceptado). Devuelve {ok: true, correo} o {ok: false}; nunca el token.
 * El correo no se guarda: el panel solo lo muestra.
 * Si Google responde 401 (token vencido), se quita de la caché y se reintenta una vez.
 */
export async function obtenerCorreo(identidad, pedir) {
  if (!puedeAutenticar(identidad)) return { ok: false };
  try {
    for (let intento = 0; intento < 2; intento += 1) {
      const token = await pedirToken(identidad, false);
      if (!token) return { ok: false };
      const { estado, cuerpo } = await pedirUserinfo(pedir, token);
      if (estado === 401 && intento === 0) {
        await identidad.removeCachedAuthToken({ token });
        continue;
      }
      return interpretarUserinfo(estado, cuerpo);
    }
    return { ok: false };
  } catch {
    return { ok: false }; // sin red, tiempo agotado o sin sesión
  }
}

/**
 * "Cerrar sesión" (Opciones y menú de la cuenta): quita el token de la caché de Chrome y lo
 * revoca en Google.
 * Devuelve {ok, mensaje}. Si Google no confirma, la caché igual queda limpia y el mensaje
 * explica cómo quitar el acceso a mano.
 */
export async function cerrarSesion(identidad, pedir) {
  if (!puedeAutenticar(identidad)) return { ok: false, mensaje: MENSAJES_AUTH.navegador };
  let token = null;
  try {
    token = await pedirToken(identidad, false);
  } catch {
    token = null;
  }
  if (!token) return { ok: true, mensaje: MENSAJES_CIERRE.sinSesion };

  try {
    await identidad.removeCachedAuthToken({ token });
  } catch {
    // Se intenta revocar igual.
  }
  try {
    const respuesta = await pedir(URL_REVOCAR, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(), // en el cuerpo, nunca en la URL
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(TIEMPO_REVOCAR_MS),
    });
    return respuesta?.ok ? { ok: true, mensaje: MENSAJES_CIERRE.revocado } : { ok: false, mensaje: MENSAJES_CIERRE.noConfirmado };
  } catch {
    return { ok: false, mensaje: MENSAJES_CIERRE.noConfirmado };
  }
}
