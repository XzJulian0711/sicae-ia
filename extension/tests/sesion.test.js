// Pruebas de extension/lib/sesion.js (paso 4.2) con un DOBLE de chrome.identity y de fetch:
// funciones falsas que responden lo que la prueba decide y anotan cómo las llamaron.
// Nunca se habla con Google de verdad. Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MENSAJES_API,
  MENSAJES_AUTH,
  MENSAJES_CIERRE,
  MENSAJES_CUENTA,
  URL_REVOCAR,
  URL_USERINFO,
  VERSION_CONSENTIMIENTO,
  abrirSesionApi,
  asegurarSesionApi,
  borrarCuentaApi,
  cerrarSesion,
  cerrarSesionApi,
  cerrarSesionCompleta,
  conSesion,
  consentimientoValido,
  crearConsentimiento,
  haySesion,
  iniciarSesion,
  interpretarAuthApi,
  interpretarErrorAuth,
  interpretarUserinfo,
  obtenerCorreo,
  olvidarToken,
  pantallaInicial,
  pantallaTrasIniciarSesion,
  queHacerAnte403,
  registrarConsentimiento,
  retirarConsentimiento,
  sesionVigente,
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

describe("versión del consentimiento (paso 4.4: ahora se leen los correos)", () => {
  test("la versión es la 2: quien aceptó la 1 vuelve a ver Revisa los permisos", () => {
    assert.equal(VERSION_CONSENTIMIENTO, "2");
    assert.equal(consentimientoValido({ ...crearConsentimiento(), version: "1" }), false);
    assert.equal(consentimientoValido(crearConsentimiento()), true);
  });
});

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

