// Genera los íconos PNG de la extensión (16, 32, 48 y 128 px) sin paquetes: solo node:zlib.
//
// Chrome necesita PNG para los íconos del manifest (no acepta SVG). El dibujo es el escudo del
// encabezado del panel: cuadro oscuro redondeado, escudo blanco y un visto oscuro.
//
// Uso, desde la raíz del proyecto (solo hace falta si se cambia el dibujo):
//     node herramientas/iconos.js
// Deja extension/iconos/sicae-16.png … sicae-128.png. La prueba extension/tests/iconos.test.js
// comprueba que los PNG guardados tengan exactamente los píxeles que genera este archivo.
//
// Está FUERA de extension/ a propósito: la extensión no lo usa y así no se empaqueta con ella.
// Solo se corre a mano con Node.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

export const TAMANOS = [16, 32, 48, 128];
const MUESTRAS = 4; // 4×4 muestras por píxel: bordes suaves (antialiasing)

const OSCURO = [0x18, 0x18, 0x1b]; // #18181b, igual que el cuadro del encabezado
const BLANCO = [0xff, 0xff, 0xff];

// ----- Geometría, en coordenadas de 0 a 1 (la misma del SVG del encabezado) -----

const RADIO_CUADRO = 0.22;

/** Punto de una curva cuadrática de Bézier. */
function bezier(p0, control, p1, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * control[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * control[1] + t * t * p1[1]];
}

/** Contorno del escudo como polígono: lado derecho con curva hasta la punta, y su espejo. */
function contornoEscudo() {
  const derecho = [[0.5, 0.18], [0.75, 0.27], [0.75, 0.5]];
  for (let i = 1; i <= 16; i += 1) derecho.push(bezier([0.75, 0.5], [0.75, 0.72], [0.5, 0.84], i / 16));
  const izquierdo = derecho.slice(1, -1).reverse().map(([x, y]) => [1 - x, y]);
  return [...derecho, ...izquierdo];
}

const ESCUDO = contornoEscudo();
const VISTO = [[0.38, 0.51], [0.47, 0.6], [0.63, 0.42]];
const GROSOR_VISTO = 0.045; // mitad del ancho del trazo

function dentroDelCuadro(x, y) {
  const r = RADIO_CUADRO;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Regla par-impar: ¿el punto está dentro del polígono? */
function dentroDelPoligono(x, y, poligono) {
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i, i += 1) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

function distanciaASegmento(x, y, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

function enElVisto(x, y) {
  return distanciaASegmento(x, y, VISTO[0], VISTO[1]) <= GROSOR_VISTO
    || distanciaASegmento(x, y, VISTO[1], VISTO[2]) <= GROSOR_VISTO;
}

/** Color de un punto: null si está fuera del cuadro (transparente). */
function colorEn(x, y) {
  if (!dentroDelCuadro(x, y)) return null;
  if (dentroDelPoligono(x, y, ESCUDO) && !enElVisto(x, y)) return BLANCO;
  return OSCURO;
}

// ----- Imagen -----

/** Píxeles RGBA (4 bytes por píxel, fila por fila) del ícono de `tamano` × `tamano`. */
export function pixeles(tamano) {
  const datos = Buffer.alloc(tamano * tamano * 4);
  for (let fila = 0; fila < tamano; fila += 1) {
    for (let col = 0; col < tamano; col += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let cubiertas = 0;
      for (let sy = 0; sy < MUESTRAS; sy += 1) {
        for (let sx = 0; sx < MUESTRAS; sx += 1) {
          const color = colorEn((col + (sx + 0.5) / MUESTRAS) / tamano, (fila + (sy + 0.5) / MUESTRAS) / tamano);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            cubiertas += 1;
          }
        }
      }
      const i = (fila * tamano + col) * 4;
      if (cubiertas > 0) {
        datos[i] = Math.round(r / cubiertas);
        datos[i + 1] = Math.round(g / cubiertas);
        datos[i + 2] = Math.round(b / cubiertas);
        datos[i + 3] = Math.round((255 * cubiertas) / (MUESTRAS * MUESTRAS));
      }
    }
  }
  return datos;
}

// ----- Formato PNG (firma + bloques IHDR, IDAT, IEND) -----

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** CRC-32 que exige cada bloque del PNG. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloque(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const tipoYDatos = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tipoYDatos));
  return Buffer.concat([largo, tipoYDatos, crc]);
}

export const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG completo del ícono (RGBA de 8 bits, sin entrelazado). */
export function crearPng(tamano) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tamano, 0);
  ihdr.writeUInt32BE(tamano, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  // 10, 11 y 12 en 0: compresión, filtro y sin entrelazado

  // Cada fila empieza con un byte de filtro (0 = sin filtro).
  const rgba = pixeles(tamano);
  const filas = Buffer.alloc(tamano * (tamano * 4 + 1));
  for (let fila = 0; fila < tamano; fila += 1) {
    rgba.copy(filas, fila * (tamano * 4 + 1) + 1, fila * tamano * 4, (fila + 1) * tamano * 4);
  }
  return Buffer.concat([FIRMA_PNG, bloque("IHDR", ihdr), bloque("IDAT", deflateSync(filas, { level: 9 })), bloque("IEND", Buffer.alloc(0))]);
}

// Si se corre directamente (no importado por una prueba), escribe los PNG.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const carpeta = fileURLToPath(new URL("../extension/iconos/", import.meta.url));
  for (const tamano of TAMANOS) {
    const ruta = join(carpeta, `sicae-${tamano}.png`);
    writeFileSync(ruta, crearPng(tamano));
    process.stdout.write(`Escrito ${ruta}\n`);
  }
}
