// Página de opciones: la URL de la API (chrome.storage.local) y la sesión.
//
// Desde el paso 4.3 ya no hay clave de API: el acceso es con la sesión de Google, que la API
// verifica (lib/sesion.js). Todo el texto se muestra con textContent (nunca innerHTML).

import {
  alCambiarTema,
  almacenSesionApi,
  borrarConsentimiento,
  guardarTema,
  guardarUrl,
  leerConfiguracion,
  leerTema,
} from "../lib/almacen.js";
import { validarUrlApi } from "../lib/logica.js";
import { cerrarSesionCompleta, retirarConsentimiento } from "../lib/sesion.js";
import { conectarTema } from "../lib/tema.js";

// El mismo tema que el panel (lo guardado, o el del sistema). Aquí no hay botón: se cambia en
// el panel y esta página lo sigue (alCambiarTema).
conectarTema({
  raiz: document.documentElement,
  consulta: window.matchMedia("(prefers-color-scheme: dark)"),
  leer: leerTema,
  guardar: guardarTema,
  alCambiar: alCambiarTema,
});

const elementos = {
  formulario: document.getElementById("formulario"),
  url: document.getElementById("url"),
  mensaje: document.getElementById("mensaje"),
};

function mostrarMensaje(texto, tipo) {
  elementos.mensaje.dataset.tipo = tipo;
  elementos.mensaje.textContent = texto;
}

async function cargar() {
  const { urlApi } = await leerConfiguracion();
  elementos.url.value = urlApi;
}

async function guardar(evento) {
  evento.preventDefault();
  const url = validarUrlApi(elementos.url.value);
  if (!url.ok) {
    mostrarMensaje(url.error, "error");
    elementos.url.focus();
    return;
  }
  await guardarUrl(url.url);
  elementos.url.value = url.url;
  mostrarMensaje("URL guardada.", "ok");
}

// ----- Sesión y consentimiento (pasos 4.2 y 4.3) -----

const sesion = {
  cerrar: document.getElementById("cerrar-sesion"),
  retirar: document.getElementById("retirar-consentimiento"),
  mensaje: document.getElementById("mensaje-sesion"),
};

function mostrarMensajeSesion(texto, tipo) {
  sesion.mensaje.dataset.tipo = tipo;
  sesion.mensaje.textContent = texto;
}

/** URL de la API ya validada, o null (sin URL válida no se le envía la sesión). */
async function baseApi() {
  const { urlApi } = await leerConfiguracion();
  const url = validarUrlApi(urlApi);
  return url.ok ? url.url : null;
}

/**
 * Cierra la sesión de la API (POST /auth/cerrar), la borra de chrome.storage.session y cierra
 * la de Google (caché de Chrome + revocar). Ningún token se muestra.
 */
async function cerrarLaSesion() {
  sesion.cerrar.disabled = true;
  try {
    const resultado = await cerrarSesionCompleta({ identidad: chrome.identity, pedir: fetch, base: await baseApi(),
                                                   almacen: almacenSesionApi });
    mostrarMensajeSesion(resultado.mensaje, resultado.ok ? "ok" : "error");
  } finally {
    sesion.cerrar.disabled = false;
  }
}

/**
 * Retira el consentimiento (lib/sesion.js): DELETE /cuenta en la API (borra tu usuario y sus
 * sesiones), borra el consentimiento y la sesión de este equipo y revoca el acceso de Google.
 * Sin una URL válida de la API (base = null) igual hace lo local y revoca. El panel volverá a pedirlo.
 */
async function retirarElConsentimiento() {
  sesion.retirar.disabled = true;
  try {
    const base = await baseApi();
    const resultado = await retirarConsentimiento({ identidad: chrome.identity, pedir: fetch, base, almacen: almacenSesionApi },
                                                  borrarConsentimiento);
    mostrarMensajeSesion(resultado.mensaje, resultado.ok ? "ok" : "error");
  } finally {
    sesion.retirar.disabled = false;
  }
}

elementos.formulario.addEventListener("submit", guardar);
sesion.cerrar.addEventListener("click", cerrarLaSesion);
sesion.retirar.addEventListener("click", retirarElConsentimiento);
cargar();
