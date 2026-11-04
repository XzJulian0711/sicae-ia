// Pruebas de los íconos de la extensión: el generador (herramientas/iconos.js, en la raíz del
// repo, fuera de la extensión) y los PNG de extension/iconos/.
// Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { inflateSync } from "node:zlib";

import { FIRMA_PNG, TAMANOS, crc32, crearPng, pixeles } from "../../herramientas/iconos.js";

const RAIZ = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));
const rutaPng = (tamano) => `iconos/sicae-${tamano}.png`;

/** Lee un PNG: {ancho, alto, tipoColor, pixeles RGBA}. Solo el formato que escribe iconos.js. */
function leerPng(datos) {
  assert.ok(datos.subarray(0, 8).equals(FIRMA_PNG), "firma PNG");
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < datos.length) {
    const largo = datos.readUInt32BE(pos);
    const tipo = datos.toString("ascii", pos + 4, pos + 8);
    const contenido = datos.subarray(pos + 8, pos + 8 + largo);
    const crc = datos.readUInt32BE(pos + 8 + largo);
    assert.equal(crc, crc32(datos.subarray(pos + 4, pos + 8 + largo)), `CRC del bloque ${tipo}`);
    if (tipo === "IHDR") ihdr = contenido;
    if (tipo === "IDAT") idat.push(contenido);
    pos += 12 + largo;
  }
  const ancho = ihdr.readUInt32BE(0);
  const alto = ihdr.readUInt32BE(4);
  const filas = inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(ancho * alto * 4);
  for (let fila = 0; fila < alto; fila += 1) {
    const inicio = fila * (ancho * 4 + 1);
    assert.equal(filas[inicio], 0, "sin filtro en cada fila");
    filas.copy(rgba, fila * ancho * 4, inicio + 1, inicio + 1 + ancho * 4);
  }
  return { ancho, alto, profundidad: ihdr[8], tipoColor: ihdr[9], pixeles: rgba };
}

describe("crc32", () => {
  test("da el valor conocido de '123456789'", () => {
    assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  });
});

describe("íconos PNG de la extensión", () => {
  for (const tamano of TAMANOS) {
    test(`sicae-${tamano}.png: PNG RGBA de ${tamano}×${tamano} con los píxeles que genera iconos.js`, () => {
      const png = leerPng(readFileSync(join(RAIZ, rutaPng(tamano))));
      assert.equal(png.ancho, tamano);
      assert.equal(png.alto, tamano);
      assert.equal(png.profundidad, 8);
      assert.equal(png.tipoColor, 6);
      // Se comparan los píxeles (no los bytes): la compresión podría cambiar entre versiones de Node.
      assert.ok(png.pixeles.equals(pixeles(tamano)), "el PNG guardado no coincide: corre node herramientas/iconos.js");
    });
  }

  test("crearPng arma un PNG que se puede volver a leer", () => {
    const png = leerPng(crearPng(16));
    assert.ok(png.pixeles.equals(pixeles(16)));
  });

  test("el dibujo tiene esquinas transparentes, borde oscuro y escudo blanco en el centro", () => {
    const tamano = 128;
    const px = pixeles(tamano);
    const en = (x, y) => [...px.subarray((y * tamano + x) * 4, (y * tamano + x) * 4 + 4)];
    assert.equal(en(0, 0)[3], 0, "esquina transparente");
    assert.deepEqual(en(64, 8), [0x18, 0x18, 0x1b, 255], "arriba del escudo: cuadro oscuro");
    assert.deepEqual(en(50, 45), [255, 255, 255, 255], "dentro del escudo: blanco");
  });

  test("el manifest usa los 4 tamaños y el ícono de la barra", () => {
    assert.deepEqual(manifest.icons, Object.fromEntries(TAMANOS.map((t) => [String(t), rutaPng(t)])));
    assert.deepEqual(manifest.action.default_icon, { 16: rutaPng(16), 32: rutaPng(32) });
  });
});
