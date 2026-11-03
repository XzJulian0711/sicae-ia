// Pruebas del content script (gmail/lector.js) y de los selectores (gmail/selectores.js).
// Usan HTML INVENTADO que imita la estructura de Gmail: nunca correos reales.
// Correr desde la raíz:  node --test "extension/tests/*.test.js"

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { armarPeticion } from "../lib/correo.js";
import { crearDocumento, esSelectorSencillo } from "./ayudas/mini-dom.js";

// Scripts clásicos: al cargarlos dejan SICAE_SELECTORES y SICAE_GMAIL en globalThis.
await import("../gmail/selectores.js");
await import("../gmail/lector.js");
const { leerCorreoAbierto } = globalThis.SICAE_GMAIL;

/** Un mensaje desplegado de Gmail, inventado. */
function mensaje({ remitente = "avisos@example.net", destinatarios = ["ana@example.org"], cuerpo = "", adjuntos = 0 } = {}) {
  const de = remitente === null ? "" : `<span class="gD" email="${remitente}" name="Avisos">Avisos</span>`;
  const para = destinatarios.map((d) => `<span class="g2" email="${d}">${d}</span>`).join(", ");
  const cuerpoHtml = cuerpo === null ? "" : `<div class="a3s aiL">${cuerpo}</div>`;
  const tarjetas = adjuntos ? `<div class="aQH">${'<span class="aZo">archivo</span>'.repeat(adjuntos)}</div>` : "";
  return `<div class="adn ads"><div class="gE">${de}<div class="hb">para ${para}</div></div>${cuerpoHtml}${tarjetas}</div>`;
}

function pagina(...mensajes) {
  return crearDocumento(`
    <div role="navigation"><a href="https://mail.google.com/mail/u/0/#inbox">Recibidos</a></div>
    <div role="main">
      <h2 class="hP">Su paquete está detenido</h2>
      ${mensajes.join("")}
    </div>`);
}

describe("selectores.js", () => {
  test("todos los selectores son sencillos (etiqueta, .clase, [atributo], descendiente)", () => {
    const selectores = Object.entries(globalThis.SICAE_SELECTORES);
    assert.ok(selectores.length >= 7);
    for (const [nombre, selector] of selectores) {
      assert.ok(esSelectorSencillo(selector), `${nombre}: "${selector}"`);
    }
  });

  test("no se pueden cambiar en tiempo de ejecución", () => {
    assert.ok(Object.isFrozen(globalThis.SICAE_SELECTORES));
  });
});

describe("leerCorreoAbierto", () => {
  test("lee asunto, remitente, destinatarios, cuerpo, enlaces y adjuntos", () => {
    const cuerpo = `Estimado cliente,<br>su paquete no pudo ser entregado.
      <p>Pague aquí: <a href="https://pagos.example.net/tasa">pagar</a></p>
      <p><a href="https://pagos.example.net/tasa">otra vez el mismo enlace</a>
         <a href="#">#</a> <a href="mailto:soporte@example.net">soporte</a></p>
      <img src="https://img.example.net/logo.png">`;
    const doc = pagina(mensaje({ destinatarios: ["ana@example.org", "luis@example.org"], cuerpo, adjuntos: 2 }));

    const r = leerCorreoAbierto(doc);
    assert.equal(r.ok, true);
    assert.equal(r.correo.asunto, "Su paquete está detenido");
    assert.equal(r.correo.remitente, "avisos@example.net");
    assert.deepEqual(r.correo.destinatarios, ["ana@example.org", "luis@example.org"]);
    assert.match(r.correo.cuerpo, /^Estimado cliente,\nsu paquete no pudo ser entregado\./);
    assert.equal(r.correo.nAdjuntos, 2);
    // Se leen los 5 valores crudos (con el repetido); el enlace de la bandeja no cuenta.
    assert.equal(r.correo.enlaces.length, 5);
    assert.ok(!r.correo.enlaces.some((e) => e.includes("#inbox")));
    // Al armar la petición se cuentan los distintos: 4, como url_count de SpaPhish.
    assert.equal(armarPeticion(r.correo).peticion.n_urls, 4);
  });

  test("en un hilo usa el último mensaje desplegado", () => {
    const doc = pagina(
      mensaje({ remitente: "primero@example.net", cuerpo: "Mensaje viejo" }),
      mensaje({ remitente: "ultimo@example.net", cuerpo: "Mensaje nuevo", adjuntos: 1 }),
    );
    const r = leerCorreoAbierto(doc);
    assert.equal(r.correo.remitente, "ultimo@example.net");
    assert.equal(r.correo.cuerpo, "Mensaje nuevo");
    assert.equal(r.correo.nAdjuntos, 1);
  });

  test("sin enlaces ni adjuntos da listas y conteos en cero", () => {
    const r = leerCorreoAbierto(pagina(mensaje({ cuerpo: "Hola, nos vemos mañana." })));
    assert.deepEqual(r.correo.enlaces, []);
    assert.equal(r.correo.nAdjuntos, 0);
  });

  test("bandeja de entrada (sin correo abierto) → sin_correo", () => {
    const doc = crearDocumento(`<div role="main"><table><tr><td>Lista de correos</td></tr></table></div>`);
    assert.deepEqual(leerCorreoAbierto(doc), { ok: false, motivo: "sin_correo" });
  });

  test("si falta el remitente o el cuerpo, lo dice sin fallar", () => {
    assert.deepEqual(leerCorreoAbierto(pagina(mensaje({ remitente: null, cuerpo: "x" }))),
                     { ok: false, motivo: "incompleto", falta: "remitente" });
    assert.deepEqual(leerCorreoAbierto(pagina(mensaje({ cuerpo: null }))),
                     { ok: false, motivo: "incompleto", falta: "cuerpo" });
  });

  test("sin asunto devuelve asunto vacío", () => {
    const doc = crearDocumento(`<div role="main">${mensaje({ cuerpo: "Texto" })}</div>`);
    const r = leerCorreoAbierto(doc);
    assert.equal(r.ok, true);
    assert.equal(r.correo.asunto, "");
  });
});
