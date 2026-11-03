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

  /** Texto de un elemento como se ve en pantalla (innerText respeta los saltos de línea). */
  function texto(elemento) {
    if (!elemento) return "";
    const valor = typeof elemento.innerText === "string" ? elemento.innerText : elemento.textContent;
    return (valor || "").trim();
  }

  /**
   * Lee el correo abierto en `documento`.
   * Devuelve {ok: true, correo} o {ok: false, motivo: "sin_correo" | "incompleto", falta}.
   * correo = {asunto, remitente, destinatarios, cuerpo, enlaces, nAdjuntos}.
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

    const enlaces = [
      ...[...cuerpo.querySelectorAll(S.enlaces)].map((a) => a.getAttribute("href")),
      ...[...cuerpo.querySelectorAll(S.imagenes)].map((img) => img.getAttribute("src")),
    ];
    const destinatarios = [...mensaje.querySelectorAll(S.destinatarios)].map((d) => d.getAttribute("email"));

    return {
      ok: true,
      correo: {
        asunto: texto(documento.querySelector(S.asunto)),
        remitente,
        destinatarios,
        cuerpo: texto(cuerpo),
        enlaces,
        nAdjuntos: mensaje.querySelectorAll(S.adjuntos).length,
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
