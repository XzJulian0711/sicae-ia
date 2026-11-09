// Guarda y lee la configuración de la extensión.
//
// chrome.storage.local (se queda en este equipo, no se copia a la cuenta de Google):
//   - urlApi: la dirección de la API.
//   - consentimiento: solo {aceptado, version, fecha} (paso 4.2).
//   - tema: "claro" u "oscuro", solo si la persona eligió uno (si no, se sigue al sistema).
// chrome.storage.session (en memoria: se borra al cerrar el navegador; los content scripts no
// pueden leerla) (paso 4.3):
//   - sesionApi: {token, expira} de la sesión que entrega la API. Nunca va a "local".
// El token de GOOGLE nunca se guarda en ningún lado. Ya no hay clave de API (paso 4.3).

import { URL_POR_DEFECTO } from "./logica.js";
import { esTema } from "./tema.js";

const CLAVES = { url: "urlApi", consentimiento: "consentimiento", tema: "tema" };
const CLAVE_SESION = "sesionApi";

/** Devuelve {urlApi}. Si no hay URL guardada, usa la de por defecto. */
export async function leerConfiguracion() {
  const datos = await chrome.storage.local.get(CLAVES.url);
  return { urlApi: typeof datos[CLAVES.url] === "string" ? datos[CLAVES.url] : URL_POR_DEFECTO };
}

export async function guardarUrl(url) {
  await chrome.storage.local.set({ [CLAVES.url]: url });
}

/** Consentimiento guardado ({aceptado, version, fecha}) o null. */
export async function leerConsentimiento() {
  const datos = await chrome.storage.local.get(CLAVES.consentimiento);
  return datos[CLAVES.consentimiento] ?? null;
}

/** Guarda solo los 3 campos del consentimiento (los arma crearConsentimiento en lib/sesion.js). */
export async function guardarConsentimiento({ aceptado, version, fecha }) {
  await chrome.storage.local.set({ [CLAVES.consentimiento]: { aceptado, version, fecha } });
}

export async function borrarConsentimiento() {
  await chrome.storage.local.remove(CLAVES.consentimiento);
}

// ----- Tema (claro u oscuro): solo una preferencia -----

/** Tema elegido ("claro" u "oscuro"), o null si no eligió ninguno (entonces se sigue al sistema). */
export async function leerTema() {
  const datos = await chrome.storage.local.get(CLAVES.tema);
  return esTema(datos[CLAVES.tema]) ? datos[CLAVES.tema] : null;
}

/** Guarda SOLO "claro" u "oscuro"; cualquier otro valor se ignora. */
export async function guardarTema(tema) {
  if (!esTema(tema)) return;
  await chrome.storage.local.set({ [CLAVES.tema]: tema });
}

/** Avisa a fn(tema | null) cuando cambia el tema guardado (p. ej., desde el panel a Opciones). */
export function alCambiarTema(fn) {
  chrome.storage.onChanged.addListener((cambios, area) => {
    if (area !== "local" || !(CLAVES.tema in cambios)) return;
    const nuevo = cambios[CLAVES.tema].newValue;
    fn(esTema(nuevo) ? nuevo : null);
  });
}

// ----- Sesión de la API: SOLO en chrome.storage.session -----

export async function leerSesionApi() {
  const datos = await chrome.storage.session.get(CLAVE_SESION);
  return datos[CLAVE_SESION] ?? null;
}

/** Guarda solo {token, expira} de la sesión de la API. */
export async function guardarSesionApi({ token, expira }) {
  await chrome.storage.session.set({ [CLAVE_SESION]: { token, expira } });
}

export async function borrarSesionApi() {
  await chrome.storage.session.remove(CLAVE_SESION);
}

/** Lo que usan las funciones de lib/sesion.js para leer, guardar y borrar la sesión de la API. */
export const almacenSesionApi = Object.freeze({ leer: leerSesionApi, guardar: guardarSesionApi, borrar: borrarSesionApi });
