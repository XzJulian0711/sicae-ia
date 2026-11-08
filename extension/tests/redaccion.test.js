// Pruebas de extension/lib/redaccion.js (paso 6.3, pestaña Redactar), con correos INVENTADOS.
// Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AVISO_DEMO,
  LARGO_MAX_INDICACION,
  MENSAJES_REDACCION,
  MENSAJE_BORRADOR_GUARDADO,
  armarMime,
  armarPeticionRedactar,
  asuntoRespuesta,
  base64Url,
  codificarRFC2047,
  direccionDe,
  enlaceBorradores,
  idMensajeValido,
  interpretarProveedores,
  interpretarRedaccion,
  limpiarCabecera,
  referenciasRespuesta,
  textoContador,
  textoProveedor,
  urlProveedores,
  urlRedactar,
} from "../lib/redaccion.js";

/** base64url (sin "=") → texto UTF-8, como lo leería Gmail. */
const deBase64Url = (raw) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** Decodifica las palabras "=?UTF-8?B?…?=" de un asunto (RFC 2047), uniendo las del plegado. */
function decodificarRFC2047(valor) {
  return valor.replace(/\r\n /g, "").replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_, b64) => `\u0000${b64}\u0000`)
    .split("\u0000").filter(Boolean)
    .map((parte) => (/^[A-Za-z0-9+/=]+$/.test(parte) ? Buffer.from(parte, "base64") : Buffer.from(parte)))
    .reduce((acc, b) => Buffer.concat([acc, b]), Buffer.alloc(0)).toString("utf8");
}

/** Separa un mensaje crudo en {cabeceras: [[nombre, valor]], cuerpo}, desplegando las líneas. */
function leerMime(raw) {
  const texto = deBase64Url(raw);
  const corte = texto.indexOf("\r\n\r\n");
  const lineas = texto.slice(0, corte).replace(/\r\n /g, " ").split("\r\n");
  return {
    texto,
    cabeceras: lineas.map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 2)]),
    cuerpo: Buffer.from(texto.slice(corte + 4).replace(/\r\n/g, ""), "base64").toString("utf8"),
  };
}

const BASE = {
  de: "Yo de Prueba <sicae.pruebas.2026@gmail.com>",
  para: "Coordinación Académica <coordinacion@uni.example.edu>",
  asunto: "Entrega del anteproyecto",
  inReplyTo: "<CAF123abc@mail.gmail.com>",
  references: "<raiz-1@uni.example.edu> <CAF000@mail.gmail.com>",
  cuerpo: "Buenos días.\n\nLes confirmamos la entrega el 6 de octubre. ¿Podrían indicarnos la fecha?\n\nCordialmente,",
};

describe("MIME del borrador (RFC 2822, UTF-8, base64url)", () => {
  test("cabeceras exactas, CRLF y cuerpo UTF-8 de ida y vuelta", () => {
    const r = armarMime(BASE);
    assert.equal(r.ok, true);
    assert.match(r.raw, /^[A-Za-z0-9_-]+$/, "base64url sin '=', '+' ni '/'");
    const { texto, cabeceras, cuerpo } = leerMime(r.raw);
    assert.deepEqual(cabeceras, [
      ["From", "sicae.pruebas.2026@gmail.com"],
      ["To", "coordinacion@uni.example.edu"],
      ["Subject", "Re: Entrega del anteproyecto"],
      ["In-Reply-To", "<CAF123abc@mail.gmail.com>"],
      ["References", "<raiz-1@uni.example.edu> <CAF000@mail.gmail.com> <CAF123abc@mail.gmail.com>"],
      ["MIME-Version", "1.0"],
      ["Content-Type", 'text/plain; charset="UTF-8"'],
      ["Content-Transfer-Encoding", "base64"],
    ]);
    assert.equal(cuerpo, BASE.cuerpo.replace(/\n/g, "\r\n"));
    assert.ok(!/(?<!\r)\n/.test(texto), "todas las líneas terminan en CRLF");
    assert.ok(texto.split("\r\n").every((l) => l.length <= 998), "ninguna línea pasa de 998");
  });

  test("tildes y emoji en el cuerpo, en líneas de base64 de 76", () => {
    const r = armarMime({ ...BASE, cuerpo: "Ñandú, café y 😀 ".repeat(30) });
    const { texto, cuerpo } = leerMime(r.raw);
    assert.equal(cuerpo, "Ñandú, café y 😀 ".repeat(30));
    const lineasCuerpo = texto.slice(texto.indexOf("\r\n\r\n") + 4).trim().split("\r\n");
    assert.ok(lineasCuerpo.every((l) => l.length <= 76));
  });

  test("sin De o Para válidos no se arma nada", () => {
    assert.deepEqual(armarMime({ ...BASE, de: "" }), { ok: false, motivo: "remitente" });
    assert.deepEqual(armarMime({ ...BASE, para: "no es correo" }), { ok: false, motivo: "destinatario" });
  });

  test("base64Url: UTF-8 y sin relleno", () => {
    assert.equal(deBase64Url(base64Url("¿Sí? 😀")), "¿Sí? 😀");
    assert.ok(!base64Url("a").includes("="));
  });
});

