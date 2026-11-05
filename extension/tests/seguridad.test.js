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

  test("3 pantallas; al cargar solo se ve la bienvenida (y la barra inferior está oculta)", () => {
    const abre = (id) => new RegExp(`<(?:section|div)[^>]*id="${id}"[^>]*>`).exec(panel)?.[0] ?? "";
    assert.doesNotMatch(abre("pantalla-bienvenida"), /\bhidden\b/);
    assert.match(abre("pantalla-permisos"), /\bhidden\b/);
    assert.match(abre("pantalla-principal"), /\bhidden\b/);
    assert.match(panel, /id="barra-inferior"[^>]*\bhidden\b/);
  });

  test("la bienvenida solo ofrece Google, y los permisos incluyen Nunca haremos y la Ley 1581", () => {
    const bienvenida = /id="pantalla-bienvenida"[\s\S]*?<\/section>/.exec(panel)[0];
    assert.match(bienvenida, /Continuar con Google/);
    assert.match(bienvenida, /Nunca te pedimos la contraseña de tu correo/);
    assert.doesNotMatch(bienvenida, /Microsoft|Outlook|Otro proveedor/i);
    assert.equal((bienvenida.match(/<li>/g) || []).length, 3, "3 beneficios");
    const permisos = /id="pantalla-permisos"[\s\S]*?<\/section>/.exec(panel)[0];
    // Pasos 4.4 y 4.5 (consentimiento v3): identificarte + leer tus correos + papelera/cuarentena.
    assert.equal((permisos.match(/class="permiso"/g) || []).length, 3, "solo los permisos que se piden hoy");
    assert.match(permisos, /Identificarte con tu correo de Google/);
    assert.match(permisos, /Leer tus correos para clasificarlos/);
    assert.match(permisos, /No guardamos su contenido/);
    assert.match(permisos, /Mover correos a la papelera o a cuarentena solo cuando lo confirmas\. Se puede deshacer\. Nunca borramos de forma definitiva\./);
    // Aclaración del paso 4.5 (sin subir la versión del consentimiento).
    assert.match(permisos, /Google describe este permiso como «leer, redactar y enviar»\. Es el mínimo que existe para mover a la papelera; SICAE-IA nunca envía ni borra correos de forma definitiva\./);
    assert.match(permisos, /Nunca haremos/);
    assert.match(permisos, /Ley 1581 de 2012/);
    assert.match(permisos, /id="ahora-no"[^>]*>Ahora no</);
    assert.match(permisos, /id="aceptar-permisos"[^>]*>Aceptar y continuar</);
  });

  test("la cuenta del encabezado abre un menú accesible con Cerrar sesión (oculto al cargar)", () => {
    assert.match(panel, /<button[^>]*id="cuenta"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="menu-cuenta"[^>]*hidden/);
    assert.match(panel, /id="menu-cuenta"[^>]*role="menu"[^>]*hidden/);
    assert.match(panel, /role="menuitem" id="menu-cerrar-sesion">Cerrar sesión</);
    assert.doesNotMatch(panel, /@gmail\.com/, "el correo no va escrito en el HTML: se pide en el momento");
  });

  test("los botones de solo ícono tienen nombre accesible", () => {
    assert.match(panel, /id="ir-opciones"[^>]*aria-label="Ajustes"/);
  });

  test("Bandeja ya funciona (4.4); Redactar sigue no disponible; Analizar es la actual al cargar", () => {
    assert.match(panel, /<button[^>]*id="nav-bandeja"/);
    assert.doesNotMatch(panel, /id="nav-bandeja"[^>]*aria-disabled/);
    assert.match(panel, /id="nav-redactar"[^>]*aria-disabled="true"/);
    assert.match(panel, /id="nav-analizar"[^>]*aria-current="page"/);
    assert.match(panel, /id="vista-bandeja"[^>]*hidden/);
  });

  test("Bandeja: liberar espacio ya funciona (4.5) y progreso/errores anunciados", () => {
    assert.match(panel, /<button[^>]*id="liberar-espacio"/);
    assert.doesNotMatch(panel, /id="liberar-espacio"[^>]*aria-disabled/);
    assert.match(panel, /id="bandeja-progreso"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(panel, /id="bandeja-error"[^>]*role="alert"/);
    assert.match(panel, /id="ver-motivos"[^>]*aria-expanded="false"[^>]*aria-controls="lista-phishing"/);
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
    // identity (paso 4.2): token de Google con la cuenta del navegador, sin contraseñas.
    assert.deepEqual(manifest.permissions, ["storage", "sidePanel", "identity"]);
    // oauth2.googleapis.com (paso 4.2): solo para revocar el token al cerrar sesión.
    // openidconnect.googleapis.com (paso 4.2): solo para leer el correo de la sesión (userinfo).
    assert.deepEqual(manifest.host_permissions, [
      "https://mail.google.com/*",
      "http://127.0.0.1:8000/*",
      "https://oauth2.googleapis.com/*",
      "https://openidconnect.googleapis.com/*",
      // gmail.googleapis.com (paso 4.4): solo para leer la bandeja con la API de Gmail (GET).
      "https://gmail.googleapis.com/*",
    ]);
  });

  test("oauth2: openid, email y gmail.modify (sin borrado definitivo); NUNCA mail.google.com/", () => {
    assert.match(manifest.oauth2.client_id, /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
    assert.deepEqual(manifest.oauth2.scopes, [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      // paso 4.5: lectura + papelera/etiquetas. "does not allow immediate, permanent deletion".
      "https://www.googleapis.com/auth/gmail.modify",
    ]);
    for (const alcance of manifest.oauth2.scopes) {
      // mail.google.com/ es el único que permite el borrado definitivo: prohibido.
      assert.doesNotMatch(alcance, /gmail\.(readonly|send|compose|insert|labels|settings)|mail\.google\.com\/?$/, alcance);
    }
    assert.deepEqual(Object.keys(manifest.oauth2).sort(), ["client_id", "scopes"]);
  });

  test("las direcciones de la API en logica.js coinciden con host_permissions", async () => {
    const { ORIGENES_PERMITIDOS } = await import("../lib/logica.js");
    const deLaApi = manifest.host_permissions
      .filter((permiso) => !/^https:\/\/(mail\.google\.com|oauth2\.googleapis\.com|openidconnect\.googleapis\.com|gmail\.googleapis\.com)\//.test(permiso))
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

  test("solo almacen.js usa chrome.storage: en local solo urlApi y consentimiento (ya no hay clave)", () => {
    for (const { nombre, codigo } of leer(".js")) {
      if (nombre.replaceAll("\\", "/") !== "lib/almacen.js") {
        assert.doesNotMatch(codigo, /\bchrome\.storage\b/, `${nombre} usa chrome.storage`);
      }
    }
    const almacen = codigoDe("lib/almacen.js");
    assert.match(almacen, /const CLAVES = \{ url: "urlApi", consentimiento: "consentimiento" \};/);
    assert.doesNotMatch(almacen, /claveApi/);
    const guardados = [...almacen.matchAll(/chrome\.storage\.local\.set\(\{\s*\[CLAVES\.(\w+)\]: (.+?) \}\);/g)];
    assert.equal(guardados.length, (almacen.match(/chrome\.storage\.local\.set\(/g) || []).length,
                 "cada set guarda una sola clave de CLAVES");
    for (const [, clave, valor] of guardados) {
      assert.ok(["url", "consentimiento"].includes(clave), clave);
      if (clave === "consentimiento") {
        // Del consentimiento solo se guardan estos 3 campos.
        assert.equal(valor.trim(), "{ aceptado, version, fecha }");
      }
    }
  });

  test("la sesión de la API va SOLO a chrome.storage.session (memoria), nunca a local", () => {
    const almacen = codigoDe("lib/almacen.js");
    assert.match(almacen, /const CLAVE_SESION = "sesionApi";/);
    const enSession = almacen.match(/chrome\.storage\.session\.\w+\([^)]*\)/g) || [];
    assert.equal(enSession.length, 3, "leer, guardar y borrar");
    for (const llamada of enSession) assert.match(llamada, /CLAVE_SESION/);
    assert.match(almacen, /chrome\.storage\.session\.set\(\{ \[CLAVE_SESION\]: \{ token, expira \} \}\)/);
    for (const llamada of almacen.match(/chrome\.storage\.local\.\w+\([^)]*\)/g) || []) {
      assert.doesNotMatch(llamada, /CLAVE_SESION|sesionApi|token/i, `local no guarda la sesión: ${llamada}`);
    }
  });

  test("el token de Google nunca se guarda, ni se escribe en la consola", () => {
    for (const { nombre, codigo } of leer(".js")) {
      for (const llamada of codigo.match(/chrome\.storage\.[\s\S]*?\)/g) || []) {
        // La única excepción es la sesión de la API ({token, expira}) en storage.session.
        if (!/^chrome\.storage\.session\.set\(\{ \[CLAVE_SESION\]: \{ token, expira \}/.test(llamada)) {
          assert.doesNotMatch(llamada, /token/i, `${nombre} guarda algo con "token"`);
        }
        assert.doesNotMatch(llamada, /correo|email/i, `${nombre} guarda el correo de la sesión`);
      }
      for (const llamada of codigo.match(/console\.\w+\([\s\S]*?\)/g) || []) {
        assert.doesNotMatch(llamada, /token/i, `${nombre} escribe un token en la consola`);
      }
      assert.doesNotMatch(codigo, /\b(localStorage|sessionStorage|indexedDB)\b/, `${nombre} usa otro almacenamiento`);
    }
  });
});

describe("Gmail (pasos 4.4 y 4.5): leer, papelera y cuarentena; NUNCA borrado definitivo ni envío", () => {
  const gmail = sinComentarios(readFileSync(join(RAIZ, "lib", "gmail.js"), "utf8"), ".js");

  test("el cliente solo llama con GET o POST, y los POST solo a las 4 rutas permitidas", () => {
    assert.match(gmail, /get: \(ruta\) => llamar\("GET", ruta\)/);
    assert.match(gmail, /return llamar\("POST", ruta, cuerpo\)/);
    assert.match(gmail, /if \(!rutaPostPermitida\(ruta\)\)/);
    assert.equal((gmail.match(/llamar\("(GET|POST)"/g) || []).length, 2, "solo GET y POST");
    const rutas = /RUTAS_POST_PERMITIDAS = Object\.freeze\(\[([\s\S]*?)\]\);/.exec(gmail)[1];
    assert.deepEqual(rutas.match(/\/\^[^,]*\$\//g), [
      "/^\\/messages\\/[\\w-]+\\/trash$/",
      "/^\\/messages\\/[\\w-]+\\/untrash$/",
      "/^\\/messages\\/batchModify$/",
      "/^\\/labels$/",
    ]);
  });

  test("ninguna ruta de Gmail borra de forma definitiva ni envía", () => {
    assert.doesNotMatch(gmail, /\/(delete|batchDelete|send|drafts|import|insert)\b/i);
  });

  test("la cuarentena usa batchModify y NUNCA trash", () => {
    const cuarentena = /export async function ponerEnCuarentena[\s\S]*?\n}\n/.exec(gmail)[0];
    const devolver = /export async function devolverARecibidos[\s\S]*?\n}\n/.exec(gmail)[0];
    for (const codigo of [cuarentena, devolver]) {
      assert.match(codigo, /\/messages\/batchModify/);
      assert.doesNotMatch(codigo, /trash/);
    }
  });

  test("el token de Gmail va en Authorization y nunca en la URL", () => {
    assert.match(gmail, /const cabeceras = \{ Authorization: `Bearer \$\{usado\}` \};/);
    assert.doesNotMatch(gmail, /access_token|[?&]token=|\$\{URL_GMAIL\}[^`]*\$\{(token|usado)\}/);
  });

  test("las rutas de Gmail solo usan ids con forma segura", () => {
    assert.match(gmail, /\/\^\[\\w-\]\+\$\/\.test\(id\)/);
  });

  test("nada de lo leído se guarda: ni gmail.js, ni bandeja.js, ni limpieza.js usan almacenamiento", () => {
    for (const archivo of ["gmail.js", "bandeja.js", "limpieza.js"]) {
      const codigo = sinComentarios(readFileSync(join(RAIZ, "lib", archivo), "utf8"), ".js");
      assert.doesNotMatch(codigo, /chrome\.storage|localStorage|sessionStorage|indexedDB|console\./, archivo);
    }
  });

  test("los ids de Deshacer y la cuarentena viven solo en memoria del panel", () => {
    const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
    assert.match(panel, /let ultimoMovimiento = null;/);
    assert.doesNotMatch(panel, /chrome\.storage/);
  });

  // Cuerpo de una función de panel.js (de su `function` hasta la siguiente función de primer nivel).
  const cuerpoDe = (codigo, nombre) => {
    const inicio = codigo.search(new RegExp(`\\n(async )?function ${nombre}\\(`));
    assert.ok(inicio >= 0, `falta ${nombre}`);
    const resto = codigo.slice(inicio + 1);
    const fin = resto.slice(1).search(/\n(async )?function /);
    return fin < 0 ? resto : resto.slice(0, fin + 1);
  };

  test("cada búsqueda nueva limpia el resultado anterior, pero conserva Deshacer", () => {
    const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
    const buscar = cuerpoDe(panel, "buscarParaLiberar");
    const primeras = buscar.split("\n").slice(1, 4).join("\n");
    assert.match(primeras, /limpiarResultadoPrevio\(\);/, "lo primero que hace la búsqueda");
    const limpiar = cuerpoDe(panel, "limpiarResultadoPrevio");
    assert.match(limpiar, /errorLiberar\(null\)/);
    assert.match(limpiar, /textoMovimiento\(null\)/);
    assert.match(limpiar, /l\.resultado\.hidden = true/);
    assert.doesNotMatch(limpiar, /ultimoMovimiento\s*=[^=]/, "no borra lo que se puede deshacer");
    assert.match(limpiar, /textoBotonDeshacer\(/);
    for (const nombre of ["moverSeleccionAPapelera", "deshacerMovimiento"]) {
      assert.match(cuerpoDe(panel, nombre), /errorLiberar\(null\)/, nombre);
    }
  });

  test("todos los clientes de Gmail del panel avisan los reintentos", () => {
    const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
    assert.equal((panel.match(/crearClienteGmail\(/g) ?? []).length, 1, "solo dentro de clienteGmail()");
    assert.match(cuerpoDe(panel, "clienteGmail"), /alReintentar: \(\) => mostrar\(MENSAJES_GMAIL\.reintentando\)/);
    assert.match(cuerpoDe(panel, "actualizarBandeja"), /alReintentar: \(\) => mostrarProgresoBandeja\(MENSAJES_GMAIL\.reintentando\)/);
  });

  test("un 403 de permiso muestra «Dar permiso» en Bandeja, Liberar espacio y cuarentena", () => {
    const html = readFileSync(join(RAIZ, "sidepanel", "panel.html"), "utf8");
    for (const id of ["dar-permiso-gmail", "liberar-dar-permiso", "cuarentena-dar-permiso"]) {
      assert.match(html, new RegExp(`id="${id}" hidden>Dar permiso</button>`), id);
    }
    const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
    const conPermiso = /\{ conPermiso: error\?\.codigo === "sin_permiso" \}/;
    for (const nombre of ["buscarParaLiberar", "moverSeleccionAPapelera", "deshacerMovimiento", "moverACuarentena", "devolverDeCuarentena"]) {
      assert.match(cuerpoDe(panel, nombre), conPermiso, nombre);
    }
    for (const nombre of ["moverSeleccionAPapelera", "deshacerMovimiento"]) {
      assert.match(cuerpoDe(panel, nombre), /if \(resultado\.sinPermiso\) errorLiberar\(MENSAJES_GMAIL\.sinPermiso, \{ conPermiso: true \}\)/, nombre);
    }
    // Dar permiso en Liberar espacio y en la cuarentena NO repite la acción sola.
    for (const nombre of ["darPermisoLiberar", "darPermisoCuarentena"]) {
      assert.doesNotMatch(cuerpoDe(panel, nombre), /moverAPapelera|sacarDePapelera|ponerEnCuarentena|devolverARecibidos|buscarParaLiberar/, nombre);
    }
  });
});

describe("NINGÚN borrado definitivo en TODO el código (paso 4.5)", () => {
  // Extensión (sin pruebas), API y herramientas: textos que harían un borrado definitivo de Gmail.
  const REPO = join(RAIZ, "..");
  const carpetas = [RAIZ, join(REPO, "api", "app"), join(REPO, "herramientas")];
  const codigo = carpetas.flatMap((carpeta) => archivos(carpeta))
    .filter((ruta) => /\.(js|py|html|json)$/.test(ruta))
    .map((ruta) => {
      const crudo = readFileSync(ruta, "utf8");
      // Sin comentarios: los comentarios NOMBRAN lo prohibido para explicarlo.
      const texto = ruta.endsWith(".js") ? sinComentarios(crudo, ".js")
        : ruta.endsWith(".html") ? sinComentarios(crudo, ".html")
          : ruta.endsWith(".py") ? crudo.replace(/#.*$/gm, "").replace(/"""[\s\S]*?"""/g, "") : crudo;
      return { nombre: relative(REPO, ruta), texto };
    });

  test("no aparecen batchDelete, messages.delete, threads.delete, emptyTrash ni mail.google.com/ como alcance", () => {
    assert.ok(codigo.length > 20, "se revisaron los archivos");
    for (const { nombre, texto } of codigo) {
      assert.doesNotMatch(texto, /batchDelete|messages\.delete|threads\.delete|emptyTrash/i, nombre);
      // El alcance de acceso total (el único que permite borrar sin pasar por la papelera). La
      // dirección https://mail.google.com/ sí aparece, pero como página de Gmail (pestaña y
      // host_permissions), nunca como alcance de OAuth.
      assert.doesNotMatch(texto, /scopes?["']?\s*[:=][^\n\]]*mail\.google\.com/i, `${nombre}: el alcance de acceso total está prohibido`);
    }
  });

  test("la única llamada DELETE es DELETE /cuenta de nuestra API (no Gmail)", () => {
    const deletes = [];
    for (const { nombre, texto } of codigo.filter((c) => c.nombre.endsWith(".js"))) {
      for (const m of texto.matchAll(/\b(method|metodo):\s*["']DELETE["']/gi)) {
        deletes.push(nombre);
        assert.ok(nombre.replaceAll("\\", "/").endsWith("lib/sesion.js"), `${nombre} hace un DELETE`);
        assert.match(texto.slice(Math.max(0, m.index - 120), m.index), /"\/cuenta"/, "el DELETE es DELETE /cuenta");
      }
    }
    assert.equal(deletes.length, 1, "hay exactamente un DELETE (borrar la cuenta en NUESTRA API)");
  });
});

describe("sesión con la API (paso 4.3)", () => {
  test("X-API-Key ya no se usa en ningún archivo de la extensión", () => {
    for (const { nombre, codigo } of [...leer(".js"), ...leer(".html")]) {
      assert.doesNotMatch(codigo, /X-API-Key|claveApi/i, `${nombre} todavía usa la clave de API`);
    }
  });

  test("un 403 de /analizar usa queHacerAnte403 y, sin consentimiento válido, vuelve a los permisos", () => {
    const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
    const bloque = /if \(intento\.ok && intento\.respuesta\.status === 403\) \{[\s\S]*?\n {4}\}/.exec(panel)?.[0] ?? "";
    assert.ok(bloque, "falta el manejo del 403");
    // La decisión va ANTES de registrar nada.
    assert.ok(bloque.indexOf("queHacerAnte403(await leerConsentimiento())") < bloque.indexOf("registrarConsentimiento("));
    assert.match(bloque, /!== "registrar"\) return \{ tipo: "pedir_permisos" \}/);
    assert.match(panel, /resultado\.tipo === "pedir_permisos"\) \{\s*mostrarPantalla\("permisos"\)/);
  });

  test("Opciones ya no tiene el campo de clave, solo la URL", () => {
    const opciones = sinComentarios(readFileSync(join(RAIZ, "opciones", "opciones.html"), "utf8"), ".html");
    assert.doesNotMatch(opciones, /type="password"|id="clave"|borrar-clave/);
    assert.match(opciones, /id="url"/);
    assert.match(opciones, /id="cerrar-sesion"/);
    assert.match(opciones, /id="retirar-consentimiento"/);
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
