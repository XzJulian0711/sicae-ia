// Pruebas de extension/lib/gmail.js (pasos 4.4 y 4.5): lectura, papelera y cuarentena con la API de Gmail SIMULADA.
// Los mensajes son INVENTADOS, con la forma JSON que devuelve users.messages.get (format=full).
// Nunca se habla con Google. Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONCURRENCIA,
  ESPERA_BASE_MS,
  ESPERA_MAX_MS,
  MAX_CORREOS,
  MENSAJES_GMAIL,
  NOMBRE_CUARENTENA,
  REINTENTOS_MAX,
  RAZONES_403_REINTENTABLES,
  RETRY_AFTER_MAX_MS,
  TOPE_PUBLICIDAD,
  URL_GMAIL,
  cabecera,
  CABECERAS_RESPUESTA,
  crearBorrador,
  crearClienteGmail,
  datosParaResponder,
  datosPromociones,
  decodificarBase64Url,
  direcciones,
  enParalelo,
  enlacesDeHtml,
  enlacesDeTexto,
  esReintentable,
  esperaReintento,
  esperaRetryAfter,
  htmlATexto,
  interpretarErrorGmail,
  interpretarMensaje,
  devolverARecibidos,
  leerBandeja,
  leerMensajes,
  listarIds,
  moverAPapelera,
  ponerEnCuarentena,
  remitenteDe,
  rutaPostPermitida,
  sacarDePapelera,
} from "../lib/gmail.js";

const TOKEN = "ya29.token-de-gmail-inventado";
const b64 = (texto) => Buffer.from(texto, "utf8").toString("base64url");
const sinEspera = async () => {}; // en las pruebas los reintentos no esperan de verdad

/** Doble de chrome.identity. */
function identidadFalsa(token = TOKEN) {
  const llamadas = { getAuthToken: [], removeCachedAuthToken: [] };
  let actual = token;
  return {
    llamadas,
    async getAuthToken(opciones) {
      llamadas.getAuthToken.push(opciones);
      if (actual instanceof Error) throw actual;
      return { token: actual };
    },
    async removeCachedAuthToken(detalles) {
      llamadas.removeCachedAuthToken.push(detalles);
      actual = `${TOKEN}-nuevo`;
    },
  };
}

/** Un mensaje de Gmail inventado. */
function mensaje(id, { asunto = `Asunto ${id}`, de = "Coordinación <coord@uni.example.edu>", para = "yo@example.org",
                     cc, partes, cabecerasExtra = [], fecha = 1_762_340_000_000, tamano = 5_000, etiquetas = ["INBOX"] } = {}) {
  const headers = [
    { name: "Subject", value: asunto },
    { name: "From", value: de },
    { name: "To", value: para },
    ...(cc ? [{ name: "Cc", value: cc }] : []),
    ...cabecerasExtra,
  ];
  return {
    id,
    internalDate: String(fecha),
    sizeEstimate: tamano,
    labelIds: etiquetas,
    payload: partes ?? { mimeType: "text/plain", headers, body: { data: b64(`Cuerpo del correo ${id}.`) } },
    ...(partes ? { payload: { ...partes, headers } } : {}),
  };
}

/** Doble de la API de Gmail: responde según la ruta; anota las llamadas y cuántas van a la vez. */
function gmailFalso({ mensajes = [], promociones = null, respuestas = {} } = {}) {
  const llamadas = [];
  let enCurso = 0;
  let maximo = 0;
  const pedir = async (url, opciones) => {
    llamadas.push({ url, opciones });
    enCurso += 1;
    maximo = Math.max(maximo, enCurso);
    await new Promise((r) => setTimeout(r, 1));
    enCurso -= 1;
    const ruta = url.slice(URL_GMAIL.length);
    const especial = respuestas[ruta];
    if (especial) {
      const r = typeof especial === "function" ? especial(opciones) : especial;
      if (r === "sin-red") throw new TypeError("Failed to fetch");
      return { status: r.estado, json: async () => r.cuerpo ?? {} };
    }
    if (ruta.startsWith("/messages?labelIds=INBOX")) {
      return { status: 200, json: async () => ({ messages: mensajes.map((m) => ({ id: m.id, threadId: m.id })) }) };
    }
    if (ruta === "/labels/CATEGORY_PROMOTIONS") {
      return promociones ? { status: 200, json: async () => ({ messagesTotal: promociones.total }) } : { status: 404, json: async () => ({}) };
    }
    if (ruta.startsWith("/messages?labelIds=CATEGORY_PROMOTIONS")) {
      return { status: 200, json: async () => ({ messages: promociones.ids.map((id) => ({ id })) }) };
    }
    const m = /^\/messages\/([\w-]+)\?format=(full|minimal)$/.exec(ruta);
    if (m && m[2] === "minimal") return { status: 200, json: async () => ({ id: m[1], sizeEstimate: 1024 }) };
    if (m) return { status: 200, json: async () => mensajes.find((x) => x.id === m[1]) };
    return { status: 404, json: async () => ({}) };
  };
  return { pedir, llamadas, get maximo() { return maximo; } };
}

