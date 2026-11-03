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

export const ICONOS = Object.freeze({
  peligro: "../iconos/alerta.svg",
  precaucion: "../iconos/precaucion.svg",
  informativo: "../iconos/ok.svg",
  neutro: "../iconos/sobre.svg",
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

/** Etiquetas de los motivos (máximo 3, en el orden de la API). Ignora lo que no sea texto. */
export function extraerMotivos(lista) {
  if (!Array.isArray(lista)) return [];
  const motivos = [];
  for (const motivo of lista) {
    const etiqueta = typeof motivo?.etiqueta === "string" ? motivo.etiqueta.trim() : "";
    if (etiqueta) motivos.push(etiqueta.slice(0, LARGO_MAX_MOTIVO));
    if (motivos.length === MAX_MOTIVOS) break;
  }
  return motivos;
}

function estilo(categoria, dudosa) {
  if (categoria === "phishing") {
    return dudosa
      ? { variante: "precaucion", titulo: "Revisa con cuidado", detalle: DETALLE_PHISHING_DUDOSO, consejos: [] }
      : { variante: "peligro", titulo: "Posible phishing", detalle: null, consejos: [...CONSEJOS_PHISHING] };
  }
  if (categoria === "publicidad") {
    return { variante: "neutro", titulo: `Correo masivo o publicidad${dudosa ? REVISA : ""}`, detalle: null, consejos: [] };
  }
  return { variante: "informativo", titulo: `No se detectaron señales de phishing${dudosa ? REVISA : ""}`, detalle: null, consejos: [] };
}

/**
 * Resultado validado de /analizar → lo que muestra la tarjeta:
 * {variante, icono, titulo, detalle, consejos, prioridad: {valor, texto} | null, motivos, nota}.
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
    nota: NOTA,
  };
}
