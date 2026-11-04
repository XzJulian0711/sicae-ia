// Panel lateral de SICAE-IA.
//
// "Analizar este correo":
//   1. pide a la pestaña activa (Gmail) el correo abierto (gmail/lector.js);
//   2. arma la petición (lib/correo.js) y la envía a POST /analizar con X-API-Key;
//   3. muestra la tarjeta "CORREO ABIERTO" (asunto y remitente) y la franja de resultado con
//      sus motivos (lib/tarjeta.js decide estilo, textos y secciones).
// Barra inferior: Bandeja y Redactar solo dicen "Próximamente" (llegan con la API de Gmail).
// "Probar conexión":
//   1. GET /salud (pública): ¿responde la API? ¿hay modelo cargado?
//   2. GET /estadisticas con X-API-Key: ¿la clave es correcta? (solo se usa el código)
//
// Seguridad:
// - El correo solo vive en variables locales: no se guarda en chrome.storage ni va a la consola.
// - Todo el texto se muestra con textContent (nunca innerHTML).
// - Cada fetch tiene tiempo máximo (AbortSignal.timeout) y va sin cookies.
// - Mensajes genéricos: nunca se muestra el texto crudo de un error.

import { guardarConsentimiento, leerConfiguracion, leerConsentimiento } from "../lib/almacen.js";
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
import {
  cerrarSesion,
  crearConsentimiento,
  haySesion,
  iniciarSesion,
  obtenerCorreo,
  olvidarToken,
  pantallaInicial,
  pantallaTrasIniciarSesion,
} from "../lib/sesion.js";
import { TEXTO_VACIO, armarTarjeta, datosCorreoAbierto, vistaResultado } from "../lib/tarjeta.js";

// Pantallas (paso 4.2): solo una se ve a la vez. "foco" = a dónde va el foco al mostrarla.
const PANTALLAS = {
  bienvenida: { seccion: document.getElementById("pantalla-bienvenida"), foco: "titulo-bienvenida" },
  permisos: { seccion: document.getElementById("pantalla-permisos"), foco: "titulo-permisos" },
  principal: { seccion: document.getElementById("pantalla-principal"), foco: "analizar" },
};

const acceso = {
  continuar: document.getElementById("continuar-google"),
  errorSesion: document.getElementById("error-sesion"),
  ahoraNo: document.getElementById("ahora-no"),
  aceptar: document.getElementById("aceptar-permisos"),
  barraInferior: document.getElementById("barra-inferior"),
  cuenta: document.getElementById("cuenta"),
  cuentaCorreo: document.getElementById("cuenta-correo"),
  menuCuenta: document.getElementById("menu-cuenta"),
  menuCerrarSesion: document.getElementById("menu-cerrar-sesion"),
};

