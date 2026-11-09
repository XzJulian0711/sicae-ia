// Lógica pura de la tarjeta de resultado (sin DOM ni Chrome: se prueba con node --test).
//
// armarTarjeta() decide, a partir de la respuesta ya validada de /analizar:
// - el estilo (variante) y el ícono;
// - el título, el detalle y los consejos;
// - si se muestra la prioridad y qué motivos se listan.
//
// Reglas:
// - Nunca se dice que un correo "es seguro": el modelo puede equivocarse.
// - Los motivos se tratan como TEXTO no confiable (pueden traer palabras del correo): el panel
//   los muestra solo con textContent.
// - Los íconos salen de esta tabla fija, nunca de la respuesta de la API.

export const MAX_MOTIVOS = 3;
const LARGO_MAX_MOTIVO = 200;

export const NOTA = "Resultado automático: puede equivocarse.";
const REVISA = ", pero revisa con cuidado";

// Nombre del ícono de cada variante: panel.js lo pone en data-icono y el CSS dibuja
// iconos/<nombre>.svg como máscara con el color del tema (paso 7.1, tema oscuro).
export const ICONOS = Object.freeze({
  peligro: "alerta",
  precaucion: "precaucion",
  informativo: "ok",
  neutro: "sobre",
});

export const CONSEJOS_PHISHING = Object.freeze([
  "No hagas clic en los enlaces.",
  "No envíes datos ni contraseñas.",
  "Verifica con el remitente por otro medio.",
]);

export const DETALLE_PHISHING_DUDOSO =
  "Tiene algunas señales de phishing, pero no es un resultado seguro. "
  + "Antes de abrir enlaces o responder, confirma con el remitente por otro medio.";

const PRIORIDADES = { alta: "Prioridad alta", media: "Prioridad media", baja: "Prioridad baja" };

/** Término entre «…» de un motivo ("Menciona «estimado cliente»" → "estimado cliente"), o null. */
function termino(etiqueta) {
  const m = /«([^»]+)»/.exec(etiqueta);
  return m ? m[1].trim().toLowerCase().replace(/\s+/g, " ") : null;
}

/**
 * Etiquetas de los motivos (máximo 3, en el orden de la API), sin repetidos:
 * - se quitan los duplicados exactos;
 * - si el término de un motivo está dentro del de otro (el modelo usa palabras y pares:
 *   «estimado» y «estimado cliente»), queda solo la frase.
 * Los repetidos se quitan ANTES de quedarse con 3, para que los 3 sean distintos.
 * Ignora lo que no sea texto.
 */
export function extraerMotivos(lista) {
  if (!Array.isArray(lista)) return [];
  const vistas = new Set();
  const candidatos = [];
  for (const motivo of lista) {
    const etiqueta = typeof motivo?.etiqueta === "string" ? motivo.etiqueta.trim().slice(0, LARGO_MAX_MOTIVO) : "";
    if (!etiqueta || vistas.has(etiqueta.toLowerCase())) continue;
    vistas.add(etiqueta.toLowerCase());
    candidatos.push({ etiqueta, termino: termino(etiqueta) });
  }
  const contenidoEnOtro = ({ termino: t }) => t !== null && candidatos.some(
    (otro) => otro.termino !== null && otro.termino !== t && ` ${otro.termino} `.includes(` ${t} `),
  );
  return candidatos.filter((c) => !contenidoEnOtro(c)).slice(0, MAX_MOTIVOS).map((c) => c.etiqueta);
}

// ----- Estado vacío (antes de analizar) -----

export const TEXTO_VACIO = "Abre un correo en Gmail y pulsa Analizar este correo.";

/**
 * Qué se ve en el espacio del resultado: el estado vacío o el resultado, nunca los dos a la
 * vez ni ninguno. hayResultado = ya se leyó un correo (y se muestra su tarjeta).
 */
export function vistaResultado(hayResultado) {
  const hay = hayResultado === true;
  return { vacio: !hay, resultado: hay };
}

const LARGO_MAX_ASUNTO = 300;
const LARGO_MAX_REMITENTE = 320;

/** Lo que muestra la tarjeta "CORREO ABIERTO": asunto (o "(Sin asunto)") y remitente. */
export function datosCorreoAbierto(correo) {
  const asunto = typeof correo?.asunto === "string" ? correo.asunto.trim() : "";
  const remitente = typeof correo?.remitente === "string" ? correo.remitente.trim() : "";
  return {
    asunto: asunto ? asunto.slice(0, LARGO_MAX_ASUNTO) : "(Sin asunto)",
    remitente: remitente.slice(0, LARGO_MAX_REMITENTE),
  };
}

function estilo(categoria, dudosa) {
  if (categoria === "phishing") {
    return dudosa
      ? { variante: "precaucion", titulo: "Revisa con cuidado", detalle: DETALLE_PHISHING_DUDOSO, consejos: [] }
      : { variante: "peligro", titulo: "Posible phishing · riesgo alto", detalle: null, consejos: [...CONSEJOS_PHISHING] };
  }
  if (categoria === "publicidad") {
    return { variante: "neutro", titulo: `Correo masivo o publicidad${dudosa ? REVISA : ""}`, detalle: null, consejos: [] };
  }
  return { variante: "informativo", titulo: `No se detectaron señales de phishing${dudosa ? REVISA : ""}`, detalle: null, consejos: [] };
}

/**
 * Resultado validado de /analizar → lo que muestra la tarjeta:
 * {variante, icono, titulo, detalle, consejos, prioridad: {valor, texto} | null, motivos,
 *  tituloMotivos, nota}.
 * La prioridad no se muestra si es phishing (va como alerta).
 */
export function armarTarjeta({ categoria, confianza, prioridad, motivos }) {
  const base = estilo(categoria, confianza === "dudosa");
  const conPrioridad = categoria !== "phishing" && Object.hasOwn(PRIORIDADES, prioridad);
  return {
    ...base,
    icono: ICONOS[base.variante],
    prioridad: conPrioridad ? { valor: prioridad, texto: PRIORIDADES[prioridad] } : null,
    motivos: extraerMotivos(motivos),
    // En un legítimo los motivos son señales de correo normal, no "motivos" de alerta.
    tituloMotivos: categoria === "legitimo" ? "Señales de correo normal" : "Motivos",
    nota: NOTA,
  };
}
