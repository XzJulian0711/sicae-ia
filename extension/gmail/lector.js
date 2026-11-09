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

  // Paso 7.1: el texto del aviso de recorte, justo antes del enlace "Ver todo el mensaje": algo
  // corto entre corchetes ("[Mensaje recortado]", "[Message clipped]"…).
  const TEXTO_AVISO = /^\[[^\]]{1,60}\]$/;

  // Para armar el texto sin lo que agrega Gmail (como innerText): bloques que terminan en salto
  // de línea y etiquetas que no tienen texto visible.
  const BLOQUES = new Set(["DIV", "P", "LI", "TR", "TABLE", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6",
                           "BLOCKQUOTE", "SECTION", "HEADER", "FOOTER", "PRE"]);
  const SIN_TEXTO = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT", "TEMPLATE"]);

  /** Texto de un nodo de texto o de un elemento, sin espacios a los lados. */
  function textoDeNodo(nodo) {
    return nodo.nodeType === 3 ? (nodo.nodeValue || "").trim() : texto(nodo);
  }

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
   * Paso 7.1: los nodos EXACTOS que Gmail agrega dentro del cuerpo y que no son del correo.
   * NUNCA sus contenedores: Gmail puede poner el aviso en el mismo contenedor que el texto del
   * correo, y quitar el contenedor borraba el cuerpo entero.
   * - el enlace "Ver todo el mensaje" (view=lg);
   * - el texto del aviso: el hermano anterior al enlace (sin contar espacios), si es algo corto
   *   entre corchetes, como "[Mensaje recortado]";
   * - el botón "•••" del texto citado.
   * Devuelve un Set de nodos (elementos o nodos de texto). No toca la página.
   */
  function agregadosDeGmail(cuerpo) {
    const agregados = new Set();
    for (const enlace of cuerpo.querySelectorAll(S.enlaces)) {
      if (!(enlace.getAttribute("href") || "").includes(M.recorte)) continue;
      agregados.add(enlace);
      const hermanos = [...(enlace.parentElement?.childNodes ?? [])];
      const anteriores = hermanos.slice(0, hermanos.indexOf(enlace)).reverse();
      const anterior = anteriores.find((nodo) => textoDeNodo(nodo) !== "");
      if (anterior && TEXTO_AVISO.test(textoDeNodo(anterior))) agregados.add(anterior);
    }
    for (const boton of cuerpo.querySelectorAll(S.textoCitado)) agregados.add(boton);
    return agregados;
  }

  /**
   * Texto de `raiz` como lo da innerText, pero SIN los nodos de `excluidos`. Solo LEE la página
   * (recorre childNodes): no copia ni cambia nada. Salta lo que no se ve (checkVisibility), igual
   * que innerText, y pone saltos de línea en <br> y al final de cada bloque.
   */
  function textoSin(raiz, excluidos) {
    const partes = [];
    const recorrer = (nodo) => {
      for (const hijo of nodo.childNodes) {
        if (excluidos.has(hijo)) continue;
        if (hijo.nodeType === 3) {
          partes.push((hijo.nodeValue || "").replace(/\s+/g, " "));
          continue;
        }
        if (hijo.nodeType !== 1 || SIN_TEXTO.has(hijo.tagName)) continue;
        if (typeof hijo.checkVisibility === "function" && !hijo.checkVisibility()) continue;
        if (hijo.tagName === "BR") {
          partes.push("\n");
          continue;
        }
        recorrer(hijo);
        if (BLOQUES.has(hijo.tagName)) partes.push("\n");
      }
    };
    recorrer(raiz);
    return partes.join("").split("\n").map((linea) => linea.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Cuerpo sin lo que agrega Gmail → {texto, limpiezaParcial}.
   * Protección: si la limpieza deja el cuerpo vacío y antes no lo estaba, se usa el innerText
   * de siempre quitando SOLO el texto exacto de esos nodos ("[Mensaje recortado]", "Ver todo el
   * mensaje"), y se marca limpiezaParcial para avisarlo en la tarjeta.
   */
  function cuerpoSinAgregados(cuerpo, agregados) {
    const original = texto(cuerpo);
    if (agregados.size === 0) return { texto: original, limpiezaParcial: false };
    const limpio = textoSin(cuerpo, agregados);
    if (limpio !== "" || original === "") return { texto: limpio, limpiezaParcial: false };
    let respaldo = original;
    for (const nodo of agregados) respaldo = quitarTexto(respaldo, textoDeNodo(nodo));
    return { texto: respaldo.replace(/\n{3,}/g, "\n\n").trim(), limpiezaParcial: true };
  }

  /**
   * Lee el correo abierto en `documento`.
   * Devuelve {ok: true, correo} o {ok: false, motivo: "sin_correo" | "incompleto", falta}.
   * correo = {asunto, remitente, destinatarios, cuerpo, enlaces, nAdjuntos, idGmail, recortadoGmail,
   *          limpiezaParcial}.
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
    const elementosDeGmail = [...agregados].filter((nodo) => nodo.nodeType === 1);
    const deGmail = (el) => elementosDeGmail.some((agregado) => agregado.contains(el));
    const enlaces = [
      ...[...cuerpo.querySelectorAll(S.enlaces)].filter((a) => !deGmail(a)).map((a) => a.getAttribute("href")),
      ...[...cuerpo.querySelectorAll(S.imagenes)].filter((img) => !deGmail(img)).map((img) => img.getAttribute("src")),
    ];
    const limpieza = cuerpoSinAgregados(cuerpo, agregados);
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
        cuerpo: limpieza.texto,
        enlaces,
        nAdjuntos: mensaje.querySelectorAll(S.adjuntos).length,
        idGmail,
        recortadoGmail,
        limpiezaParcial: limpieza.limpiezaParcial, // paso 7.1: se usó la protección
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
