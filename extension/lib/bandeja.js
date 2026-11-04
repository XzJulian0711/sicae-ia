// Lógica pura de la pestaña Bandeja ("Tu bandeja hoy", paso 4.4). Sin DOM ni Chrome: se prueba
// con node --test. Arma lo que se muestra a partir de los correos leídos (lib/gmail.js) y de
// los resultados de POST /analizar/lote. Nada de esto se guarda.

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MAX_PRIORIDAD_ALTA = 10;

/** 1240 → "1.240" (separador de miles en español). */
export function formatearNumero(n) {
  return String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Bytes → "35 KB", "860 MB", "1,2 GB" (base 1024, coma decimal). */
export function formatearTamano(bytes) {
  const b = Math.max(0, Number(bytes) || 0);
  const unidades = [["GB", 1024 ** 3], ["MB", 1024 ** 2], ["KB", 1024]];
  for (const [unidad, tamano] of unidades) {
    if (b >= tamano) {
      const valor = b / tamano;
      const texto = valor < 10 ? (Math.round(valor * 10) / 10).toString().replace(".", ",") : formatearNumero(valor);
      return `${texto} ${unidad}`;
    }
  }
  return `${Math.round(b)} B`;
}

/** Hora corta como en el demo: "8:14" si es de hoy, "ayer", o "5 nov". */
export function formatearHora(fechaMs, ahora = new Date()) {
  const fecha = new Date(Number(fechaMs));
  if (Number.isNaN(fecha.getTime())) return "";
  const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (mismoDia(fecha, ahora)) return `${fecha.getHours()}:${String(fecha.getMinutes()).padStart(2, "0")}`;
  const ayer = new Date(ahora);
  ayer.setDate(ayer.getDate() - 1);
  if (mismoDia(fecha, ayer)) return "ayer";
  return `${fecha.getDate()} ${MESES[fecha.getMonth()]}`;
}

/** "1 correo con posible phishing." / "3 correos con posible phishing." */
export function textoAvisoPhishing(cantidad) {
  return cantidad === 1 ? "1 correo con posible phishing." : `${formatearNumero(cantidad)} correos con posible phishing.`;
}

/**
 * items: [{id, fecha, tamano, etiquetas, remitenteNombre, correo: {asunto, remitente}, resultado}]
 * (resultado = lo que devolvió la API para ese correo, o null si no se pudo analizar).
 * → {conteos: {alta, media, baja}, phishing: [...], prioridadAlta: [...10], publicidad: [...],
 *    sinClasificar}.
 */
export function resumirBandeja(items) {
  const conteos = { alta: 0, media: 0, baja: 0 };
  const phishing = [];
  const alta = [];
  const publicidad = [];
  let sinClasificar = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const r = item?.resultado;
    if (!r || typeof r !== "object" || !r.categoria) {
      sinClasificar += 1;
      continue;
    }
    if (r.categoria === "phishing") phishing.push(item);
    if (r.categoria === "publicidad") publicidad.push(item);
    if (Object.hasOwn(conteos, r.prioridad) && r.categoria !== "phishing") conteos[r.prioridad] += 1;
    if (r.prioridad === "alta" && r.categoria !== "phishing") alta.push(item);
  }
  const masNuevoPrimero = (a, b) => (b.fecha || 0) - (a.fecha || 0);
  return {
    conteos,
    phishing: phishing.sort(masNuevoPrimero),
    prioridadAlta: alta.sort(masNuevoPrimero).slice(0, MAX_PRIORIDAD_ALTA),
    publicidad,
    sinClasificar,
  };
}

/**
 * "Sobrecarga de publicidad": Promociones (total exacto de Gmail + tamaño de hasta 100) más los
 * detectados como publicidad entre los analizados que NO estén ya en Promociones.
 * promociones = {total, tamanos, ids} o null (no se pudo leer).
 * → {cantidad, bytes, alMenos, texto}.
 */
export function resumenPublicidad(promociones, detectados) {
  const promo = promociones ?? { total: 0, tamanos: [], ids: [] };
  const enPromo = new Set(promo.ids);
  // Un detectado que ya está en Promociones ya va en promo.total: no se cuenta dos veces. Pero si
  // no se pudo leer Promociones (null), ese total no existe y el detectado sí se cuenta.
  const yaContado = (item) => promociones !== null
    && (enPromo.has(item.id) || (item.etiquetas || []).includes("CATEGORY_PROMOTIONS"));
  const extra = (Array.isArray(detectados) ? detectados : []).filter((item) => !yaContado(item));
  const cantidad = (Number(promo.total) || 0) + extra.length;
  const bytes = promo.tamanos.reduce((suma, t) => suma + (Number(t) || 0), 0)
    + extra.reduce((suma, item) => suma + (Number(item.tamano) || 0), 0);
  // El tamaño es "al menos" si en Promociones hay más de los que se midieron, o si no se pudo leer.
  const alMenos = promociones === null || (Number(promo.total) || 0) > promo.tamanos.length;
  let texto;
  if (cantidad === 0) {
    texto = "No se encontraron correos de publicidad.";
  } else {
    const correos = cantidad === 1 ? "1 correo de publicidad ocupa" : `${formatearNumero(cantidad)} correos de publicidad ocupan`;
    texto = `${correos} ${alMenos ? "al menos " : ""}${formatearTamano(bytes)}. Revisa la lista antes de moverlos a la papelera.`;
  }
  return { cantidad, bytes, alMenos, texto };
}

// ----- La pestaña de Gmail de otra cuenta (resuelve la limitación del paso 4.2) -----

/** Gmail pone la cuenta en el título: "Recibidos (3) - ana@gmail.com - Gmail" → "ana@gmail.com". */
export function cuentaDeTitulo(titulo) {
  if (typeof titulo !== "string") return null;
  const m = /([^\s<>()"',;]+@[^\s<>()"',;]+\.[a-z]{2,})/i.exec(titulo);
  return m ? m[1].toLowerCase() : null;
}

/** ¿La pestaña es de la misma cuenta que la sesión? Si no se puede saber, se asume que sí. */
export function mismaCuenta(titulo, correoSesion) {
  const cuenta = cuentaDeTitulo(titulo);
  if (!cuenta || typeof correoSesion !== "string" || !correoSesion) return true;
  return cuenta === correoSesion.trim().toLowerCase();
}

export const MENSAJE_OTRA_CUENTA =
  "Esta pestaña de Gmail es de otra cuenta. Cambia a la cuenta de la sesión o usa otro perfil de Chrome.";
