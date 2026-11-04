// Panel lateral de SICAE-IA.
//
// "Analizar este correo":
//   1. pide a la pestaña activa (Gmail) el correo abierto (gmail/lector.js);
//   2. arma la petición (lib/correo.js) y la envía a POST /analizar con la sesión de la API
//      (Authorization: Bearer; si responde 401, la sesión se renueva una vez: lib/sesion.js);
//   3. muestra la tarjeta "CORREO ABIERTO" (asunto y remitente) y la franja de resultado con
//      sus motivos (lib/tarjeta.js decide estilo, textos y secciones).
// Barra inferior: Bandeja y Redactar solo dicen "Próximamente" (llegan con la API de Gmail).
// "Probar conexión":
//   1. GET /salud (pública): ¿responde la API? ¿hay modelo cargado?
//   2. GET /estadisticas con la sesión: ¿la API acepta la sesión? (solo se usa el código)
//
// Seguridad:
// - El correo solo vive en variables locales: no se guarda en chrome.storage ni va a la consola.
// - Todo el texto se muestra con textContent (nunca innerHTML).
// - Cada fetch tiene tiempo máximo (AbortSignal.timeout) y va sin cookies.
// - Mensajes genéricos: nunca se muestra el texto crudo de un error.

import { almacenSesionApi, guardarConsentimiento, leerConfiguracion, leerConsentimiento } from "../lib/almacen.js";
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
  interpretarSalud,
  interpretarSesionApi,
  resultadoSinConexion,
  urlEstadisticas,
  urlSalud,
  validarUrlApi,
} from "../lib/logica.js";
import {
  asegurarSesionApi,
  cerrarSesionCompleta,
  conSesion,
  consentimientoValido,
  crearConsentimiento,
  haySesion,
  iniciarSesion,
  obtenerCorreo,
  olvidarToken,
  pantallaInicial,
  pantallaTrasIniciarSesion,
  queHacerAnte403,
  registrarConsentimiento,
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
  estadoSesion: document.getElementById("estado-sesion"),
  estadoSesionTexto: document.getElementById("estado-sesion-texto"),
};

const URL_NO_VALIDA = { tipo: "error", mensaje: "La URL de la API no es válida. Corrígela en Opciones." };

/**
 * Lo que necesitan las funciones de sesión de lib/sesion.js (paso 4.3): la sesión de la API se
 * guarda SOLO en chrome.storage.session, y se registra el consentimiento local si es válido.
 */
async function contextoSesion(base) {
  const consentimiento = await leerConsentimiento();
  return {
    identidad: chrome.identity,
    pedir: fetch,
    base,
    almacen: almacenSesionApi,
    version: consentimientoValido(consentimiento) ? consentimiento.version : null,
  };
}

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

/**
 * POST /analizar con la sesión de la API. conSesion() la abre si hace falta y, si la API
 * responde 401, la renueva UNA vez y reintenta.
 * Si responde 403 (la API no tiene el consentimiento, p. ej. porque la cuenta se borró en otro
 * equipo), queHacerAnte403() decide:
 *   - "registrar": hay un consentimiento aceptado de la MISMA versión del texto en este equipo →
 *     se registra en la API y se reintenta una vez;
 *   - "pedir_permisos": no lo hay (o es de otra versión) → NO se registra solo: se devuelve
 *     {tipo: "pedir_permisos"} y el panel vuelve a "Revisa los permisos".
 */
