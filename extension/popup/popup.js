// Popup: avisa si falta la clave y prueba la conexión con la API en dos pasos:
//   1. GET /salud (pública): ¿responde la API? ¿hay modelo cargado?
//   2. GET /estadisticas con X-API-Key: ¿la clave guardada es correcta? (200 / 401)
//      De esa respuesta solo se usa el código: los conteos no se leen ni se muestran.
//
// Seguridad:
// - Todo el texto se muestra con textContent (nunca innerHTML).
// - Cada fetch tiene tiempo máximo (AbortSignal.timeout) y va sin cookies.
// - Mensajes genéricos: nunca se muestra el texto crudo de un error.

import { leerConfiguracion } from "../lib/almacen.js";
import {
  TIEMPO_ESPERA_MS,
  interpretarClave,
  interpretarSalud,
  resultadoClaveSinConexion,
  resultadoSinClave,
  resultadoSinConexion,
  urlEstadisticas,
  urlSalud,
  validarUrlApi,
} from "../lib/logica.js";

const elementos = {
  avisoSinClave: document.getElementById("aviso-sin-clave"),
  abrirOpciones: document.getElementById("abrir-opciones"),
  irOpciones: document.getElementById("ir-opciones"),
  probar: document.getElementById("probar"),
  estado: document.getElementById("estado"),
  estadoTexto: document.getElementById("estado-texto"),
  estadoClave: document.getElementById("estado-clave"),
  estadoClaveTexto: document.getElementById("estado-clave-texto"),
};

function mostrar(caja, texto, resultado) {
  caja.dataset.tipo = resultado.tipo;
  texto.textContent = resultado.mensaje;
  caja.hidden = false;
}

/** fetch con tiempo máximo, sin caché y sin cookies. */
function pedir(url, cabeceras = {}) {
  return fetch(url, {
    method: "GET",
    headers: cabeceras,
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(TIEMPO_ESPERA_MS),
  });
}

async function comprobarSalud(base) {
  try {
    const respuesta = await pedir(urlSalud(base));
    let cuerpo = null;
    try {
      cuerpo = await respuesta.json();
    } catch {
      cuerpo = null; // no era JSON: interpretarSalud lo trata como respuesta inesperada
    }
    return interpretarSalud(respuesta.status, cuerpo);
  } catch {
    // Red caída, API apagada o tiempo agotado: un solo mensaje genérico.
    return resultadoSinConexion();
  }
}

async function comprobarClave(base, claveApi) {
  if (!claveApi) {
    return resultadoSinClave();
  }
  try {
    const respuesta = await pedir(urlEstadisticas(base), { "X-API-Key": claveApi });
    return interpretarClave(respuesta.status); // el cuerpo (conteos) no se lee
  } catch {
    return resultadoClaveSinConexion();
  }
}

async function probarConexion() {
  const { urlApi, claveApi } = await leerConfiguracion();
  const url = validarUrlApi(urlApi);
  elementos.estadoClave.hidden = true;
  if (!url.ok) {
    mostrar(elementos.estado, elementos.estadoTexto,
            { tipo: "error", mensaje: "La URL de la API no es válida. Corrígela en Opciones." });
    return;
  }

  elementos.probar.disabled = true;
  elementos.probar.textContent = "Probando…";
  try {
    const salud = await comprobarSalud(url.url);
    mostrar(elementos.estado, elementos.estadoTexto, salud);
    // La clave solo se prueba si la API respondió (con o sin modelo).
    if (salud.tipo === "conectado" || salud.tipo === "sin_modelo") {
      mostrar(elementos.estadoClave, elementos.estadoClaveTexto, await comprobarClave(url.url, claveApi));
    }
  } finally {
    elementos.probar.disabled = false;
    elementos.probar.textContent = "Probar conexión";
  }
}

function abrirOpciones() {
  chrome.runtime.openOptionsPage();
}

async function iniciar() {
  elementos.irOpciones.addEventListener("click", abrirOpciones);
  elementos.abrirOpciones.addEventListener("click", abrirOpciones);
  elementos.probar.addEventListener("click", probarConexion);

  const { claveApi } = await leerConfiguracion();
  const faltaClave = !claveApi;
  elementos.avisoSinClave.hidden = !faltaClave;
  elementos.abrirOpciones.hidden = !faltaClave;
}

iniciar();
