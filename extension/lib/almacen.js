// Guarda y lee la configuración en chrome.storage.local.
//
// Se usa "local" y no "sync": así la clave de la API se queda en este equipo y no se copia
// a la cuenta de Google. La clave NUNCA está escrita en el código: la escribe el usuario
// en la página de Opciones.

import { URL_POR_DEFECTO } from "./logica.js";

const CLAVES = { url: "urlApi", clave: "claveApi" };

/** Devuelve {urlApi, claveApi}. Si no hay URL guardada, usa la de por defecto. */
export async function leerConfiguracion() {
  const datos = await chrome.storage.local.get([CLAVES.url, CLAVES.clave]);
  return {
    urlApi: typeof datos[CLAVES.url] === "string" ? datos[CLAVES.url] : URL_POR_DEFECTO,
    claveApi: typeof datos[CLAVES.clave] === "string" ? datos[CLAVES.clave] : "",
  };
}

export async function guardarUrl(url) {
  await chrome.storage.local.set({ [CLAVES.url]: url });
}

export async function guardarClave(clave) {
  await chrome.storage.local.set({ [CLAVES.clave]: clave });
}

export async function borrarClave() {
  await chrome.storage.local.remove(CLAVES.clave);
}
