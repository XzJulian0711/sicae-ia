// Panel lateral de SICAE-IA.
//
// "Analizar este correo":
//   1. pide a la pestaña activa (Gmail) el correo abierto (gmail/lector.js);
//   2. arma la petición (lib/correo.js) y la envía a POST /analizar con X-API-Key;
//   3. muestra categoría, prioridad y confianza.
// "Probar conexión":
//   1. GET /salud (pública): ¿responde la API? ¿hay modelo cargado?
//   2. GET /estadisticas con X-API-Key: ¿la clave es correcta? (solo se usa el código)
//
// Seguridad:
// - El correo solo vive en variables locales: no se guarda en chrome.storage ni va a la consola.
// - Todo el texto se muestra con textContent (nunca innerHTML).
// - Cada fetch tiene tiempo máximo (AbortSignal.timeout) y va sin cookies.
// - Mensajes genéricos: nunca se muestra el texto crudo de un error.

import { leerConfiguracion } from "../lib/almacen.js";
import {
  armarPeticion,
  esPestanaGmail,
  interpretarAnalisis,
  interpretarLectura,
  resultadoAnalisisSinConexion,
  resultadoNoGmail,
  resultadoRecargarGmail,
  urlAnalizar,
} from "../lib/correo.js";
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
  analizar: document.getElementById("analizar"),
  analisis: document.getElementById("analisis"),
  analisisTexto: document.getElementById("analisis-texto"),
  resultado: document.getElementById("resultado"),
  resCategoria: document.getElementById("res-categoria"),
  resPrioridad: document.getElementById("res-prioridad"),
  resConfianza: document.getElementById("res-confianza"),
  avisoRecorte: document.getElementById("aviso-recorte"),
  probar: document.getElementById("probar"),
  estado: document.getElementById("estado"),
  estadoTexto: document.getElementById("estado-texto"),
  estadoClave: document.getElementById("estado-clave"),
  estadoClaveTexto: document.getElementById("estado-clave-texto"),
};

const URL_NO_VALIDA = { tipo: "error", mensaje: "La URL de la API no es válida. Corrígela en Opciones." };

function mostrar(caja, texto, resultado) {
  caja.dataset.tipo = resultado.tipo;
  texto.textContent = resultado.mensaje;
  caja.hidden = false;
}

/** fetch con tiempo máximo, sin caché y sin cookies. */
function pedir(url, { metodo = "GET", cabeceras = {}, cuerpo } = {}) {
  return fetch(url, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo,
    cache: "no-store",
    credentials: "omit",
    signal: AbortSignal.timeout(TIEMPO_ESPERA_MS),
  });
}

// ----- Analizar este correo -----

/** Pide el correo a la pestaña activa. Devuelve {ok, correo} o {ok: false, resultado}. */
async function leerCorreoDeLaPestana() {
  const [pestana] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!pestana || !esPestanaGmail(pestana.url)) {
    return { ok: false, resultado: resultadoNoGmail() };
  }
  let respuesta;
  try {
    respuesta = await Promise.race([
      chrome.tabs.sendMessage(pestana.id, { tipo: "leer-correo" }),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("tiempo")), TIEMPO_ESPERA_MS)),
    ]);
  } catch {
    // Sin content script: la pestaña se abrió antes de instalar o recargar la extensión.
    return { ok: false, resultado: resultadoRecargarGmail() };
  }
  return interpretarLectura(respuesta);
}

async function enviarAnalisis(base, claveApi, peticion) {
  try {
    const respuesta = await pedir(urlAnalizar(base), {
      metodo: "POST",
      cabeceras: { "Content-Type": "application/json", "X-API-Key": claveApi },
      cuerpo: JSON.stringify(peticion),
    });
    let cuerpo = null;
    if (respuesta.status === 200) {
      try {
        cuerpo = await respuesta.json();
      } catch {
        cuerpo = null; // no era JSON: interpretarAnalisis lo trata como respuesta inesperada
      }
    }
    return interpretarAnalisis(respuesta.status, cuerpo);
  } catch {
    return resultadoAnalisisSinConexion();
  }
}

function mostrarResultado(resultado, recortado) {
  elementos.resultado.dataset.categoria = resultado.categoria;
  elementos.resCategoria.textContent = resultado.categoriaTexto;
  elementos.resPrioridad.textContent = resultado.prioridadTexto;
  elementos.resConfianza.textContent = resultado.confianzaTexto;
  elementos.avisoRecorte.hidden = !recortado;
  elementos.resultado.hidden = false;
}

async function analizarCorreo() {
  elementos.analisis.hidden = true;
  elementos.resultado.hidden = true;

  const { urlApi, claveApi } = await leerConfiguracion();
  const url = validarUrlApi(urlApi);
  if (!url.ok) {
    mostrar(elementos.analisis, elementos.analisisTexto, URL_NO_VALIDA);
    return;
  }
  if (!claveApi) {
    mostrar(elementos.analisis, elementos.analisisTexto, resultadoSinClave());
    return;
  }

  elementos.analizar.disabled = true;
  elementos.analizar.textContent = "Analizando…";
  try {
    const lectura = await leerCorreoDeLaPestana();
    if (!lectura.ok) {
      mostrar(elementos.analisis, elementos.analisisTexto, lectura.resultado);
      return;
    }
    const armado = armarPeticion(lectura.correo);
    if (!armado.ok) {
      mostrar(elementos.analisis, elementos.analisisTexto, armado.resultado);
      return;
    }
    const resultado = await enviarAnalisis(url.url, claveApi, armado.peticion);
    if (resultado.tipo === "resultado") {
      mostrarResultado(resultado, armado.recortado);
    } else {
      mostrar(elementos.analisis, elementos.analisisTexto, resultado);
    }
  } finally {
    elementos.analizar.disabled = false;
    elementos.analizar.textContent = "Analizar este correo";
  }
}

// ----- Probar conexión -----

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
    const respuesta = await pedir(urlEstadisticas(base), { cabeceras: { "X-API-Key": claveApi } });
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
    mostrar(elementos.estado, elementos.estadoTexto, URL_NO_VALIDA);
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

// ----- Inicio -----

function abrirOpciones() {
  chrome.runtime.openOptionsPage();
}

async function iniciar() {
  elementos.irOpciones.addEventListener("click", abrirOpciones);
  elementos.abrirOpciones.addEventListener("click", abrirOpciones);
  elementos.analizar.addEventListener("click", analizarCorreo);
  elementos.probar.addEventListener("click", probarConexion);

  const { claveApi } = await leerConfiguracion();
  const faltaClave = !claveApi;
  elementos.avisoSinClave.hidden = !faltaClave;
  elementos.abrirOpciones.hidden = !faltaClave;
}

iniciar();
