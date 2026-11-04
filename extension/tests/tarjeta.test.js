// Pruebas de extension/lib/tarjeta.js: qué muestra la tarjeta en cada combinación de
// categoría × confianza. Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  CONSEJOS_PHISHING,
  DETALLE_PHISHING_DUDOSO,
  ICONOS,
  MAX_MOTIVOS,
  NOTA,
  TEXTO_VACIO,
  armarTarjeta,
  datosCorreoAbierto,
  extraerMotivos,
  vistaResultado,
} from "../lib/tarjeta.js";

const PANEL = join(import.meta.dirname, "..", "sidepanel");
const motivo = (etiqueta) => ({ codigo: "palabra:x", etiqueta, origen: "modelo" });

// Las 6 combinaciones: lo que debe mostrar cada una.
const CASOS = [
  {
    categoria: "phishing", confianza: "alta", prioridad: null,
    variante: "peligro", icono: "alerta.svg", titulo: "Posible phishing · riesgo alto",
    detalle: null, consejos: CONSEJOS_PHISHING, conPrioridad: false, tituloMotivos: "Motivos",
  },
  {
    categoria: "phishing", confianza: "dudosa", prioridad: null,
    variante: "precaucion", icono: "precaucion.svg", titulo: "Revisa con cuidado",
    detalle: DETALLE_PHISHING_DUDOSO, consejos: [], conPrioridad: false, tituloMotivos: "Motivos",
  },
  {
    categoria: "legitimo", confianza: "alta", prioridad: "alta",
    variante: "informativo", icono: "ok.svg", titulo: "No se detectaron señales de phishing",
    detalle: null, consejos: [], conPrioridad: true, tituloMotivos: "Señales de correo normal",
  },
  {
    categoria: "legitimo", confianza: "dudosa", prioridad: "media",
    variante: "informativo", icono: "ok.svg", titulo: "No se detectaron señales de phishing, pero revisa con cuidado",
    detalle: null, consejos: [], conPrioridad: true, tituloMotivos: "Señales de correo normal",
  },
  {
    categoria: "publicidad", confianza: "alta", prioridad: "baja",
    variante: "neutro", icono: "sobre.svg", titulo: "Correo masivo o publicidad",
    detalle: null, consejos: [], conPrioridad: true, tituloMotivos: "Motivos",
  },
  {
    categoria: "publicidad", confianza: "dudosa", prioridad: "baja",
    variante: "neutro", icono: "sobre.svg", titulo: "Correo masivo o publicidad, pero revisa con cuidado",
    detalle: null, consejos: [], conPrioridad: true, tituloMotivos: "Motivos",
  },
];

describe("armarTarjeta: cada combinación de categoría × confianza", () => {
  for (const caso of CASOS) {
    test(`${caso.categoria} + ${caso.confianza}`, () => {
      const t = armarTarjeta({ categoria: caso.categoria, confianza: caso.confianza, prioridad: caso.prioridad, motivos: [] });
      assert.equal(t.variante, caso.variante);
      assert.equal(t.icono, `../iconos/${caso.icono}`);
      assert.equal(t.titulo, caso.titulo);
      assert.equal(t.detalle, caso.detalle);
      assert.deepEqual(t.consejos, [...caso.consejos]);
      assert.equal(t.prioridad !== null, caso.conPrioridad);
      assert.equal(t.tituloMotivos, caso.tituloMotivos);
      assert.equal(t.nota, NOTA);
    });
  }

  test("phishing + alta trae los 3 consejos pedidos", () => {
    assert.deepEqual(armarTarjeta({ categoria: "phishing", confianza: "alta", prioridad: null }).consejos, [
      "No hagas clic en los enlaces.",
      "No envíes datos ni contraseñas.",
      "Verifica con el remitente por otro medio.",
    ]);
  });

  test("los consejos de la tarjeta son una copia: cambiarlos no altera los originales", () => {
    armarTarjeta({ categoria: "phishing", confianza: "alta", prioridad: null }).consejos.push("x");
    assert.equal(CONSEJOS_PHISHING.length, 3);
  });

  test("ningún texto dice que el correo es seguro", () => {
    for (const caso of CASOS) {
      const t = armarTarjeta({ ...caso, motivos: [] });
      const textos = [t.titulo, t.detalle ?? "", ...t.consejos, t.nota].join(" ").toLowerCase();
      // Solo se admite la frase negativa "no es un resultado seguro".
      assert.doesNotMatch(textos.replaceAll("no es un resultado seguro", ""), /segur[oa]/, `${caso.categoria} + ${caso.confianza}`);
    }
  });
});

describe("prioridad como etiqueta", () => {
  test("alta, media y baja", () => {
    for (const [valor, texto] of [["alta", "Prioridad alta"], ["media", "Prioridad media"], ["baja", "Prioridad baja"]]) {
      assert.deepEqual(armarTarjeta({ categoria: "legitimo", confianza: "alta", prioridad: valor }).prioridad, { valor, texto });
    }
  });

  test("no se muestra en phishing, aunque llegue un valor", () => {
    assert.equal(armarTarjeta({ categoria: "phishing", confianza: "alta", prioridad: "alta" }).prioridad, null);
  });

  test("null o un valor desconocido → sin etiqueta", () => {
    assert.equal(armarTarjeta({ categoria: "legitimo", confianza: "alta", prioridad: null }).prioridad, null);
    assert.equal(armarTarjeta({ categoria: "legitimo", confianza: "alta", prioridad: "urgente" }).prioridad, null);
  });
});

