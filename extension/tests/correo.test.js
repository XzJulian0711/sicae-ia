// Pruebas de extension/lib/correo.js con el ejecutor de pruebas de Node (sin paquetes).
// Los correos son inventados (dominios example.*).
// Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  MAX_ASUNTO,
  MAX_BYTES,
  MAX_CUERPO,
  MAX_DESTINATARIOS,
  armarPeticion,
  bytesJson,
  contarEnlaces,
  esPestanaGmail,
  interpretarAnalisis,
  interpretarLectura,
  recortarCuerpo,
  resultadoAnalisisSinConexion,
  urlAnalizar,
} from "../lib/correo.js";

const API = join(import.meta.dirname, "..", "..", "api", "app");

const CORREO = {
  asunto: "  Su paquete está detenido ",
  remitente: "avisos@example.net",
  destinatarios: ["ana@example.org"],
  cuerpo: "Pague la tasa de envío.",
  enlaces: ["https://pagos.example.net/tasa"],
  nAdjuntos: 0,
};

describe("coincide con la API (sin tocarla: solo se leen sus archivos)", () => {
  test("armarPeticion usa exactamente los campos de CorreoEntrada (esquemas.py)", () => {
    const esquemas = readFileSync(join(API, "esquemas.py"), "utf8");
    const clase = esquemas.slice(esquemas.indexOf("class CorreoEntrada"), esquemas.indexOf("return CorreoEntrada"));
    const campos = [...clase.matchAll(/^ {8}(\w+): [^\n]*= Field\(/gm)].map((m) => m[1]);
    assert.deepEqual(Object.keys(armarPeticion(CORREO).peticion).sort(), campos.sort());
  });

  test("los límites son los valores por defecto de config.py", () => {
    const config = readFileSync(join(API, "config.py"), "utf8");
    const valor = (nombre) => Number(new RegExp(`${nombre}: int = ([\\d_]+)`).exec(config)[1].replaceAll("_", ""));
    assert.equal(MAX_ASUNTO, valor("max_asunto"));
    assert.equal(MAX_CUERPO, valor("max_cuerpo"));
    assert.equal(MAX_DESTINATARIOS, valor("max_destinatarios"));
    assert.equal(MAX_BYTES, valor("max_bytes"));
  });
});

describe("esPestanaGmail", () => {
  test("solo https://mail.google.com/", () => {
    assert.equal(esPestanaGmail("https://mail.google.com/mail/u/0/#inbox/abc"), true);
    for (const url of [undefined, "", "http://mail.google.com/", "https://mail.google.com.example.net/", "https://example.org/"]) {
      assert.equal(esPestanaGmail(url), false, String(url));
    }
  });
});

describe("interpretarLectura", () => {
  test("correo leído", () => {
    assert.deepEqual(interpretarLectura({ ok: true, correo: CORREO }), { ok: true, correo: CORREO });
  });

  test("sin correo abierto pide abrir uno en Gmail", () => {
    const r = interpretarLectura({ ok: false, motivo: "sin_correo" });
    assert.equal(r.ok, false);
    assert.match(r.resultado.mensaje, /Abre un correo en Gmail/);
  });

  test("dice qué falta", () => {
    assert.match(interpretarLectura({ ok: false, motivo: "incompleto", falta: "remitente" }).resultado.mensaje, /remitente/);
    assert.match(interpretarLectura({ ok: false, motivo: "incompleto", falta: "cuerpo" }).resultado.mensaje, /texto del correo/);
  });

  test("cualquier otra respuesta da un mensaje genérico", () => {
    for (const respuesta of [undefined, null, {}, { ok: true }, { ok: false, motivo: "incompleto", falta: "<b>x</b>" }]) {
      const r = interpretarLectura(respuesta);
      assert.equal(r.ok, false);
      assert.match(r.resultado.mensaje, /No se pudo leer el correo/);
    }
  });
});

describe("contarEnlaces", () => {
  test("cuenta los distintos, incluidos # y mailto, sin vacíos", () => {
    assert.equal(contarEnlaces(["https://a.example", "https://a.example", "#", "mailto:x@example.org", "", "  ", null]), 3);
    assert.equal(contarEnlaces([]), 0);
    assert.equal(contarEnlaces(undefined), 0);
  });
});

describe("recortarCuerpo", () => {
  test("no toca un texto dentro del límite", () => {
    assert.deepEqual(recortarCuerpo("hola", 10), { texto: "hola", recortado: false });
  });

  test("recorta al límite y lo avisa", () => {
    const r = recortarCuerpo("x".repeat(MAX_CUERPO + 5));
    assert.equal(r.texto.length, MAX_CUERPO);
    assert.equal(r.recortado, true);
  });

  test("no parte un emoji por la mitad", () => {
    const r = recortarCuerpo("abc😀def", 4); // "abc" + la primera mitad del emoji
    assert.equal(r.texto, "abc");
    assert.equal(r.recortado, true);
  });
});

describe("armarPeticion", () => {
  test("arma el JSON de /analizar", () => {
    const r = armarPeticion(CORREO);
    assert.equal(r.ok, true);
    assert.equal(r.recortado, false);
    assert.deepEqual(r.peticion, {
      asunto: "Su paquete está detenido",
      cuerpo: "Pague la tasa de envío.",
      remitente: "avisos@example.net",
      destinatarios: ["ana@example.org"],
      cabeceras: {},
      n_urls: 1,
      n_adjuntos: 0,
    });
  });

  test("recorta el cuerpo largo y el asunto largo", () => {
    const r = armarPeticion({ ...CORREO, asunto: "a".repeat(MAX_ASUNTO + 1), cuerpo: "b".repeat(MAX_CUERPO + 1) });
    assert.equal(r.recortado, true);
    assert.equal(r.peticion.cuerpo.length, MAX_CUERPO);
    assert.equal(r.peticion.asunto.length, MAX_ASUNTO);
  });

  test("destinatarios: sin repetidos, sin inválidos y como máximo 100", () => {
    const r = armarPeticion({ ...CORREO, destinatarios: ["ana@example.org", "ANA@example.org", "no es correo", "", 42] });
    assert.deepEqual(r.peticion.destinatarios, ["ana@example.org"]);
    const muchos = Array.from({ length: 150 }, (_, i) => `u${i}@example.org`);
    assert.equal(armarPeticion({ ...CORREO, destinatarios: muchos }).peticion.destinatarios.length, MAX_DESTINATARIOS);
    assert.deepEqual(armarPeticion({ ...CORREO, destinatarios: undefined }).peticion.destinatarios, []);
  });

  test("remitente ausente o inválido → mensaje claro", () => {
    for (const remitente of ["", "sin-arroba", undefined, `${"x".repeat(320)}@example.org`]) {
      const r = armarPeticion({ ...CORREO, remitente });
      assert.equal(r.ok, false, String(remitente));
      assert.match(r.resultado.mensaje, /remitente/);
    }
    assert.equal(armarPeticion(null).ok, false);
  });

  test("valores raros se corrigen: adjuntos inválidos = 0, asunto y cuerpo no texto = vacío", () => {
    const r = armarPeticion({ ...CORREO, asunto: null, cuerpo: 5, nAdjuntos: -1 });
    assert.equal(r.peticion.asunto, "");
    assert.equal(r.peticion.cuerpo, "");
    assert.equal(r.peticion.n_adjuntos, 0);
    assert.equal(armarPeticion({ ...CORREO, nAdjuntos: 2.5 }).peticion.n_adjuntos, 0);
    assert.equal(armarPeticion({ ...CORREO, nAdjuntos: 3 }).peticion.n_adjuntos, 3);
  });
});

describe("armarPeticion: límite de bytes de la petición (MAX_BYTES)", () => {
  // El peor caso de los demás campos: asunto de 1.000 caracteres chinos y 100 destinatarios largos.
  const PESADO = {
    ...CORREO,
    asunto: "中".repeat(MAX_ASUNTO),
    destinatarios: Array.from({ length: MAX_DESTINATARIOS }, (_, i) => `${"u".repeat(300)}${i}@example.org`),
  };

  test("bytesJson mide UTF-8 del JSON completo", () => {
    assert.equal(bytesJson({ a: "ñ" }), 10); // {"a":"ñ"} → 8 caracteres, ñ ocupa 2 bytes
    assert.equal(bytesJson("😀"), 6); // 2 comillas + 4 bytes
    assert.equal(bytesJson("\u0001"), 8); // 2 comillas + \u0001 (6 bytes)
  });

  test("50.000 caracteres de control (6 bytes cada uno) se recortan al máximo que cabe", () => {
    const original = "\u0001".repeat(MAX_CUERPO);
    const r = armarPeticion({ ...PESADO, cuerpo: original });
    assert.equal(r.ok, true);
    assert.equal(r.recortado, true);
    assert.ok(bytesJson(r.peticion) <= MAX_BYTES, `${bytesJson(r.peticion)} bytes`);
    assert.ok(original.startsWith(r.peticion.cuerpo), "es el inicio del cuerpo");
    // Es el corte máximo: con un carácter más ya no cabría.
    const unoMas = { ...r.peticion, cuerpo: original.slice(0, r.peticion.cuerpo.length + 1) };
    assert.ok(bytesJson(unoMas) > MAX_BYTES);
  });

  test("50.000 caracteres chinos (≈185.000 bytes) caben: no se recortan por bytes", () => {
    const original = "中".repeat(MAX_CUERPO);
    const r = armarPeticion({ ...PESADO, cuerpo: original });
    assert.equal(r.recortado, false);
    assert.equal(r.peticion.cuerpo, original);
    assert.ok(bytesJson(r.peticion) <= MAX_BYTES);
  });

  test("un recorte por bytes no deja medio emoji", () => {
    // 120.000 bytes de controles + emojis: el corte cae en la zona de emojis.
    const original = "\u0001".repeat(20_000) + "😀".repeat(15_000);
    const r = armarPeticion({ ...PESADO, cuerpo: original });
    assert.equal(r.recortado, true);
    assert.ok(bytesJson(r.peticion) <= MAX_BYTES);
    const ultimo = r.peticion.cuerpo.charCodeAt(r.peticion.cuerpo.length - 1);
    assert.ok(!(ultimo >= 0xd800 && ultimo <= 0xdbff), "termina en medio de un emoji");
    assert.ok(r.peticion.cuerpo.endsWith("😀"));
  });

  test("un correo normal no cambia", () => {
    const r = armarPeticion(PESADO);
    assert.equal(r.recortado, false);
    assert.equal(r.peticion.cuerpo, CORREO.cuerpo);
  });
});

describe("urlAnalizar", () => {
  test("agrega la ruta a la URL base", () => {
    assert.equal(urlAnalizar("http://127.0.0.1:8000/"), "http://127.0.0.1:8000/analizar");
  });
});

describe("interpretarAnalisis", () => {
  const respuesta = (cambios) => ({ categoria: "legitimo", confianza: "alta", puntaje: -1.2, prioridad: "media", motivos: [], version: "v1.0", ...cambios });

  test("devuelve los valores validados y los motivos para la tarjeta", () => {
    const motivos = [{ codigo: "palabra:reunion", etiqueta: "Menciona «reunión»", origen: "modelo" }];
    assert.deepEqual(interpretarAnalisis(200, respuesta({ motivos })), {
      tipo: "resultado",
      categoria: "legitimo",
      confianza: "alta",
      prioridad: "media",
      motivos,
    });
  });

  test("phishing va sin prioridad (null)", () => {
    const r = interpretarAnalisis(200, respuesta({ categoria: "phishing", prioridad: null, confianza: "dudosa" }));
    assert.equal(r.tipo, "resultado");
    assert.equal(r.categoria, "phishing");
    assert.equal(r.prioridad, null);
    assert.equal(r.confianza, "dudosa");
  });

  test("publicidad, y motivos que no son lista quedan vacíos", () => {
    const r = interpretarAnalisis(200, respuesta({ categoria: "publicidad", prioridad: "baja", motivos: "texto" }));
    assert.equal(r.categoria, "publicidad");
    assert.deepEqual(r.motivos, []);
  });

  test("valores desconocidos no se muestran: respuesta inesperada", () => {
    for (const cuerpo of [null, "texto", respuesta({ categoria: "<img src=x>" }), respuesta({ prioridad: "urgente" }),
                          respuesta({ confianza: undefined }), respuesta({ categoria: "toString" })]) {
      const r = interpretarAnalisis(200, cuerpo);
      assert.equal(r.tipo, "error");
      assert.match(r.mensaje, /inesperada/);
    }
  });

  test("mensajes claros para 401, 413, 422, 429 y 503", () => {
    const esperado = { 401: /Clave incorrecta/, 413: /demasiado grande/, 422: /no aceptó/, 429: /espera un minuto/, 503: /modelo no está cargado/ };
    for (const [codigo, patron] of Object.entries(esperado)) {
      const r = interpretarAnalisis(Number(codigo), null);
      assert.equal(r.tipo, "error");
      assert.match(r.mensaje, patron, codigo);
    }
  });

  test("otros códigos y sin conexión dan mensajes genéricos", () => {
    assert.deepEqual(interpretarAnalisis(500, { detalle: "Error interno" }), { tipo: "error", mensaje: "No se pudo analizar el correo." });
    assert.match(resultadoAnalisisSinConexion().mensaje, /Sin conexión/);
  });
});