describe("decodificar el contenido", () => {
  test("base64url con tildes y emoji", () => {
    assert.equal(decodificarBase64Url(b64("Reunión del comité 😀")), "Reunión del comité 😀");
    assert.equal(decodificarBase64Url(""), "");
  });

  test("respeta el charset de la parte (ISO-8859-1)", () => {
    const latin1 = Buffer.from("Reunión", "latin1").toString("base64url");
    assert.equal(decodificarBase64Url(latin1, "iso-8859-1"), "Reunión");
    assert.equal(decodificarBase64Url(b64("hola"), "charset-inventado"), "hola", "charset desconocido → UTF-8");
  });

  test("HTML → texto: sin script/style, con saltos y entidades", () => {
    const html = "<html><head><style>p{}</style></head><body><p>Hola&nbsp;Ana,</p><script>alert(1)</script>"
      + "<p>Pague &amp; listo<br>hoy &#191;s&iacute;? &#x263A; &Ntilde;and&uacute; &raro;</p></body></html>";
    assert.equal(htmlATexto(html), "Hola Ana,\nPague & listo\nhoy ¿sí? ☺ Ñandú &raro;");
  });

  test("enlaces: href de <a> y src de <img> del HTML; URLs del texto plano", () => {
    const html = '<a href="https://pagos.example.net/a?x=1&amp;y=2">x</a><img src="https://img.example.net/l.png">'
      + "<a href='#'>#</a><link href=\"https://no-cuenta.example\">";
    assert.deepEqual(enlacesDeHtml(html), ["https://pagos.example.net/a?x=1&y=2", "https://img.example.net/l.png", "#"]);
    assert.deepEqual(enlacesDeTexto("Ver https://a.example.org/x y www.b.example.org."), ["https://a.example.org/x", "www.b.example.org."]);
  });

  test("cabeceras, direcciones y remitente", () => {
    const cabeceras = [{ name: "list-unsubscribe", value: "<mailto:baja@example.net>" }];
    assert.equal(cabecera(cabeceras, "List-Unsubscribe"), "<mailto:baja@example.net>");
    assert.equal(cabecera(cabeceras, "Precedence"), "");
    assert.deepEqual(direcciones('"Ana, Pérez" <ana@example.org>, luis@example.org'), ["ana@example.org", "luis@example.org"]);
    assert.deepEqual(remitenteDe('"Coordinación académica" <coord@uni.example.edu>'), { nombre: "Coordinación académica", direccion: "coord@uni.example.edu" });
    assert.deepEqual(remitenteDe("solo@example.org"), { nombre: "solo@example.org", direccion: "solo@example.org" });
  });
});

describe("interpretarMensaje", () => {
  test("text/plain con destinatarios Para + CC y las cabeceras que importan", () => {
    const m = mensaje("a1", {
      cc: "luis@example.org",
      cabecerasExtra: [
        { name: "List-Unsubscribe", value: "<https://baja.example.net/x>" },
        { name: "List-Id", value: "<boletin.example.net>" },
        { name: "Precedence", value: "bulk" },
        { name: "In-Reply-To", value: "<anterior@example.org>" },
        { name: "X-Otra", value: "no se envía" },
      ],
    });
    const r = interpretarMensaje(m);
    assert.equal(r.id, "a1");
    assert.equal(r.remitenteNombre, "Coordinación");
    assert.deepEqual(r.correo.destinatarios, ["yo@example.org", "luis@example.org"]);
    assert.equal(r.correo.cuerpo, "Cuerpo del correo a1.");
    assert.deepEqual(r.correo.cabeceras, {
      "List-Unsubscribe": "<https://baja.example.net/x>",
      "List-Id": "<boletin.example.net>",
      Precedence: "bulk",
      "In-Reply-To": "<anterior@example.org>",
    });
    assert.equal(r.fecha, 1_762_340_000_000);
    assert.equal(r.tamano, 5_000);
  });

  test("multipart/alternative: usa el texto plano y cuenta los enlaces del HTML", () => {
    const partes = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Texto plano") } },
        { mimeType: "text/html", body: { data: b64('<p>Texto</p><a href="https://x.example">a</a><img src="https://y.example/i.png">') } },
      ],
    };
    const r = interpretarMensaje(mensaje("a2", { partes }));
    assert.equal(r.correo.cuerpo, "Texto plano");
    assert.deepEqual(r.correo.enlaces, ["https://x.example", "https://y.example/i.png"]);
  });

  test("solo HTML: lo convierte a texto", () => {
    const partes = { mimeType: "text/html", body: { data: b64("<p>Hola</p><p>Mundo</p>") } };
    assert.equal(interpretarMensaje(mensaje("a3", { partes })).correo.cuerpo, "Hola\nMundo");
  });

  test("cuenta los adjuntos sin abrirlos", () => {
    const partes = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Adjunto el acta.") } },
        { mimeType: "application/pdf", filename: "acta.pdf", body: { attachmentId: "x1", size: 2000 } },
        { mimeType: "image/png", filename: "foto.png", body: { attachmentId: "x2", size: 900 } },
      ],
    };
    const r = interpretarMensaje(mensaje("a4", { partes }));
    assert.equal(r.correo.nAdjuntos, 2);
    assert.equal(r.correo.cuerpo, "Adjunto el acta.");
  });

  test("cabeceras enormes se recortan a 2.000 caracteres", () => {
    const r = interpretarMensaje(mensaje("a5", { cabecerasExtra: [{ name: "List-Unsubscribe", value: "x".repeat(5000) }] }));
    assert.equal(r.correo.cabeceras["List-Unsubscribe"].length, 2000);
  });

  test("datos raros no lo rompen", () => {
    const r = interpretarMensaje({});
    assert.equal(r.correo.cuerpo, "");
    assert.deepEqual(r.correo.destinatarios, []);
  });
});

describe("errores de Gmail", () => {
  test("cada caso da su código y mensaje", () => {
    assert.equal(interpretarErrorGmail(401).codigo, "vencido");
    assert.equal(interpretarErrorGmail(429).codigo, "cuota");
    assert.equal(interpretarErrorGmail(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }).codigo, "cuota");
    assert.equal(interpretarErrorGmail(403, { error: { errors: [{ reason: "accessNotConfigured" }] } }).codigo, "api_apagada");
    const alcance = interpretarErrorGmail(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } });
    assert.equal(alcance.codigo, "sin_permiso");
    assert.equal(alcance.message, MENSAJES_GMAIL.sinPermiso);
    assert.equal(interpretarErrorGmail(500).codigo, "inesperada");
  });
});

