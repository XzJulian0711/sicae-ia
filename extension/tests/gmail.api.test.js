// Pruebas de extension/lib/gmail.js (paso 4.4): lectura con la API de Gmail SIMULADA.
// Los mensajes son INVENTADOS, con la forma JSON que devuelve users.messages.get (format=full).
// Nunca se habla con Google. Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CONCURRENCIA,
  MAX_CORREOS,
  MENSAJES_GMAIL,
  TOPE_PUBLICIDAD,
  URL_GMAIL,
  cabecera,
  crearClienteGmail,
  datosPromociones,
  decodificarBase64Url,
  direcciones,
  enParalelo,
  enlacesDeHtml,
  enlacesDeTexto,
  htmlATexto,
  interpretarErrorGmail,
  interpretarMensaje,
  leerBandeja,
  remitenteDe,
} from "../lib/gmail.js";

const TOKEN = "ya29.token-de-gmail-inventado";
const b64 = (texto) => Buffer.from(texto, "utf8").toString("base64url");

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
  test("lista los últimos 50 de Recibidos y lee cada uno, como máximo 5 a la vez", async () => {
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

  test("errores: sin permiso (403 de alcance), cuota (429) y sin red", async () => {
    const lista = `/messages?labelIds=INBOX&maxResults=${MAX_CORREOS}`;
    const casos = [
      [{ estado: 403, cuerpo: { error: { details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } } }, "sin_permiso"],
      [{ estado: 429 }, "cuota"],
      ["sin-red", "sin_red"],
    ];
    for (const [respuesta, codigo] of casos) {
      const r = await leerBandeja({ identidad: identidadFalsa(), pedir: gmailFalso({ respuestas: { [lista]: respuesta } }).pedir });
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
    const falla = crearClienteGmail({ identidad: identidadFalsa(), pedir: gmailFalso({ respuestas: { "/labels/CATEGORY_PROMOTIONS": { estado: 429 } } }).pedir });
    assert.equal(await datosPromociones(falla), null);
  });
});
