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

import { AVISO_DEMO } from "../lib/redaccion.js";
import { VERSION_CONSENTIMIENTO } from "../lib/sesion.js";

const RAIZ = join(import.meta.dirname, "..");

// Los ÚNICOS enlaces a internet del HTML (pasos 4.6 y 6.3). Son navegación (abren una pestaña),
// no cargan nada.
const URL_POLITICA = "https://github.com/XzJulian0711/sicae-ia/blob/main/docs/privacidad.md";
const ENLACE_POLITICA = `<a class="enlace" href="${URL_POLITICA}" target="_blank" rel="noopener noreferrer">Política de privacidad</a>`;
const ENLACE_OLLAMA = '<a class="enlace" id="enlace-ollama" href="https://ollama.com/download" target="_blank" '
  + 'rel="noopener noreferrer" hidden>Descargar Ollama</a>';

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
    for (const { nombre, codigo: original } of [...leer(".html"), ...leer(".css")]) {
      // Las únicas excepciones son los enlaces EXACTOS a la política y a ollama.com (pruebas siguientes).
      const codigo = original.split(ENLACE_POLITICA).join("").split(ENLACE_OLLAMA).join("");
      assert.doesNotMatch(codigo, /\b(src|href)\s*=\s*["']?(https?:)?\/\//i, `${nombre} carga un recurso remoto`);
      assert.doesNotMatch(codigo, /url\(\s*["']?(https?:)?\/\//i, `${nombre} carga un recurso remoto`);
      assert.doesNotMatch(codigo, /@import/i, `${nombre} usa @import`);
    }
  });

  test("el enlace a la política: uno solo, en «Revisa los permisos», en pestaña nueva y sin referrer", () => {
    const todo = leer(".html").map(({ codigo }) => codigo).join("\n");
    assert.equal(todo.split(ENLACE_POLITICA).length - 1, 1, "exactamente un enlace a la política");
    const panel = readFileSync(join(RAIZ, "sidepanel", "panel.html"), "utf8");
    const permisos = /id="pantalla-permisos"[\s\S]*?<\/section>/.exec(panel)[0];
    assert.ok(permisos.includes(ENLACE_POLITICA), "está en la pantalla de permisos");
    // Es un <a> normal: no hace falta ningún permiso nuevo (la lista exacta del manifest se revisa aparte).
    const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));
    assert.ok(!(manifest.host_permissions ?? []).some((p) => p.includes("github.com")));
    assert.ok(!(manifest.permissions ?? []).includes("tabs"));
  });

  test("el enlace a ollama.com (paso 6.3): uno solo, oculto, en el error de Redactar, sin permisos", () => {
    const todo = leer(".html").map(({ codigo }) => codigo).join("\n");
    assert.equal(todo.split(ENLACE_OLLAMA).length - 1, 1, "exactamente un enlace a ollama.com");
    const panel = readFileSync(join(RAIZ, "sidepanel", "panel.html"), "utf8");
    const error = /id="redactar-error"[\s\S]*?<\/div>/.exec(panel)[0];
    assert.ok(error.includes(ENLACE_OLLAMA), "está dentro del error de Redactar");
    const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));
    assert.ok(!(manifest.host_permissions ?? []).some((p) => p.includes("ollama")));
  });
});