const elementos = {
  avisoSinClave: document.getElementById("aviso-sin-clave"),
  abrirOpciones: document.getElementById("abrir-opciones"),
  irOpciones: document.getElementById("ir-opciones"),
  analizar: document.getElementById("analizar"),
  analisis: document.getElementById("analisis"),
  analisisTexto: document.getElementById("analisis-texto"),
  estadoVacio: document.getElementById("estado-vacio"),
  estadoVacioTexto: document.getElementById("estado-vacio-texto"),
  resultado: document.getElementById("resultado"),
  correoAsunto: document.getElementById("correo-asunto"),
  correoRemitente: document.getElementById("correo-remitente"),
  tituloMotivos: document.getElementById("titulo-motivos"),
  navBandeja: document.getElementById("nav-bandeja"),
  navRedactar: document.getElementById("nav-redactar"),
  proximamente: document.getElementById("proximamente"),
  tarjeta: document.getElementById("tarjeta"),
  tarjetaIcono: document.getElementById("tarjeta-icono"),
  tarjetaTitulo: document.getElementById("tarjeta-titulo"),
  tarjetaDetalle: document.getElementById("tarjeta-detalle"),
  tarjetaConsejos: document.getElementById("tarjeta-consejos"),
  tarjetaPrioridad: document.getElementById("tarjeta-prioridad"),
  tarjetaMotivos: document.getElementById("tarjeta-motivos"),
  listaMotivos: document.getElementById("lista-motivos"),
  tarjetaNota: document.getElementById("tarjeta-nota"),
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

/**
 * Llena una lista (<ul> u <ol>) con textos, cada uno con textContent: los motivos pueden traer
 * texto del correo. En los chips de motivos el número lo pone el CSS (contador de la <ol>).
 */
function llenarLista(lista, textos) {
  lista.replaceChildren(...textos.map((texto) => {
    const item = document.createElement("li");
    item.textContent = texto;
    return item;
  }));
}

/** Estado vacío o resultado: nunca los dos a la vez (lo decide vistaResultado()). */
function mostrarVista(hayResultado) {
  const vista = vistaResultado(hayResultado);
  elementos.estadoVacio.hidden = !vista.vacio;
  elementos.resultado.hidden = !vista.resultado;
}

/** Tarjeta "CORREO ABIERTO": asunto y remitente leídos de Gmail (solo textContent). */
function mostrarCorreoAbierto(correo) {
  const datos = datosCorreoAbierto(correo);
  elementos.correoAsunto.textContent = datos.asunto;
  elementos.correoRemitente.textContent = datos.remitente;
  elementos.tarjeta.hidden = true; // la franja aparece cuando responde la API
  mostrarVista(true);
}

function mostrarResultado(resultado, recortado) {
  const t = armarTarjeta(resultado);
  const e = elementos;

  e.tarjeta.dataset.variante = t.variante;
  e.tarjetaIcono.src = t.icono; // ruta fija de tarjeta.js, nunca de la API
  e.tarjetaTitulo.textContent = t.titulo;

  e.tarjetaDetalle.textContent = t.detalle ?? "";
  e.tarjetaDetalle.hidden = !t.detalle;

  llenarLista(e.tarjetaConsejos, t.consejos);
  e.tarjetaConsejos.hidden = t.consejos.length === 0;

  e.tarjetaPrioridad.textContent = t.prioridad?.texto ?? "";
  e.tarjetaPrioridad.dataset.prioridad = t.prioridad?.valor ?? "";
  e.tarjetaPrioridad.hidden = !t.prioridad;

  e.tituloMotivos.textContent = t.tituloMotivos;
  llenarLista(e.listaMotivos, t.motivos);
  e.tarjetaMotivos.hidden = t.motivos.length === 0;

  e.avisoRecorte.hidden = !recortado;
  e.tarjetaNota.textContent = t.nota;
  e.tarjeta.hidden = false;
}

async function analizarCorreo() {
  elementos.analisis.hidden = true;
  elementos.tarjeta.hidden = true;
  mostrarVista(false); // si la lectura falla, vuelve el estado vacío junto al mensaje

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
    mostrarCorreoAbierto(lectura.correo); // se ve el correo leído aunque la API falle
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

/** Bandeja y Redactar todavía no existen: solo avisan "Próximamente" y no hacen nada más. */
function avisarProximamente(evento) {
  const nombre = evento.currentTarget.querySelector("span")?.textContent ?? "";
  elementos.proximamente.textContent = `${nombre}: próximamente.`;
}

// ----- Bienvenida, permisos e inicio de sesión (paso 4.2) -----
// El token de Google nunca pasa por aquí: lib/sesion.js solo responde {ok, mensaje} o true/false.

function mostrarPantalla(nombre, { enfocar = true } = {}) {
  for (const [clave, pantalla] of Object.entries(PANTALLAS)) {
    pantalla.seccion.hidden = clave !== nombre;
  }
  acceso.barraInferior.hidden = nombre !== "principal";
  if (enfocar) document.getElementById(PANTALLAS[nombre].foco)?.focus();
}

/** Mensaje en la bienvenida. tipo "error" (naranja) o "conectado" (azul, p. ej. sesión cerrada). */
function mostrarErrorSesion(mensaje, tipo = "error") {
  acceso.errorSesion.dataset.tipo = tipo;
  acceso.errorSesion.textContent = mensaje ?? "";
  acceso.errorSesion.hidden = !mensaje;
}

// ----- Cuenta de la sesión y menú "Cerrar sesión" -----
// El correo se pide a Google en el momento (lib/sesion.js → obtenerCorreo) y solo vive aquí,
// en el texto del botón: no se guarda en chrome.storage ni va a la consola.

function ocultarCuenta() {
  cerrarMenuCuenta({ devolverFoco: false });
  acceso.cuenta.hidden = true;
  acceso.cuentaCorreo.textContent = "";
  acceso.cuenta.removeAttribute("title");
}

async function mostrarCuenta() {
  const resultado = await obtenerCorreo(chrome.identity, fetch);
  if (!resultado.ok) {
    ocultarCuenta(); // sin correo, el resto del panel sigue igual
    return;
  }
  acceso.cuentaCorreo.textContent = resultado.correo;
  acceso.cuenta.title = `Sesión: ${resultado.correo}`;
  acceso.cuenta.hidden = false;
}

function menuAbierto() {
  return !acceso.menuCuenta.hidden;
}

function abrirMenuCuenta() {
  acceso.menuCuenta.hidden = false;
  acceso.cuenta.setAttribute("aria-expanded", "true");
  acceso.menuCerrarSesion.focus();
}

function cerrarMenuCuenta({ devolverFoco = true } = {}) {
  if (!menuAbierto()) return;
  acceso.menuCuenta.hidden = true;
  acceso.cuenta.setAttribute("aria-expanded", "false");
  if (devolverFoco) acceso.cuenta.focus();
}

async function cerrarSesionDesdeMenu() {
  acceso.menuCerrarSesion.disabled = true;
  try {
    const resultado = await cerrarSesion(chrome.identity, fetch); // la misma lógica de Opciones
    ocultarCuenta();
    mostrarPantalla("bienvenida");
    mostrarErrorSesion(resultado.mensaje, resultado.ok ? "conectado" : "error");
  } finally {
    acceso.menuCerrarSesion.disabled = false;
  }
}

function iniciarMenuCuenta() {
  acceso.cuenta.addEventListener("click", () => (menuAbierto() ? cerrarMenuCuenta() : abrirMenuCuenta()));
  acceso.menuCerrarSesion.addEventListener("click", cerrarSesionDesdeMenu);
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") cerrarMenuCuenta();
  });
  document.addEventListener("click", (evento) => {
    if (menuAbierto() && !evento.target.closest(".cuenta-contenedor")) cerrarMenuCuenta({ devolverFoco: false });
  });
}

