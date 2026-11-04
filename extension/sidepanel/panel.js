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
  MENSAJE_OTRA_CUENTA,
  formatearHora,
  mismaCuenta,
  resumenPublicidad,
  resumirBandeja,
  textoAvisoPhishing,
} from "../lib/bandeja.js";
import {
  MAX_BYTES_POR_CORREO_LOTE,
  armarPeticion,
  esPestanaGmail,
  interpretarAnalisis,
  interpretarLectura,
  interpretarLote,
  resultadoAnalisisSinConexion,
  resultadoNoGmail,
  resultadoRecargarGmail,
  urlAnalizar,
  urlAnalizarLote,
} from "../lib/correo.js";
import { datosPromociones, leerBandeja } from "../lib/gmail.js";
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
  navAnalizar: document.getElementById("nav-analizar"),
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
  // Paso 4.4: la pestaña de Gmail debe ser de la cuenta de la sesión (Gmail la pone en el título;
  // tab.title llega por el permiso de mail.google.com). Si no se puede saber, se sigue.
  if (!mismaCuenta(pestana.title, correoSesion)) {
    return { ok: false, resultado: { tipo: "error", mensaje: MENSAJE_OTRA_CUENTA } };
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

/** Redactar todavía no existe: solo avisa "Próximamente" y no hace nada más. */
function avisarProximamente(evento) {
  const nombre = evento.currentTarget.querySelector("span")?.textContent ?? "";
  elementos.proximamente.textContent = `${nombre}: próximamente.`;
}

// ----- Pestañas de la vista principal: Analizar y Bandeja -----

const VISTAS = {
  analizar: { seccion: document.getElementById("vista-analizar"), pestana: "nav-analizar", foco: "analizar" },
  bandeja: { seccion: document.getElementById("vista-bandeja"), pestana: "nav-bandeja", foco: "titulo-bandeja" },
};

function mostrarVistaPrincipal(nombre, { enfocar = true } = {}) {
  for (const [clave, vista] of Object.entries(VISTAS)) {
    vista.seccion.hidden = clave !== nombre;
    const pestana = document.getElementById(vista.pestana);
    if (clave === nombre) pestana.setAttribute("aria-current", "page");
    else pestana.removeAttribute("aria-current");
  }
  elementos.proximamente.textContent = "";
  if (enfocar) document.getElementById(VISTAS[nombre].foco)?.focus();
}

// ----- Bandeja (paso 4.4): SOLO LECTURA -----
// Lee los últimos 50 correos de Recibidos con la API de Gmail (lib/gmail.js), los clasifica en
// un solo POST /analizar/lote y muestra el resumen (lib/bandeja.js). Todo vive en memoria: ni
// los correos ni los resultados se guardan en chrome.storage ni en la API (fuera del registro
// de siempre, sin texto).

const b = {
  actualizar: document.getElementById("actualizar-bandeja"),
  ultimo: document.getElementById("bandeja-ultimo"),
  progreso: document.getElementById("bandeja-progreso"),
  error: document.getElementById("bandeja-error"),
  errorTexto: document.getElementById("bandeja-error-texto"),
  darPermiso: document.getElementById("dar-permiso-gmail"),
  vacia: document.getElementById("bandeja-vacia"),
  resumen: document.getElementById("bandeja-resumen"),
  conteoAlta: document.getElementById("conteo-alta"),
  conteoMedia: document.getElementById("conteo-media"),
  conteoBaja: document.getElementById("conteo-baja"),
  avisoPhishing: document.getElementById("aviso-phishing"),
  avisoPhishingTexto: document.getElementById("aviso-phishing-texto"),
  verMotivos: document.getElementById("ver-motivos"),
  listaPhishing: document.getElementById("lista-phishing"),
  listaAlta: document.getElementById("lista-alta"),
  altaVacia: document.getElementById("alta-vacia"),
  publicidadTexto: document.getElementById("publicidad-texto"),
  liberar: document.getElementById("liberar-espacio"),
  sinClasificar: document.getElementById("bandeja-sin-clasificar"),
};

function mostrarProgresoBandeja(texto) {
  b.progreso.textContent = texto ?? "";
  b.progreso.hidden = !texto;
}

function mostrarErrorBandeja(mensaje, { conPermiso = false } = {}) {
  b.errorTexto.textContent = mensaje ?? "";
  b.error.hidden = !mensaje;
  b.darPermiso.hidden = !conPermiso;
}

/** Fila de una lista de correos: botón con remitente · hora y asunto (solo textContent). */
function filaCorreo(item) {
  const li = document.createElement("li");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "fila-correo";
  const linea = document.createElement("span");
  linea.className = "fila-linea";
  const remitente = document.createElement("strong");
  remitente.textContent = item.remitenteNombre || item.correo.remitente || "(Sin remitente)";
  const hora = document.createElement("span");
  hora.className = "fila-hora";
  hora.textContent = ` · ${formatearHora(item.fecha)}`;
  linea.append(remitente, hora);
  const asunto = document.createElement("span");
  asunto.className = "fila-asunto";
  asunto.textContent = item.correo.asunto?.trim() || "(Sin asunto)";
  boton.append(linea, asunto);
  boton.addEventListener("click", () => abrirEnAnalizar(item));
  li.append(boton);
  return li;
}

/** "Ver motivos": muestra la tarjeta de ese correo en Analizar, con su resultado del lote. */
function abrirEnAnalizar(item) {
  mostrarVistaPrincipal("analizar", { enfocar: false });
  elementos.analisis.hidden = true;
  mostrarCorreoAbierto(item.correo);
  mostrarResultado(item.resultado, false);
  elementos.tarjeta.querySelector("h2")?.setAttribute("tabindex", "-1");
  elementos.tarjeta.querySelector("h2")?.focus();
}

function pintarBandeja(items, publicidad) {
  const resumen = resumirBandeja(items);
  b.conteoAlta.textContent = String(resumen.conteos.alta);
  b.conteoMedia.textContent = String(resumen.conteos.media);
  b.conteoBaja.textContent = String(resumen.conteos.baja);

  b.avisoPhishing.hidden = resumen.phishing.length === 0;
  b.avisoPhishingTexto.textContent = textoAvisoPhishing(resumen.phishing.length);
  b.listaPhishing.replaceChildren(...resumen.phishing.map(filaCorreo));
  b.listaPhishing.hidden = true;
  b.verMotivos.setAttribute("aria-expanded", "false");

  b.listaAlta.replaceChildren(...resumen.prioridadAlta.map(filaCorreo));
  b.altaVacia.hidden = resumen.prioridadAlta.length > 0;

  b.publicidadTexto.textContent = resumenPublicidad(publicidad, resumen.publicidad).texto;

  b.sinClasificar.textContent = resumen.sinClasificar
    ? `${resumen.sinClasificar} correo(s) no se pudieron clasificar.`
    : "";
  b.sinClasificar.hidden = !resumen.sinClasificar;

  b.vacia.hidden = true;
  b.resumen.hidden = false;
}

/** POST /analizar/lote con la sesión (se renueva una vez con 401; un 403 sigue la regla del 4.3). */
async function clasificarLote(base, peticiones) {
  const contexto = await contextoSesion(base);
  const enviar = (sesion) => pedir(urlAnalizarLote(base), {
    metodo: "POST",
    cabeceras: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.token}` },
    cuerpo: JSON.stringify({ correos: peticiones }),
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
  let cuerpo = null;
  if (intento.respuesta.status === 200) {
    try {
      cuerpo = await intento.respuesta.json();
    } catch {
      cuerpo = null;
    }
  }
  return interpretarLote(intento.respuesta.status, cuerpo, peticiones.length);
}

async function actualizarBandeja() {
  mostrarErrorBandeja(null);
  const { urlApi } = await leerConfiguracion();
  const url = validarUrlApi(urlApi);
  if (!url.ok) {
    mostrarErrorBandeja(URL_NO_VALIDA.mensaje);
    return;
  }

  b.actualizar.disabled = true;
  try {
    mostrarProgresoBandeja("Leyendo correos…");
    const lectura = await leerBandeja({
      identidad: chrome.identity,
      pedir: fetch,
      alProgresar: (leidos, total) => mostrarProgresoBandeja(`Leyendo correos ${leidos} de ${total}…`),
    });
    if (!lectura.ok) {
      mostrarErrorBandeja(lectura.mensaje, { conPermiso: lectura.codigo === "sin_permiso" });
      return;
    }

    // Cada correo se recorta a su parte del lote; los que no se pueden armar quedan sin clasificar.
    const armados = lectura.mensajes.map((m) => armarPeticion(m.correo, { maxBytes: MAX_BYTES_POR_CORREO_LOTE }));
    const enviables = armados.map((a, i) => ({ a, i })).filter(({ a }) => a.ok);
    const items = lectura.mensajes.map((m) => ({ ...m, resultado: null }));

    if (enviables.length > 0) {
      mostrarProgresoBandeja("Clasificando…");
      const [lote, promociones] = await Promise.all([
        clasificarLote(url.url, enviables.map(({ a }) => a.peticion)),
        datosPromociones(lectura.cliente),
      ]);
      if (lote.tipo === "pedir_permisos") {
        mostrarPantalla("permisos"); // sin consentimiento válido no se registra nada solo
        return;
      }
      if (lote.tipo !== "lote") {
        mostrarErrorBandeja(lote.mensaje);
        return;
      }
      lote.resultados.forEach((resultado, k) => { items[enviables[k].i].resultado = resultado; });
      pintarBandeja(items, promociones);
    } else {
      pintarBandeja(items, await datosPromociones(lectura.cliente));
    }
    b.ultimo.textContent = `Último análisis: ${formatearHora(Date.now())}`;
  } finally {
    mostrarProgresoBandeja(null);
    b.actualizar.disabled = false;
  }
}

/** "Dar permiso": abre la ventana de Google para aceptar el alcance de lectura de Gmail. */
async function darPermisoGmail() {
  const sesion = await iniciarSesion(chrome.identity, navigator.onLine);
  if (!sesion.ok) {
    mostrarErrorBandeja(sesion.mensaje, { conPermiso: true });
    return;
  }
  actualizarBandeja();
}

function iniciarBandeja() {
  b.actualizar.addEventListener("click", actualizarBandeja);
  b.darPermiso.addEventListener("click", darPermisoGmail);
  b.verMotivos.addEventListener("click", () => {
    const abrir = b.listaPhishing.hidden;
    b.listaPhishing.hidden = !abrir;
    b.verMotivos.setAttribute("aria-expanded", String(abrir));
  });
  // "Revisar y liberar espacio" llega en el paso 4.5: por ahora no hace nada.
  b.liberar.addEventListener("click", () => {
    elementos.proximamente.textContent = "Revisar y liberar espacio: próximamente (4.5).";
  });
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

// Correo de la sesión en memoria (para comparar con la pestaña de Gmail). Nunca se guarda.
let correoSesion = null;

function ocultarCuenta() {
  correoSesion = null;
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
  correoSesion = resultado.correo;
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
  elementos.navBandeja.addEventListener("click", () => mostrarVistaPrincipal("bandeja"));
  elementos.navAnalizar.addEventListener("click", () => mostrarVistaPrincipal("analizar"));
  elementos.navRedactar.addEventListener("click", avisarProximamente);
  iniciarBandeja();
}

iniciar();