describe("asunto (RFC 2047) y «Re:»", () => {
  test("«Re:» sin duplicar", () => {
    assert.equal(asuntoRespuesta("Entrega"), "Re: Entrega");
    for (const ya of ["Re: Entrega", "RE: Entrega", "re : Entrega", "Re:Entrega"]) assert.equal(asuntoRespuesta(ya), ya);
    assert.equal(asuntoRespuesta(""), "Re:");
    assert.equal(asuntoRespuesta("Reunión"), "Re: Reunión", "«Reunión» no es un «Re:»");
  });

  test("ASCII queda igual; con tildes y emoji se codifica y se puede decodificar", () => {
    assert.equal(codificarRFC2047("Re: Entrega del anteproyecto"), "Re: Entrega del anteproyecto");
    const asunto = "Re: Observaciones al anteproyecto — revisión 😀 ñandú ".repeat(4).trim();
    const codificado = codificarRFC2047(asunto);
    assert.match(codificado, /^=\?UTF-8\?B\?/);
    assert.equal(decodificarRFC2047(codificado), asunto);
    for (const palabra of codificado.split("\r\n ")) {
      assert.ok(palabra.length <= 75, `palabra de ${palabra.length}`);
      // Cada palabra, sola, es UTF-8 válido: ningún carácter (ni el emoji) quedó partido.
      const bytes = Buffer.from(/=\?UTF-8\?B\?(.*)\?=/.exec(palabra)[1], "base64");
      assert.equal(Buffer.from(bytes.toString("utf8"), "utf8").length, bytes.length);
      assert.ok(!bytes.toString("utf8").includes("�"));
    }
  });

  test("el asunto codificado llega bien en el MIME", () => {
    const r = armarMime({ ...BASE, asunto: "Reunión del comité 😀" });
    const asunto = leerMime(r.raw).cabeceras.find(([n]) => n === "Subject")[1];
    assert.equal(decodificarRFC2047(asunto), "Re: Reunión del comité 😀");
  });
});

describe("inyección de cabeceras", () => {
  test("un salto de línea en el asunto o en el Message-ID no crea una cabecera nueva", () => {
    const r = armarMime({
      ...BASE,
      asunto: "Hola\r\nBcc: espia@malo.example\r\n\r\nCuerpo falso",
      inReplyTo: "<a@b.co>\r\nBcc: espia@malo.example",
      references: "<x@y.co>\nBcc: espia@malo.example",
      para: "coordinacion@uni.example.edu\r\nCc: espia@malo.example",
    });
    if (r.ok) {
      const { cabeceras } = leerMime(r.raw);
      assert.ok(!cabeceras.some(([nombre]) => /^(bcc|cc)$/i.test(nombre)), "ninguna Bcc ni Cc");
      assert.ok(!cabeceras.some(([nombre]) => nombre === "In-Reply-To"), "Message-ID inválido: se descarta");
    } else {
      assert.equal(r.motivo, "destinatario", "o directamente no se arma");
    }
    assert.equal(limpiarCabecera("a\r\nb\nc\rd\te\u0000f"), "a b c d e f");
  });

  test("Message-ID, direcciones y References se validan", () => {
    assert.equal(idMensajeValido("<CAF1@mail.gmail.com>"), "<CAF1@mail.gmail.com>");
    for (const malo of ["CAF1@mail.gmail.com", "<sin-arroba>", "<a@b> <c@d>", "", null]) {
      assert.equal(idMensajeValido(malo), null, String(malo));
    }
    assert.equal(direccionDe("Ana Pérez <ana.perez@uni.example.edu>"), "ana.perez@uni.example.edu");
    assert.equal(direccionDe("ana@x.co"), "ana@x.co");
    for (const mala of ["", "Ana", "a@b", "<a@b.co>, c@d.co", "a b@c.co"]) assert.equal(direccionDe(mala), null, mala);
    assert.equal(referenciasRespuesta("<a@b.co>  basura <c@d.co>", "<c@d.co>"), "<a@b.co> <c@d.co>", "sin repetir");
    assert.equal(referenciasRespuesta("", "<e@f.co>"), "<e@f.co>");
    const muchas = Array.from({ length: 80 }, (_, i) => `<id-${i}@hilo.example.edu>`).join(" ");
    const recortadas = referenciasRespuesta(muchas, "<ultimo@hilo.example.edu>");
    assert.ok(recortadas.length <= 900);
    assert.ok(recortadas.endsWith("<ultimo@hilo.example.edu>"), "se quedan los más recientes");
  });
});