describe("cliente de Gmail", () => {
  test("solo GET, con el token en Authorization y nunca en la URL", async () => {
    const gmail = gmailFalso({ mensajes: [mensaje("b1")] });
    const cliente = crearClienteGmail({ identidad: identidadFalsa(), pedir: gmail.pedir });
    await cliente.get("/messages/b1?format=full");
    const [{ url, opciones }] = gmail.llamadas;
    assert.equal(url, `${URL_GMAIL}/messages/b1?format=full`);
    assert.ok(!url.includes(TOKEN));
    assert.equal(opciones.method, "GET");
    assert.equal(opciones.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(opciones.credentials, "omit");
    assert.ok(opciones.signal instanceof AbortSignal);
  });

  test("401: quita el token de la caché y reintenta UNA vez con el nuevo", async () => {
    const identidad = identidadFalsa();
    let veces = 0;
    const gmail = gmailFalso({ respuestas: { "/labels/INBOX": () => (++veces === 1 ? { estado: 401 } : { estado: 200, cuerpo: { id: "INBOX" } }) } });
    const cliente = crearClienteGmail({ identidad, pedir: gmail.pedir });
    assert.deepEqual(await cliente.get("/labels/INBOX"), { id: "INBOX" });
    assert.deepEqual(identidad.llamadas.removeCachedAuthToken, [{ token: TOKEN }]);
    assert.equal(gmail.llamadas[1].opciones.headers.Authorization, `Bearer ${TOKEN}-nuevo`);

    const siempre = crearClienteGmail({ identidad: identidadFalsa(), pedir: gmailFalso({ respuestas: { "/x": { estado: 401 } } }).pedir });
    await assert.rejects(siempre.get("/x"), (e) => e.codigo === "vencido");
  });

  test("sin red, sin token y sin el alcance → errores con código", async () => {
    const sinRed = crearClienteGmail({ identidad: identidadFalsa(), pedir: gmailFalso({ respuestas: { "/x": "sin-red" } }).pedir });
    await assert.rejects(sinRed.get("/x"), (e) => e.codigo === "sin_red" && e.message === MENSAJES_GMAIL.sinRed);
    const sinToken = crearClienteGmail({ identidad: identidadFalsa(new Error("OAuth2 not granted or revoked.")), pedir: gmailFalso().pedir });
    await assert.rejects(sinToken.get("/x"), (e) => e.codigo === "sin_permiso");
  });

  test("enParalelo mantiene el orden y respeta el límite", async () => {
    let enCurso = 0;
    let maximo = 0;
    const r = await enParalelo([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      enCurso += 1;
      maximo = Math.max(maximo, enCurso);
      await new Promise((ok) => setTimeout(ok, 1));
      enCurso -= 1;
      return n * 10;
    });
    assert.deepEqual(r, [10, 20, 30, 40, 50, 60, 70]);
    assert.ok(maximo <= 3);
  });
});

describe("leerBandeja", () => {
  test("lista los últimos 50 de Recibidos y lee cada uno, como máximo 3 a la vez", async () => {
    assert.equal(CONCURRENCIA, 3);
    const mensajes = Array.from({ length: 12 }, (_, i) => mensaje(`m${i}`));
    const gmail = gmailFalso({ mensajes });
    const progreso = [];
    const r = await leerBandeja({ identidad: identidadFalsa(), pedir: gmail.pedir, alProgresar: (l, t) => progreso.push(`${l}/${t}`) });
    assert.equal(r.ok, true);
    assert.equal(r.mensajes.length, 12);
    assert.equal(r.mensajes[3].id, "m3", "en el orden de Gmail");
    assert.equal(gmail.llamadas[0].url, `${URL_GMAIL}/messages?labelIds=INBOX&maxResults=${MAX_CORREOS}`);
    assert.ok(gmail.maximo <= CONCURRENCIA, `a la vez: ${gmail.maximo}`);
    assert.equal(progreso[0], "0/12");
    assert.equal(progreso.at(-1), "12/12");
  });

  test("bandeja vacía → lista vacía", async () => {
    const r = await leerBandeja({ identidad: identidadFalsa(), pedir: gmailFalso().pedir });
    assert.deepEqual(r.mensajes, []);
  });

  test("ignora ids con forma rara (no se arman URLs con ellos)", async () => {
    const gmail = gmailFalso({ respuestas: { [`/messages?labelIds=INBOX&maxResults=${MAX_CORREOS}`]: { estado: 200, cuerpo: { messages: [{ id: "../../x" }, { id: "ok1" }] } } } });
    await leerBandeja({ identidad: identidadFalsa(), pedir: gmail.pedir });
    assert.ok(gmail.llamadas.every((l) => !l.url.includes("..")));
  });

  test("errores: sin permiso (403 de alcance), cuota (429, después de reintentar) y sin red", async () => {
    const lista = `/messages?labelIds=INBOX&maxResults=${MAX_CORREOS}`;
    const casos = [
      [{ estado: 403, cuerpo: { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } }, "sin_permiso"],
      [{ estado: 429 }, "cuota"],
      ["sin-red", "sin_red"],
    ];
    for (const [respuesta, codigo] of casos) {
      const r = await leerBandeja({ identidad: identidadFalsa(), pedir: gmailFalso({ respuestas: { [lista]: respuesta } }).pedir, esperar: sinEspera });
      assert.equal(r.ok, false);
      assert.equal(r.codigo, codigo);
      assert.ok(!JSON.stringify(r).includes(TOKEN));
    }
  });
});

describe("datosPromociones (Sobrecarga de publicidad)", () => {
  test("total exacto de la etiqueta y tamaño de hasta 100", async () => {
    const ids = Array.from({ length: TOPE_PUBLICIDAD }, (_, i) => `p${i}`);
    const gmail = gmailFalso({ promociones: { total: 1240, ids } });
    const cliente = crearClienteGmail({ identidad: identidadFalsa(), pedir: gmail.pedir });
    const r = await datosPromociones(cliente);
    assert.equal(r.total, 1240);
    assert.equal(r.tamanos.length, TOPE_PUBLICIDAD);
    assert.ok(gmail.llamadas.some((l) => l.url.endsWith(`labelIds=CATEGORY_PROMOTIONS&maxResults=${TOPE_PUBLICIDAD}`)));
    assert.ok(gmail.llamadas.filter((l) => l.url.endsWith("format=minimal")).length === TOPE_PUBLICIDAD);
  });

  test("sin categoría Promociones (404) → 0; error de Gmail → null", async () => {
    const sin = crearClienteGmail({ identidad: identidadFalsa(), pedir: gmailFalso().pedir });
    assert.deepEqual(await datosPromociones(sin), { total: 0, tamanos: [], ids: [] });
    const falla = crearClienteGmail({ identidad: identidadFalsa(), pedir: gmailFalso({ respuestas: { "/labels/CATEGORY_PROMOTIONS": { estado: 429 } } }).pedir, esperar: sinEspera });
    assert.equal(await datosPromociones(falla), null);
  });
});

// ===================== Paso 4.5: buscar, papelera y cuarentena =====================

/**
 * Doble mínimo de la API: `manejar(metodo, ruta, cuerpo)` → {estado, cuerpo, cabeceras} o
 * "sin-red". `cabeceras` (p. ej. {"Retry-After": "7"}) se leen con headers.get, como en fetch.
 */
function apiFalsa(manejar) {
  const llamadas = [];
  const pedir = async (url, opciones) => {
    const ruta = url.slice(URL_GMAIL.length);
    const cuerpo = opciones.body === undefined ? undefined : JSON.parse(opciones.body);
    llamadas.push({ metodo: opciones.method, ruta, cuerpo, headers: opciones.headers });
    await new Promise((r) => setTimeout(r, 1));
    const r = manejar(opciones.method, ruta, cuerpo) ?? { estado: 404 };
    if (r === "sin-red") throw new TypeError("Failed to fetch");
    const cabeceras = new Map(Object.entries(r.cabeceras ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      status: r.estado,
      headers: { get: (nombre) => cabeceras.get(nombre.toLowerCase()) ?? null },
      json: async () => (r.estado === 204 ? Promise.reject(new SyntaxError("vacío")) : (r.cuerpo ?? {})),
    };
  };
  return { pedir, llamadas };
}

const clienteCon = (api, opciones = {}) => crearClienteGmail({ identidad: identidadFalsa(), pedir: api.pedir, esperar: sinEspera, ...opciones });
const parametros = (ruta) => new URL(`https://x.example${ruta}`).searchParams;

describe("post(): solo las rutas permitidas", () => {
  test("acepta trash, untrash, batchModify, labels y crear un borrador (5); nada más", () => {
    for (const ruta of ["/messages/abc123/trash", "/messages/abc123/untrash", "/messages/batchModify", "/labels", "/drafts"]) {
      assert.equal(rutaPostPermitida(ruta), true, ruta);
    }
    // drafts.send, messages.send y cualquier otra ruta de borradores siguen bloqueadas.
    for (const ruta of ["/messages/abc123/delete", "/messages/batchDelete", "/messages/send", "/drafts/send", "/drafts/abc123",
                        "/drafts/abc123/send", "/drafts?x=1", "/drafts/", "/messages/import", "/messages", "/threads/abc/trash",
                        "/messages/a/b/trash", "/messages/abc/trash?x=1", "/settings/filters", null, undefined, 42]) {
      assert.equal(rutaPostPermitida(ruta), false, String(ruta));
    }
  });

  test("una ruta no permitida se rechaza SIN llamar a Gmail", async () => {
    const api = apiFalsa(() => ({ estado: 200 }));
    const cliente = clienteCon(api);
    for (const ruta of ["/messages/abc/delete", "/messages/send", "/messages/batchDelete"]) {
      await assert.rejects(cliente.post(ruta, {}), (e) => e.codigo === "ruta_no_permitida");
    }
    assert.equal(api.llamadas.length, 0);
  });

  test("el POST lleva el token en la cabecera, JSON y nada en la URL", async () => {
    const api = apiFalsa(() => ({ estado: 200, cuerpo: { id: "abc" } }));
    await clienteCon(api).post("/messages/abc/trash");
    const [llamada] = api.llamadas;
    assert.equal(llamada.metodo, "POST");
    assert.equal(llamada.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(llamada.headers["Content-Type"], "application/json");
    assert.ok(!llamada.ruta.includes(TOKEN));
  });
});

describe("listarIds (buscar candidatos)", () => {
  test("lleva etiquetas, q e includeSpamTrash", async () => {
    const api = apiFalsa(() => ({ estado: 200, cuerpo: { messages: [{ id: "s1" }, { id: "s2" }] } }));
    const ids = await listarIds(clienteCon(api), { labelIds: ["SPAM"], q: "older_than:6m larger:5M", includeSpamTrash: true, max: 10 });
    assert.deepEqual(ids, ["s1", "s2"]);
    const p = parametros(api.llamadas[0].ruta);
    assert.deepEqual(p.getAll("labelIds"), ["SPAM"]);
    assert.equal(p.get("q"), "older_than:6m larger:5M");
    assert.equal(p.get("includeSpamTrash"), "true");
    assert.equal(p.get("maxResults"), "10");
  });

  test("«Todo el correo»: sin etiqueta ni includeSpamTrash", async () => {
    const api = apiFalsa(() => ({ estado: 200, cuerpo: { messages: [] } }));
    await listarIds(clienteCon(api), { labelIds: [], q: "larger:5M", max: 25 });
    const p = parametros(api.llamadas[0].ruta);
    assert.equal(p.has("labelIds"), false);
    assert.equal(p.has("includeSpamTrash"), false);
  });

  test("sigue las páginas hasta el tope y descarta ids raros o repetidos", async () => {
    const paginas = {
      "": { messages: [{ id: "a1" }, { id: "a2" }, { id: "../x" }], nextPageToken: "p2" },
      p2: { messages: [{ id: "a2" }, { id: "a3" }, { id: "a4" }], nextPageToken: "p3" },
      p3: { messages: [{ id: "a5" }] },
    };
    const api = apiFalsa((_m, ruta) => ({ estado: 200, cuerpo: paginas[parametros(ruta).get("pageToken") ?? ""] }));
    assert.deepEqual(await listarIds(clienteCon(api), { labelIds: ["CATEGORY_PROMOTIONS"], max: 4 }), ["a1", "a2", "a3", "a4"]);
    assert.equal(api.llamadas.length, 2, "con 4 ya no pide la tercera página");
    assert.equal(parametros(api.llamadas[1].ruta).get("maxResults"), "2", "pide solo lo que falta");
  });

  test("cancelar para antes de la siguiente página", async () => {
    let paginasPedidas = 0;
    const api = apiFalsa(() => { paginasPedidas += 1; return { estado: 200, cuerpo: { messages: [{ id: `m${paginasPedidas}` }], nextPageToken: "otra" } }; });
    const ids = await listarIds(clienteCon(api), { max: 100 }, () => paginasPedidas >= 2);
    assert.deepEqual(ids, ["m1", "m2"]);
    assert.equal(api.llamadas.length, 2);
  });
});

describe("leerMensajes", () => {
  const api = () => apiFalsa((_m, ruta) => {
    const id = /^\/messages\/([\w-]+)\?format=full$/.exec(ruta)?.[1];
    return id ? { estado: 200, cuerpo: mensaje(id) } : { estado: 404 };
  });

  test("lee e interpreta cada uno, con progreso", async () => {
    const progreso = [];
    const leidos = await leerMensajes(clienteCon(api()), ["x1", "x2", "x3"], { alProgresar: (n, total) => progreso.push([n, total]) });
    assert.deepEqual(leidos.map((m) => m.id), ["x1", "x2", "x3"]);
    assert.equal(leidos[0].correo.asunto, "Asunto x1");
    assert.deepEqual(progreso.at(-1), [3, 3]);
  });

  test("cancelado no pide nada más", async () => {
    const a = api();
    assert.deepEqual(await leerMensajes(clienteCon(a), ["x1", "x2"], { cancelado: () => true }), []);
    assert.equal(a.llamadas.length, 0);
  });
});

describe("papelera y Deshacer", () => {
  test("mueve con messages.trash, uno por id; si alguno falla, sigue con los demás", async () => {
    const api = apiFalsa((metodo, ruta) => {
      if (ruta === "/messages/m2/trash") return { estado: 500 };
      if (ruta === "/messages/m4/trash") return "sin-red";
      return metodo === "POST" ? { estado: 200, cuerpo: { id: "ok" } } : { estado: 404 };
    });
    const progreso = [];
    const r = await moverAPapelera(clienteCon(api), ["m1", "m2", "m3", "m4", "m5"], (n, total) => progreso.push([n, total]));
    assert.deepEqual(r, { hechos: ["m1", "m3", "m5"], fallidos: ["m2", "m4"], sinPermiso: false });
    assert.deepEqual([...new Set(api.llamadas.map((l) => l.ruta))].sort(), ["m1", "m2", "m3", "m4", "m5"].map((id) => `/messages/${id}/trash`));
    // m2 (500 permanente) se intentó 1 + 5 veces; m4 (sin red) no se reintenta.
    assert.equal(api.llamadas.filter((l) => l.ruta === "/messages/m2/trash").length, 1 + REINTENTOS_MAX);
    assert.equal(api.llamadas.filter((l) => l.ruta === "/messages/m4/trash").length, 1);
    assert.ok(api.llamadas.every((l) => l.metodo === "POST"));
    assert.deepEqual(progreso.at(-1), [5, 5]);
  });

  test("un 429 permanente en un correo: queda en fallidos y los demás se mueven", async () => {
    const api = apiFalsa((_m, ruta) => (ruta === "/messages/q2/trash" ? { estado: 429 } : { estado: 200, cuerpo: {} }));
    const r = await moverAPapelera(clienteCon(api), ["q1", "q2", "q3"]);
    assert.deepEqual(r, { hechos: ["q1", "q3"], fallidos: ["q2"], sinPermiso: false });
  });

  test("un 429 pasajero en trash se recupera solo", async () => {
    let veces = 0;
    const api = apiFalsa(() => (++veces <= 2 ? { estado: 429 } : { estado: 200, cuerpo: {} }));
    assert.deepEqual(await moverAPapelera(clienteCon(api), ["r1"]), { hechos: ["r1"], fallidos: [], sinPermiso: false });
  });

  test("un id raro no llega a Gmail: cuenta como fallido", async () => {
    const api = apiFalsa(() => ({ estado: 200 }));
    const r = await moverAPapelera(clienteCon(api), ["bueno1", "../../labels"]);
    assert.deepEqual(r, { hechos: ["bueno1"], fallidos: ["../../labels"], sinPermiso: false });
    assert.equal(api.llamadas.length, 1);
  });

  test("Deshacer hace untrash de ESOS MISMOS ids", async () => {
    const api = apiFalsa(() => ({ estado: 200 }));
    const cliente = clienteCon(api);
    const movidos = await moverAPapelera(cliente, ["d1", "d2"]);
    const deshecho = await sacarDePapelera(cliente, movidos.hechos);
    assert.deepEqual(deshecho, { hechos: ["d1", "d2"], fallidos: [], sinPermiso: false });
    assert.deepEqual(api.llamadas.slice(2).map((l) => l.ruta).sort(), ["/messages/d1/untrash", "/messages/d2/untrash"]);
  });
});

describe("cuarentena (nunca a la papelera)", () => {
  function apiCuarentena({ existe }) {
    return apiFalsa((metodo, ruta) => {
      if (metodo === "GET" && ruta === "/labels") {
        return { estado: 200, cuerpo: { labels: [{ id: "INBOX", name: "INBOX" }, ...(existe ? [{ id: "Label_9", name: NOMBRE_CUARENTENA }] : [])] } };
      }
      if (metodo === "POST" && ruta === "/labels") return { estado: 200, cuerpo: { id: "Label_nueva", name: NOMBRE_CUARENTENA } };
      if (metodo === "POST" && ruta === "/messages/batchModify") return { estado: 204 };
      return { estado: 404 };
    });
  }

  test("crea la etiqueta si falta, la pone y quita INBOX", async () => {
    const api = apiCuarentena({ existe: false });
    const r = await ponerEnCuarentena(clienteCon(api), ["f1"]);
    assert.deepEqual(r, { etiqueta: "Label_nueva", ids: ["f1"] });
    const creada = api.llamadas.find((l) => l.metodo === "POST" && l.ruta === "/labels");
    assert.equal(creada.cuerpo.name, "SICAE/Cuarentena");
    const cambio = api.llamadas.find((l) => l.ruta === "/messages/batchModify");
    assert.deepEqual(cambio.cuerpo, { ids: ["f1"], addLabelIds: ["Label_nueva"], removeLabelIds: ["INBOX"] });
  });

  test("si la etiqueta ya existe, la reusa (no crea otra)", async () => {
    const api = apiCuarentena({ existe: true });
    const r = await ponerEnCuarentena(clienteCon(api), ["f1"]);
    assert.equal(r.etiqueta, "Label_9");
    assert.equal(api.llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/labels").length, 0);
  });

  test("ni la cuarentena ni Devolver llaman a trash", async () => {
    const api = apiCuarentena({ existe: true });
    const cliente = clienteCon(api);
    await ponerEnCuarentena(cliente, ["f1"]);
    await devolverARecibidos(cliente, ["f1"]);
    assert.ok(api.llamadas.every((l) => !/trash/i.test(l.ruta)));
  });

  test("Devolver a Recibidos: agrega INBOX y quita la etiqueta", async () => {
    const api = apiCuarentena({ existe: true });
    await devolverARecibidos(clienteCon(api), ["f1", "../x"]);
    const cambio = api.llamadas.find((l) => l.ruta === "/messages/batchModify");
    assert.deepEqual(cambio.cuerpo, { ids: ["f1"], addLabelIds: ["INBOX"], removeLabelIds: ["Label_9"] });
  });
});


// ===================== Reintentos ante 429 / 5xx (corrección del 4.5) =====================

/** Cliente que anota cada espera y cada aviso, sin esperar de verdad; azar fijo en 0,5. */
function clienteQueAnota(api) {
  const esperas = [];
  const avisos = [];
  const cliente = crearClienteGmail({
    identidad: identidadFalsa(),
    pedir: api.pedir,
    esperar: async (ms) => { esperas.push(ms); },
    azar: () => 0.5,
    alReintentar: (intento, ms) => avisos.push([intento, ms]),
  });
  return { cliente, esperas, avisos };
}

describe("reintentos: funciones puras", () => {
  test("qué se reintenta y qué no", () => {
    for (const estado of [429, 500, 502, 503, 504]) assert.equal(esReintentable(estado, null), true, String(estado));
    assert.equal(esReintentable(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }), true);
    assert.equal(esReintentable(403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }), true);
    assert.equal(esReintentable(403, { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }), false);
    assert.equal(esReintentable(403, { error: { errors: [{ reason: "accessNotConfigured" }] } }), false);
    for (const estado of [400, 401, 404, 409]) assert.equal(esReintentable(estado, null), false, String(estado));
    // soloLimite (crear la etiqueta): 429 sí, 5xx no.
    assert.equal(esReintentable(429, null, { soloLimite: true }), true);
    assert.equal(esReintentable(500, null, { soloLimite: true }), false);
  });

  test("espera exponencial con jitter y tope", () => {
    assert.equal(esperaReintento(0, { azar: () => 0 }), ESPERA_BASE_MS);
    assert.deepEqual([0, 1, 2, 3, 4].map((n) => esperaReintento(n, { azar: () => 0.5 })), [1500, 2500, 4500, 8500, 16500]);
    assert.equal(esperaReintento(10, { azar: () => 0.5 }), ESPERA_MAX_MS, "nunca más de 32 s");
    assert.ok(esperaReintento(2, { azar: () => 0.999 }) < 5000, "el jitter suma menos de 1 s");
    assert.equal(esperaReintento(0, { azar: () => "raro" }), ESPERA_BASE_MS);
    assert.equal(esperaReintento(3, { retryAfterMs: 7000 }), 7000, "Retry-After manda");
  });

  test("Retry-After en segundos o como fecha HTTP, entre 1 s y 60 s", () => {
    assert.equal(esperaRetryAfter("7"), 7000);
    assert.equal(esperaRetryAfter("0"), ESPERA_BASE_MS, "al menos 1 s");
    assert.equal(esperaRetryAfter("3600"), RETRY_AFTER_MAX_MS, "como máximo 60 s");
    const ahora = Date.parse("Wed, 04 Nov 2026 15:00:00 GMT");
    assert.equal(esperaRetryAfter("Wed, 04 Nov 2026 15:00:12 GMT", ahora), 12_000);
    assert.equal(esperaRetryAfter("Wed, 04 Nov 2026 14:00:00 GMT", ahora), ESPERA_BASE_MS, "fecha pasada → 1 s");
    for (const raro of [null, undefined, "", "7.5", "-3", "mañana", "7 segundos"]) {
      assert.equal(esperaRetryAfter(raro), null, String(raro));
    }
  });
});

describe("reintentos con Gmail simulado", () => {
  test("429 que se recupera: dos 429 y luego 200", async () => {
    let veces = 0;
    const api = apiFalsa(() => (++veces <= 2 ? { estado: 429 } : { estado: 200, cuerpo: { messages: [{ id: "a1" }] } }));
    const { cliente, esperas, avisos } = clienteQueAnota(api);
    assert.deepEqual(await listarIds(cliente, { max: 5 }), ["a1"]);
    assert.equal(api.llamadas.length, 3);
    assert.deepEqual(esperas, [1500, 2500]);
    assert.deepEqual(avisos, [[1, 1500], [2, 2500]]);
  });

  test("429 permanente: 1 + 5 intentos, esperas crecientes, y recién ahí el error de cuota", async () => {
    const api = apiFalsa(() => ({ estado: 429 }));
    const { cliente, esperas } = clienteQueAnota(api);
    await assert.rejects(cliente.get("/messages/x1?format=full"), (e) => e.codigo === "cuota" && e.message === MENSAJES_GMAIL.cuota);
    assert.equal(api.llamadas.length, 1 + REINTENTOS_MAX);
    assert.deepEqual(esperas, [1500, 2500, 4500, 8500, 16500]);
  });

  test("respeta Retry-After si viene", async () => {
    let veces = 0;
    const api = apiFalsa(() => (++veces === 1 ? { estado: 429, cabeceras: { "Retry-After": "7" } } : { estado: 200, cuerpo: { ok: 1 } }));
    const { cliente, esperas } = clienteQueAnota(api);
    assert.deepEqual(await cliente.get("/labels"), { ok: 1 });
    assert.deepEqual(esperas, [7000]);
  });

  test("Retry-After inválido o exagerado", async () => {
    let veces = 0;
    const api = apiFalsa(() => {
      veces += 1;
      if (veces === 1) return { estado: 503, cabeceras: { "Retry-After": "pronto" } };
      if (veces === 2) return { estado: 503, cabeceras: { "Retry-After": "86400" } };
      return { estado: 200, cuerpo: {} };
    });
    const { cliente, esperas } = clienteQueAnota(api);
    await cliente.get("/labels");
    assert.deepEqual(esperas, [1500, RETRY_AFTER_MAX_MS], "inválido → backoff; un día → 60 s");
  });

  test("503 y 403 de límite se reintentan; 400, 404, 403 de permiso y sin red no", async () => {
    for (const primero of [{ estado: 503 }, { estado: 403, cuerpo: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } }]) {
      let veces = 0;
      const api = apiFalsa(() => (++veces === 1 ? primero : { estado: 200, cuerpo: { ok: 1 } }));
      assert.deepEqual(await clienteQueAnota(api).cliente.get("/labels"), { ok: 1 });
    }
    const casos = [
      [{ estado: 400 }, "inesperada"],
      [{ estado: 403, cuerpo: { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } }, "sin_permiso"],
      ["sin-red", "sin_red"],
    ];
    for (const [respuesta, codigo] of casos) {
      const api = apiFalsa(() => respuesta);
      const { cliente, esperas } = clienteQueAnota(api);
      await assert.rejects(cliente.post("/messages/z1/trash"), (e) => e.codigo === codigo);
      assert.equal(api.llamadas.length, 1, codigo);
      assert.deepEqual(esperas, []);
    }
    const api404 = apiFalsa(() => ({ estado: 404 }));
    assert.equal(await clienteQueAnota(api404).cliente.get("/messages/z1?format=full"), null);
    assert.equal(api404.llamadas.length, 1);
  });

  test("crear la etiqueta (POST /labels) no se repite ante un 500, pero sí ante un 429", async () => {
    const con500 = apiFalsa((metodo) => (metodo === "GET" ? { estado: 200, cuerpo: { labels: [] } } : { estado: 500 }));
    await assert.rejects(ponerEnCuarentena(clienteQueAnota(con500).cliente, ["f1"]));
    assert.equal(con500.llamadas.filter((l) => l.metodo === "POST").length, 1);

    let veces = 0;
    const con429 = apiFalsa((metodo, ruta) => {
      if (metodo === "GET") return { estado: 200, cuerpo: { labels: [] } };
      if (ruta === "/labels") return ++veces === 1 ? { estado: 429 } : { estado: 200, cuerpo: { id: "Label_1" } };
      return { estado: 204 };
    });
    assert.equal((await ponerEnCuarentena(clienteQueAnota(con429).cliente, ["f1"])).etiqueta, "Label_1");
  });

  test("el 401 se renueva aparte y no gasta reintentos", async () => {
    let veces = 0;
    const api = apiFalsa(() => {
      veces += 1;
      if (veces === 1) return { estado: 429 };
      if (veces === 2) return { estado: 401 };
      return { estado: 200, cuerpo: { ok: 1 } };
    });
    const { cliente, esperas } = clienteQueAnota(api);
    assert.deepEqual(await cliente.get("/labels"), { ok: 1 });
    assert.deepEqual(esperas, [1500]);
    assert.equal(api.llamadas.at(-1).headers.Authorization, `Bearer ${TOKEN}-nuevo`);
  });

  test("leerBandeja avisa los reintentos y se recupera", async () => {
    const lista = `/messages?labelIds=INBOX&maxResults=${MAX_CORREOS}`;
    let veces = 0;
    const gmail = gmailFalso({
      mensajes: [mensaje("b1")],
      respuestas: { [lista]: () => (++veces === 1 ? { estado: 429 } : { estado: 200, cuerpo: { messages: [{ id: "b1" }] } }) },
    });
    const avisos = [];
    const r = await leerBandeja({ identidad: identidadFalsa(), pedir: gmail.pedir, esperar: sinEspera, alReintentar: (n) => avisos.push(n) });
    assert.equal(r.ok, true);
    assert.equal(r.mensajes.length, 1);
    assert.deepEqual(avisos, [1]);
    assert.equal(MENSAJES_GMAIL.reintentando, "Gmail pidió esperar, reintentando…");
  });
});

// ===================== El 403 se reintenta SOLO por límite de uso =====================

// Cuerpo real de Gmail cuando el token no tiene el alcance (p. ej. faltaba gmail.modify).
const CUERPO_SIN_PERMISO = {
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    errors: [{ message: "Insufficient Permission", domain: "global", reason: "insufficientPermissions" }],
    status: "PERMISSION_DENIED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
  },
};
const cuerpoLimite = (reason) => ({ error: { code: 403, errors: [{ domain: "usageLimits", reason }] } });

