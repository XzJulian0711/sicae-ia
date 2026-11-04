// Página de opciones: guarda la URL de la API y la clave en chrome.storage.local.
//
// - La clave nunca se vuelve a mostrar: si ya hay una guardada, el campo queda vacío y se
//   avisa que existe. Para cambiarla se escribe una nueva.
// - Todo el texto se muestra con textContent (nunca innerHTML).

import { borrarClave, borrarConsentimiento, guardarClave, guardarUrl, leerConfiguracion } from "../lib/almacen.js";
import { validarClave, validarUrlApi } from "../lib/logica.js";
import { cerrarSesion } from "../lib/sesion.js";

const elementos = {
  formulario: document.getElementById("formulario"),
  url: document.getElementById("url"),
  clave: document.getElementById("clave"),
  estadoClave: document.getElementById("estado-clave"),
  borrar: document.getElementById("borrar-clave"),
  mensaje: document.getElementById("mensaje"),
};

function mostrarMensaje(texto, tipo) {
  elementos.mensaje.dataset.tipo = tipo;
  elementos.mensaje.textContent = texto;
}

function mostrarEstadoClave(hayClave) {
  elementos.estadoClave.textContent = hayClave
    ? "Hay una clave guardada. Escribe una nueva solo si quieres cambiarla."
    : "Todavía no hay una clave guardada.";
  elementos.borrar.disabled = !hayClave;
}

async function cargar() {
  const { urlApi, claveApi } = await leerConfiguracion();
  elementos.url.value = urlApi;
  elementos.clave.value = ""; // la clave guardada no se muestra nunca
  mostrarEstadoClave(Boolean(claveApi));
}

async function guardar(evento) {
  evento.preventDefault();

  const url = validarUrlApi(elementos.url.value);
  if (!url.ok) {
    mostrarMensaje(url.error, "error");
    elementos.url.focus();
    return;
  }

  const textoClave = elementos.clave.value;
  const { claveApi } = await leerConfiguracion();
  // Campo vacío y ya hay clave guardada: se conserva la que había.
  if (!textoClave.trim() && claveApi) {
    await guardarUrl(url.url);
    elementos.url.value = url.url;
    mostrarMensaje("URL guardada. La clave no cambió.", "ok");
    return;
  }

  const clave = validarClave(textoClave);
  if (!clave.ok) {
    mostrarMensaje(clave.error, "error");
    elementos.clave.focus();
    return;
  }

  await guardarUrl(url.url);
  await guardarClave(clave.clave);
  elementos.url.value = url.url;
  elementos.clave.value = "";
  mostrarEstadoClave(true);
  mostrarMensaje("Opciones guardadas.", "ok");
}

async function borrar() {
  await borrarClave();
  elementos.clave.value = "";
  mostrarEstadoClave(false);
  mostrarMensaje("Clave borrada.", "ok");
}

// ----- Sesión y consentimiento (paso 4.2) -----

const sesion = {
  cerrar: document.getElementById("cerrar-sesion"),
  retirar: document.getElementById("retirar-consentimiento"),
  mensaje: document.getElementById("mensaje-sesion"),
};

function mostrarMensajeSesion(texto, tipo) {
  sesion.mensaje.dataset.tipo = tipo;
  sesion.mensaje.textContent = texto;
}

/** Quita el token de la caché de Chrome y lo revoca en Google (el token nunca se muestra). */
async function cerrarLaSesion() {
  sesion.cerrar.disabled = true;
  try {
    const resultado = await cerrarSesion(chrome.identity, fetch);
    mostrarMensajeSesion(resultado.mensaje, resultado.ok ? "ok" : "error");
  } finally {
    sesion.cerrar.disabled = false;
  }
}

async function retirarConsentimiento() {
  await borrarConsentimiento();
  mostrarMensajeSesion("Consentimiento retirado. El panel lo volverá a pedir.", "ok");
}

elementos.formulario.addEventListener("submit", guardar);
sesion.cerrar.addEventListener("click", cerrarLaSesion);
sesion.retirar.addEventListener("click", retirarConsentimiento);
elementos.borrar.addEventListener("click", borrar);
cargar();
