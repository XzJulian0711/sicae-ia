// Pruebas de extension/lib/logica.js con el ejecutor de pruebas de Node (sin paquetes).
// Correr desde la raíz:  node --test extension/tests/

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ORIGENES_PERMITIDOS,
  URL_POR_DEFECTO,
  interpretarClave,
  interpretarSalud,
  resultadoClaveSinConexion,
  resultadoSinClave,
  resultadoSinConexion,
  urlEstadisticas,
  urlSalud,
  validarClave,
  validarUrlApi,
} from "../lib/logica.js";

describe("validarUrlApi", () => {
  test("acepta la URL por defecto y la deja sin / final", () => {
    assert.deepEqual(validarUrlApi(URL_POR_DEFECTO), { ok: true, url: "http://127.0.0.1:8000" });
    assert.deepEqual(validarUrlApi("  http://127.0.0.1:8000/  "), { ok: true, url: "http://127.0.0.1:8000" });
  });

  test("solo acepta las direcciones de ORIGENES_PERMITIDOS (las del manifest)", () => {
    assert.deepEqual(ORIGENES_PERMITIDOS, ["http://127.0.0.1:8000"]);
    for (const origen of ORIGENES_PERMITIDOS) {
      assert.equal(validarUrlApi(origen).ok, true, origen);
    }
  });

  test("localhost se rechaza y el mensaje pide usar 127.0.0.1", () => {
    const r = validarUrlApi("http://localhost:8000");
    assert.equal(r.ok, false);
    assert.match(r.error, /127\.0\.0\.1/);
    assert.match(r.error, /localhost/);
  });

  test("otro puerto se rechaza y el mensaje explica que debe ser 8000", () => {
    const r = validarUrlApi("http://127.0.0.1:8080");
    assert.equal(r.ok, false);
    assert.match(r.error, /8000/);
  });

  test("https todavía no está permitido: el mensaje habla del manifest", () => {
    const r = validarUrlApi("https://api.example.edu");
    assert.equal(r.ok, false);
    assert.match(r.error, /manifest/);
  });

  test("http hacia otro equipo se rechaza", () => {
    const r = validarUrlApi("http://api.example.edu:8000");
    assert.equal(r.ok, false);
    assert.match(r.error, /127\.0\.0\.1:8000/);
  });

  test("rechaza otros protocolos", () => {
    for (const url of ["ftp://127.0.0.1", "javascript:alert(1)", "file:///C:/x", "chrome://extensions"]) {
      assert.equal(validarUrlApi(url).ok, false, url);
    }
  });

  test("rechaza usuario y contraseña, consulta, fragmento y rutas", () => {
    for (const url of [
      "http://usuario:clave@127.0.0.1:8000",
      "http://127.0.0.1:8000/?x=1",
      "http://127.0.0.1:8000/#a",
      "http://127.0.0.1:8000/salud",
    ]) {
      assert.equal(validarUrlApi(url).ok, false, url);
    }
  });

  test("rechaza vacío, texto que no es URL y valores que no son texto", () => {
    for (const valor of ["", "   ", "no es una url", null, undefined, 42]) {
      assert.equal(validarUrlApi(valor).ok, false, String(valor));
    }
  });
});

describe("urlSalud y urlEstadisticas", () => {
  test("agregan la ruta a la URL base", () => {
    assert.equal(urlSalud("http://127.0.0.1:8000"), "http://127.0.0.1:8000/salud");
    assert.equal(urlSalud("http://127.0.0.1:8000/"), "http://127.0.0.1:8000/salud");
    assert.equal(urlEstadisticas("http://127.0.0.1:8000/"), "http://127.0.0.1:8000/estadisticas");
  });
});

describe("interpretarClave", () => {
  test("200 es clave correcta", () => {
    assert.deepEqual(interpretarClave(200), { tipo: "clave_correcta", mensaje: "Clave correcta." });
  });

  test("401 es clave incorrecta y lleva a Opciones", () => {
    const r = interpretarClave(401);
    assert.equal(r.tipo, "clave_incorrecta");
    assert.match(r.mensaje, /Opciones/);
  });

  test("429 pide esperar", () => {
    const r = interpretarClave(429);
    assert.equal(r.tipo, "error");
    assert.match(r.mensaje, /espera/);
  });

  test("cualquier otro código da un mensaje genérico", () => {
    for (const estado of [500, 503, 404, 0]) {
      assert.deepEqual(interpretarClave(estado), { tipo: "error", mensaje: "No se pudo comprobar la clave." }, String(estado));
    }
  });

  test("sin conexión y sin clave tienen su propio mensaje", () => {
    assert.equal(resultadoClaveSinConexion().tipo, "error");
    const sinClave = resultadoSinClave();
    assert.equal(sinClave.tipo, "error");
    assert.match(sinClave.mensaje, /Opciones/);
  });
});

describe("validarClave", () => {
  test("acepta una clave larga sin espacios y quita espacios de los extremos", () => {
    const clave = "Ab3_xY-9kLmN0pQrStUvWxYz12345678";
    assert.deepEqual(validarClave(`  ${clave} `), { ok: true, clave });
  });

  test("rechaza vacía, corta o muy larga", () => {
    assert.equal(validarClave("").ok, false);
    assert.equal(validarClave("corta").ok, false);
    assert.equal(validarClave("x".repeat(257)).ok, false);
  });

  test("rechaza espacios internos y caracteres que no son ASCII visibles", () => {
    assert.equal(validarClave("clave con espacios 12345").ok, false);
    assert.equal(validarClave("contraseñamuylarga123456").ok, false);
    assert.equal(validarClave("clave\tcon-tabulador-1234").ok, false);
  });
});

describe("interpretarSalud", () => {
  test("conectado con la versión del modelo", () => {
    const r = interpretarSalud(200, { estado: "ok", modelo_cargado: true, version: "v1.0", detalle: null });
    assert.deepEqual(r, { tipo: "conectado", mensaje: "Conectado · modelo v1.0", version: "v1.0" });
  });

  test("una versión con forma rara se muestra como 'desconocida'", () => {
    const r = interpretarSalud(200, { estado: "ok", modelo_cargado: true, version: "<img src=x onerror=alert(1)>" });
    assert.equal(r.tipo, "conectado");
    assert.equal(r.version, "desconocida");
  });

  test("API arriba pero sin modelo", () => {
    const r = interpretarSalud(200, { estado: "sin_modelo", modelo_cargado: false, version: null, detalle: "x" });
    assert.equal(r.tipo, "sin_modelo");
    assert.equal(r.version, null);
    assert.doesNotMatch(r.mensaje, /x$/); // el detalle de la API no se muestra
  });

  test("cualquier otra respuesta es un error genérico", () => {
    for (const [estado, cuerpo] of [
      [500, { detalle: "Error interno" }],
      [404, null],
      [200, null],
      [200, "texto"],
      [200, { estado: "raro" }],
      [200, { estado: "ok", modelo_cargado: "si" }],
    ]) {
      const r = interpretarSalud(estado, cuerpo);
      assert.equal(r.tipo, "error", `${estado} ${JSON.stringify(cuerpo)}`);
      assert.match(r.mensaje, /inesperada/);
    }
  });
});

describe("resultadoSinConexion", () => {
  test("da un mensaje genérico sin detalles técnicos", () => {
    const r = resultadoSinConexion();
    assert.equal(r.tipo, "sin_conexion");
    assert.match(r.mensaje, /Sin conexión/);
  });
});
