// Pruebas de extension/lib/limpieza.js (paso 4.5, "Liberar espacio"), con correos INVENTADOS.
// Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AVISO_TODO_EL_CORREO,
  MAX_CANTIDAD,
  agruparPorRemitente,
  busquedasGmail,
  consultaGmail,
  cumpleCondiciones,
  enLotes,
  filtrarCandidatos,
  mbDe,
  motivoExclusion,
  opcionesIniciales,
  textoBotonDeshacer,
  textoConfirmacion,
  textoExclusiones,
  textoResultado,
  totalesSeleccion,
  validarOpciones,
} from "../lib/limpieza.js";

const MB = 1024 * 1024;
const resultado = (categoria, prioridad) => ({ tipo: "resultado", categoria, confianza: "alta", prioridad, motivos: [] });
const item = (id, { etiquetas = ["INBOX"], categoria = "publicidad", prioridad = "baja", remitente = "ofertas@tienda.example",
                    nombre = "Tienda", tamano = MB, fecha = Date.UTC(2026, 0, 1) } = {}) => ({
  id, etiquetas, tamano, fecha, remitenteNombre: nombre,
  correo: { asunto: `Asunto ${id}`, remitente },
  resultado: categoria ? resultado(categoria, prioridad) : null,
});

const conOrigen = (cambios = {}) => ({ ...opcionesIniciales(), origenes: { ...opcionesIniciales().origenes, promociones: true }, ...cambios });

describe("opciones", () => {
  test("por defecto no hay ningún origen marcado, tampoco «Todo el correo»", () => {
    const o = opcionesIniciales();
    assert.deepEqual(o.origenes, { publicidad: false, promociones: false, spam: false, todo: false });
    assert.equal(o.cantidad, 25);
  });

  test("sin origen no se busca", () => {
    assert.deepEqual(validarOpciones(opcionesIniciales()), { ok: false, error: "Marca al menos un origen para buscar." });
    // Una condición sola no basta: hay que marcar un origen.
    assert.equal(validarOpciones({ ...opcionesIniciales(), antiguedadMeses: 6 }).ok, false);
  });

  test("límites: cantidad 1–500, meses 1–120, MB 1–50 (enteros)", () => {
    for (const cantidad of [10, 25, 50, 100, 1, 500, "200"]) assert.equal(validarOpciones(conOrigen({ cantidad })).ok, true, String(cantidad));
    for (const cantidad of [0, 501, 2.5, "x", null]) assert.equal(validarOpciones(conOrigen({ cantidad })).ok, false, String(cantidad));
    assert.equal(validarOpciones(conOrigen({ antiguedadMeses: 0 })).ok, false);
    assert.equal(validarOpciones(conOrigen({ antiguedadMeses: 121 })).ok, false);
    assert.equal(validarOpciones(conOrigen({ tamanoMb: 51 })).ok, false);
    assert.equal(validarOpciones(conOrigen({ tamanoMb: "5" })).opciones.tamanoMb, 5);
    assert.equal(MAX_CANTIDAD, 500);
  });

  test("el aviso de «Todo el correo»", () => {
    assert.equal(AVISO_TODO_EL_CORREO, "Incluye correos personales y de trabajo: revisa la lista con cuidado.");
  });
});