async function enviarAnalisis(base, peticion) {
  try {
    const contexto = await contextoSesion(base);
    const enviar = (sesion) => pedir(urlAnalizar(base), {
      metodo: "POST",
      cabeceras: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.token}` },
      cuerpo: JSON.stringify(peticion),
    });
    let intento = await conSesion(contexto, enviar);
    if (intento.ok && intento.respuesta.status === 403) {
      if (queHacerAnte403(await leerConsentimiento()) !== "registrar") return { tipo: "pedir_permisos" };
      intento = await conSesion(contexto, async (sesion) => {
        await registrarConsentimiento(fetch, base, sesion, contexto.version);
        return enviar(sesion);
      });
      if (intento.ok && intento.respuesta.status === 403) return { tipo: "pedir_permisos" };
    }
    if (!intento.ok) return { tipo: "error", mensaje: intento.mensaje };
    const respuesta = intento.respuesta;
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

  const { urlApi } = await leerConfiguracion();
  const url = validarUrlApi(urlApi);
  if (!url.ok) {
    mostrar(elementos.analisis, elementos.analisisTexto, URL_NO_VALIDA);
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
    const resultado = await enviarAnalisis(url.url, armado.peticion);
    if (resultado.tipo === "resultado") {
      mostrarResultado(resultado, armado.recortado);
    } else if (resultado.tipo === "pedir_permisos") {
      mostrarPantalla("permisos"); // sin consentimiento válido no se registra nada solo
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

/** Abre (o reusa) la sesión con la API y prueba GET /estadisticas: solo se usa el código. */
async function comprobarSesionApi(base) {
  const intento = await conSesion(await contextoSesion(base),
                                  (sesion) => pedir(urlEstadisticas(base), { cabeceras: { Authorization: `Bearer ${sesion.token}` } }));
  if (!intento.ok) return { tipo: "error", mensaje: intento.mensaje };
  return interpretarSesionApi(intento.respuesta.status); // el cuerpo (conteos) no se lee
}

async function probarConexion() {
  const { urlApi } = await leerConfiguracion();
  const url = validarUrlApi(urlApi);
  elementos.estadoSesion.hidden = true;
  if (!url.ok) {
    mostrar(elementos.estado, elementos.estadoTexto, URL_NO_VALIDA);
    return;
  }

  elementos.probar.disabled = true;
  elementos.probar.textContent = "Probando…";
  try {
    const salud = await comprobarSalud(url.url);
    mostrar(elementos.estado, elementos.estadoTexto, salud);
    // La sesión solo se prueba si la API respondió (con o sin modelo).
    if (salud.tipo === "conectado" || salud.tipo === "sin_modelo") {
      mostrar(elementos.estadoSesion, elementos.estadoSesionTexto, await comprobarSesionApi(url.url));
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
    // La misma lógica de Opciones: cierra la sesión de la API, la borra de storage.session y
    // luego cierra la de Google (caché de Chrome + revocar).
    const { urlApi } = await leerConfiguracion();
    const url = validarUrlApi(urlApi);
    const resultado = await cerrarSesionCompleta({ identidad: chrome.identity, pedir: fetch, base: url.ok ? url.url : null,
                                                   almacen: almacenSesionApi });
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
  const consentimiento = crearConsentimiento();
  await guardarConsentimiento(consentimiento); // solo {aceptado, version, fecha}
  mostrarPantalla("principal");
  registrarEnLaApi(consentimiento.version); // sin esperar: si la API está apagada, se reintenta al analizar
}

/**
 * Paso 4.3: abre la sesión con la API (POST /auth/google) y registra el consentimiento
 * (POST /consentimiento). Si falla (API apagada), no pasa nada: se intenta otra vez al analizar.
 */
async function registrarEnLaApi(version) {
  try {
    const { urlApi } = await leerConfiguracion();
    const url = validarUrlApi(urlApi);
    if (!url.ok) return;
    const lista = await asegurarSesionApi({ identidad: chrome.identity, pedir: fetch, base: url.url, almacen: almacenSesionApi, version });
    if (lista.ok) await registrarConsentimiento(fetch, url.url, lista.sesion, version);
  } catch {
    // Se reintenta al analizar.
  }
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
  elementos.analizar.addEventListener("click", analizarCorreo);
  elementos.probar.addEventListener("click", probarConexion);
  elementos.navBandeja.addEventListener("click", avisarProximamente);
  elementos.navRedactar.addEventListener("click", avisarProximamente);
}

iniciar();
