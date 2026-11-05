// Lógica pura de "Liberar espacio" (paso 4.5). Sin DOM ni Chrome: se prueba con node --test.
//
// Cómo se eligen los correos:
// - ORÍGENES (se suman, O): publicidad detectada, Promociones, Spam y "Todo el correo" (este no
//   viene marcado y muestra un aviso). Hay que marcar al menos uno para buscar.
// - CONDICIONES (filtran, Y): más antiguos que N meses, más grandes que N MB.
// - EXCLUSIONES, siempre: destacados, importantes, prioridad alta, phishing y los que no se
//   pudieron clasificar (por seguridad).
// Los correos solo se MUEVEN A LA PAPELERA (se puede deshacer). Nunca se borran del todo.

import { formatearNumero, formatearTamano } from "./bandeja.js";

export const OPCIONES_CANTIDAD = Object.freeze([10, 25, 50, 100]);
export const MAX_CANTIDAD = 500;
export const MESES = Object.freeze({ min: 1, max: 120 });
export const MEGAS = Object.freeze({ min: 1, max: 50 });
export const TAMANO_LOTE = 50; // como /analizar/lote
const MB = 1024 * 1024;

export const AVISO_TODO_EL_CORREO = "Incluye correos personales y de trabajo: revisa la lista con cuidado.";

const ORIGENES = ["publicidad", "promociones", "spam", "todo"];

/** Opciones por defecto: nada marcado ("Todo el correo" tampoco), 25 correos. */
export function opcionesIniciales() {
  return { origenes: { publicidad: false, promociones: false, spam: false, todo: false }, antiguedadMeses: null, tamanoMb: null, cantidad: 25 };
}

