// Pruebas de extension/lib/sesion.js (paso 4.2) con un DOBLE de chrome.identity y de fetch:
// funciones falsas que responden lo que la prueba decide y anotan cómo las llamaron.
// Nunca se habla con Google de verdad. Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MENSAJES_AUTH,
  MENSAJES_CIERRE,
  URL_REVOCAR,
  URL_USERINFO,
  VERSION_CONSENTIMIENTO,
  cerrarSesion,
  consentimientoValido,
  crearConsentimiento,
  haySesion,
  iniciarSesion,
  interpretarErrorAuth,
  interpretarUserinfo,
  obtenerCorreo,
  olvidarToken,
  pantallaInicial,
  pantallaTrasIniciarSesion,
} from "../lib/sesion.js";

const TOKEN = "ya29.token-inventado-para-pruebas";

/** Doble de chrome.identity. respuesta: lo que devuelve getAuthToken (o una función que lanza). */
function identidadFalsa(respuesta = { token: TOKEN }) {
  const llamadas = { getAuthToken: [], removeCachedAuthToken: [] };
  return {
    llamadas,
    async getAuthToken(opciones) {
      llamadas.getAuthToken.push(opciones);
      return typeof respuesta === "function" ? respuesta(opciones) : respuesta;
    },
    async removeCachedAuthToken(detalles) {
      llamadas.removeCachedAuthToken.push(detalles);
    },
  };
}

/** Doble de fetch: responde {ok} o lanza (sin red). */
function fetchFalso({ ok = true, lanza = false } = {}) {
  const llamadas = [];
  const pedir = async (url, opciones) => {
    llamadas.push({ url, opciones });
    if (lanza) throw new TypeError("Failed to fetch");
    return { ok, status: ok ? 200 : 400 };
  };
  return { pedir, llamadas };
}

const noContieneToken = (valor) => assert.ok(!JSON.stringify(valor).includes(TOKEN), "devolvió el token");

describe("consentimiento", () => {
  test("se guarda solo {aceptado, version, fecha}", () => {
    const c = crearConsentimiento(new Date("2026-11-05T10:00:00Z"));
    assert.deepEqual(c, { aceptado: true, version: VERSION_CONSENTIMIENTO, fecha: "2026-11-05T10:00:00.000Z" });
    assert.equal(consentimientoValido(c), true);
  });

  test("inválido si falta algo, no está aceptado, es de otra versión o trae campos de más", () => {
    const bueno = crearConsentimiento();
    for (const malo of [null, undefined, "si", [], {}, { ...bueno, aceptado: false }, { ...bueno, aceptado: "true" },
                        { ...bueno, version: "0" }, { ...bueno, fecha: "ayer" }, { aceptado: true, version: "1" },
                        { ...bueno, token: TOKEN }]) {
      assert.equal(consentimientoValido(malo), false, JSON.stringify(malo));
    }
  });
});

describe("qué pantalla se ve", () => {
  const valido = crearConsentimiento();

  test("al abrir: principal solo con sesión Y consentimiento válido", () => {
    assert.equal(pantallaInicial({ sesion: true, consentimiento: valido }), "principal");
    assert.equal(pantallaInicial({ sesion: true, consentimiento: null }), "bienvenida");
    assert.equal(pantallaInicial({ sesion: false, consentimiento: valido }), "bienvenida");
    assert.equal(pantallaInicial({ sesion: false, consentimiento: null }), "bienvenida");
    assert.equal(pantallaInicial({ sesion: true, consentimiento: { ...valido, version: "0" } }), "bienvenida");
  });

  test("después de iniciar sesión: permisos si aún no aceptó", () => {
    assert.equal(pantallaTrasIniciarSesion(valido), "principal");
    assert.equal(pantallaTrasIniciarSesion(null), "permisos");
  });
});

