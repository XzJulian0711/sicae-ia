// DOM mínimo SOLO para las pruebas (Node no trae DOM y no usamos npm, así que no hay jsdom).
//
// Convierte HTML INVENTADO en elementos con lo poco que usa gmail/lector.js:
//   querySelector, querySelectorAll, getAttribute, parentElement, contains, textContent, innerText,
//   childNodes (con nodos de texto), nodeType, tagName y checkVisibility().
// Selectores que entiende: etiqueta, .clase, [atributo] y el espacio (descendiente).
// No es un navegador: el comportamiento real se revisa a mano en Chrome.

const VACIOS = new Set(["br", "hr", "img", "input", "meta", "link", "wbr"]);
const BLOQUES = new Set(["div", "p", "li", "tr", "table", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "section", "header", "footer"]);
const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// Un selector compuesto sencillo: etiqueta opcional, .clases y [atributos].
const COMPUESTO = /^([a-z][a-z0-9]*)?((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/i;

function decodificar(texto) {
  return texto.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTIDADES[e]);
}

/** Un nodo de texto (nodeType 3), como en el navegador. */
class Texto {
  constructor(texto, padre) {
    this.texto = texto;
    this.padre = padre;
  }

  get nodeType() {
    return 3;
  }

  get nodeValue() {
    return this.texto;
  }
}

// Atributo SOLO de las pruebas: el elemento "no se ve" para checkVisibility() (como un
// display: none de Gmail). innerText de mini-dom lo ignora a propósito, para poder simular
// que el recorrido del lector y innerText no coinciden.
const OCULTO_EN_PRUEBA = "data-oculto-en-prueba";

class Elemento {
  constructor(etiqueta, atributos = {}, padre = null) {
    this.etiqueta = etiqueta;
    this.atributos = atributos;
    this.padre = padre;
    this.hijos = []; // Elemento o Texto
  }

  get nodeType() {
    return 1;
  }

  get tagName() {
    return this.etiqueta.toUpperCase();
  }

  get childNodes() {
    return [...this.hijos];
  }

  /** Como Element.checkVisibility(): false si él o un ancestro "no se ve". */
  checkVisibility() {
    for (let nodo = this; nodo; nodo = nodo.padre) {
      if (nodo.getAttribute(OCULTO_EN_PRUEBA) !== null) return false;
    }
    return true;
  }

  getAttribute(nombre) {
    return Object.hasOwn(this.atributos, nombre) ? this.atributos[nombre] : null;
  }

  get parentElement() {
    return this.padre;
  }

  /** Como Node.contains: true si `otro` es este elemento o está dentro de él. */
  contains(otro) {
    for (let nodo = otro; nodo; nodo = nodo.padre) {
      if (nodo === this) return true;
    }
    return false;
  }

  get textContent() {
    return this.hijos.map((h) => (h instanceof Elemento ? h.textContent : h.texto)).join("");
  }

  /** Aproximación de innerText: <br> y los bloques generan saltos de línea. */
  get innerText() {
    const partes = [];
    const recorrer = (nodo) => {
      for (const h of nodo.hijos) {
        if (!(h instanceof Elemento)) partes.push(h.texto.replace(/\s+/g, " "));
        else if (h.etiqueta === "br") partes.push("\n");
        else {
          recorrer(h);
          if (BLOQUES.has(h.etiqueta)) partes.push("\n");
        }
      }
    };
    recorrer(this);
    return partes.join("").split("\n").map((l) => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  *descendientes() {
    for (const h of this.hijos) {
      if (h instanceof Elemento) {
        yield h;
        yield* h.descendientes();
      }
    }
  }

  querySelectorAll(selector) {
    const partes = selector.trim().split(/\s+/).map(analizarCompuesto);
    return [...this.descendientes()].filter((el) => coincide(el, partes, this));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function analizarCompuesto(texto) {
  const m = COMPUESTO.exec(texto);
  if (!m) throw new Error(`mini-dom no entiende el selector "${texto}"`);
  return {
    etiqueta: m[1]?.toLowerCase() ?? null,
    clases: m[2] ? m[2].slice(1).split(".") : [],
    atributos: m[3] ? m[3].slice(1, -1).split("][") : [],
  };
}

function cumple(el, parte) {
  if (parte.etiqueta && el.etiqueta !== parte.etiqueta) return false;
  const clases = (el.getAttribute("class") || "").split(/\s+/);
  if (!parte.clases.every((c) => clases.includes(c))) return false;
  return parte.atributos.every((a) => el.getAttribute(a) !== null);
}

/** El último compuesto debe cumplirlo el elemento; los anteriores, sus ancestros (en orden). */
function coincide(el, partes, raiz) {
  if (!cumple(el, partes[partes.length - 1])) return false;
  let i = partes.length - 2;
  let actual = el.padre;
  while (i >= 0 && actual && actual !== raiz) {
    if (cumple(actual, partes[i])) i -= 1;
    actual = actual.padre;
  }
  return i < 0;
}

/** ¿El selector es de la forma que entiende mini-dom? (para revisar selectores.js) */
export function esSelectorSencillo(selector) {
  return typeof selector === "string" && selector.trim().split(/\s+/).every((p) => COMPUESTO.test(p));
}

/** Convierte un texto HTML inventado en un "documento" con querySelector(All). */
export function crearDocumento(html) {
  const documento = new Elemento("#documento");
  let actual = documento;
  const fichas = /<!--[\s\S]*?-->|<\/([a-z][a-z0-9]*)\s*>|<([a-z][a-z0-9]*)((?:\s+[^\s=\/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>|([^<]+)/gi;
  for (const [, cierre, apertura, textoAtributos, texto] of html.matchAll(fichas)) {
    if (texto !== undefined) {
      actual.hijos.push(new Texto(decodificar(texto), actual));
    } else if (apertura) {
      const atributos = {};
      for (const [, nombre, v1, v2, v3] of (textoAtributos || "").matchAll(/([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        atributos[nombre.toLowerCase()] = decodificar(v1 ?? v2 ?? v3 ?? "");
      }
      const el = new Elemento(apertura.toLowerCase(), atributos, actual);
      actual.hijos.push(el);
      if (!VACIOS.has(el.etiqueta)) actual = el;
    } else if (cierre) {
      // Sube hasta el elemento que se cierra (tolera HTML mal cerrado).
      let nodo = actual;
      while (nodo && nodo.etiqueta !== cierre.toLowerCase()) nodo = nodo.padre;
      if (nodo && nodo.padre) actual = nodo.padre;
    }
  }
  return documento;
}