async function continuarConGoogle() {
  mostrarErrorSesion(null);
  acceso.continuar.disabled = true;
  acceso.continuar.textContent = "Abriendo Google…";
  try {
    const sesion = await iniciarSesion(chrome.identity, navigator.onLine);
    if (!sesion.ok) {
      mostrarErrorSesion(sesion.mensaje);
      return;
    }
    mostrarPantalla(pantallaTrasIniciarSesion(await leerConsentimiento()));
    mostrarCuenta();
  } finally {
    acceso.continuar.disabled = false;
    acceso.continuar.textContent = "Continuar con Google";
  }
}

async function aceptarPermisos() {
  await guardarConsentimiento(crearConsentimiento()); // solo {aceptado, version, fecha}
  mostrarPantalla("principal");
}

async function ahoraNo() {
  await olvidarToken(chrome.identity); // no se guarda nada y se suelta el token de la caché
  ocultarCuenta();
  mostrarPantalla("bienvenida");
}

async function elegirPantallaInicial() {
  const [sesion, consentimiento] = await Promise.all([haySesion(chrome.identity), leerConsentimiento()]);
  mostrarPantalla(pantallaInicial({ sesion, consentimiento }), { enfocar: false });
  if (sesion) mostrarCuenta();
}

async function iniciar() {
  iniciarMenuCuenta();
  acceso.continuar.addEventListener("click", continuarConGoogle);
  acceso.aceptar.addEventListener("click", aceptarPermisos);
  acceso.ahoraNo.addEventListener("click", ahoraNo);
  elegirPantallaInicial();

  elementos.estadoVacioTexto.textContent = TEXTO_VACIO;
  mostrarVista(false);
  elementos.irOpciones.addEventListener("click", abrirOpciones);
  elementos.abrirOpciones.addEventListener("click", abrirOpciones);
  elementos.analizar.addEventListener("click", analizarCorreo);
  elementos.probar.addEventListener("click", probarConexion);
  elementos.navBandeja.addEventListener("click", avisarProximamente);
  elementos.navRedactar.addEventListener("click", avisarProximamente);

  const { claveApi } = await leerConfiguracion();
  const faltaClave = !claveApi;
  elementos.avisoSinClave.hidden = !faltaClave;
  elementos.abrirOpciones.hidden = !faltaClave;
}

iniciar();
