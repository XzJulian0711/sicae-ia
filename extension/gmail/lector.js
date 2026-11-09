// Content script de SICAE-IA: lee el correo ABIERTO en Gmail cuando el panel lo pide.
//
// - No hace nada al cargar: solo queda escuchando el mensaje "leer-correo".
// - Solo acepta mensajes de la propia extensión (sender.id), nunca de la página.
// - Solo LEE la página: no la modifica, no guarda nada, no hace peticiones y no escribe en la
//   consola (el correo no debe quedar en ningún log).
// - Devuelve los datos crudos; el panel los valida y arma la petición (lib/correo.js).
//
// Usa los selectores de selectores.js, que el manifest carga antes que este archivo.

(() => {
  const S = globalThis.SICAE_SELECTORES;
  const M = globalThis.SICAE_MARCAS;

  /** Texto de un elemento como se ve en pantalla (innerText respeta los saltos de línea). */
  function texto(elemento) {
    if (!elemento) return "";
    const valor = typeof elemento.innerText === "string" ? elemento.innerText : elemento.textContent;
    return (valor || "").trim();
  }

  // Paso 7.1: el contenedor del aviso "[Mensaje recortado] Ver todo el mensaje" es corto. Si el
  // padre del enlace tiene más texto que esto, no es el aviso: se excluye solo el enlace.
  const LARGO_MAX_AVISO = 200;

  function escapar(textoLiteral) {
    return textoLiteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Quita de `completo` la ÚLTIMA aparición de `parte`, con espacios flexibles (innerText puede
   * separar los espacios distinto en el contenedor y en el cuerpo). Solo trabaja con textos: la
   * página no se toca.
   */
  function quitarTexto(completo, parte) {
    const palabras = parte.split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return completo;
    let ultima = null;
    for (const m of completo.matchAll(new RegExp(palabras.map(escapar).join("\\s+"), "g"))) ultima = m;
    if (!ultima) return completo;
    return completo.slice(0, ultima.index) + completo.slice(ultima.index + ultima[0].length);
  }

  /**
   * Paso 7.1: elementos que Gmail AGREGA dentro del cuerpo y que no son del correo:
   * - el aviso "[Mensaje recortado] Ver todo el mensaje" (el padre del enlace con view=lg);
   * - el botón "•••" del texto citado.
   */
  function agregadosDeGmail(cuerpo) {
    const agregados = [];
    for (const enlace of cuerpo.querySelectorAll(S.enlaces)) {
      if (!(enlace.getAttribute("href") || "").includes(M.recorte)) continue;
      const padre = enlace.parentElement;
      const esAviso = padre && padre !== cuerpo && texto(padre).length <= LARGO_MAX_AVISO;
      agregados.push(esAviso ? padre : enlace);
    }
    agregados.push(...cuerpo.querySelectorAll(S.textoCitado));
    return agregados;
  }

  /**
   * Lee el correo abierto en `documento`.
   * Devuelve {ok: true, correo} o {ok: false, motivo: "sin_correo" | "incompleto", falta}.
   * correo = {asunto, remitente, destinatarios, cuerpo, enlaces, nAdjuntos, idGmail, recortadoGmail}.
   */
  function leerCorreoAbierto(documento) {
    const mensajes = documento.querySelectorAll(S.mensaje);
    if (mensajes.length === 0) {
      return { ok: false, motivo: "sin_correo" };
    }
    const mensaje = mensajes[mensajes.length - 1]; // el último desplegado: el que se está leyendo

    const remitente = mensaje.querySelector(S.remitente)?.getAttribute("email") || "";
    if (!remitente) {
      return { ok: false, motivo: "incompleto", falta: "remitente" };
    }
    const cuerpo = mensaje.querySelector(S.cuerpo);
    if (!cuerpo) {
      return { ok: false, motivo: "incompleto", falta: "cuerpo" };
    }

    // Lo que agrega Gmail no se cuenta ni se lee (paso 7.1).
    const agregados = agregadosDeGmail(cuerpo);
    const deGmail = (el) => agregados.some((agregado) => agregado.contains(el));
    const enlaces = [
      ...[...cuerpo.querySelectorAll(S.enlaces)].filter((a) => !deGmail(a)).map((a) => a.getAttribute("href")),
      ...[...cuerpo.querySelectorAll(S.imagenes)].filter((img) => !deGmail(img)).map((img) => img.getAttribute("src")),
    ];
    let textoCuerpo = texto(cuerpo);
    if (agregados.length > 0) {
      for (const agregado of agregados) textoCuerpo = quitarTexto(textoCuerpo, texto(agregado));
      textoCuerpo = textoCuerpo.replace(/\n{3,}/g, "\n\n").trim();
    }
    const destinatarios = [...mensaje.querySelectorAll(S.destinatarios)].map((d) => d.getAttribute("email"));

    // Id del mensaje en la API de Gmail (paso 4.5). Solo si tiene forma de id (hexadecimal).
    const atributoId = S.idMensaje.slice(1, -1); // "[data-legacy-message-id]" → "data-legacy-message-id"
    const idCrudo = mensaje.getAttribute(atributoId) || mensaje.querySelector(S.idMensaje)?.getAttribute(atributoId) || "";
    const idGmail = /^[0-9a-f]{8,32}$/i.test(idCrudo) ? idCrudo : null;

    // Paso 7.1: ¿Gmail recortó el mensaje ("Ver todo el mensaje")? Entonces el cuerpo que se ve
    // es solo el inicio. Solo se mira el href; no se sigue el enlace.
    const recortadoGmail = [...mensaje.querySelectorAll(S.enlaces)]
      .some((a) => (a.getAttribute("href") || "").includes(M.recorte));

    return {
      ok: true,
      correo: {
        asunto: texto(documento.querySelector(S.asunto)),
        remitente,
        destinatarios,
        cuerpo: textoCuerpo,
        enlaces,
        nAdjuntos: mensaje.querySelectorAll(S.adjuntos).length,
        idGmail,
        recortadoGmail,
      },
    };
  }

  globalThis.SICAE_GMAIL = Object.freeze({ leerCorreoAbierto });

  // En las pruebas (Node) no existe chrome: solo se expone la función.
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;

  chrome.runtime.onMessage.addListener((mensaje, remitenteMensaje, responder) => {
    if (remitenteMensaje.id !== chrome.runtime.id || mensaje?.tipo !== "leer-correo") {
      return false; // no es para nosotros: no se responde
    }
    try {
      responder(leerCorreoAbierto(document));
    } catch {
      // Gmail cambió algo inesperado: se responde sin detalles (nada del correo).
      responder({ ok: false, motivo: "incompleto", falta: "estructura" });
    }
    return false; // la respuesta ya se envió
  });
})();