describe("iniciarSesion", () => {
  test("éxito → {ok: true}, con ventana (interactive: true) y SIN devolver el token", async () => {
    const identidad = identidadFalsa();
    const r = await iniciarSesion(identidad);
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(identidad.llamadas.getAuthToken, [{ interactive: true }]);
    noContieneToken(r);
  });

  test("funciona también con el formato viejo (token como texto)", async () => {
    assert.deepEqual(await iniciarSesion(identidadFalsa(TOKEN)), { ok: true });
  });

  test("sin token en la respuesta → mensaje genérico", async () => {
    assert.deepEqual(await iniciarSesion(identidadFalsa({})), { ok: false, mensaje: MENSAJES_AUTH.generico });
  });

  test("navegador sin chrome.identity.getAuthToken → usar Google Chrome", async () => {
    assert.deepEqual(await iniciarSesion(undefined), { ok: false, mensaje: MENSAJES_AUTH.navegador });
    assert.deepEqual(await iniciarSesion({}), { ok: false, mensaje: MENSAJES_AUTH.navegador });
  });

  test("cada error da su mensaje y nunca el texto crudo", async () => {
    const casos = [
      ["The user did not approve access.", MENSAJES_AUTH.cerrada],
      ["OAuth2 request failed: Service responded with error: 'access_denied'", MENSAJES_AUTH.noPrueba],
      ["Error 403: access blocked", MENSAJES_AUTH.noPrueba],
      ["Authorization page could not be loaded.", MENSAJES_AUTH.sinRed],
      ["algo raro <b>interno</b>", MENSAJES_AUTH.generico],
    ];
    for (const [texto, esperado] of casos) {
      const r = await iniciarSesion(identidadFalsa(() => { throw new Error(texto); }));
      assert.deepEqual(r, { ok: false, mensaje: esperado }, texto);
      assert.ok(!r.mensaje.includes(texto));
    }
  });

  test("sin red (navigator.onLine = false) manda el mensaje de conexión", async () => {
    const r = await iniciarSesion(identidadFalsa(() => { throw new Error("The user did not approve access."); }), false);
    assert.equal(r.mensaje, MENSAJES_AUTH.sinRed);
  });
});

describe("interpretarErrorAuth", () => {
  test("acepta errores que no son Error (texto o nada)", () => {
    assert.equal(interpretarErrorAuth("did not approve"), MENSAJES_AUTH.cerrada);
    assert.equal(interpretarErrorAuth(undefined), MENSAJES_AUTH.generico);
  });

  test("el mensaje de usuario de prueba explica qué hacer", () => {
    assert.match(MENSAJES_AUTH.noPrueba, /usuarios de prueba/);
    assert.match(MENSAJES_AUTH.cerrada, /Acceso bloqueado/);
  });
});

describe("haySesion (sin abrir ventanas)", () => {
  test("con token → true, y usa interactive: false", async () => {
    const identidad = identidadFalsa();
    assert.equal(await haySesion(identidad), true);
    assert.deepEqual(identidad.llamadas.getAuthToken, [{ interactive: false }]);
  });

  test("sin token, con error o sin chrome.identity → false", async () => {
    assert.equal(await haySesion(identidadFalsa({})), false);
    assert.equal(await haySesion(identidadFalsa(() => { throw new Error("OAuth2 not granted or revoked."); })), false);
    assert.equal(await haySesion(undefined), false);
  });

  test("si Chrome no responde a tiempo → false", async () => {
    const lenta = identidadFalsa(() => new Promise(() => {})); // nunca responde
    assert.equal(await haySesion(lenta, 20), false);
  });
});

describe("olvidarToken (Ahora no)", () => {
  test("quita el token de la caché, sin revocarlo", async () => {
    const identidad = identidadFalsa();
    assert.equal(await olvidarToken(identidad), undefined);
    assert.deepEqual(identidad.llamadas.removeCachedAuthToken, [{ token: TOKEN }]);
  });

  test("sin token no falla", async () => {
    await olvidarToken(identidadFalsa(() => { throw new Error("no token"); }));
    await olvidarToken(undefined);
  });
});

describe("interpretarUserinfo", () => {
  test("200 con un correo válido → {ok, correo}", () => {
    assert.deepEqual(interpretarUserinfo(200, { sub: "1", email: "sicae.pruebas.2026@gmail.com", email_verified: true }),
                     { ok: true, correo: "sicae.pruebas.2026@gmail.com" });
  });

  test("cualquier otra cosa → {ok: false}", () => {
    for (const [estado, cuerpo] of [
      [401, { email: "a@example.org" }],
      [200, null],
      [200, "texto"],
      [200, {}],
      [200, { email: "no-es-correo" }],
      [200, { email: "<img src=x>@example.org" }],
      [200, { email: `${"a".repeat(320)}@example.org` }],
      [200, { email: "a@example.org", email_verified: false }],
    ]) {
      assert.deepEqual(interpretarUserinfo(estado, cuerpo), { ok: false }, `${estado} ${JSON.stringify(cuerpo)}`);
    }
  });
});

