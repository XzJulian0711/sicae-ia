// Selectores de Gmail: TODOS los que usa la extensión están aquí.
//
// Gmail no tiene una API pública para su página: estas clases son internas y Google las puede
// cambiar sin aviso. Si "Analizar este correo" deja de encontrar algo, este es el único archivo
// que hay que revisar (clic derecho → Inspeccionar sobre el elemento en Gmail).
//
// Reglas para que las pruebas los entiendan (tests/ayudas/mini-dom.js):
// solo etiqueta, .clase, [atributo] y espacio (descendiente). Sin >, +, ~, :pseudo ni comas.
//
// Script clásico (no módulo ES): los content scripts del manifest no pueden ser módulos.
// globalThis aquí es el "mundo aislado" de la extensión: la página de Gmail no lo ve.

globalThis.SICAE_SELECTORES = Object.freeze({
  // Cada mensaje DESPLEGADO de la conversación abierta. En un hilo con varios mensajes se usa
  // el último desplegado, que es el que el usuario está leyendo.
  mensaje: "div.adn.ads",

  // Id del mensaje en la API de Gmail (paso 4.5, para "Mover a cuarentena" desde Analizar).
  // Gmail lo pone en el atributo data-legacy-message-id del mensaje (o de un elemento dentro).
  // Solo se lee. Si Gmail lo cambia, el botón de cuarentena queda deshabilitado en Analizar.
  idMensaje: "[data-legacy-message-id]",

  // Asunto de la conversación abierta (uno por página, fuera de los mensajes).
  asunto: "h2.hP",

  // Remitente del mensaje: un <span> con la dirección en el atributo "email".
  remitente: "span.gD[email]",

  // Destinatarios del mensaje (Para y CC, Gmail no los separa en la vista normal), también
  // con la dirección en el atributo "email".
  destinatarios: "span.g2[email]",

  // Cuerpo del mensaje, tal como se ve en pantalla.
  cuerpo: "div.a3s",

  // Enlaces e imágenes dentro del cuerpo: se cuentan sus href y src (como url_count de SpaPhish).
  enlaces: "a[href]",
  imagenes: "img[src]",

  // Cada adjunto del mensaje (las "tarjetas" que aparecen debajo del cuerpo).
  adjuntos: "div.aQH span.aZo",
});
