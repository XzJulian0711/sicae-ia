// Inicio de sesión con Google y consentimiento (paso 4.2). Lógica sin "chrome" global: recibe
// `identidad` (chrome.identity) y `pedir` (fetch) por parámetro, así se prueba con dobles en
// node --test. La verificación del token en la API es el paso 4.3.
//
// Reglas del token:
// - NUNCA se guarda (ni en chrome.storage ni en ningún otro lado), ni se muestra, ni va a la
//   consola. Chrome lo guarda en su propia caché; aquí solo se mira si llegó.
// - Ninguna función de este archivo lo devuelve: devuelven {ok, mensaje} o true/false.
// - Solo viaja a Google al cerrar sesión, para revocarlo (oauth2.googleapis.com/revoke).
//
// Los mensajes son propios: nunca se muestra el texto crudo de un error.

export const VERSION_CONSENTIMIENTO = "1";
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