describe("petición y respuestas de /redactar", () => {
  const correo = { asunto: "Entrega", cuerpo: "Hola", remitente: "coordinacion@uni.example.edu", destinatarios: ["yo@x.co"] };

  test("la petición lleva solo indicación, tono, asunto, cuerpo y modo", () => {
    const r = armarPeticionRedactar({ indicacion: "  Confirmar  ", tono: "breve", correo, demo: false });
    assert.deepEqual(r, { ok: true, peticion: { indicacion: "Confirmar", tono: "breve", asunto: "Entrega", cuerpo: "Hola", modo: "local" } });
    assert.equal(armarPeticionRedactar({ indicacion: "x", tono: "raro", correo, demo: true }).peticion.tono, "formal");
    assert.equal(armarPeticionRedactar({ indicacion: "x", tono: "formal", correo, demo: true }).peticion.modo, "demostracion");
    assert.equal(armarPeticionRedactar({ indicacion: "   ", tono: "formal", correo }).mensaje, MENSAJES_REDACCION.sinIndicacion);
    assert.equal(armarPeticionRedactar({ indicacion: "x".repeat(501), tono: "formal", correo }).ok, false);
    assert.equal(armarPeticionRedactar({ indicacion: "x", tono: "formal", correo: null }).mensaje, MENSAJES_REDACCION.sinCorreo);
    assert.equal(urlRedactar("http://127.0.0.1:8000"), "http://127.0.0.1:8000/redactar");
    assert.equal(urlProveedores("http://127.0.0.1:8000"), "http://127.0.0.1:8000/redactar/proveedores");
  });

  test("contador", () => {
    assert.equal(textoContador(""), `0/${LARGO_MAX_INDICACION}`);
    assert.equal(textoContador("hola"), "4/500");
  });

  test("proveedores: el demo solo con true explícito", () => {
    assert.deepEqual(interpretarProveedores(200, { local: true, modelo_local: "gemma4:e4b", demostracion: true }),
                     { demostracion: true, modeloLocal: "gemma4:e4b" });
    for (const [estado, cuerpo] of [[200, { demostracion: "true" }], [200, null], [401, { demostracion: true }], [200, {}]]) {
      assert.equal(interpretarProveedores(estado, cuerpo).demostracion, false, JSON.stringify(cuerpo));
    }
    assert.equal(interpretarProveedores(200, { modelo_local: "gemma; rm -rf /" }).modeloLocal, "gemma4:e4b");
  });

  test("borrador válido, con los avisos armados por la extensión", () => {
    const r = interpretarRedaccion(200, {
      borrador: "Hola", proveedor: "ollama", modelo: "gemma4:e4b", segundos: 1.4,
      enlaces_quitados: 2, cuerpo_recortado: true, avisos: ["<b>texto de la API</b>"],
    });
    assert.deepEqual(r, {
      tipo: "borrador", borrador: "Hola", proveedor: "ollama", modelo: "gemma4:e4b", segundos: 1.4,
      avisos: ["El correo era largo: la IA leyó solo el inicio.", "Se quitaron 2 enlaces que no estaban en tu indicación."],
    });
    assert.deepEqual(interpretarRedaccion(200, { borrador: "x", proveedor: "ollama", modelo: "m", segundos: 0, enlaces_quitados: 1 }).avisos,
                     ["Se quitó 1 enlace que no estaba en tu indicación."]);
    for (const malo of [{}, { borrador: "  ", proveedor: "ollama", modelo: "m", segundos: 1 },
      { borrador: "x", proveedor: "otro", modelo: "m", segundos: 1 }, { borrador: "x", proveedor: "ollama", modelo: "m", segundos: -1 }]) {
      assert.equal(interpretarRedaccion(200, malo).mensaje, MENSAJES_REDACCION.inesperada);
    }
  });

  test("cada código de error da su mensaje FIJO (nunca el detalle de la API)", () => {
    const con = (codigo) => ({ detalle: "<script>texto-de-la-api</script>", codigo });
    assert.deepEqual(interpretarRedaccion(503, con("sin_conexion")),
                     { tipo: "error", mensaje: MENSAJES_REDACCION.ollamaApagado, enlaceOllama: true });
    assert.equal(interpretarRedaccion(503, con("sin_conexion"), { demo: true }).mensaje, MENSAJES_REDACCION.geminiSinConexion);
    assert.equal(interpretarRedaccion(503, con("modelo_no_descargado")).mensaje,
                 "Falta el modelo: en una terminal ejecuta «ollama pull gemma4:e4b».");
    assert.match(interpretarRedaccion(503, con("modelo_no_descargado"), { modeloLocal: "llama9:1b" }).mensaje, /ollama pull llama9:1b/);
    assert.equal(interpretarRedaccion(504, con("tiempo_agotado")).mensaje, MENSAJES_REDACCION.tiempo);
    assert.equal(interpretarRedaccion(429, con("limite_hora"), { retryAfter: "1500" }).mensaje,
                 "Llegaste al límite de borradores por hora. Inténtalo en 25 min.");
    assert.deepEqual(interpretarRedaccion(403, con("consentimiento")), { tipo: "pedir_permisos" });
    assert.deepEqual(interpretarRedaccion(403, { detalle: "Falta el consentimiento." }), { tipo: "pedir_permisos" });
    assert.equal(interpretarRedaccion(403, con("demo_cuenta")).mensaje, MENSAJES_REDACCION.demoCuenta);
    assert.equal(interpretarRedaccion(503, con("demo_desactivado")).mensaje, MENSAJES_REDACCION.demoDesactivado);
    assert.equal(interpretarRedaccion(502, con("gemini_401")).mensaje, MENSAJES_REDACCION.geminiClave);
    assert.equal(interpretarRedaccion(503, con("gemini_429")).mensaje, MENSAJES_REDACCION.geminiLimite);
    assert.equal(interpretarRedaccion(503, con("configuracion")).mensaje, MENSAJES_REDACCION.configuracion);
    assert.equal(interpretarRedaccion(422, con(undefined)).mensaje, MENSAJES_REDACCION.entrada);
    for (const r of [interpretarRedaccion(502, con("respuesta_invalida")), interpretarRedaccion(500, null), interpretarRedaccion(418, "x")]) {
      assert.equal(r.mensaje, MENSAJES_REDACCION.inesperada);
    }
    const todos = [503, 504, 429, 403, 502, 422].map((e) => JSON.stringify(interpretarRedaccion(e, con("sin_conexion"))));
    assert.ok(todos.every((t) => !t.includes("texto-de-la-api")));
  });
});