describe("orígenes (O) y condiciones (Y)", () => {
  test("las condiciones van en q", () => {
    assert.equal(consultaGmail({ antiguedadMeses: 6, tamanoMb: null }), "older_than:6m");
    assert.equal(consultaGmail({ antiguedadMeses: 6, tamanoMb: 5 }), "older_than:6m larger:5M");
    assert.equal(consultaGmail({ antiguedadMeses: null, tamanoMb: null }), "");
  });

  test("Promociones + Spam se suman, con las mismas condiciones; Spam incluye la carpeta de spam", () => {
    const o = validarOpciones(conOrigen({ origenes: { publicidad: false, promociones: true, spam: true, todo: false }, antiguedadMeses: 6 })).opciones;
    assert.deepEqual(busquedasGmail(o), [
      { origen: "promociones", labelIds: ["CATEGORY_PROMOTIONS"], q: "older_than:6m", includeSpamTrash: false },
      { origen: "spam", labelIds: ["SPAM"], q: "older_than:6m", includeSpamTrash: true },
    ]);
  });

  test("«Todo el correo» es una sola búsqueda sin etiqueta (ya incluye a los demás)", () => {
    const o = validarOpciones(conOrigen({ origenes: { publicidad: true, promociones: true, spam: false, todo: true }, tamanoMb: 5 })).opciones;
    assert.deepEqual(busquedasGmail(o), [{ origen: "todo", labelIds: [], q: "larger:5M", includeSpamTrash: false }]);
  });

  test("solo «publicidad detectada» no pide nada a Gmail (sale del análisis de la Bandeja)", () => {
    const o = validarOpciones(conOrigen({ origenes: { publicidad: true, promociones: false, spam: false, todo: false } })).opciones;
    assert.deepEqual(busquedasGmail(o), []);
  });

  test("condiciones sobre la publicidad detectada: antigüedad y tamaño (Y)", () => {
    const ahora = new Date(Date.UTC(2026, 10, 4));
    const viejo = item("v", { fecha: Date.UTC(2026, 0, 1), tamano: 10 * MB });
    const nuevo = item("n", { fecha: Date.UTC(2026, 10, 1), tamano: 10 * MB });
    const chico = item("c", { fecha: Date.UTC(2026, 0, 1), tamano: MB });
    const cond = { antiguedadMeses: 6, tamanoMb: 5 };
    assert.equal(cumpleCondiciones(viejo, cond, ahora), true);
    assert.equal(cumpleCondiciones(nuevo, cond, ahora), false);
    assert.equal(cumpleCondiciones(chico, cond, ahora), false);
    assert.equal(cumpleCondiciones(nuevo, { antiguedadMeses: null, tamanoMb: null }, ahora), true);
  });
});

describe("exclusiones (siempre)", () => {
  test("destacados, importantes, phishing, prioridad alta y sin clasificar no se ofrecen", () => {
    assert.equal(motivoExclusion(item("a", { etiquetas: ["INBOX", "STARRED"] })), "destacado");
    assert.equal(motivoExclusion(item("b", { etiquetas: ["IMPORTANT"] })), "importante");
    assert.equal(motivoExclusion(item("c", { categoria: "phishing", prioridad: null })), "phishing");
    assert.equal(motivoExclusion(item("d", { categoria: "legitimo", prioridad: "alta" })), "prioridad_alta");
    assert.equal(motivoExclusion(item("e", { categoria: null })), "sin_clasificar");
    assert.equal(motivoExclusion(item("f", { categoria: "legitimo", prioridad: "media" })), null);
    assert.equal(motivoExclusion(item("g", { etiquetas: ["SPAM", "CATEGORY_PROMOTIONS"] })), null);
  });

  test("filtrar cuenta los excluidos y el texto los explica", () => {
    const { candidatos, excluidos } = filtrarCandidatos([
      item("1", { etiquetas: ["STARRED"] }), item("2", { etiquetas: ["STARRED"] }), item("3", { etiquetas: ["IMPORTANT"] }),
      item("4", { categoria: "legitimo", prioridad: "alta" }), item("5", { categoria: "phishing", prioridad: null }), item("6"),
    ]);
    assert.deepEqual(candidatos.map((c) => c.id), ["6"]);
    assert.equal(textoExclusiones(excluidos), "Se excluyeron 5: 2 destacados, 1 importante, 1 de prioridad alta y 1 de posible phishing.");
    assert.equal(textoExclusiones({ destacado: 0, importante: 0, prioridad_alta: 0, phishing: 0, sin_clasificar: 0 }), "");
  });
});

