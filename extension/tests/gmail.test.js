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

  test("recortadoGmail (paso 7.1): true solo si está el enlace «Ver todo el mensaje» (view=lg)", () => {
    const recortado = `Inicio del correo largo…
      <div class="iX"><span>[Mensaje recortado]</span> <a href="https://mail.google.com/mail/u/0?ui=2&amp;ik=abc&amp;view=lg&amp;permmsgid=msg-f:1">Ver todo el mensaje</a></div>`;
    assert.equal(leerCorreoAbierto(pagina(mensaje({ cuerpo: recortado }))).correo.recortadoGmail, true);
    const normal = `Hola <a href="https://www.example.org/calendario">calendario</a>`;
    assert.equal(leerCorreoAbierto(pagina(mensaje({ cuerpo: normal }))).correo.recortadoGmail, false);
    assert.equal(leerCorreoAbierto(pagina(mensaje({ cuerpo: "Sin enlaces" }))).correo.recortadoGmail, false);
  });

  test("respaldo (paso 7.1): no lee ni cuenta el aviso de recorte ni el «•••» de Gmail", () => {
    const cuerpo = `<p>Recordatorio: la entrega es el viernes.</p>
      <p>Rúbrica en <a href="https://campus.example.edu/rubrica">el campus</a>.</p>
      <div class="ajR" role="button"><img class="ajT" src="//ssl.gstatic.com/ui/v1/icons/mail/images/cleardot.gif"></div>
      <div class="iX"><span>[Mensaje recortado]</span>  <a href="https://mail.google.com/mail/u/0?ui=2&amp;view=lg&amp;permmsgid=msg-f:1">Ver todo el mensaje</a></div>`;
    const r = leerCorreoAbierto(pagina(mensaje({ cuerpo })));
    assert.equal(r.correo.cuerpo, "Recordatorio: la entrega es el viernes.\nRúbrica en el campus.");
    assert.deepEqual(r.correo.enlaces, ["https://campus.example.edu/rubrica"]);
    assert.equal(r.correo.recortadoGmail, true, "sigue avisando que Gmail recortó el correo");
    assert.equal(armarPeticion(r.correo).peticion.n_urls, 1);
  });

  test("respaldo: el mismo correo con o sin lo que agrega Gmail envía lo mismo", () => {
    const base = `<p>Hola, adjunto el calendario.</p><p><a href="https://www.example.org/calendario">calendario</a></p>`;
    const conAgregados = `${base}<div class="ajR"><img class="ajT" src="//ssl.gstatic.com/cleardot.gif"></div>`
      + `<div class="iX"><span>[Mensaje recortado]</span> <a href="https://mail.google.com/mail/u/0?view=lg">Ver todo el mensaje</a></div>`;
    const limpio = armarPeticion(leerCorreoAbierto(pagina(mensaje({ cuerpo: base }))).correo).peticion;
    const sucio = armarPeticion(leerCorreoAbierto(pagina(mensaje({ cuerpo: conAgregados }))).correo).peticion;
    assert.deepEqual(sucio, limpio);
  });

  test("respaldo: con un cuerpo largo en el mismo contenedor que el enlace view=lg, solo se excluye el enlace", () => {
    const cuerpo = `<p>${"Texto del correo que sigue. ".repeat(10)}<a href="https://mail.google.com/mail/u/0?view=lg">Ver todo el mensaje</a></p>`;
    const r = leerCorreoAbierto(pagina(mensaje({ cuerpo })));
    assert.match(r.correo.cuerpo, /^(Texto del correo que sigue\. ){9}Texto del correo que sigue\.$/);
    assert.deepEqual(r.correo.enlaces, []);
  });

  test("respaldo: una frase igual en el correo no se borra, solo la del aviso (la última)", () => {
    const cuerpo = `<p>Ver todo el mensaje en la web.</p>`
      + `<div class="iX"><span>[Mensaje recortado]</span> <a href="https://mail.google.com/mail/u/0?view=lg">Ver todo el mensaje</a></div>`;
    assert.equal(leerCorreoAbierto(pagina(mensaje({ cuerpo }))).correo.cuerpo, "Ver todo el mensaje en la web.");
  });

  // ----- Error del respaldo: el cuerpo quedaba vacío (correo corto y recortado) -----
  // El aviso de recorte está en el MISMO contenedor que el cuerpo. Antes se tomaba ese
  // contenedor como "el aviso" y se restaba su texto: el cuerpo entero desaparecía.
  const AVISO = `<span>[Mensaje recortado]</span>&nbsp;&nbsp;<a href="https://mail.google.com/mail/u/0?ui=2&amp;view=lg&amp;permmsgid=msg-f:1">Ver todo el mensaje</a>`;

  test("respaldo: aviso en el mismo contenedor que un cuerpo corto → el cuerpo NO queda vacío", () => {
    const cuerpo = `<div dir="ltr">Estimado usuario, su cuenta será suspendida.<br>Verifique sus datos en <a href="https://cuentas.example.net/verificar">este enlace</a>.<br>${AVISO}</div>`;
    const r = leerCorreoAbierto(pagina(mensaje({ cuerpo })));
    assert.equal(r.correo.cuerpo, "Estimado usuario, su cuenta será suspendida.\nVerifique sus datos en este enlace.");
    assert.deepEqual(r.correo.enlaces, ["https://cuentas.example.net/verificar"]);
    assert.equal(r.correo.recortadoGmail, true);
    assert.equal(r.correo.limpiezaParcial, false);
  });

  test("respaldo: el «•••» en el mismo contenedor que el cuerpo solo quita el botón", () => {
    const cuerpo = `<div dir="ltr">Les comparto el acta de la reunión.<br>Saludos.`
      + `<div class="ajR" role="button"><img class="ajT" src="//ssl.gstatic.com/ui/v1/icons/mail/images/cleardot.gif"></div></div>`;
    const r = leerCorreoAbierto(pagina(mensaje({ cuerpo })));
    assert.equal(r.correo.cuerpo, "Les comparto el acta de la reunión.\nSaludos.");
    assert.deepEqual(r.correo.enlaces, []);
    assert.equal(r.correo.limpiezaParcial, false);
  });

  test("respaldo: el aviso como texto suelto (sin <span>) también se quita", () => {
    const cuerpo = `<div dir="ltr">Recordatorio de la entrega del viernes.<br>[Mensaje recortado]  `
      + `<a href="https://mail.google.com/mail/u/0?view=lg">Ver todo el mensaje</a></div>`;
    assert.equal(leerCorreoAbierto(pagina(mensaje({ cuerpo }))).correo.cuerpo, "Recordatorio de la entrega del viernes.");
  });

  test("respaldo: un texto «[algo]» del correo que no está junto al enlace no se quita", () => {
    const cuerpo = `<div dir="ltr"><span>[Importante]</span> Revise el calendario.<br>${AVISO}</div>`;
    assert.equal(leerCorreoAbierto(pagina(mensaje({ cuerpo }))).correo.cuerpo, "[Importante] Revise el calendario.");
  });

  test("respaldo: lo que no se ve (checkVisibility) no entra, igual que con innerText", () => {
    const cuerpo = `<div dir="ltr">Texto visible.<div data-oculto-en-prueba>Texto citado oculto.</div>${AVISO}</div>`;
    assert.equal(leerCorreoAbierto(pagina(mensaje({ cuerpo }))).correo.cuerpo, "Texto visible.");
  });

  test("protección: si la limpieza deja el cuerpo vacío, usa el texto de siempre sin el aviso y lo marca", () => {
    // Simula que el recorrido no encuentra texto pero innerText sí (p. ej., Gmail cambió algo).
    const cuerpo = `<div dir="ltr" data-oculto-en-prueba>Su cuenta será suspendida hoy.<br>${AVISO}</div>`;
    const r = leerCorreoAbierto(pagina(mensaje({ cuerpo })));
    assert.equal(r.correo.cuerpo, "Su cuenta será suspendida hoy.");
    assert.equal(r.correo.limpiezaParcial, true);
    assert.deepEqual(r.correo.enlaces, [], "el enlace del aviso tampoco cuenta");
  });

  test("sin nada de Gmail, el cuerpo es el innerText de siempre y limpiezaParcial es false", () => {
    const r = leerCorreoAbierto(pagina(mensaje({ cuerpo: "Hola,<br>nos vemos mañana." })));
    assert.equal(r.correo.cuerpo, "Hola,\nnos vemos mañana.");
    assert.equal(r.correo.limpiezaParcial, false);
  });

  test("las marcas de Gmail tampoco se pueden cambiar", () => {
    assert.ok(Object.isFrozen(globalThis.SICAE_MARCAS));
    assert.equal(globalThis.SICAE_MARCAS.recorte, "view=lg");
  });

  test("sin asunto devuelve asunto vacío", () => {
    const doc = crearDocumento(`<div role="main">${mensaje({ cuerpo: "Texto" })}</div>`);
    const r = leerCorreoAbierto(doc);
    assert.equal(r.ok, true);
    assert.equal(r.correo.asunto, "");
  });
});
