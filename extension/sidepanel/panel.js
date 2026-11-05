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
  formatearNumero,
  formatearTamano,
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
import {
  MENSAJES_GMAIL,
  crearClienteGmail,
  datosPromociones,
  devolverARecibidos,
  leerBandeja,
  leerMensajes,
  listarIds,
  moverAPapelera,
  ponerEnCuarentena,
  sacarDePapelera,
} from "../lib/gmail.js";
import {
  AVISO_TODO_EL_CORREO,
  agruparPorRemitente,
  busquedasGmail,
  cumpleCondiciones,
  enLotes,
  filtrarCandidatos,
  mbDe,
  textoBotonDeshacer,
  textoConfirmacion,
  textoExclusiones,
  textoResultado,
  totalesSeleccion,
  validarOpciones,
} from "../lib/limpieza.js";
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

// Correo que muestra la tarjeta ahora (para "Mover a cuarentena"): {id de Gmail, tamaño}. Memoria.
let tarjetaActual = { id: null, tamano: 0 };

function mostrarResultado(resultado, recortado) {
  mostrarCuarentena(resultado);
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
    tarjetaActual = { id: lectura.correo.idGmail ?? null, tamano: 0 };
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
  liberar: { seccion: document.getElementById("vista-liberar"), pestana: "nav-bandeja", foco: "titulo-liberar" },
};

