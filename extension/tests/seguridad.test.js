// Revisión estática de seguridad de la extensión, con el ejecutor de pruebas de Node.
// Lee los archivos de extension/ y comprueba reglas que no deben romperse:
// - nada de innerHTML / eval / código remoto;
// - permisos mínimos en el manifest;
// - ninguna clave escrita en el código;
// - las fuentes locales son las descargadas (SHA-256).
// Correr desde la raíz:  node --test extension/tests/

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

describe("íconos SVG", () => {
  test("son locales y sin código: sin scripts, eventos, foreignObject ni enlaces externos", () => {
    const svgs = readdirSync(join(RAIZ, "iconos")).filter((nombre) => nombre.endsWith(".svg"));
    assert.ok(svgs.length >= 4, "deberían existir los 4 íconos de la tarjeta");
    for (const nombre of svgs) {
      const svg = readFileSync(join(RAIZ, "iconos", nombre), "utf8");
      assert.doesNotMatch(svg, /<script/i, `${nombre} tiene <script>`);
      assert.doesNotMatch(svg, /\son[a-z]+\s*=/i, `${nombre} tiene un manejador de eventos`);
      assert.doesNotMatch(svg, /<foreignObject/i, `${nombre} tiene foreignObject`);
      assert.doesNotMatch(svg, /\b(xlink:)?href\s*=/i, `${nombre} enlaza otro recurso`);
      assert.doesNotMatch(svg, /url\(/i, `${nombre} carga un recurso con url()`);
    }
  });
});

describe("panel (paso 3.4)", () => {
  const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.html"), "utf8"), ".html");

  test("los SVG en línea del panel no tienen scripts, foreignObject ni enlaces", () => {
    const svgs = panel.match(/<svg[\s\S]*?<\/svg>/gi) || [];
    assert.ok(svgs.length >= 5, "logo, ajustes y los 3 íconos de la barra");
    for (const svg of svgs) {
      assert.doesNotMatch(svg, /<script|<foreignObject|\b(xlink:)?href\s*=|url\(/i);
      assert.match(svg, /aria-hidden="true"/, "los íconos son decorativos");
    }
  });

  test("el estado vacío se ve al cargar, antes del resultado (que empieza oculto)", async () => {
    const { TEXTO_VACIO } = await import("../lib/tarjeta.js");
    const vacio = /<div class="vacio" id="estado-vacio"([^>]*)>([\s\S]*?)<\/div>/.exec(panel);
    assert.ok(vacio, "falta #estado-vacio");
    assert.doesNotMatch(vacio[1], /\bhidden\b/, "el estado vacío debe verse al cargar");
    assert.match(vacio[2], /<svg[^>]*aria-hidden="true"/, "el escudo es decorativo");
    assert.ok(vacio[2].includes(TEXTO_VACIO), "el texto del HTML debe ser TEXTO_VACIO");
    assert.match(panel, /id="resultado"[^>]*\bhidden\b/, "el resultado empieza oculto");
    assert.ok(panel.indexOf('id="estado-vacio"') < panel.indexOf('id="resultado"'), "va en el lugar del resultado");
  });

  test("los botones de solo ícono tienen nombre accesible", () => {
    assert.match(panel, /id="ir-opciones"[^>]*aria-label="Ajustes"/);
  });

  test("Bandeja y Redactar están marcadas como no disponibles; Analizar es la actual", () => {
    assert.match(panel, /id="nav-bandeja"[^>]*aria-disabled="true"/);
    assert.match(panel, /id="nav-redactar"[^>]*aria-disabled="true"/);
    assert.match(panel, /id="nav-analizar"[^>]*aria-current="page"/);
  });

  test("el generador de íconos está fuera de la extensión (no se empaqueta con ella)", () => {
    // Vive en herramientas/ en la raíz del repo, no en extension/.
    assert.ok(existsSync(join(RAIZ, "..", "herramientas", "iconos.js")), "falta herramientas/iconos.js en la raíz");
    assert.ok(!existsSync(join(RAIZ, "herramientas")), "extension/herramientas/ no debe existir");
    // Ningún archivo de la extensión lo menciona ni lo importa.
    const manifestTexto = readFileSync(join(RAIZ, "manifest.json"), "utf8");
    assert.doesNotMatch(manifestTexto, /herramientas/);
    for (const { nombre, codigo } of [...leer(".html"), ...leer(".css"), ...leer(".js")]) {
      assert.doesNotMatch(codigo, /herramientas/, `${nombre} menciona herramientas/`);
    }
  });
});

describe("manifest.json", () => {
  const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));

  test("es Manifest V3 con permisos mínimos", () => {
    assert.equal(manifest.manifest_version, 3);
    assert.deepEqual(manifest.permissions, ["storage", "sidePanel"]);
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

  test("los archivos del panel lateral y de opciones existen", () => {
    for (const pagina of [manifest.side_panel.default_path, manifest.options_ui.page]) {
      assert.ok(statSync(join(RAIZ, pagina)).isFile(), pagina);
    }
  });

  test("el clic en el ícono abre el panel lateral", () => {
    // 1. Sin popup: si action tiene default_popup, Chrome abre el popup y no el panel.
    assert.equal(manifest.action.default_popup, undefined, "action no debe tener default_popup");
    // 2. El panel apunta a sidepanel/panel.html.
    assert.equal(manifest.side_panel?.default_path, "sidepanel/panel.html");
    // 3. Un service worker activa el comportamiento al hacer clic.
    const worker = manifest.background?.service_worker;
    assert.ok(worker && statSync(join(RAIZ, worker)).isFile(), "falta el service worker");
    const codigo = sinComentarios(readFileSync(join(RAIZ, worker), "utf8"), ".js");
    assert.match(codigo, /chrome\.sidePanel\s*\.setPanelBehavior\(\s*\{\s*openPanelOnActionClick:\s*true\s*\}\s*\)/);
    // setPanelBehavior existe desde Chrome 116.
    assert.ok(Number(manifest.minimum_chrome_version) >= 116, "minimum_chrome_version debe ser 116 o más");
  });
});

describe("lectura de Gmail (content script)", () => {
  const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));
  const codigoDe = (ruta) => sinComentarios(readFileSync(join(RAIZ, ruta), "utf8"), ".js");

  test("el content script corre solo en https://mail.google.com/*", () => {
    assert.equal(manifest.content_scripts.length, 1);
    const [script] = manifest.content_scripts;
    assert.deepEqual(script.matches, ["https://mail.google.com/*"]);
    assert.deepEqual(script.js, ["gmail/selectores.js", "gmail/lector.js"]);
    assert.equal(script.all_frames, undefined, "solo el marco principal");
    assert.equal(script.world, undefined, "debe correr en el mundo aislado, no en el de la página");
    for (const ruta of script.js) assert.ok(statSync(join(RAIZ, ruta)).isFile(), ruta);
  });

  test("solo lee: no guarda, no pide nada a internet, no escribe en la consola ni cambia la página", () => {
    const prohibidos = [
      /\bfetch\s*\(/, /XMLHttpRequest/, /\bchrome\.storage\b/, /\blocalStorage\b/, /\bsessionStorage\b/,
      /\bindexedDB\b/, /\bconsole\./, /\bpostMessage\s*\(/, /\bappendChild\b/, /\binsertBefore\b/,
      /\.remove\s*\(/, /\bsetAttribute\b/, /\bremoveAttribute\b/, /\bclassList\b/,
      /\.(textContent|innerText|value|src|href)\s*=(?!=)/,
    ];
    for (const ruta of manifest.content_scripts[0].js) {
      const codigo = codigoDe(ruta);
      for (const patron of prohibidos) assert.doesNotMatch(codigo, patron, `${ruta} usa ${patron}`);
    }
  });

  test("solo responde a mensajes de la propia extensión", () => {
    const codigo = codigoDe("gmail/lector.js");
    assert.match(codigo, /\.id !== chrome\.runtime\.id/);
    assert.match(codigo, /"leer-correo"/);
  });

  test("el panel no guarda el correo ni lo escribe en la consola", () => {
    const codigo = codigoDe("sidepanel/panel.js");
    for (const patron of [/\bconsole\./, /\bchrome\.storage\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/]) {
      assert.doesNotMatch(codigo, patron, `panel.js usa ${patron}`);
    }
  });

  test("solo almacen.js usa chrome.storage, y solo guarda urlApi y claveApi", () => {
    for (const { nombre, codigo } of leer(".js")) {
      if (nombre.replaceAll("\\", "/") !== "lib/almacen.js") {
        assert.doesNotMatch(codigo, /\bchrome\.storage\b/, `${nombre} usa chrome.storage`);
      }
    }
    const almacen = codigoDe("lib/almacen.js");
    assert.match(almacen, /const CLAVES = \{ url: "urlApi", clave: "claveApi" \};/);
    for (const [, claves] of almacen.matchAll(/chrome\.storage\.local\.set\(\{([^}]*)\}\)/g)) {
      assert.match(claves.trim(), /^\[CLAVES\.(url|clave)\]: \w+$/, "solo se guardan las claves de CLAVES");
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