describe("política de privacidad (paso 4.6, docs/privacidad.md)", () => {
  const politica = readFileSync(join(RAIZ, "..", "docs", "privacidad.md"), "utf8");

  test("su versión es la del consentimiento", () => {
    const version = /^- \*\*Versión:\*\* (\S+)/m.exec(politica)?.[1];
    assert.equal(version, VERSION_CONSENTIMIENTO);
    assert.match(politica, new RegExp(`Esta es la \\*\\*versión ${VERSION_CONSENTIMIENTO}\\*\\*`));
  });

  test("tiene lo que pide el art. 13 del Decreto 1377 de 2013", () => {
    assert.match(politica, /^- \*\*Vigente desde:\*\* \d{1,2} de [a-z]+ de \d{4}$/m, "fecha de entrada en vigencia");
    assert.match(politica, /^## 1\. Responsable$/m);
    assert.match(politica, /\*\*Correo de contacto:\*\* \S+@\S+/);
    // Puede decir "Pendiente…", pero no quedar vacío.
    assert.match(politica, /^- \*\*Domicilio, dirección y teléfono:\*\* \S.+$/m);
    assert.match(politica, /\*\*Quién atiende peticiones, consultas y reclamos:\*\* \S/);
    assert.match(politica, /^## 2\. Qué datos se tratan y para qué$/m);
    assert.match(politica, /^## 7\. Tus derechos y cómo ejercerlos$/m);
    assert.match(politica, /^## 8\. Conservación \(período de vigencia de la base de datos\)$/m);
    for (const palabra of ["Retirar consentimiento", "DELETE /cuenta", "myaccount.google.com/permissions",
                           "10 días hábiles", "15 días hábiles", "Superintendencia de Industria y Comercio"]) {
      assert.ok(politica.includes(palabra), palabra);
    }
  });

  test("«Retirar consentimiento» también revoca el acceso de Google (política, Opciones y código)", () => {
    assert.match(politica, /\*\*revoca el acceso de SICAE-IA a tu cuenta de Google\*\*/);
    assert.doesNotMatch(politica, /\*\*no\*\* revoca el acceso de Google/, "ya no dice que no revoca");
    const opcionesHtml = readFileSync(join(RAIZ, "opciones", "opciones.html"), "utf8");
    assert.match(opcionesHtml, /Retirar el consentimiento borra tu cuenta en la API \(y sus sesiones\),\s+revoca el acceso de SICAE-IA/);
    const opciones = sinComentarios(readFileSync(join(RAIZ, "opciones", "opciones.js"), "utf8"), ".js");
    // Un solo camino, también sin URL de la API (antes ese caso no revocaba).
    assert.match(opciones, /const resultado = await retirarConsentimiento\(\{ identidad: chrome\.identity, pedir: fetch, base,/);
    assert.doesNotMatch(opciones, /Revisa la URL de la API para borrar tu cuenta/);
    const sesion = sinComentarios(readFileSync(join(RAIZ, "lib", "sesion.js"), "utf8"), ".js");
    const retirar = /export async function retirarConsentimiento[\s\S]*?\r?\n}\r?\n/.exec(sesion)[0];
    assert.ok(retirar.indexOf("borrarCuentaApi") < retirar.indexOf("cerrarSesion("), "DELETE /cuenta antes de revocar");
  });

  test("dice lo que hace el sistema: sesiones de 8 h, IA externa solo en el modo demostración, nunca borrado definitivo", () => {
    const config = readFileSync(join(RAIZ, "..", "api", "app", "config.py"), "utf8");
    const horas = /duracion_sesion_horas: int = (\d+)/.exec(config)[1];
    assert.match(politica, new RegExp(`\\*\\*Sesiones\\*\\* \\| ${horas} horas`));
    // Paso 6.3: la única excepción es el modo demostración (solo la cuenta de prueba).
    assert.match(politica, /No se envía nada a servicios de inteligencia artificial externos, \*\*salvo\*\* el modo demostración/);
    assert.match(politica, /Personas de Google pueden leerlo|personas pueden leerlo/);
    assert.match(politica, /drafts\.create/);
    assert.match(politica, /nunca se envía/i);
    assert.match(politica, /Nunca\*\* hay borrado definitivo ni envío/);
    assert.match(politica, /compromiso del equipo, no algo automático del código/);
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
    // Pasos 4.4, 4.5 y 6.3 (consentimiento v4): identificarte + leer + papelera/cuarentena + redactar.
    assert.equal((permisos.match(/class="permiso"/g) || []).length, 4, "solo los permisos que se piden hoy");
    assert.match(permisos, /Redactar borradores con un modelo de IA que funciona en tu equipo; el texto no sale de él\. Solo se guarda en Gmail como borrador si tú lo pides, y nunca se envía\./);
    // La nota del modo demostración se ve SIEMPRE (no se llama a la API antes de aceptar).
    assert.match(permisos, /<p class="suave nota-pequena" id="nota-modo-demo">Modo demostración \(opcional, solo la cuenta de prueba del proyecto\): envía el texto a Google Gemini\.<\/p>/);
    assert.doesNotMatch(/<p[^>]*id="nota-modo-demo"[^>]*>/.exec(permisos)[0], /hidden/);
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

  test("Bandeja (4.4) y Redactar (6.3) ya funcionan; Analizar es la actual al cargar", () => {
    assert.match(panel, /<button[^>]*id="nav-bandeja"/);
    assert.doesNotMatch(panel, /id="nav-bandeja"[^>]*aria-disabled/);
    assert.match(panel, /<button[^>]*id="nav-redactar"/);
    assert.doesNotMatch(panel, /id="nav-redactar"[^>]*aria-disabled/);
    assert.match(panel, /id="vista-redactar"[^>]*hidden/);
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

  test("el cliente solo llama con GET o POST, y los POST solo a las 5 rutas permitidas", () => {
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
      "/^\\/drafts$/", // paso 6.3: crear un borrador (drafts.create), NUNCA drafts/send
    ]);
  });

  test("ninguna ruta de Gmail borra de forma definitiva ni envía; drafts solo para CREAR", () => {
    assert.doesNotMatch(gmail, /\/(delete|batchDelete|send|import|insert)\b/i);
    // "/drafts" aparece SOLO en la lista de permitidas y en el POST de crearBorrador.
    assert.equal((gmail.match(/\/drafts\b/g) || []).length, 2, "solo /^\\/drafts$/ y post(\"/drafts\")");
    assert.match(gmail, /cliente\.post\("\/drafts", \{ message: \{ raw, threadId \} \}\)/);
    assert.doesNotMatch(gmail, /drafts\/|drafts\.send|messages\.send/);
  });

  test("la cuarentena usa batchModify y NUNCA trash", () => {
    // \r?\n: con core.autocrlf=true (Windows) Git saca los archivos con CRLF.
    const cuarentena = /export async function ponerEnCuarentena[\s\S]*?\r?\n}\r?\n/.exec(gmail)[0];
    const devolver = /export async function devolverARecibidos[\s\S]*?\r?\n}\r?\n/.exec(gmail)[0];
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

  test("nada de lo leído se guarda: ni gmail.js, ni bandeja.js, ni limpieza.js, ni redaccion.js usan almacenamiento", () => {
    for (const archivo of ["gmail.js", "bandeja.js", "limpieza.js", "redaccion.js"]) {
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

describe("Redactar (paso 6.3): demo oculto sin permiso, aviso con Cancelar, nada guardado", () => {
  const panelHtml = readFileSync(join(RAIZ, "sidepanel", "panel.html"), "utf8");
  const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
  const cuerpoDe = (codigo, nombre) => {
    const inicio = codigo.search(new RegExp(`\\n(async )?function ${nombre}\\(`));
    assert.ok(inicio >= 0, `falta ${nombre}`);
    const resto = codigo.slice(inicio + 1);
    const fin = resto.slice(1).search(/\n(async )?function /);
    return fin < 0 ? resto : resto.slice(0, fin + 1);
  };

  test("el interruptor del modo demostración viene oculto y apagado; solo lo muestra /redactar/proveedores", () => {
    assert.match(panelHtml, /<label class="interruptor" id="interruptor-demo" hidden>/);
    assert.match(panelHtml, /<input type="checkbox" role="switch" id="modo-demo">/);
    assert.doesNotMatch(/<input[^>]*id="modo-demo"[^>]*>/.exec(panelHtml)[0], /checked/);
    // Solo cargarProveedores() lo muestra, y solo con demostracion: true.
    const muestras = panel.match(/red\.interruptorDemo\.hidden = [^;]+;/g) ?? [];
    assert.deepEqual(muestras, ["red.interruptorDemo.hidden = true;", "red.interruptorDemo.hidden = !proveedores.demostracion;"]);
    assert.match(cuerpoDe(panel, "cargarProveedores"), /red\.modoDemo\.checked = false;/);
    // Al generar, el modo demo solo cuenta si el interruptor está a la vista.
    assert.match(cuerpoDe(panel, "generarBorrador"), /const demo = !red\.interruptorDemo\.hidden && red\.modoDemo\.checked;/);
  });

  test("cada generación con el modo demostración pide confirmar (Cancelar no envía nada)", () => {
    const dialogo = /<dialog[^>]*id="dialogo-demo"[\s\S]*?<\/dialog>/.exec(panelHtml)[0];
    assert.ok(dialogo.includes(`<p id="dialogo-demo-texto">${AVISO_DEMO}</p>`), "el texto exacto del aviso");
    assert.match(dialogo, /id="dialogo-demo-cancelar">Cancelar</);
    const generar = cuerpoDe(panel, "generarBorrador");
    assert.match(generar, /if \(demo && !\(await confirmarDemo\(\)\)\) return;/);
    assert.ok(generar.indexOf("confirmarDemo()") < generar.indexOf("pedirBorrador("), "se confirma ANTES de pedir");
    const confirmar = cuerpoDe(panel, "confirmarDemo");
    assert.match(confirmar, /dialogoDemoCancelar\.addEventListener\("click", \(\) => terminar\(false\)/);
    assert.match(confirmar, /addEventListener\("cancel", \(\) => terminar\(false\)/, "Escape también cancela");
  });

  test("el borrador va a un campo editable con .value y nada de Redactar va a storage ni a la consola", () => {
    assert.match(panelHtml, /<textarea class="campo-texto campo-borrador" id="borrador"/);
    assert.match(panelHtml, /<textarea class="campo-texto" id="indicacion" maxlength="500"/);
    assert.match(cuerpoDe(panel, "generarBorrador"), /red\.borrador\.value = resultado\.borrador;/);
    const inicio = panel.indexOf("const red = {");
    const seccion = panel.slice(inicio, panel.indexOf("function iniciarRedactar("));
    assert.ok(inicio > 0 && seccion.length > 1000);
    assert.doesNotMatch(seccion, /chrome\.storage|localStorage|sessionStorage|indexedDB|console\./);
    assert.doesNotMatch(seccion, /innerHTML|outerHTML|insertAdjacentHTML/);
    assert.match(panelHtml, /id="redactar-progreso"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(panelHtml, /id="contador-indicacion"[^>]*aria-live="polite"/);
  });

  test("insertar: datos de la API de Gmail, mismo hilo, y nunca un envío", () => {
    const insertar = cuerpoDe(panel, "insertarComoBorrador");
    assert.match(insertar, /datosParaResponder\(cliente, correoRedactar\.idGmail\)/);
    assert.match(insertar, /crearBorrador\(cliente, \{ raw: mime\.raw, threadId: datos\.threadId \}\)/);
    assert.match(insertar, /para: datos\.de/, "Para = el remitente original");
    assert.match(insertar, /inReplyTo: datos\.messageId/);
    assert.doesNotMatch(panel, /\bsend\b|drafts\/send/i);
  });

  test("no se pide ningún permiso nuevo (tampoco clipboardWrite: la copia ocurre dentro del clic)", () => {
    const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));
    assert.ok(!manifest.permissions.includes("clipboardWrite") && !manifest.permissions.includes("clipboardRead"));
    assert.match(cuerpoDe(panel, "copiarBorrador"), /navigator\.clipboard\.writeText\(red\.borrador\.value\)/);
  });
});

describe("prueba funcional (paso 7.1): diagnóstico y exportar, SOLO la cuenta de prueba", () => {
  const panelHtml = readFileSync(join(RAIZ, "sidepanel", "panel.html"), "utf8");
  const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
  const diagnostico = sinComentarios(readFileSync(join(RAIZ, "lib", "diagnostico.js"), "utf8"), ".js");
  const seccion = panel.slice(panel.indexOf("const d = {"), panel.indexOf("function iniciarHerramientasPrueba("));

  test("el diagnóstico y «Exportar CSV» vienen ocultos en el HTML", () => {
    assert.match(panelHtml, /<section class="caja diagnostico" id="diagnostico"[^>]*hidden>/);
    assert.match(panelHtml, /<div class="exportar" id="exportar" hidden>/);
    assert.match(panelHtml, /<div class="tabla-desplazable" id="diagnostico-resultado" hidden>/);
  });

  test("solo los muestra cuentaPrueba, que solo pone true GET /diagnostico/disponible", () => {
    const muestras = panel.match(/d\.(caja|exportar)\.hidden = [^;]+;/g) ?? [];
    assert.deepEqual(muestras, ["d.caja.hidden = !cuentaPrueba;", "d.exportar.hidden = !(cuentaPrueba && itemsBandeja.length > 0);"]);
    const asignaciones = panel.match(/cuentaPrueba = [^;]+;/g) ?? [];
    assert.deepEqual(asignaciones, [
      "cuentaPrueba = false;", // valor inicial
      "cuentaPrueba = intento.ok && interpretarDisponible(intento.respuesta.status, cuerpo);",
      "cuentaPrueba = false;", // si falla
      "cuentaPrueba = false;", // al cerrar sesión
    ]);
    assert.match(panel, /function ocultarCuenta\(\) \{\s*correoSesion = null;\s*olvidarCuentaPrueba\(\);/);
    assert.match(panel, /function exportarBandeja\(\) \{\s*if \(!cuentaPrueba \|\| itemsBandeja\.length === 0\) return;/);
  });

  test("nada se guarda ni va a la consola; todo se muestra con textContent", () => {
    assert.ok(seccion.length > 1000);
    for (const codigo of [seccion, diagnostico]) {
      assert.doesNotMatch(codigo, /chrome\.storage|localStorage|sessionStorage|indexedDB|console\./);
      assert.doesNotMatch(codigo, /innerHTML|outerHTML|insertAdjacentHTML/);
    }
    assert.match(seccion, /td\.textContent = valor;/);
  });

  test("el CSV es una descarga local: no pasa por la API ni pide el permiso downloads", () => {
    const exportar = seccion.slice(seccion.indexOf("function exportarBandeja("));
    assert.match(exportar, /URL\.createObjectURL\(new Blob\(\[csvBandeja\(itemsBandeja\)\]/);
    assert.match(exportar, /URL\.revokeObjectURL\(archivo\)/);
    assert.doesNotMatch(exportar, /pedir\(|fetch\(/);
    const manifest = JSON.parse(readFileSync(join(RAIZ, "manifest.json"), "utf8"));
    assert.ok(!manifest.permissions.includes("downloads"));
  });

  test("el CSV nunca lleva remitente, destinatarios ni cuerpo", () => {
    const funcion = diagnostico.slice(diagnostico.indexOf("export function csvBandeja("), diagnostico.indexOf("export function nombreArchivoCsv("));
    assert.doesNotMatch(funcion, /remitente|destinatarios|cuerpo\b|\.cuerpo/);
  });

  test("la tabla lee las celdas con celdasFila (no fila.<clave>) y tiene una columna por clave", async () => {
    const pintar = seccion.slice(seccion.indexOf("function pintarDiagnostico("), seccion.indexOf("async function compararPaginaConApi("));
    assert.match(pintar, /for \(const valor of celdasFila\(fila\)\)/);
    assert.deepEqual([...new Set(pintar.match(/fila\.\w+/g))], ["fila.nombre"], "solo el nombre se lee directo");
    const { COLUMNAS_DIAGNOSTICO } = await import("../lib/diagnostico.js");
    const encabezado = panelHtml.slice(panelHtml.indexOf('<table class="tabla-diagnostico">'), panelHtml.indexOf("</thead>"));
    const columnas = encabezado.match(/<th scope="col">/g) ?? [];
    assert.equal(columnas.length - 1, COLUMNAS_DIAGNOSTICO.length, "las columnas de panel.html, sin «Dato»");
  });
});

describe("Analizar lee con la API de Gmail, como la Bandeja (paso 7.1)", () => {
  const panelHtml = readFileSync(join(RAIZ, "sidepanel", "panel.html"), "utf8");
  const panel = sinComentarios(readFileSync(join(RAIZ, "sidepanel", "panel.js"), "utf8"), ".js");
  /** El código de una función de panel.js, hasta la siguiente función de primer nivel. */
  const funcion = (nombre) => {
    const inicio = panel.indexOf(`function ${nombre}(`);
    assert.ok(inicio >= 0, `falta ${nombre}`);
    const fin = panel.indexOf("\nfunction ", inicio + 1);
    return panel.slice(inicio, fin === -1 ? undefined : fin);
  };

  test("una sola forma de armar la petición: armarPeticionGmail (nada de armarPeticion suelto)", () => {
    assert.doesNotMatch(panel, /\barmarPeticion\(/);
    assert.doesNotMatch(panel, /MAX_BYTES_POR_CORREO_LOTE/);
    assert.match(funcion("actualizarBandeja"), /armarPeticionGmail\(m\.correo\)/);
    assert.match(panel, /lote\.map\(\(item\) => armarPeticionGmail\(item\.correo\)\)/, "Liberar espacio");
  });

  test("Analizar usa prepararAnalisis con leerMensajes (el lector de la Bandeja)", () => {
    const analizar = funcion("analizarCorreo");
    assert.match(analizar, /await prepararAnalisis\(lectura\.correo,/);
    assert.match(analizar, /leerMensajes\(clienteGmail\(/);
    assert.match(analizar, /mostrarResultado\(resultado, armado\.recortado, notaRespaldo\(armado\)\)/);
    // Nunca abre la ventana de Google (eso solo lo hace «Dar permiso»).
    assert.doesNotMatch(analizar, /iniciarSesion|pedirPermisoGmail|interactive/);
  });

  test("la nota del respaldo viene oculta y vacía; solo la llena notaRespaldo() (textos fijos)", () => {
    assert.match(panelHtml, /<p class="nota-respaldo" id="nota-respaldo" hidden><\/p>/);
    assert.deepEqual(panel.match(/notaRespaldo\.[a-zA-Z]+ = [^;]+;/g),
                     ["notaRespaldo.textContent = nota ?? \"\";", "notaRespaldo.hidden = !nota;"]);
    // Las únicas llamadas a mostrarResultado con nota pasan notaRespaldo(…); las demás, ninguna.
    const llamadas = panel.match(/(?<!function )mostrarResultado\([^)]*\)+/g) ?? [];
    assert.ok(llamadas.length >= 2, "Analizar y «Ver motivos» de la Bandeja");
    for (const llamada of llamadas) {
      const argumentos = llamada.split(",").length;
      if (argumentos >= 3) assert.match(llamada, /notaRespaldo\(armado\)/, llamada);
    }
  });

  test("el lector (content script) arma el cuerpo sin copiar ni cambiar la página", () => {
    const lector = sinComentarios(readFileSync(join(RAIZ, "gmail", "lector.js"), "utf8"), ".js");
    assert.doesNotMatch(lector, /cloneNode|appendChild|removeChild|replaceChild|insertBefore|\.remove\s*\(/);
    assert.match(lector, /function textoSin\(raiz, excluidos\)/);
  });
});