function mostrarVistaPrincipal(nombre, { enfocar = true } = {}) {
  for (const [clave, vista] of Object.entries(VISTAS)) vista.seccion.hidden = clave !== nombre;
  // "Liberar espacio" es parte de la Bandeja: la pestaña activa sigue siendo Bandeja.
  for (const id of ["nav-analizar", "nav-bandeja"]) {
    const pestana = document.getElementById(id);
    if (id === VISTAS[nombre].pestana) pestana.setAttribute("aria-current", "page");
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
  tarjetaActual = { id: item.id ?? null, tamano: item.tamano ?? 0 };
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
async function clasificarLote(base, peticiones, { registrar = true } = {}) {
  const contexto = await contextoSesion(base);
  const enviar = (sesion) => pedir(urlAnalizarLote(base), {
    metodo: "POST",
    cabeceras: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.token}` },
    // registrar: false (paso 4.5): los análisis de "Liberar espacio" no se cuentan en /estadisticas.
    cuerpo: JSON.stringify({ correos: peticiones, registrar }),
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

// Últimos correos analizados por la Bandeja (solo en memoria): "publicidad detectada" sale de aquí.
let itemsBandeja = [];

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
      alReintentar: () => mostrarProgresoBandeja(MENSAJES_GMAIL.reintentando),
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
      itemsBandeja = items;
      pintarBandeja(items, promociones);
    } else {
      itemsBandeja = items;
      pintarBandeja(items, await datosPromociones(lectura.cliente));
    }
    b.ultimo.textContent = `Último análisis: ${formatearHora(Date.now())}`;
  } finally {
    mostrarProgresoBandeja(null);
    b.actualizar.disabled = false;
  }
}

/** Abre la ventana de Google para aceptar el permiso de Gmail (gmail.modify). → {ok, mensaje}. */
function pedirPermisoGmail() {
  return iniciarSesion(chrome.identity, navigator.onLine);
}

const PERMISO_LISTO = "Listo, ya tienes el permiso. Vuelve a intentarlo.";

/** "Dar permiso" de la Bandeja: si se acepta, vuelve a leer (leer no cambia nada en Gmail). */
async function darPermisoGmail() {
  const sesion = await pedirPermisoGmail();
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
  b.liberar.addEventListener("click", () => mostrarVistaPrincipal("liberar"));
  iniciarLiberar();
  iniciarCuarentena();
}

// ----- Registro de acciones en la API (paso 4.5): solo acción, cantidad y MB -----

/** POST /acciones. Si falla, la acción en Gmail ya se hizo: devuelve false para avisarlo. */
async function registrarAccion(accion, cantidad, mb) {
  try {
    const { urlApi } = await leerConfiguracion();
    const url = validarUrlApi(urlApi);
    if (!url.ok) return false;
    const intento = await conSesion(await contextoSesion(url.url), (sesion) => pedir(`${url.url}/acciones`, {
      metodo: "POST",
      cabeceras: { "Content-Type": "application/json", Authorization: `Bearer ${sesion.token}` },
      cuerpo: JSON.stringify({ accion, cantidad, mb }),
    }));
    return intento.ok && intento.respuesta.status === 204;
  } catch {
    return false;
  }
}

const AVISO_SIN_REGISTRO = " (No se pudo registrar la acción en la API.)";

/**
 * Cliente de Gmail del panel. Si Gmail pide esperar (429, 5xx), `mostrar` recibe "Gmail pidió
 * esperar, reintentando…"; el siguiente avance lo reemplaza.
 */
function clienteGmail(mostrar) {
  return crearClienteGmail({
    identidad: chrome.identity,
    pedir: fetch,
    alReintentar: () => mostrar(MENSAJES_GMAIL.reintentando),
  });
}

// ----- Cuarentena de phishing (paso 4.5): etiqueta + quitar de Recibidos. NUNCA a la papelera -----

const q = {
  caja: document.getElementById("cuarentena"),
  mover: document.getElementById("mover-cuarentena"),
  devolver: document.getElementById("devolver-recibidos"),
  estado: document.getElementById("cuarentena-estado"),
  darPermiso: document.getElementById("cuarentena-dar-permiso"),
};

/** Estado de la cuarentena; con `conPermiso` (403 de permiso insuficiente) muestra "Dar permiso". */
function estadoCuarentena(texto, tipo = "conectado", { conPermiso = false } = {}) {
  q.estado.dataset.tipo = tipo;
  q.estado.textContent = texto ?? "";
  q.estado.hidden = !texto;
  q.darPermiso.hidden = !conPermiso;
}

/** "Dar permiso" de la cuarentena: NO repite la acción sola; la persona vuelve a pulsar. */
async function darPermisoCuarentena() {
  const sesion = await pedirPermisoGmail();
  if (!sesion.ok) {
    estadoCuarentena(sesion.mensaje, "error", { conPermiso: true });
    return;
  }
  estadoCuarentena(PERMISO_LISTO);
}

/** Solo en la tarjeta de phishing. Sin id de Gmail (p. ej. si Gmail cambió su página), deshabilitado. */
function mostrarCuarentena(resultado) {
  const esPhishing = resultado?.categoria === "phishing";
  q.caja.hidden = !esPhishing;
  q.devolver.hidden = true;
  q.mover.hidden = false;
  estadoCuarentena(null);
  const sinId = !tarjetaActual.id;
  q.mover.disabled = sinId;
  if (esPhishing && sinId) estadoCuarentena("Ábrelo desde la Bandeja para moverlo a cuarentena.", "error");
}

async function moverACuarentena() {
  if (!tarjetaActual.id) return;
  q.mover.disabled = true;
  try {
    await ponerEnCuarentena(clienteGmail((texto) => estadoCuarentena(texto)), [tarjetaActual.id]);
    const registrado = await registrarAccion("cuarentena", 1, mbDe(tarjetaActual.tamano));
    estadoCuarentena(`Movido a cuarentena (etiqueta «SICAE/Cuarentena») y quitado de Recibidos.${registrado ? "" : AVISO_SIN_REGISTRO}`);
    q.mover.hidden = true;
    q.devolver.hidden = false;
    q.devolver.focus();
  } catch (error) {
    estadoCuarentena(error?.message || "No se pudo mover a cuarentena.", "error", { conPermiso: error?.codigo === "sin_permiso" });
  } finally {
    q.mover.disabled = !tarjetaActual.id;
  }
}

async function devolverDeCuarentena() {
  if (!tarjetaActual.id) return;
  q.devolver.disabled = true;
  try {
    await devolverARecibidos(clienteGmail((texto) => estadoCuarentena(texto)), [tarjetaActual.id]);
    const registrado = await registrarAccion("devolver_cuarentena", 1, mbDe(tarjetaActual.tamano));
    estadoCuarentena(`Devuelto a Recibidos.${registrado ? "" : AVISO_SIN_REGISTRO}`);
    q.devolver.hidden = true;
    q.mover.hidden = false;
    q.mover.focus();
  } catch (error) {
    estadoCuarentena(error?.message || "No se pudo devolver a Recibidos.", "error", { conPermiso: error?.codigo === "sin_permiso" });
  } finally {
    q.devolver.disabled = false;
  }
}

function iniciarCuarentena() {
  q.mover.addEventListener("click", moverACuarentena);
  q.devolver.addEventListener("click", devolverDeCuarentena);
  q.darPermiso.addEventListener("click", darPermisoCuarentena);
}

// ----- Liberar espacio (paso 4.5): papelera con confirmación y Deshacer -----
// Los correos se MUEVEN A LA PAPELERA (users.messages.trash): se pueden recuperar 30 días. Los ids
// del último movimiento quedan SOLO en memoria para "Deshacer" (se pierden al cerrar el panel).

const l = {
  formulario: document.getElementById("formulario-liberar"),
  origenTodo: document.getElementById("origen-todo"),
  avisoTodo: document.getElementById("aviso-todo"),
  usarMeses: document.getElementById("usar-meses"),
  meses: document.getElementById("meses"),
  usarMb: document.getElementById("usar-mb"),
  mb: document.getElementById("mb"),
  cantidadOtra: document.getElementById("cantidad-otra"),
  buscar: document.getElementById("buscar-limpieza"),
  cancelar: document.getElementById("cancelar-limpieza"),
  progreso: document.getElementById("liberar-progreso"),
  error: document.getElementById("liberar-error"),
  errorTexto: document.getElementById("liberar-error-texto"),
  darPermiso: document.getElementById("liberar-dar-permiso"),
  excluidos: document.getElementById("liberar-excluidos"),
  resultado: document.getElementById("resultado-limpieza"),
  seleccionarTodo: document.getElementById("seleccionar-todo"),
  total: document.getElementById("total-seleccion"),
  grupos: document.getElementById("grupos-remitente"),
  moverPapelera: document.getElementById("mover-papelera"),
  movimiento: document.getElementById("movimiento"),
  movimientoTexto: document.getElementById("movimiento-texto"),
  deshacer: document.getElementById("deshacer-movimiento"),
  dialogo: document.getElementById("dialogo-confirmar"),
  dialogoTexto: document.getElementById("dialogo-texto"),
  dialogoCancelar: document.getElementById("dialogo-cancelar"),
  dialogoConfirmar: document.getElementById("dialogo-confirmar-boton"),
  volver: document.getElementById("volver-bandeja"),
};

let candidatos = []; // correos que se pueden mover (en memoria)
const seleccion = new Set(); // ids elegidos
let cancelado = false;
let ultimoMovimiento = null; // {ids, bytes}: SOLO en memoria, para Deshacer

function progresoLiberar(texto) {
  l.progreso.textContent = texto ?? "";
  l.progreso.hidden = !texto;
}

/** Error de Liberar espacio; con `conPermiso` (403 de permiso insuficiente) muestra "Dar permiso". */
function errorLiberar(texto, { conPermiso = false } = {}) {
  l.errorTexto.textContent = texto ?? "";
  l.error.hidden = !texto;
  l.darPermiso.hidden = !conPermiso;
}

/** "Dar permiso" de Liberar espacio: NO repite la búsqueda ni el movimiento; la persona decide. */
async function darPermisoLiberar() {
  const sesion = await pedirPermisoGmail();
  if (!sesion.ok) {
    errorLiberar(sesion.mensaje, { conPermiso: true });
    return;
  }
  errorLiberar(null);
  progresoLiberar(PERMISO_LISTO);
}

/** Texto del último movimiento ("Se movieron 38 de 40…"); vacío lo oculta. */
function textoMovimiento(texto) {
  l.movimientoTexto.textContent = texto ?? "";
  l.movimientoTexto.hidden = !texto;
}

/**
 * Al empezar una búsqueda nueva: quita el error, los excluidos, la lista y el resultado del
 * movimiento anterior, para no mezclarlos con lo nuevo. Deshacer sigue disponible mientras
 * exista `ultimoMovimiento` (no se borra aquí).
 */
function limpiarResultadoPrevio() {
  errorLiberar(null);
  l.excluidos.hidden = true;
  l.resultado.hidden = true;
  candidatos = [];
  seleccion.clear();
  textoMovimiento(null);
  const puedeDeshacer = Boolean(ultimoMovimiento?.ids?.length);
  l.movimiento.hidden = !puedeDeshacer;
  l.deshacer.hidden = !puedeDeshacer;
  if (puedeDeshacer) l.deshacer.textContent = textoBotonDeshacer(ultimoMovimiento.ids.length);
}

function leerFormulario() {
  const marcados = new Set([...l.formulario.querySelectorAll('input[name="origen"]:checked')].map((c) => c.value));
  const cantidadElegida = l.formulario.querySelector('input[name="cantidad"]:checked')?.value;
  return {
    origenes: { publicidad: marcados.has("publicidad"), promociones: marcados.has("promociones"), spam: marcados.has("spam"), todo: marcados.has("todo") },
    antiguedadMeses: l.usarMeses.checked ? l.meses.value : null,
    tamanoMb: l.usarMb.checked ? l.mb.value : null,
    cantidad: cantidadElegida === "otro" ? l.cantidadOtra.value : cantidadElegida,
  };
}

function actualizarTotales() {
  const totales = totalesSeleccion(candidatos, seleccion);
  l.total.textContent = totales.cantidad === 0
    ? "Nada seleccionado."
    : `Seleccionados: ${totales.cantidad} correo(s) · ${formatearTamano(totales.bytes)}`;
  l.moverPapelera.disabled = totales.cantidad === 0;
  l.seleccionarTodo.checked = candidatos.length > 0 && totales.cantidad === candidatos.length;
  l.seleccionarTodo.indeterminate = totales.cantidad > 0 && totales.cantidad < candidatos.length;
  for (const grupo of l.grupos.querySelectorAll("[data-grupo]")) {
    const ids = grupo.dataset.ids.split(" ");
    const elegidos = ids.filter((id) => seleccion.has(id)).length;
    const casilla = grupo.querySelector(".casilla-grupo");
    casilla.checked = elegidos === ids.length;
    casilla.indeterminate = elegidos > 0 && elegidos < ids.length;
  }
  for (const casilla of l.grupos.querySelectorAll(".casilla-correo")) casilla.checked = seleccion.has(casilla.value);
}

function casilla(clase, etiqueta) {
  const label = document.createElement("label");
  label.className = "opcion";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = clase;
  const texto = document.createElement("span");
  texto.textContent = etiqueta;
  label.append(input, texto);
  return { label, input };
}

/** Lista agrupada por remitente (solo textContent y createElement). */
function pintarGrupos() {
  const grupos = agruparPorRemitente(candidatos);
  l.grupos.replaceChildren(...grupos.map((grupo) => {
    const li = document.createElement("li");
    li.className = "grupo";
    li.dataset.grupo = grupo.clave;
    li.dataset.ids = grupo.items.map((i) => i.id).join(" ");
    const { label, input } = casilla("casilla-grupo",
      `${grupo.nombre} — ${grupo.cantidad === 1 ? "1 correo" : `${formatearNumero(grupo.cantidad)} correos`} · ${formatearTamano(grupo.bytes)}`);
    input.addEventListener("change", () => {
      for (const item of grupo.items) {
        if (input.checked) seleccion.add(item.id);
        else seleccion.delete(item.id);
      }
      actualizarTotales();
    });
    const detalles = document.createElement("details");
    const resumen = document.createElement("summary");
    resumen.textContent = "Ver correos";
    const lista = document.createElement("ul");
    lista.className = "lista-correos";
    for (const item of grupo.items) {
      const fila = document.createElement("li");
      const c = casilla("casilla-correo",
        `${item.correo.asunto?.trim() || "(Sin asunto)"} · ${formatearHora(item.fecha)} · ${formatearTamano(item.tamano)}`);
      c.input.value = item.id;
      c.input.addEventListener("change", () => {
        if (c.input.checked) seleccion.add(item.id);
        else seleccion.delete(item.id);
        actualizarTotales();
      });
      fila.append(c.label);
      lista.append(fila);
    }
    detalles.append(resumen, lista);
    li.append(label, detalles);
    return li;
  }));
  l.resultado.hidden = false;
  actualizarTotales();
}

/** Busca, lee, CLASIFICA todos (registrar: false) y excluye. Con progreso y Cancelar. */
async function buscarParaLiberar(evento) {
  evento.preventDefault();
  limpiarResultadoPrevio();
  const validas = validarOpciones(leerFormulario());
  if (!validas.ok) {
    errorLiberar(validas.error);
    return;
  }
  const opciones = validas.opciones;
  const { urlApi } = await leerConfiguracion();
  const url = validarUrlApi(urlApi);
  if (!url.ok) {
    errorLiberar(URL_NO_VALIDA.mensaje);
    return;
  }

  cancelado = false;
  l.buscar.disabled = true;
  l.cancelar.hidden = false;
  const fueCancelado = () => cancelado;
  try {
    const cliente = clienteGmail(progresoLiberar);

    // 1. Orígenes (O). "Publicidad detectada" sale del último análisis de la Bandeja.
    const conocidos = new Map();
    if (opciones.origenes.publicidad && !opciones.origenes.todo) {
      for (const item of itemsBandeja) {
        if (item.resultado?.categoria === "publicidad" && cumpleCondiciones(item, opciones)) conocidos.set(item.id, item);
      }
    }
    const ids = [...conocidos.keys()];
    for (const busqueda of busquedasGmail(opciones)) {
      if (fueCancelado() || ids.length >= opciones.cantidad) break;
      progresoLiberar("Buscando correos…");
      for (const id of await listarIds(cliente, { ...busqueda, max: opciones.cantidad }, fueCancelado)) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    const elegidos = ids.slice(0, opciones.cantidad);

    // Lo que la Bandeja ya leyó no se vuelve a pedir a Gmail (cada lectura completa cuesta
    // 60 unidades de una cuota de 6.000 por minuto). Se copia para no tocar la Bandeja.
    for (const item of itemsBandeja) {
      if (elegidos.includes(item.id) && !conocidos.has(item.id)) conocidos.set(item.id, { ...item });
    }

    // 2. Leer los que no conocemos (format=full: hace falta el cuerpo para clasificar).
    const porLeer = elegidos.filter((id) => !conocidos.has(id));
    const leidos = await leerMensajes(cliente, porLeer, {
      cancelado: fueCancelado,
      alProgresar: (n, total) => progresoLiberar(`Leyendo correos ${n} de ${total}…`),
    });
    const items = [...elegidos.filter((id) => conocidos.has(id)).map((id) => conocidos.get(id)),
      ...leidos.map((m) => ({ ...m, resultado: null }))];

    // 3. Clasificar TODOS los que no tienen resultado, en lotes de 50, SIN registrar.
    const sinResultado = items.filter((item) => !item.resultado);
    let clasificados = 0;
    for (const lote of enLotes(sinResultado)) {
      if (fueCancelado()) break;
      progresoLiberar(`Clasificando ${clasificados} de ${sinResultado.length}…`);
      const armados = lote.map((item) => armarPeticion(item.correo, { maxBytes: MAX_BYTES_POR_CORREO_LOTE }));
      const enviables = armados.map((a, i) => ({ a, i })).filter(({ a }) => a.ok);
      if (enviables.length > 0) {
        const respuesta = await clasificarLote(url.url, enviables.map(({ a }) => a.peticion), { registrar: false });
        if (respuesta.tipo === "pedir_permisos") {
          mostrarPantalla("permisos");
          return;
        }
        if (respuesta.tipo !== "lote") {
          errorLiberar(respuesta.mensaje);
          return;
        }
        respuesta.resultados.forEach((resultado, k) => { lote[enviables[k].i].resultado = resultado; });
      }
      clasificados += lote.length;
    }
    if (fueCancelado()) {
      progresoLiberar(null);
      errorLiberar("Búsqueda cancelada. No se movió nada.");
      return;
    }

    // 4. Exclusiones (siempre) y lista agrupada por remitente.
    const filtrado = filtrarCandidatos(items);
    candidatos = filtrado.candidatos;
    seleccion.clear();
    const textoExcl = textoExclusiones(filtrado.excluidos);
    l.excluidos.textContent = textoExcl;
    l.excluidos.hidden = !textoExcl;
    if (candidatos.length === 0) {
      errorLiberar("No hay correos para mover con esas opciones.");
      return;
    }
    pintarGrupos();
  } catch (error) {
    errorLiberar(error?.message || "No se pudo buscar en Gmail.", { conPermiso: error?.codigo === "sin_permiso" });
  } finally {
    progresoLiberar(null);
    l.buscar.disabled = false;
    l.cancelar.hidden = true;
  }
}

function pedirConfirmacion() {
  const totales = totalesSeleccion(candidatos, seleccion);
  if (totales.cantidad === 0) return;
  l.dialogoTexto.textContent = textoConfirmacion(totales);
  l.dialogo.showModal();
  l.dialogoCancelar.focus();
}

/** Mueve a la PAPELERA lo seleccionado (messages.trash), sigue si alguno falla, y ofrece Deshacer. */
async function moverSeleccionAPapelera() {
  l.dialogo.close();
  const elegidos = candidatos.filter((item) => seleccion.has(item.id));
  if (elegidos.length === 0) return;
  l.moverPapelera.disabled = true;
  errorLiberar(null);
  try {
    const cliente = clienteGmail(progresoLiberar);
    const resultado = await moverAPapelera(cliente, elegidos.map((i) => i.id),
                                           (n, total) => progresoLiberar(`Moviendo ${n} de ${total} a la papelera…`));
    const movidos = elegidos.filter((i) => resultado.hechos.includes(i.id));
    const bytes = movidos.reduce((s, i) => s + (Number(i.tamano) || 0), 0);
    // Si no se movió ninguno, se conserva el Deshacer anterior.
    if (resultado.hechos.length > 0) ultimoMovimiento = { ids: resultado.hechos, bytes };
    const registrado = movidos.length === 0 || await registrarAccion("papelera", movidos.length, mbDe(bytes));
    textoMovimiento(textoResultado(resultado, "papelera") + (registrado ? "" : AVISO_SIN_REGISTRO));
    if (resultado.sinPermiso) errorLiberar(MENSAJES_GMAIL.sinPermiso, { conPermiso: true });
    l.movimiento.hidden = false;
    l.deshacer.textContent = "Deshacer";
    l.deshacer.hidden = !ultimoMovimiento?.ids?.length;
    // Los movidos salen de la lista.
    candidatos = candidatos.filter((i) => !resultado.hechos.includes(i.id));
    for (const id of resultado.hechos) seleccion.delete(id);
    if (candidatos.length) pintarGrupos();
    else l.resultado.hidden = true;
    l.deshacer.focus();
  } catch (error) {
    errorLiberar(error?.message || "No se pudo mover a la papelera.", { conPermiso: error?.codigo === "sin_permiso" });
  } finally {
    progresoLiberar(null);
    actualizarTotales();
  }
}

/** Deshacer: saca de la papelera ESOS MISMOS ids (messages.untrash). */
async function deshacerMovimiento() {
  if (!ultimoMovimiento?.ids?.length) return;
  l.deshacer.disabled = true;
  errorLiberar(null);
  try {
    const cliente = clienteGmail(progresoLiberar);
    const resultado = await sacarDePapelera(cliente, ultimoMovimiento.ids,
                                            (n, total) => progresoLiberar(`Devolviendo ${n} de ${total}…`));
    const proporcion = resultado.hechos.length / ultimoMovimiento.ids.length;
    const registrado = resultado.hechos.length === 0
      || await registrarAccion("deshacer_papelera", resultado.hechos.length, mbDe(ultimoMovimiento.bytes * proporcion));
    textoMovimiento(textoResultado(resultado, "deshacer") + (registrado ? "" : AVISO_SIN_REGISTRO));
    if (resultado.sinPermiso) errorLiberar(MENSAJES_GMAIL.sinPermiso, { conPermiso: true });
    l.movimiento.hidden = false;
    // Si alguno no se pudo devolver, se puede intentar otra vez con esos.
    ultimoMovimiento = resultado.fallidos.length
      ? { ids: resultado.fallidos, bytes: ultimoMovimiento.bytes * (1 - proporcion) }
      : null;
    l.deshacer.textContent = "Deshacer";
    l.deshacer.hidden = !ultimoMovimiento;
  } catch (error) {
    errorLiberar(error?.message || "No se pudo deshacer.", { conPermiso: error?.codigo === "sin_permiso" });
  } finally {
    progresoLiberar(null);
    l.deshacer.disabled = false;
  }
}

function iniciarLiberar() {
  l.formulario.addEventListener("submit", buscarParaLiberar);
  l.cancelar.addEventListener("click", () => { cancelado = true; progresoLiberar("Cancelando…"); });
  l.volver.addEventListener("click", () => mostrarVistaPrincipal("bandeja"));
  l.darPermiso.addEventListener("click", darPermisoLiberar);
  l.origenTodo.addEventListener("change", () => {
    l.avisoTodo.textContent = l.origenTodo.checked ? AVISO_TODO_EL_CORREO : "";
    l.avisoTodo.hidden = !l.origenTodo.checked;
  });
  l.seleccionarTodo.addEventListener("change", () => {
    for (const item of candidatos) {
      if (l.seleccionarTodo.checked) seleccion.add(item.id);
      else seleccion.delete(item.id);
    }
    actualizarTotales();
  });
  l.moverPapelera.addEventListener("click", pedirConfirmacion);
  l.dialogoCancelar.addEventListener("click", () => l.dialogo.close());
  l.dialogoConfirmar.addEventListener("click", moverSeleccionAPapelera);
  l.deshacer.addEventListener("click", deshacerMovimiento);
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