describe("obtenerCorreo (para el encabezado)", () => {
  /** Doble de fetch para userinfo: responde los estados en orden. */
  function userinfoFalso(...respuestas) {
    const llamadas = [];
    const pedir = async (url, opciones) => {
      llamadas.push({ url, opciones });
      const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
      if (r === "sin-red") throw new TypeError("Failed to fetch");
      return { status: r.estado, json: async () => r.cuerpo };
    };
    return { pedir, llamadas };
  }
  const OK = { estado: 200, cuerpo: { email: "sicae.pruebas.2026@gmail.com", email_verified: true } };

  test("pide userinfo con el token en la cabecera Authorization (nunca en la URL) y devuelve solo el correo", async () => {
    const identidad = identidadFalsa();
    const red = userinfoFalso(OK);
    const r = await obtenerCorreo(identidad, red.pedir);
    assert.deepEqual(r, { ok: true, correo: "sicae.pruebas.2026@gmail.com" });
    assert.deepEqual(identidad.llamadas.getAuthToken, [{ interactive: false }]);
    assert.equal(red.llamadas.length, 1);
    const { url, opciones } = red.llamadas[0];
    assert.equal(url, URL_USERINFO);
    assert.ok(!url.includes(TOKEN));
    assert.equal(opciones.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(opciones.credentials, "omit");
    assert.ok(opciones.signal instanceof AbortSignal);
    noContieneToken(r);
  });

  test("sin token → no pide nada a Google", async () => {
    const red = userinfoFalso(OK);
    assert.deepEqual(await obtenerCorreo(identidadFalsa({}), red.pedir), { ok: false });
    assert.equal(red.llamadas.length, 0);
  });

  test("401 (token vencido): quita el token de la caché y reintenta UNA vez", async () => {
    const identidad = identidadFalsa();
    const red = userinfoFalso({ estado: 401 }, OK);
    assert.deepEqual(await obtenerCorreo(identidad, red.pedir), { ok: true, correo: "sicae.pruebas.2026@gmail.com" });
    assert.deepEqual(identidad.llamadas.removeCachedAuthToken, [{ token: TOKEN }]);
    assert.equal(red.llamadas.length, 2);

    const siempre401 = userinfoFalso({ estado: 401 });
    assert.deepEqual(await obtenerCorreo(identidadFalsa(), siempre401.pedir), { ok: false });
    assert.equal(siempre401.llamadas.length, 2, "no reintenta más de una vez");
  });

  test("error del servidor, sin red o sin chrome.identity → {ok: false}", async () => {
    assert.deepEqual(await obtenerCorreo(identidadFalsa(), userinfoFalso({ estado: 500 }).pedir), { ok: false });
    assert.deepEqual(await obtenerCorreo(identidadFalsa(), userinfoFalso("sin-red").pedir), { ok: false });
    assert.deepEqual(await obtenerCorreo(undefined, userinfoFalso(OK).pedir), { ok: false });
  });
});

describe("cerrarSesion", () => {
  test("quita la caché y revoca por POST con el token en el CUERPO, sin cookies", async () => {
    const identidad = identidadFalsa();
    const red = fetchFalso();
    const r = await cerrarSesion(identidad, red.pedir);
    assert.deepEqual(r, { ok: true, mensaje: MENSAJES_CIERRE.revocado });
    assert.deepEqual(identidad.llamadas.getAuthToken, [{ interactive: false }]);
    assert.deepEqual(identidad.llamadas.removeCachedAuthToken, [{ token: TOKEN }]);

    assert.equal(red.llamadas.length, 1);
    const { url, opciones } = red.llamadas[0];
    assert.equal(url, URL_REVOCAR);
    assert.ok(!url.includes(TOKEN), "el token no va en la URL");
    assert.equal(opciones.method, "POST");
    assert.equal(opciones.body, `token=${encodeURIComponent(TOKEN)}`);
    assert.equal(opciones.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(opciones.credentials, "omit");
    assert.ok(opciones.signal instanceof AbortSignal, "tiene tiempo máximo");
    noContieneToken(r);
  });

  test("sin sesión → no pide nada a Google", async () => {
    const red = fetchFalso();
    const r = await cerrarSesion(identidadFalsa({}), red.pedir);
    assert.deepEqual(r, { ok: true, mensaje: MENSAJES_CIERRE.sinSesion });
    assert.equal(red.llamadas.length, 0);
  });

  test("si Google no confirma o no hay red: la caché igual queda limpia y se explica cómo quitar el acceso", async () => {
    for (const red of [fetchFalso({ ok: false }), fetchFalso({ lanza: true })]) {
      const identidad = identidadFalsa();
      const r = await cerrarSesion(identidad, red.pedir);
      assert.deepEqual(r, { ok: false, mensaje: MENSAJES_CIERRE.noConfirmado });
      assert.match(r.mensaje, /myaccount\.google\.com\/permissions/);
      assert.deepEqual(identidad.llamadas.removeCachedAuthToken, [{ token: TOKEN }]);
      noContieneToken(r);
    }
  });

  test("navegador sin chrome.identity → mensaje de navegador", async () => {
    assert.deepEqual(await cerrarSesion(undefined, fetchFalso().pedir), { ok: false, mensaje: MENSAJES_AUTH.navegador });
  });
});