describe("textos", () => {
  test("proveedor y segundos", () => {
    assert.equal(textoProveedor({ proveedor: "ollama", modelo: "gemma4:e4b", segundos: 1.42 }), "Ollama (gemma4:e4b) en tu equipo · 1,4 s");
    assert.equal(textoProveedor({ proveedor: "demostracion", modelo: "gemini-3.5-flash-lite", segundos: 2.06 }),
                 "Google Gemini (modo demostración) · 2,1 s");
  });

  test("aviso del modo demostración y mensaje al guardar", () => {
    assert.equal(AVISO_DEMO, "El texto se envía a Google Gemini (capa gratuita). Personas de Google pueden leerlo. "
      + "Úsalo solo con correos de prueba.");
    assert.equal(MENSAJE_BORRADOR_GUARDADO, "Borrador guardado en Gmail. Revísalo antes de enviarlo.");
  });

  test("enlace a Borradores de la misma cuenta", () => {
    assert.equal(enlaceBorradores("https://mail.google.com/mail/u/1/#inbox/FMfcg"), "https://mail.google.com/mail/u/1/#drafts");
    for (const otra of ["https://mail.google.com/mail/#inbox", "https://malo.example/mail/u/1/", "javascript:alert(1)", null,
      "https://mail.google.com/mail/u/999/"]) {
      assert.equal(enlaceBorradores(otra), "https://mail.google.com/mail/#drafts", String(otra));
    }
  });
});
