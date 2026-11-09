// Pruebas del tema claro/oscuro: lib/tema.js y los colores de estilos/sicae.css.
// El contraste se CALCULA con las variables de cada tema (fórmula de WCAG 2.x), así un cambio de
// color que baje del AA hace fallar la prueba. Correr desde la raíz:
//   node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import { TEMAS, aplicarTema, conectarTema, esTema, etiquetaCambio, otroTema, temaInicial } from "../lib/tema.js";

const RAIZ = join(import.meta.dirname, "..");
const leer = (ruta) => readFileSync(join(RAIZ, ruta), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("lib/tema.js", () => {
  test("temas válidos", () => {
    assert.deepEqual([...TEMAS], ["claro", "oscuro"]);
    assert.ok(Object.isFrozen(TEMAS));
    assert.equal(esTema("oscuro"), true);
    for (const raro of ["OSCURO", "", null, undefined, 1, "auto"]) assert.equal(esTema(raro), false, String(raro));
  });

  test("temaInicial: lo guardado manda; si no, el del sistema", () => {
    assert.equal(temaInicial("claro", true), "claro");
    assert.equal(temaInicial("oscuro", false), "oscuro");
    assert.equal(temaInicial(null, true), "oscuro");
    assert.equal(temaInicial(null, false), "claro");
    assert.equal(temaInicial("raro", true), "oscuro", "un valor raro guardado no cuenta");
  });

  test("otroTema y la etiqueta del botón (dice a qué tema pasa)", () => {
    assert.equal(otroTema("claro"), "oscuro");
    assert.equal(otroTema("oscuro"), "claro");
    assert.equal(etiquetaCambio("claro"), "Cambiar a tema oscuro");
    assert.equal(etiquetaCambio("oscuro"), "Cambiar a tema claro");
  });

  test("aplicarTema pone data-tema; un valor raro queda en claro", () => {
    const raiz = { dataset: {} };
    assert.equal(aplicarTema(raiz, "oscuro"), "oscuro");
    assert.equal(raiz.dataset.tema, "oscuro");
    assert.equal(aplicarTema(raiz, "<script>"), "claro");
    assert.equal(raiz.dataset.tema, "claro");
  });
});

/** Dobles de <html>, matchMedia y almacen.js para conectarTema. */
function entorno({ sistemaOscuro = false, guardado = null, falla = false } = {}) {
  const avisos = { cambio: null, sistema: null };
  const e = {
    raiz: { dataset: {} },
    consulta: { matches: sistemaOscuro, addEventListener: (tipo, fn) => { if (tipo === "change") avisos.sistema = fn; } },
    guardados: [],
    pintados: [],
    leer: async () => { if (falla) throw new Error("sin storage"); return guardado; },
    guardar: async (tema) => { if (falla) throw new Error("sin storage"); e.guardados.push(tema); },
    alCambiar: (fn) => { avisos.cambio = fn; },
    avisos,
  };
  e.alPintar = (tema) => e.pintados.push(tema);
  return e;
}

const conectar = (e) => conectarTema(e);

describe("conectarTema", () => {
  test("sin elección: el tema del sistema enseguida, y sigue sus cambios", async () => {
    const e = entorno({ sistemaOscuro: true });
    const tema = conectar(e);
    assert.equal(e.raiz.dataset.tema, "oscuro", "antes de leer storage");
    await tema.listo;
    e.consulta.matches = false;
    e.avisos.sistema();
    assert.equal(e.raiz.dataset.tema, "claro");
    assert.deepEqual(e.guardados, [], "seguir al sistema no guarda nada");
  });

  test("con una elección guardada, manda sobre el sistema", async () => {
    const e = entorno({ sistemaOscuro: false, guardado: "oscuro" });
    const tema = conectar(e);
    await tema.listo;
    assert.equal(e.raiz.dataset.tema, "oscuro");
    e.consulta.matches = true;
    e.avisos.sistema();
    e.consulta.matches = false;
    e.avisos.sistema();
    assert.equal(e.raiz.dataset.tema, "oscuro", "el sistema ya no lo cambia");
  });

  test("alternar: cambia, guarda la palabra y avisa para el botón", async () => {
    const e = entorno({ sistemaOscuro: false });
    const tema = conectar(e);
    await tema.listo;
    assert.equal(await tema.alternar(), "oscuro");
    assert.equal(e.raiz.dataset.tema, "oscuro");
    assert.equal(await tema.alternar(), "claro");
    assert.deepEqual(e.guardados, ["oscuro", "claro"]);
    assert.equal(e.pintados.at(-1), "claro");
    assert.ok(e.pintados.every(esTema));
  });

  test("otra página guarda otro tema → se aplica; si lo borra, vuelve al sistema", async () => {
    const e = entorno({ sistemaOscuro: true });
    const tema = conectar(e);
    await tema.listo;
    e.avisos.cambio("claro");
    assert.equal(e.raiz.dataset.tema, "claro");
    e.avisos.cambio(null);
    assert.equal(e.raiz.dataset.tema, "oscuro");
  });

  test("si storage falla, sigue al sistema y el botón igual cambia el tema", async () => {
    const e = entorno({ sistemaOscuro: false, falla: true });
    const tema = conectar(e);
    await tema.listo;
    assert.equal(e.raiz.dataset.tema, "claro");
    assert.equal(await tema.alternar(), "oscuro");
    assert.equal(e.raiz.dataset.tema, "oscuro");
  });

  test("un valor raro guardado no se aplica", async () => {
    const e = entorno({ sistemaOscuro: true, guardado: "<b>rojo</b>" });
    await conectar(e).listo;
    assert.equal(e.raiz.dataset.tema, "oscuro");
  });
});

// ----- Colores de estilos/sicae.css -----

const CSS = sinComentarios(leer("estilos/sicae.css"));

/** Bloque CSS que empieza en `encabezado`: {inicio, fin, cuerpo (lo de adentro de las llaves)}. */
function bloque(texto, encabezado) {
  const inicio = texto.indexOf(encabezado);
  assert.ok(inicio >= 0, `falta el bloque ${encabezado}`);
  let nivel = 0;
  for (let i = texto.indexOf("{", inicio); i < texto.length; i += 1) {
    if (texto[i] === "{") nivel += 1;
    if (texto[i] === "}") nivel -= 1;
    if (nivel === 0) return { inicio, fin: i + 1, cuerpo: texto.slice(texto.indexOf("{", inicio) + 1, i) };
  }
  throw new Error(`bloque sin cerrar: ${encabezado}`);
}

function variables(cuerpo) {
  return Object.fromEntries([...cuerpo.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const CLARO_BLOQUE = bloque(CSS, ":root {");
const MEDIA_BLOQUE = bloque(CSS, "@media (prefers-color-scheme: dark) {");
const OSCURO_MEDIA = bloque(MEDIA_BLOQUE.cuerpo, ':root:not([data-tema="claro"]) {');
const OSCURO_BLOQUE = bloque(CSS, ':root[data-tema="oscuro"] {');
const CLARO = variables(CLARO_BLOQUE.cuerpo);
const OSCURO = { ...CLARO, ...variables(OSCURO_BLOQUE.cuerpo) };

/** Luminancia relativa y razón de contraste (WCAG 2.x). */
function luminancia(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map((h) => Number.parseInt(h, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

// Texto (≥ 4,5:1). Cada par: [color del texto, fondo, dónde se ve].
const PARES_TEXTO = [
  ["--texto", "--fondo", "texto en las cajas"],
  ["--texto", "--fondo-panel", "títulos de la bienvenida y del panel"],
  ["--texto", "--fondo-pagina", "Opciones"],
  ["--texto", "--gris-suave", "número de los motivos"],
  ["--texto", "--azul-suave", "ítem del menú con el ratón encima"],
  ["--texto-suave", "--fondo", "texto secundario en las cajas"],
  ["--texto-suave", "--fondo-panel", "subtítulos de la bienvenida"],
  ["--texto-suave", "--fondo-pagina", "ayudas de Opciones"],
  ["--texto-suave", "--gris-suave", "«Obligatorio» y botones deshabilitados"],
  ["--texto-suave", "--azul-suave", "hora y asunto de la Bandeja con el ratón encima"],
  ["--azul", "--fondo", "botón secundario y enlaces en cajas"],
  ["--azul", "--fondo-panel", "enlaces en la bienvenida"],
  ["--azul", "--azul-suave", "pestaña actual, tarjeta informativa"],
  ["--azul", "--azul-tenue", "«Nunca haremos»"],
  ["--azul-hover", "--fondo", "enlace con el ratón encima"],
  ["--naranja", "--fondo", "mensajes de error en Opciones"],
  ["--naranja", "--naranja-suave", "avisos y tarjeta de precaución"],
  ["--rojo", "--rojo-suave", "tarjeta de phishing (riesgo alto)"],
  ["--gris-fuerte", "--gris-suave", "tarjeta de publicidad (gris)"],
  ["--gris-fuerte", "--fondo", "números de la Bandeja"],
  ["--texto-sobre-color", "--azul", "botón principal y tono elegido"],
  ["--texto-sobre-color", "--azul-hover", "botón principal con el ratón encima"],
  ["--texto-sobre-color", "--naranja", "botón de alerta"],
  ["--texto-sobre-color", "--naranja-hover", "botón de alerta con el ratón encima"],
  ["--borde-control", "--fondo", "texto de ejemplo de los campos"],
];
// Controles e íconos (≥ 3:1, WCAG 1.4.11).
const PARES_CONTROL = [
  ["--borde-control", "--fondo", "borde de campos y tonos, pista del interruptor apagado"],
  ["--azul", "--fondo", "marco de foco, interruptor encendido"],
  ["--azul", "--fondo-panel", "marco de foco sobre el panel"],
  ["--perilla", "--borde-control", "perilla del interruptor apagado"],
  ["--perilla", "--azul", "perilla del interruptor encendido"],
  ["--azul", "--azul-suave", "ícono de la tarjeta informativa"],
  ["--naranja", "--naranja-suave", "ícono de precaución"],
  ["--rojo", "--rojo-suave", "ícono de alerta"],
  ["--gris-fuerte", "--gris-suave", "ícono de publicidad"],
  ["--borde-control", "--fondo-panel", "íconos de los estados vacíos"],
];

describe("estilos/sicae.css: colores de los dos temas", () => {
  test("el bloque oscuro del sistema es IGUAL al de la elección guardada", () => {
    assert.deepEqual(variables(OSCURO_MEDIA.cuerpo), variables(OSCURO_BLOQUE.cuerpo));
    assert.equal(CLARO["color-scheme"], "light");
    assert.equal(OSCURO["color-scheme"], "dark");
  });

  test("el tema oscuro define todos los colores que usan los pares (nada se hereda del claro por error)", () => {
    const oscuras = variables(OSCURO_BLOQUE.cuerpo);
    for (const [a, b] of [...PARES_TEXTO, ...PARES_CONTROL]) {
      assert.ok(a in oscuras && b in oscuras, `${a} / ${b}`);
    }
  });

  for (const [nombre, tema] of [["claro", CLARO], ["oscuro", OSCURO]]) {
    test(`tema ${nombre}: texto ≥ 4,5:1 (AA)`, (t) => {
      for (const [texto, fondo, donde] of PARES_TEXTO) {
        const razon = contraste(tema[texto], tema[fondo]);
        t.diagnostic(`${razon.toFixed(2)}:1  ${texto} sobre ${fondo} (${donde})`);
        assert.ok(razon >= 4.5, `${nombre}: ${texto} ${tema[texto]} sobre ${fondo} ${tema[fondo]} = ${razon.toFixed(2)} (${donde})`);
      }
    });

    test(`tema ${nombre}: controles e íconos ≥ 3:1 (AA)`, (t) => {
      for (const [color, fondo, donde] of PARES_CONTROL) {
        const razon = contraste(tema[color], tema[fondo]);
        t.diagnostic(`${razon.toFixed(2)}:1  ${color} sobre ${fondo} (${donde})`);
        assert.ok(razon >= 3, `${nombre}: ${color} sobre ${fondo} = ${razon.toFixed(2)} (${donde})`);
      }
    });
  }

  test("no hay colores fijos fuera de los bloques de variables", () => {
    let resto = CSS;
    for (const b of [OSCURO_BLOQUE, MEDIA_BLOQUE, CLARO_BLOQUE].sort((x, y) => y.inicio - x.inicio)) {
      resto = resto.slice(0, b.inicio) + resto.slice(b.fin);
    }
    const fijos = resto.split("\n").filter((linea) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(linea));
    assert.deepEqual(fijos, []);
  });

  test("HTML: sin colores fijos, salvo el logo (igual en los dos temas, como el ícono)", () => {
    for (const ruta of ["sidepanel/panel.html", "opciones/opciones.html"]) {
      let html = leer(ruta);
      const logo = html.indexOf('<span class="marca-logo"');
      if (logo >= 0) html = html.slice(0, logo) + html.slice(html.indexOf("</span>", logo));
      assert.doesNotMatch(html, /(fill|stroke|color)="#|style=/i, ruta);
    }
  });
});
