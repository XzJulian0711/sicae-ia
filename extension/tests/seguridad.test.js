// Revisión estática de seguridad de la extensión, con el ejecutor de pruebas de Node.
// Lee los archivos de extension/ y comprueba reglas que no deben romperse:
// - nada de innerHTML / eval / código remoto;
// - permisos mínimos en el manifest;
// - ninguna clave escrita en el código;
// - las fuentes locales son las descargadas (SHA-256).
// Correr desde la raíz:  node --test extension/tests/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, test } from "node:test";

const RAIZ = join(import.meta.dirname, "..");

// SHA-256 de las fuentes descargadas de github.com/google/fonts (ver docs/extension.md).
const FUENTES = {
  "Sora-Variable.ttf": "84ff7096ae3ec6c8be47d906d1a0ba4de7f2ce78c615275c77301964a316e16c",
  "OFL-Sora.txt": "ba0b9729c9428ba79a0459ab8ec575791b51509dbec213e383d0316d37fec299",
  "DMSans-Variable.ttf": "8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d",
  "OFL-DMSans.txt": "9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1",
};

function archivos(carpeta = RAIZ) {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) {
      return nombre === "tests" || nombre === "fuentes" ? [] : archivos(ruta);
    }
    return [ruta];
  });
}

function sinComentarios(texto, extension) {
  if (extension === ".html") return texto.replace(/<!--[\s\S]*?-->/g, "");
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

function leer(extension) {
  return archivos()
    .filter((ruta) => ruta.endsWith(extension))
    .map((ruta) => ({ nombre: relative(RAIZ, ruta), codigo: sinComentarios(readFileSync(ruta, "utf8"), extension) }));
}

describe("código JavaScript", () => {
  const prohibidos = [
    /\binnerHTML\b/,
    /\bouterHTML\b/,
    /\binsertAdjacentHTML\b/,
    /\bdocument\.write\b/,
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bimport\s*\(\s*["'`]https?:/,
    /\bfrom\s+["']https?:/,
  ];

  test("no usa innerHTML, eval ni código remoto", () => {
    const js = leer(".js");
    assert.ok(js.length >= 4, "deberían existir los archivos .js de la extensión");
    for (const { nombre, codigo } of js) {
      for (const patron of prohibidos) {
        assert.doesNotMatch(codigo, patron, `${nombre} usa ${patron}`);
      }
    }
  });

  test("todos los fetch tienen tiempo máximo de espera", () => {
    for (const { nombre, codigo } of leer(".js")) {
      const llamadas = codigo.match(/\bfetch\s*\(/g) || [];
      const conEspera = codigo.match(/AbortSignal\.timeout\s*\(/g) || [];
      assert.ok(conEspera.length >= llamadas.length, `${nombre}: hay fetch sin AbortSignal.timeout`);
    }
  });
});

describe("HTML y CSS", () => {
  test("no hay scripts en línea ni manejadores onclick", () => {
    for (const { nombre, codigo } of leer(".html")) {
      assert.doesNotMatch(codigo, /<script(?![^>]*\bsrc=)[^>]*>/i, `${nombre} tiene un <script> en línea`);
      assert.doesNotMatch(codigo, /\son[a-z]+\s*=/i, `${nombre} tiene un manejador en línea (onclick=…)`);
      assert.doesNotMatch(codigo, /\sstyle\s*=/i, `${nombre} tiene estilos en línea`);
    }
  });

  test("no carga nada de internet (fuentes, estilos, scripts, imágenes)", () => {
    for (const { nombre, codigo } of [...leer(".html"), ...leer(".css")]) {
      assert.doesNotMatch(codigo, /\b(src|href)\s*=\s*["']?(https?:)?\/\//i, `${nombre} carga un recurso remoto`);
      assert.doesNotMatch(codigo, /url\(\s*["']?(https?:)?\/\//i, `${nombre} carga un recurso remoto`);
      assert.doesNotMatch(codigo, /@import/i, `${nombre} usa @import`);
    }
  });
});

describe("manifest.json", () => {
  const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));

  test("es Manifest V3 con permisos mínimos", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ["storage"]);
    assert.deepEqual(manifest.host_permissions, ["https://mail.google.com/*", "http://127.0.0.1:8000/*"]);
  });

  test("las direcciones de la API en logica.js coinciden con host_permissions", async () => {
    const { ORIGENES_PERMITIDOS } = await import("../lib/logica.js");
    const deLaApi = manifest.host_permissions
      .filter((permiso) => !permiso.startsWith("https://mail.google.com"))
      .map((permiso) => permiso.replace(/\/\*$/, ""));
    assert.deepEqual([...ORIGENES_PERMITIDOS].sort(), deLaApi.sort());
  });

  test("no relaja la política de seguridad de contenido", () => {
    assert.equal(manifest.content_security_policy, undefined);
  });

  test("los archivos del popup y de opciones existen", () => {
    for (const pagina of [manifest.action.default_popup, manifest.options_ui.page]) {
      assert.ok(statSync(join(RAIZ, pagina)).isFile(), pagina);
    }
  });
});

describe("secretos", () => {
  test("no hay claves de API escritas en el código", () => {
    for (const ruta of archivos()) {
      const texto = readFileSync(ruta, "utf8");
      const nombre = relative(RAIZ, ruta);
      assert.doesNotMatch(texto, /X-API-Key["']?\s*[:=]\s*["'][^"'\s]{8,}/i, `${nombre} tiene una clave escrita`);
      for (const conocida of ["cambia-esto", "clave-de-prueba-solo-para-tests"]) {
        assert.ok(!texto.includes(conocida), `${nombre} contiene "${conocida}"`);
      }
    }
  });
});

describe("fuentes locales", () => {
  for (const [nombre, esperado] of Object.entries(FUENTES)) {
    test(`${nombre} existe y tiene el SHA-256 documentado`, () => {
      const datos = readFileSync(join(RAIZ, "fuentes", nombre));
      assert.equal(createHash("sha256").update(datos).digest("hex"), esperado);
    });
  }
});