describe("403: reintentar solo con rateLimitExceeded / userRateLimitExceeded", () => {
  test("esReintentable: sí con las dos razones de límite; no con ningún otro 403", () => {
    assert.deepEqual([...RAZONES_403_REINTENTABLES], ["ratelimitexceeded", "userratelimitexceeded"]);
    assert.equal(esReintentable(403, cuerpoLimite("rateLimitExceeded")), true);
    assert.equal(esReintentable(403, cuerpoLimite("userRateLimitExceeded")), true);
    assert.equal(esReintentable(403, CUERPO_SIN_PERMISO), false, "permiso insuficiente");
    assert.equal(esReintentable(403, { error: { status: "RESOURCE_EXHAUSTED" } }), false, "solo las dos razones pedidas");
    assert.equal(esReintentable(403, cuerpoLimite("dailyLimitExceeded")), false);
    assert.equal(esReintentable(403, null), false, "403 sin cuerpo");
  });

  test("403 de permiso insuficiente: 1 solo pedido, sin esperas ni avisos, y el mensaje de «Dar permiso»", async () => {
    const api = apiFalsa(() => ({ estado: 403, cuerpo: CUERPO_SIN_PERMISO }));
    const { cliente, esperas, avisos } = clienteQueAnota(api);
    await assert.rejects(cliente.get("/messages?maxResults=10"),
                         (e) => e.codigo === "sin_permiso" && e.message === MENSAJES_GMAIL.sinPermiso);
    assert.equal(api.llamadas.length, 1);
    assert.deepEqual(esperas, []);
    assert.deepEqual(avisos, []);
    assert.match(MENSAJES_GMAIL.sinPermiso, /Dar permiso/);
  });

  test("403 rateLimitExceeded: se reintenta y se recupera", async () => {
    let veces = 0;
    const api = apiFalsa(() => (++veces === 1 ? { estado: 403, cuerpo: cuerpoLimite("rateLimitExceeded") } : { estado: 200, cuerpo: { ok: 1 } }));
    const { cliente, esperas, avisos } = clienteQueAnota(api);
    assert.deepEqual(await cliente.get("/labels"), { ok: 1 });
    assert.equal(api.llamadas.length, 2);
    assert.deepEqual(esperas, [1500]);
    assert.equal(avisos.length, 1);
  });

  test("leerBandeja con 403 de permiso: un pedido y codigo sin_permiso (el panel muestra «Dar permiso»)", async () => {
    const lista = `/messages?labelIds=INBOX&maxResults=${MAX_CORREOS}`;
    const gmail = gmailFalso({ respuestas: { [lista]: { estado: 403, cuerpo: CUERPO_SIN_PERMISO } } });
    const avisos = [];
    const r = await leerBandeja({ identidad: identidadFalsa(), pedir: gmail.pedir, esperar: sinEspera, alReintentar: () => avisos.push(1) });
    assert.deepEqual(r, { ok: false, codigo: "sin_permiso", mensaje: MENSAJES_GMAIL.sinPermiso });
    assert.equal(gmail.llamadas.length, 1);
    assert.deepEqual(avisos, []);
  });

  test("papelera con 403 de permiso: fallidos + sinPermiso, sin reintentos", async () => {
    const api = apiFalsa((_m, ruta) => (ruta === "/messages/s2/trash" ? { estado: 403, cuerpo: CUERPO_SIN_PERMISO } : { estado: 200, cuerpo: {} }));
    const { cliente, esperas } = clienteQueAnota(api);
    const r = await moverAPapelera(cliente, ["s1", "s2", "s3"]);
    assert.deepEqual(r, { hechos: ["s1", "s3"], fallidos: ["s2"], sinPermiso: true });
    assert.equal(api.llamadas.filter((l) => l.ruta === "/messages/s2/trash").length, 1);
    assert.deepEqual(esperas, []);
  });

  test("Deshacer con 403 de permiso también avisa sinPermiso", async () => {
    const api = apiFalsa(() => ({ estado: 403, cuerpo: CUERPO_SIN_PERMISO }));
    const r = await sacarDePapelera(clienteQueAnota(api).cliente, ["u1"]);
    assert.deepEqual(r, { hechos: [], fallidos: ["u1"], sinPermiso: true });
  });

  test("cuarentena con 403 de permiso: error sin_permiso, sin reintentos", async () => {
    const api = apiFalsa(() => ({ estado: 403, cuerpo: CUERPO_SIN_PERMISO }));
    const { cliente, esperas } = clienteQueAnota(api);
    await assert.rejects(ponerEnCuarentena(cliente, ["f1"]), (e) => e.codigo === "sin_permiso");
    assert.equal(api.llamadas.length, 1);
    assert.deepEqual(esperas, []);
  });
});