function enteroEnRango(valor, { min, max }) {
  const n = Number(valor);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Revisa y normaliza las opciones. → {ok: true, opciones} o {ok: false, error}. */
export function validarOpciones(opciones) {
  const origenes = Object.fromEntries(ORIGENES.map((o) => [o, opciones?.origenes?.[o] === true]));
  if (!ORIGENES.some((o) => origenes[o])) {
    return { ok: false, error: "Marca al menos un origen para buscar." };
  }
  const cantidad = enteroEnRango(opciones?.cantidad, { min: 1, max: MAX_CANTIDAD });
  if (cantidad === null) return { ok: false, error: `La cantidad debe ser un número entero entre 1 y ${MAX_CANTIDAD}.` };
  let antiguedadMeses = null;
  if (opciones?.antiguedadMeses !== null && opciones?.antiguedadMeses !== undefined && opciones?.antiguedadMeses !== "") {
    antiguedadMeses = enteroEnRango(opciones.antiguedadMeses, MESES);
    if (antiguedadMeses === null) return { ok: false, error: `Los meses deben ser un número entero entre ${MESES.min} y ${MESES.max}.` };
  }
  let tamanoMb = null;
  if (opciones?.tamanoMb !== null && opciones?.tamanoMb !== undefined && opciones?.tamanoMb !== "") {
    tamanoMb = enteroEnRango(opciones.tamanoMb, MEGAS);
    if (tamanoMb === null) return { ok: false, error: `Los MB deben ser un número entero entre ${MEGAS.min} y ${MEGAS.max}.` };
  }
  return { ok: true, opciones: { origenes, antiguedadMeses, tamanoMb, cantidad } };
}

/** Condiciones (Y) como búsqueda de Gmail: "older_than:6m larger:5M". */
export function consultaGmail({ antiguedadMeses, tamanoMb }) {
  const partes = [];
  if (Number.isInteger(antiguedadMeses)) partes.push(`older_than:${antiguedadMeses}m`);
  if (Number.isInteger(tamanoMb)) partes.push(`larger:${tamanoMb}M`);
  return partes.join(" ");
}

/**
 * Búsquedas que hay que pedirle a Gmail (los orígenes que viven en Gmail; "publicidad detectada"
 * sale del último análisis de la Bandeja). Cada una lleva las condiciones en q.
 * "Todo el correo" no lleva etiqueta (Gmail ya deja fuera Spam y Papelera).
 */
export function busquedasGmail(opciones) {
  const q = consultaGmail(opciones);
  const busquedas = [];
  if (opciones.origenes.todo) return [{ origen: "todo", labelIds: [], q, includeSpamTrash: false }];
  if (opciones.origenes.promociones) busquedas.push({ origen: "promociones", labelIds: ["CATEGORY_PROMOTIONS"], q, includeSpamTrash: false });
  if (opciones.origenes.spam) busquedas.push({ origen: "spam", labelIds: ["SPAM"], q, includeSpamTrash: true });
  return busquedas;
}

/** ¿Un correo ya leído cumple las condiciones? (para "publicidad detectada", que no pasa por q). */
export function cumpleCondiciones(item, { antiguedadMeses, tamanoMb }, ahora = new Date()) {
  if (Number.isInteger(antiguedadMeses)) {
    const limite = new Date(ahora);
    limite.setMonth(limite.getMonth() - antiguedadMeses);
    if (!(Number(item?.fecha) < limite.getTime())) return false;
  }
  if (Number.isInteger(tamanoMb) && !(Number(item?.tamano) > tamanoMb * MB)) return false;
  return true;
}

/**
 * Por qué un correo NO se puede ofrecer para la papelera (o null si se puede).
 * item = {etiquetas, resultado} (resultado = clasificación validada, o null).
 */
export function motivoExclusion(item) {
  const etiquetas = Array.isArray(item?.etiquetas) ? item.etiquetas : [];
  if (etiquetas.includes("STARRED")) return "destacado";
  if (etiquetas.includes("IMPORTANT")) return "importante";
  const r = item?.resultado;
  if (!r || typeof r !== "object" || !r.categoria) return "sin_clasificar"; // sin saber si es phishing: no
  if (r.categoria === "phishing") return "phishing";
  if (r.prioridad === "alta") return "prioridad_alta";
  return null;
}

/** Separa los que se pueden ofrecer y cuenta los excluidos por motivo. */
export function filtrarCandidatos(items) {
  const excluidos = { destacado: 0, importante: 0, prioridad_alta: 0, phishing: 0, sin_clasificar: 0 };
  const candidatos = [];
  for (const item of Array.isArray(items) ? items : []) {
    const motivo = motivoExclusion(item);
    if (motivo) excluidos[motivo] += 1;
    else candidatos.push(item);
  }
  return { candidatos, excluidos };
}

/** "Se excluyeron 7: 3 destacados, 2 importantes, 1 de prioridad alta y 1 de posible phishing." */
export function textoExclusiones(excluidos) {
  const partes = [];
  const agregar = (n, uno, varios) => { if (n > 0) partes.push(`${formatearNumero(n)} ${n === 1 ? uno : varios}`); };
  agregar(excluidos.destacado, "destacado", "destacados");
  agregar(excluidos.importante, "importante", "importantes");
  agregar(excluidos.prioridad_alta, "de prioridad alta", "de prioridad alta");
  agregar(excluidos.phishing, "de posible phishing", "de posible phishing");
  agregar(excluidos.sin_clasificar, "sin clasificar", "sin clasificar");
  if (partes.length === 0) return "";
  const total = Object.values(excluidos).reduce((a, b) => a + b, 0);
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} y ${partes.at(-1)}`;
  return `Se excluyeron ${formatearNumero(total)}: ${lista}.`;
}

/**
 * Agrupa por remitente: [{clave, nombre, remitente, cantidad, bytes, items}], del que más pesa
 * al que menos (y, si empatan, el que tiene más correos).
 */
export function agruparPorRemitente(items) {
  const grupos = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const remitente = String(item?.correo?.remitente || "").trim();
    const clave = remitente.toLowerCase() || "(sin remitente)";
    if (!grupos.has(clave)) {
      grupos.set(clave, { clave, nombre: item?.remitenteNombre || remitente || "(Sin remitente)", remitente, cantidad: 0, bytes: 0, items: [] });
    }
    const grupo = grupos.get(clave);
    grupo.cantidad += 1;
    grupo.bytes += Number(item?.tamano) || 0;
    grupo.items.push(item);
  }
  return [...grupos.values()].sort((a, b) => b.bytes - a.bytes || b.cantidad - a.cantidad || a.clave.localeCompare(b.clave));
}

/** Totales de los seleccionados (ids en un Set). → {cantidad, bytes, mb}. */
export function totalesSeleccion(items, seleccionados) {
  const elegidos = (Array.isArray(items) ? items : []).filter((item) => seleccionados.has(item.id));
  const bytes = elegidos.reduce((suma, item) => suma + (Number(item.tamano) || 0), 0);
  return { cantidad: elegidos.length, bytes, mb: mbDe(bytes) };
}

/** MB con 2 decimales (para el registro de acciones). */
export function mbDe(bytes) {
  return Math.round(((Number(bytes) || 0) / MB) * 100) / 100;
}

/** Texto del diálogo de confirmación. */
export function textoConfirmacion({ cantidad, bytes }) {
  const correos = cantidad === 1 ? "1 correo" : `${formatearNumero(cantidad)} correos`;
  return `Vas a mover ${correos} (${formatearTamano(bytes)}) a la papelera. Se puede deshacer. `
    + "La papelera sigue ocupando espacio hasta que Gmail la vacía sola a los 30 días.";
}

/**
 * Texto después de mover o deshacer: "Se movieron 38 de 40 a la papelera. 2 no se pudieron mover…".
 * Con `sinPermiso` (403 de permiso insuficiente) no dice "más tarde": falta el permiso.
 */
export function textoResultado({ hechos, fallidos, sinPermiso = false }, accion = "papelera") {
  const total = hechos.length + fallidos.length;
  const base = accion === "papelera"
    ? `Se movieron ${formatearNumero(hechos.length)} de ${formatearNumero(total)} a la papelera.`
    : `Se devolvieron ${formatearNumero(hechos.length)} de ${formatearNumero(total)} desde la papelera.`;
  if (fallidos.length === 0) return base;
  const verbo = accion === "papelera" ? "mover" : "devolver";
  const porque = sinPermiso ? "falta el permiso de Gmail" : "inténtalo de nuevo más tarde";
  return `${base} ${formatearNumero(fallidos.length)} no se pudieron ${verbo}: ${porque}.`;
}

/**
 * Texto del botón Deshacer cuando se empieza una búsqueda nueva y todavía se puede deshacer el
 * movimiento anterior: "Deshacer el último movimiento (40 correos)".
 */
export function textoBotonDeshacer(cantidad) {
  const n = Number(cantidad) || 0;
  return `Deshacer el último movimiento (${n === 1 ? "1 correo" : `${formatearNumero(n)} correos`})`;
}

/** Parte una lista en lotes de `tamano` (para /analizar/lote). */
export function enLotes(lista, tamano = TAMANO_LOTE) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}