describe("agrupar y seleccionar", () => {
  const lista = [
    item("t1", { tamano: 2 * MB }), item("t2", { tamano: 3 * MB }),
    item("b1", { remitente: "Boletin@Noticias.example", nombre: "Noticias", tamano: 1 * MB }),
    item("b2", { remitente: "boletin@noticias.example", nombre: "Noticias", tamano: 1 * MB }),
    item("b3", { remitente: "boletin@noticias.example", nombre: "Noticias", tamano: 1 * MB }),
  ];

  test("por remitente (sin importar mayúsculas), con cantidad y peso, del que más pesa al que menos", () => {
    const grupos = agruparPorRemitente(lista);
    assert.deepEqual(grupos.map((g) => [g.clave, g.cantidad, g.bytes]), [
      ["ofertas@tienda.example", 2, 5 * MB],
      ["boletin@noticias.example", 3, 3 * MB],
    ]);
    assert.deepEqual(grupos[1].items.map((i) => i.id), ["b1", "b2", "b3"]);
  });

  test("totales de lo seleccionado y MB para el registro", () => {
    assert.deepEqual(totalesSeleccion(lista, new Set(["t1", "b1"])), { cantidad: 2, bytes: 3 * MB, mb: 3 });
    assert.deepEqual(totalesSeleccion(lista, new Set()), { cantidad: 0, bytes: 0, mb: 0 });
    assert.equal(mbDe(1.5 * MB), 1.5);
  });

  test("lotes de 50 para clasificar", () => {
    const ids = Array.from({ length: 120 }, (_, i) => i);
    assert.deepEqual(enLotes(ids).map((l) => l.length), [50, 50, 20]);
    assert.deepEqual(enLotes([]), []);
  });
});

describe("textos", () => {
  test("confirmación: total de correos y MB, que se puede deshacer y los 30 días de la papelera", () => {
    const texto = textoConfirmacion({ cantidad: 40, bytes: 12 * MB });
    assert.equal(texto, "Vas a mover 40 correos (12 MB) a la papelera. Se puede deshacer. "
      + "La papelera sigue ocupando espacio hasta que Gmail la vacía sola a los 30 días.");
    assert.match(textoConfirmacion({ cantidad: 1, bytes: 1024 }), /^Vas a mover 1 correo \(1 KB\)/);
  });

  test("resultado: todo bien o con fallos parciales", () => {
    assert.equal(textoResultado({ hechos: ["a", "b"], fallidos: [] }), "Se movieron 2 de 2 a la papelera.");
    assert.equal(textoResultado({ hechos: ["a"], fallidos: ["b"] }),
                 "Se movieron 1 de 2 a la papelera. 1 no se pudieron mover: inténtalo de nuevo más tarde.");
    assert.equal(textoResultado({ hechos: ["a", "b"], fallidos: [] }, "deshacer"), "Se devolvieron 2 de 2 desde la papelera.");
  });

  test("resultado con 403 de permiso: no dice «más tarde», dice que falta el permiso", () => {
    assert.equal(textoResultado({ hechos: [], fallidos: ["a", "b"], sinPermiso: true }),
                 "Se movieron 0 de 2 a la papelera. 2 no se pudieron mover: falta el permiso de Gmail.");
    assert.equal(textoResultado({ hechos: [], fallidos: ["a"], sinPermiso: true }, "deshacer"),
                 "Se devolvieron 0 de 1 desde la papelera. 1 no se pudieron devolver: falta el permiso de Gmail.");
  });

  test("botón Deshacer en una búsqueda nueva: singular y plural", () => {
    assert.equal(textoBotonDeshacer(1), "Deshacer el último movimiento (1 correo)");
    assert.equal(textoBotonDeshacer(40), "Deshacer el último movimiento (40 correos)");
    assert.equal(textoBotonDeshacer(1500), "Deshacer el último movimiento (1.500 correos)");
  });
});