describe("motivos", () => {
  test("sin motivos → lista vacía (la sección no se muestra)", () => {
    assert.deepEqual(extraerMotivos([]), []);
    assert.deepEqual(extraerMotivos(undefined), []);
    assert.deepEqual(armarTarjeta({ categoria: "legitimo", confianza: "alta", prioridad: "baja" }).motivos, []);
  });

  test("como máximo 3, en el orden de la API", () => {
    const lista = ["uno", "dos", "tres", "cuatro", "cinco"].map(motivo);
    assert.equal(MAX_MOTIVOS, 3);
    assert.deepEqual(extraerMotivos(lista), ["uno", "dos", "tres"]);
  });

  test("ignora motivos sin etiqueta de texto y no cuenta los ignorados", () => {
    const lista = [null, { codigo: "x" }, motivo(""), motivo(42), motivo("  válido  "), motivo("otro")];
    assert.deepEqual(extraerMotivos(lista), ["válido", "otro"]);
  });

  test("si una palabra está dentro de una frase ya mostrada, queda solo la frase", () => {
    const lista = ["Menciona «estimado»", "Menciona «estimado cliente»", "Menciona «paquete»"].map(motivo);
    assert.deepEqual(extraerMotivos(lista), ["Menciona «estimado cliente»", "Menciona «paquete»"]);
    // Da igual el orden: la palabra suelta sale aunque venga después de la frase.
    const alReves = ["Menciona «darse baja»", "Menciona «baja»"].map(motivo);
    assert.deepEqual(extraerMotivos(alReves), ["Menciona «darse baja»"]);
  });

  test("solo cuenta palabras completas: «pago» no se quita por «pagos pendientes»", () => {
    const lista = ["Menciona «pago»", "Menciona «pagos pendientes»"].map(motivo);
    assert.deepEqual(extraerMotivos(lista), ["Menciona «pago»", "Menciona «pagos pendientes»"]);
  });

  test("quita los duplicados exactos y los motivos sin «…» se comparan enteros", () => {
    const lista = ["Trae muchos enlaces", "trae muchos enlaces", "Dirigido solo a ti", "Menciona «ti»"].map(motivo);
    assert.deepEqual(extraerMotivos(lista), ["Trae muchos enlaces", "Dirigido solo a ti", "Menciona «ti»"]);
  });

  test("los repetidos se quitan ANTES del límite de 3: se muestran 3 distintos", () => {
    const lista = ["Menciona «tasa»", "Menciona «tasa envío»", "Menciona «tasa»", "Menciona «paquete»", "Menciona «urgente»"].map(motivo);
    assert.deepEqual(extraerMotivos(lista), ["Menciona «tasa envío»", "Menciona «paquete»", "Menciona «urgente»"]);
  });

  test("el HTML queda como texto (el panel usa textContent) y se recorta lo enorme", () => {
    assert.deepEqual(extraerMotivos([motivo("<b>Hola</b> «Juan»")]), ["<b>Hola</b> «Juan»"]);
    assert.equal(extraerMotivos([motivo("x".repeat(1000))])[0].length, 200);
  });
});

describe("estado vacío", () => {
  test("el texto es el pedido", () => {
    assert.equal(TEXTO_VACIO, "Abre un correo en Gmail y pulsa Analizar este correo.");
  });

  test("sin resultado se ve el estado vacío; con resultado, solo el resultado", () => {
    assert.deepEqual(vistaResultado(false), { vacio: true, resultado: false });
    assert.deepEqual(vistaResultado(true), { vacio: false, resultado: true });
  });

  test("nunca se ven los dos a la vez ni ninguno, aunque llegue un valor raro", () => {
    for (const valor of [true, false, undefined, null, 1, "si"]) {
      const vista = vistaResultado(valor);
      assert.notEqual(vista.vacio, vista.resultado, String(valor));
    }
    assert.equal(vistaResultado("si").vacio, true, "solo true cuenta como resultado");
  });
});

describe("datosCorreoAbierto", () => {
  test("asunto y remitente leídos, sin espacios de sobra", () => {
    assert.deepEqual(datosCorreoAbierto({ asunto: "  Su paquete está detenido ", remitente: " avisos@example.net " }),
                     { asunto: "Su paquete está detenido", remitente: "avisos@example.net" });
  });

  test("sin asunto muestra (Sin asunto)", () => {
    for (const asunto of ["", "   ", undefined, null, 42]) {
      assert.equal(datosCorreoAbierto({ asunto, remitente: "a@example.net" }).asunto, "(Sin asunto)", String(asunto));
    }
  });

  test("recorta textos enormes y tolera valores raros", () => {
    const r = datosCorreoAbierto({ asunto: "a".repeat(5000), remitente: "b".repeat(5000) });
    assert.equal(r.asunto.length, 300);
    assert.equal(r.remitente.length, 320);
    assert.deepEqual(datosCorreoAbierto(null), { asunto: "(Sin asunto)", remitente: "" });
  });

  test("el HTML queda como texto (el panel usa textContent)", () => {
    assert.equal(datosCorreoAbierto({ asunto: "<img src=x>", remitente: "a@example.net" }).asunto, "<img src=x>");
  });
});

describe("íconos", () => {
  test("los 4 SVG existen y salen de la tabla fija", () => {
    assert.deepEqual(Object.keys(ICONOS).sort(), ["informativo", "neutro", "peligro", "precaucion"]);
    for (const ruta of Object.values(ICONOS)) {
      assert.ok(statSync(join(PANEL, ruta)).isFile(), ruta);
    }
  });
});