// ===================== Paso 6.3: borrador de respuesta en el mismo hilo =====================

describe("borrador de respuesta (drafts.create) en el MISMO hilo", () => {
  const METADATOS = {
    id: "18c0ffee",
    threadId: "18cHILO01",
    payload: {
      headers: [
        { name: "Message-Id", value: "<CAF123abc@mail.gmail.com>" },
        { name: "References", value: "<raiz@uni.example.edu>" },
        { name: "Subject", value: "Entrega del anteproyecto" },
        { name: "From", value: "Coordinación <coordinacion@uni.example.edu>" },
      ],
    },
  };

  test("datosParaResponder pide format=metadata con las 4 cabeceras y devuelve el threadId", async () => {
    const api = apiFalsa((metodo, ruta) => (metodo === "GET" && ruta.startsWith("/messages/18c0ffee?")
      ? { estado: 200, cuerpo: METADATOS } : { estado: 404 }));
    const datos = await datosParaResponder(clienteCon(api), "18c0ffee");
    assert.deepEqual(datos, {
      threadId: "18cHILO01",
      messageId: "<CAF123abc@mail.gmail.com>",
      references: "<raiz@uni.example.edu>",
      asunto: "Entrega del anteproyecto",
      de: "Coordinación <coordinacion@uni.example.edu>",
    });
    const p = parametros(api.llamadas[0].ruta);
    assert.equal(p.get("format"), "metadata");
    assert.deepEqual(p.getAll("metadataHeaders"), [...CABECERAS_RESPUESTA]);
    assert.deepEqual([...CABECERAS_RESPUESTA], ["Message-ID", "References", "Subject", "From"]);
  });

  test("sin threadId, id raro o correo que ya no existe → error, sin seguir", async () => {
    const sinHilo = apiFalsa(() => ({ estado: 200, cuerpo: { id: "x", payload: { headers: [] } } }));
    await assert.rejects(datosParaResponder(clienteCon(sinHilo), "18c0ffee"), (e) => e.codigo === "inesperada");
    const noExiste = apiFalsa(() => ({ estado: 404 }));
    await assert.rejects(datosParaResponder(clienteCon(noExiste), "18c0ffee"), (e) => e.codigo === "inesperada");
    const nada = apiFalsa(() => ({ estado: 200 }));
    await assert.rejects(datosParaResponder(clienteCon(nada), "../labels"));
    assert.equal(nada.llamadas.length, 0);
  });

  test("crearBorrador: POST /drafts con {message: {raw, threadId}}; nunca drafts/send", async () => {
    const api = apiFalsa((metodo, ruta) => (metodo === "POST" && ruta === "/drafts"
      ? { estado: 200, cuerpo: { id: "r-123", message: { id: "m1", threadId: "18cHILO01" } } } : { estado: 404 }));
    const r = await crearBorrador(clienteCon(api), { raw: "RnJvbTogYUBiLmNv", threadId: "18cHILO01" });
    assert.deepEqual(r, { id: "r-123" });
    assert.deepEqual(api.llamadas.map((l) => [l.metodo, l.ruta]), [["POST", "/drafts"]]);
    assert.deepEqual(api.llamadas[0].cuerpo, { message: { raw: "RnJvbTogYUBiLmNv", threadId: "18cHILO01" } });
    assert.ok(api.llamadas.every((l) => !/send/i.test(l.ruta)));
  });

  test("crearBorrador rechaza un raw que no es base64url o un threadId raro, sin llamar a Gmail", async () => {
    const api = apiFalsa(() => ({ estado: 200, cuerpo: { id: "x" } }));
    for (const malo of [{ raw: "con espacios", threadId: "h1" }, { raw: "YWJj+/=", threadId: "h1" }, { raw: "YWJj", threadId: "../x" }]) {
      await assert.rejects(crearBorrador(clienteCon(api), malo));
    }
    assert.equal(api.llamadas.length, 0);
  });
});
