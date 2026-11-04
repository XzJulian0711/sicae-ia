// Pruebas de extension/lib/bandeja.js (paso 4.4): resumen de la pestaña Bandeja, con correos
// y resultados INVENTADOS. Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MENSAJE_OTRA_CUENTA,
  cuentaDeTitulo,
  formatearHora,
  formatearNumero,
  formatearTamano,
  mismaCuenta,
  resumenPublicidad,
  resumirBandeja,
  textoAvisoPhishing,
} from "../lib/bandeja.js";

const resultado = (categoria, prioridad) => ({ tipo: "resultado", categoria, confianza: "alta", prioridad, motivos: [] });
const item = (id, categoria, prioridad, extra = {}) => ({
  id,
  fecha: 1_000 + Number(id.replace(/\D/g, "")),
  tamano: 1024,
  etiquetas: ["INBOX"],
  remitenteNombre: `Remitente ${id}`,
  correo: { asunto: `Asunto ${id}`, remitente: `${id}@example.org` },
  resultado: categoria ? resultado(categoria, prioridad) : null,
  ...extra,
});

describe("resumirBandeja", () => {
  const items = [
    item("c1", "legitimo", "alta"),
    item("c2", "legitimo", "media"),
    item("c3", "publicidad", "baja"),
    item("c4", "phishing", null),
    item("c5", "legitimo", "alta"),
    item("c6", "phishing", null),
    item("c7", null, null), // no se pudo clasificar
  ];
  const r = resumirBandeja(items);

  test("conteos alta / media / baja (el phishing no tiene prioridad)", () => {
    assert.deepEqual(r.conteos, { alta: 2, media: 1, baja: 1 });
    assert.equal(r.sinClasificar, 1);
  });

  test("phishing y prioridad alta, del más nuevo al más viejo", () => {
    assert.deepEqual(r.phishing.map((i) => i.id), ["c6", "c4"]);
    assert.deepEqual(r.prioridadAlta.map((i) => i.id), ["c5", "c1"]);
    assert.deepEqual(r.publicidad.map((i) => i.id), ["c3"]);
  });

  test("como máximo 10 en prioridad alta", () => {
    const muchos = Array.from({ length: 15 }, (_, i) => item(`a${i}`, "legitimo", "alta"));
    assert.equal(resumirBandeja(muchos).prioridadAlta.length, 10);
  });

  test("lista vacía o rara", () => {
    assert.deepEqual(resumirBandeja(undefined).conteos, { alta: 0, media: 0, baja: 0 });
  });
});

describe("formatos", () => {
  test("números con punto de miles", () => {
    assert.equal(formatearNumero(1240), "1.240");
    assert.equal(formatearNumero(1234567), "1.234.567");
    assert.equal(formatearNumero(7), "7");
  });

  test("tamaños como en el demo", () => {
    assert.equal(formatearTamano(860 * 1024 ** 2), "860 MB");
    assert.equal(formatearTamano(1.2 * 1024 ** 3), "1,2 GB");
    assert.equal(formatearTamano(35 * 1024), "35 KB");
    assert.equal(formatearTamano(2.5 * 1024 ** 2), "2,5 MB");
    assert.equal(formatearTamano(500), "500 B");
  });

  test("hora: de hoy, ayer u otro día", () => {
    const ahora = new Date(2026, 10, 5, 18, 30);
    assert.equal(formatearHora(new Date(2026, 10, 5, 8, 14).getTime(), ahora), "8:14");
    assert.equal(formatearHora(new Date(2026, 10, 4, 23, 59).getTime(), ahora), "ayer");
    assert.equal(formatearHora(new Date(2026, 9, 28, 10, 0).getTime(), ahora), "28 oct");
    assert.equal(formatearHora("no-es-fecha", ahora), "");
  });

  test("texto del aviso de phishing (1 o N)", () => {
    assert.equal(textoAvisoPhishing(1), "1 correo con posible phishing.");
    assert.equal(textoAvisoPhishing(3), "3 correos con posible phishing.");
  });
});

describe("resumenPublicidad", () => {
  const detectados = [
    item("d1", "publicidad", "baja", { tamano: 2048 }), // no está en Promociones: se suma
    item("d2", "publicidad", "baja", { tamano: 4096, etiquetas: ["INBOX", "CATEGORY_PROMOTIONS"] }), // ya está en Promociones
  ];

  test("Promociones + los detectados que no estén ya en Promociones", () => {
    const r = resumenPublicidad({ total: 3, tamanos: [1024, 1024, 1024], ids: ["p1", "p2", "p3"] }, detectados);
    assert.equal(r.cantidad, 4);
    assert.equal(r.bytes, 3 * 1024 + 2048);
    assert.equal(r.alMenos, false);
    assert.equal(r.texto, "4 correos de publicidad ocupan 5 KB. Revisa la lista antes de moverlos a la papelera.");
  });

  test("si Promociones tiene más de los medidos (tope), el tamaño es «al menos»", () => {
    const r = resumenPublicidad({ total: 1240, tamanos: Array(100).fill(1024 ** 2), ids: [] }, []);
    assert.equal(r.cantidad, 1240);
    assert.equal(r.alMenos, true);
    assert.match(r.texto, /^1\.240 correos de publicidad ocupan al menos 100 MB\./);
  });

  test("sin datos de Promociones (error) → solo los detectados, y «al menos»", () => {
    const r = resumenPublicidad(null, detectados);
    assert.equal(r.cantidad, 2);
    assert.equal(r.alMenos, true);
  });

  test("sin publicidad", () => {
    assert.equal(resumenPublicidad({ total: 0, tamanos: [], ids: [] }, []).texto, "No se encontraron correos de publicidad.");
    assert.match(resumenPublicidad({ total: 1, tamanos: [1024], ids: ["p"] }, []).texto, /^1 correo de publicidad ocupa 1 KB\./);
  });
});

describe("la pestaña de Gmail de otra cuenta (resuelve la limitación del 4.2)", () => {
  test("lee la cuenta del título de Gmail", () => {
    assert.equal(cuentaDeTitulo("Recibidos (3) - Sicae.Pruebas.2026@gmail.com - Gmail"), "sicae.pruebas.2026@gmail.com");
    assert.equal(cuentaDeTitulo("Gmail"), null);
    assert.equal(cuentaDeTitulo(undefined), null);
  });

  test("misma cuenta (sin importar mayúsculas), otra cuenta, o no se puede saber", () => {
    const titulo = "Recibidos - sicae.pruebas.2026@gmail.com - Gmail";
    assert.equal(mismaCuenta(titulo, "SICAE.pruebas.2026@gmail.com"), true);
    assert.equal(mismaCuenta("Recibidos - otra.persona@gmail.com - Gmail", "sicae.pruebas.2026@gmail.com"), false);
    assert.equal(mismaCuenta("Gmail", "sicae.pruebas.2026@gmail.com"), true, "sin correo en el título: se sigue");
    assert.equal(mismaCuenta(titulo, null), true, "sin correo de sesión todavía: se sigue");
    assert.match(MENSAJE_OTRA_CUENTA, /otra cuenta/);
  });
});