describe("queHacerAnte403 (paso 4.3: /analizar sin consentimiento en la API)", () => {
  test("registra solo con un consentimiento aceptado de la MISMA versión del texto", () => {
    assert.equal(queHacerAnte403(crearConsentimiento()), "registrar");
  });

  test("otra versión, sin consentimiento o datos raros → vuelve a Revisa los permisos", () => {
    const bueno = crearConsentimiento();
    for (const local of [
      { ...bueno, version: "0" },
      { ...bueno, version: "1" }, // la del paso 4.2: el texto cambió en el 4.4
      { ...bueno, version: 1 },
      null,
      undefined,
      { ...bueno, aceptado: false },
      { aceptado: true, version: VERSION_CONSENTIMIENTO },
      { ...bueno, fecha: "ayer" },
      { ...bueno, token: TOKEN },
    ]) {
      assert.equal(queHacerAnte403(local), "pedir_permisos", JSON.stringify(local));
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

// ===================== Paso 4.3: sesión con la API =====================

const BASE = "http://127.0.0.1:8000";
const SESION = { token: "s".repeat(43), expira: "2026-11-05T16:00:00+00:00" };
const AHORA_MS = Date.parse("2026-11-05T08:00:00Z");
const OK_AUTH = { estado: 200, cuerpo: { token_sesion: SESION.token, expira: SESION.expira, consentimiento_version: null } };

/** Doble de fetch para la API: rutas = {"METODO /ruta": [respuestas en orden]}. */
function apiFalsa(rutas) {
  const llamadas = [];
  const pedir = async (url, opciones) => {
    const clave = `${opciones.method} ${new URL(url).pathname}`;
    llamadas.push({ clave, url, opciones });
    const lista = rutas[clave] ?? [{ estado: 404 }];
    const r = lista[Math.min(llamadas.filter((l) => l.clave === clave).length - 1, lista.length - 1)];
    if (r === "sin-red") throw new TypeError("Failed to fetch");
    return { status: r.estado, json: async () => r.cuerpo };
  };
  return { pedir, llamadas };
}

/** Doble de chrome.storage.session para la sesión de la API. */
function almacenFalso(inicial = null) {
  let valor = inicial;
  const registro = [];
  return {
    registro,
    get valor() { return valor; },
    leer: async () => valor,
    guardar: async (s) => { registro.push("guardar"); valor = { ...s }; },
    borrar: async () => { registro.push("borrar"); valor = null; },
  };
}

describe("sesionVigente e interpretarAuthApi", () => {
  test("vigente solo con forma correcta y si vence en más de 1 minuto", () => {
    assert.equal(sesionVigente(SESION, AHORA_MS), true);
    assert.equal(sesionVigente({ ...SESION, expira: "2026-11-05T08:00:30Z" }, AHORA_MS), false, "vence en 30 s");
    assert.equal(sesionVigente({ ...SESION, expira: "2026-11-05T07:00:00Z" }, AHORA_MS), false, "vencida");
    for (const mala of [null, {}, "texto", { token: "corto", expira: SESION.expira }, { token: SESION.token },
                        { token: "<script>".repeat(6), expira: SESION.expira }]) {
      assert.equal(sesionVigente(mala, AHORA_MS), false, JSON.stringify(mala));
    }
  });

  test("respuesta de /auth/google", () => {
    assert.deepEqual(interpretarAuthApi(200, OK_AUTH.cuerpo), { ok: true, sesion: SESION });
    assert.equal(interpretarAuthApi(200, { token_sesion: "x", expira: SESION.expira }).ok, false);
    assert.equal(interpretarAuthApi(200, null).mensaje, MENSAJES_API.inesperada);
    assert.equal(interpretarAuthApi(401).mensaje, MENSAJES_API.googleRechazo);
    assert.equal(interpretarAuthApi(503).mensaje, MENSAJES_API.googleCaido);
    assert.equal(interpretarAuthApi(429).mensaje, MENSAJES_API.limite);
  });
});

describe("abrirSesionApi", () => {
  test("manda el token de Google en Bearer a /auth/google y devuelve SOLO la sesión de la API", async () => {
    const api = apiFalsa({ "POST /auth/google": [OK_AUTH] });
    const r = await abrirSesionApi(identidadFalsa(), api.pedir, BASE);
    assert.deepEqual(r, { ok: true, sesion: SESION });
    noContieneToken(r);
    const [llamada] = api.llamadas;
    assert.equal(llamada.url, `${BASE}/auth/google`);
    assert.equal(llamada.opciones.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(!llamada.url.includes(TOKEN));
    assert.equal(llamada.opciones.credentials, "omit");
    assert.ok(llamada.opciones.signal instanceof AbortSignal);
  });

  test("sin token de Google no llama a la API", async () => {
    const api = apiFalsa({ "POST /auth/google": [OK_AUTH] });
    assert.deepEqual(await abrirSesionApi(identidadFalsa({}), api.pedir, BASE), { ok: false, mensaje: MENSAJES_API.sinSesionGoogle });
    assert.equal(api.llamadas.length, 0);
  });

  test("401: quita el token de Google de la caché y reintenta UNA vez", async () => {
    const identidad = identidadFalsa();
    const api = apiFalsa({ "POST /auth/google": [{ estado: 401 }, OK_AUTH] });
    assert.equal((await abrirSesionApi(identidad, api.pedir, BASE)).ok, true);
    assert.deepEqual(identidad.llamadas.removeCachedAuthToken, [{ token: TOKEN }]);

    const siempre = apiFalsa({ "POST /auth/google": [{ estado: 401 }] });
    assert.deepEqual(await abrirSesionApi(identidadFalsa(), siempre.pedir, BASE), { ok: false, mensaje: MENSAJES_API.googleRechazo });
    assert.equal(siempre.llamadas.length, 2);
  });

  test("Google caído (503) y sin red dan mensajes claros", async () => {
    const caido = apiFalsa({ "POST /auth/google": [{ estado: 503 }] });
    assert.equal((await abrirSesionApi(identidadFalsa(), caido.pedir, BASE)).mensaje, MENSAJES_API.googleCaido);
    const sinRed = apiFalsa({ "POST /auth/google": ["sin-red"] });
    assert.equal((await abrirSesionApi(identidadFalsa(), sinRed.pedir, BASE)).mensaje, MENSAJES_API.sinConexion);
  });
});

describe("consentimiento, cerrar y borrar en la API", () => {
  test("registrarConsentimiento: POST /consentimiento con {version} y Bearer de la sesión", async () => {
    const api = apiFalsa({ "POST /consentimiento": [{ estado: 204 }] });
    assert.deepEqual(await registrarConsentimiento(api.pedir, BASE, SESION, "1"), { ok: true });
    const { opciones } = api.llamadas[0];
    assert.equal(opciones.headers.Authorization, `Bearer ${SESION.token}`);
    assert.equal(opciones.headers["Content-Type"], "application/json");
    assert.equal(opciones.body, JSON.stringify({ version: "1" }));
    const sinRed = apiFalsa({ "POST /consentimiento": ["sin-red"] });
    assert.deepEqual(await registrarConsentimiento(sinRed.pedir, BASE, SESION, "1"), { ok: false });
  });

  test("cerrarSesionApi: 204 o 401 (ya cerrada) cuentan como cerrada", async () => {
    for (const estado of [204, 401]) {
      assert.deepEqual(await cerrarSesionApi(apiFalsa({ "POST /auth/cerrar": [{ estado }] }).pedir, BASE, SESION), { ok: true });
    }
    assert.deepEqual(await cerrarSesionApi(apiFalsa({ "POST /auth/cerrar": [{ estado: 503 }] }).pedir, BASE, SESION), { ok: false });
  });

  test("borrarCuentaApi: DELETE /cuenta con Bearer", async () => {
    const api = apiFalsa({ "DELETE /cuenta": [{ estado: 204 }] });
    assert.equal((await borrarCuentaApi(api.pedir, BASE, SESION)).status, 204);
    assert.equal(api.llamadas[0].opciones.headers.Authorization, `Bearer ${SESION.token}`);
  });
});

describe("asegurarSesionApi y conSesion", () => {
  const contexto = (api, almacen, version = "1") => ({
    identidad: identidadFalsa(), pedir: api.pedir, base: BASE, almacen, version, ahora: AHORA_MS,
  });

  test("usa la sesión guardada si sigue vigente (no llama a la API)", async () => {
    const api = apiFalsa({});
    assert.deepEqual(await asegurarSesionApi(contexto(api, almacenFalso(SESION))), { ok: true, sesion: SESION });
    assert.equal(api.llamadas.length, 0);
  });

  test("si no hay sesión: abre una, registra el consentimiento y la guarda", async () => {
    const api = apiFalsa({ "POST /auth/google": [OK_AUTH], "POST /consentimiento": [{ estado: 204 }] });
    const almacen = almacenFalso();
    assert.deepEqual(await asegurarSesionApi(contexto(api, almacen)), { ok: true, sesion: SESION });
    assert.deepEqual(api.llamadas.map((l) => l.clave), ["POST /auth/google", "POST /consentimiento"]);
    assert.deepEqual(almacen.valor, SESION);
  });

  test("sin versión de consentimiento no lo registra", async () => {
    const api = apiFalsa({ "POST /auth/google": [OK_AUTH] });
    await asegurarSesionApi(contexto(api, almacenFalso(), null));
    assert.deepEqual(api.llamadas.map((l) => l.clave), ["POST /auth/google"]);
  });

  test("conSesion: con 401 borra la sesión, abre otra y reintenta UNA vez", async () => {
    const api = apiFalsa({ "POST /auth/google": [OK_AUTH], "POST /consentimiento": [{ estado: 204 }] });
    const almacen = almacenFalso(SESION);
    const estados = [401, 200];
    const r = await conSesion(contexto(api, almacen), async () => ({ status: estados.shift() }));
    assert.equal(r.ok, true);
    assert.equal(r.respuesta.status, 200);
    assert.deepEqual(almacen.registro, ["borrar", "guardar"]);

    const siempre401 = await conSesion(contexto(api, almacenFalso(SESION)), async () => ({ status: 401 }));
    assert.equal(siempre401.ok, true);
    assert.equal(siempre401.respuesta.status, 401, "devuelve el segundo 401 sin seguir intentando");
  });

  test("conSesion: si no se puede abrir sesión, da el mensaje y no ejecuta la acción", async () => {
    let ejecutada = false;
    const r = await conSesion(contexto(apiFalsa({ "POST /auth/google": [{ estado: 503 }] }), almacenFalso()),
                              async () => { ejecutada = true; return { status: 200 }; });
    assert.deepEqual(r, { ok: false, mensaje: MENSAJES_API.googleCaido });
    assert.equal(ejecutada, false);
  });

  test("conSesion: sin red en la acción → sin conexión", async () => {
    const r = await conSesion(contexto(apiFalsa({}), almacenFalso(SESION)), async () => { throw new TypeError("Failed to fetch"); });
    assert.deepEqual(r, { ok: false, mensaje: MENSAJES_API.sinConexion });
  });
});

describe("cerrarSesionCompleta y retirarConsentimiento", () => {
  test("cerrar: /auth/cerrar, borra la sesión guardada y luego cierra la de Google", async () => {
    const identidad = identidadFalsa();
    const api = apiFalsa({ "POST /auth/cerrar": [{ estado: 204 }] });
    const pedir = async (url, opciones) => (url === URL_REVOCAR ? { ok: true, status: 200 } : api.pedir(url, opciones));
    const almacen = almacenFalso(SESION);
    const r = await cerrarSesionCompleta({ identidad, pedir, base: BASE, almacen });
    assert.deepEqual(r, { ok: true, mensaje: MENSAJES_CIERRE.revocado });
    assert.deepEqual(api.llamadas.map((l) => l.clave), ["POST /auth/cerrar"]);
    assert.equal(almacen.valor, null);
    assert.deepEqual(identidad.llamadas.removeCachedAuthToken, [{ token: TOKEN }]);
  });

  test("cerrar sin URL válida: no envía la sesión a la API, pero igual la borra y cierra Google", async () => {
    const api = apiFalsa({});
    const pedir = async (url, opciones) => (url === URL_REVOCAR ? { ok: true, status: 200 } : api.pedir(url, opciones));
    const almacen = almacenFalso(SESION);
    await cerrarSesionCompleta({ identidad: identidadFalsa(), pedir, base: null, almacen });
    assert.equal(api.llamadas.length, 0);
    assert.equal(almacen.valor, null);
  });

  test("retirar: DELETE /cuenta y borra la sesión y el consentimiento local", async () => {
    const api = apiFalsa({ "DELETE /cuenta": [{ estado: 204 }] });
    const almacen = almacenFalso(SESION);
    let localBorrado = false;
    const r = await retirarConsentimiento({ identidad: identidadFalsa(), pedir: api.pedir, base: BASE, almacen, ahora: AHORA_MS },
                                          async () => { localBorrado = true; });
    assert.deepEqual(r, { ok: true, mensaje: MENSAJES_CUENTA.borrada });
    assert.deepEqual(api.llamadas.map((l) => l.clave), ["DELETE /cuenta"]);
    assert.equal(almacen.valor, null);
    assert.equal(localBorrado, true);
  });

  test("retirar con la API apagada: igual se retira en este equipo y lo avisa", async () => {
    const almacen = almacenFalso(SESION);
    let localBorrado = false;
    const sinRed = apiFalsa({ "DELETE /cuenta": ["sin-red"] });
    const r = await retirarConsentimiento({ identidad: identidadFalsa(), pedir: sinRed.pedir, base: BASE, almacen, ahora: AHORA_MS },
                                          async () => { localBorrado = true; });
    assert.deepEqual(r, { ok: false, mensaje: MENSAJES_CUENTA.noConfirmada });
    assert.equal(almacen.valor, null);
    assert.equal(localBorrado, true);
  });
});
