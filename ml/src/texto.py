"""Utilidades de texto para explorar y limpiar los correos.

- STOPWORDS_ES / STOPWORDS_EN: palabras vacías en español e inglés.
- tokenizar(): parte un texto en palabras limpias.
- palabras_frecuentes(): cuenta las palabras más comunes de varios textos.
- limpiar_texto(): quita HTML, cambia URLs, correos y nombres por tokens y borra
  direcciones, lugares y organizaciones anonimizadas.
"""

import html
import re
from collections import Counter

# Lista propia (sin nltk) para no depender de descargas. Todo en minúsculas.
STOPWORDS_ES = frozenset(
    """
    a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque
    bajo bien cada casi como con contra cual cuales cualquier cuando cuanto de
    del desde donde dos durante e el ella ellas ello ellos en entre era eran
    eres es esa esas ese eso esos esta estaba estaban estado estamos estan estar
    estas este esto estos estoy fue fueron fui ha haber habia hace hacer hacia
    han has hasta hay he hemos la las le les lo los mas me mi mis mismo mucho
    muchos muy nada ni no nos nosotros nuestra nuestras nuestro nuestros o os
    otra otras otro otros para pero poco por porque pues que quien quienes se
    sea sean ser si sido sin sobre sois solo somos son soy su sus suya suyo tal
    tambien tan tanto te tendra tendran tenemos tener tengo ti tiene tienen todo
    todos tras tu tus un una uno unos usted ustedes va van vez y ya yo
    aquí así aún cuál cuáles cuándo cuánto dónde está están estás él más mí
    qué quién quiénes sí sólo también tú había habían será serán sería podrá
    puede pueden podemos debe deben hecho cómo ahora entonces mientras luego
    """.split()
)

# Una URL: empieza por http(s):// o www. y sigue hasta un espacio.
_URL = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
# Una palabra: solo letras (incluye tildes, ü y ñ), 3 o más.
_PALABRA = re.compile(r"[a-záéíóúüñ]{3,}")


def tokenizar(texto):
    """Devuelve las palabras de un texto en minúsculas, sin URLs.

    Un valor vacío o no textual (por ejemplo NaN de pandas) da lista vacía.
    """
    if not isinstance(texto, str):
        return []
    texto = _URL.sub(" ", texto.lower())
    return _PALABRA.findall(texto)


def palabras_frecuentes(textos, n=20, stopwords=STOPWORDS_ES):
    """Las n palabras más frecuentes de una lista de textos, sin stopwords.

    Devuelve una lista de tuplas (palabra, veces), de mayor a menor.
    """
    conteo = Counter()
    for texto in textos:
        conteo.update(p for p in tokenizar(texto) if p not in stopwords)
    return conteo.most_common(n)


# ---------------------------------------------------------------------------
# Limpieza para el modelo (paso 1.3)
# ---------------------------------------------------------------------------

# Palabras vacías en inglés: SpaPhish trae pies de página y avisos legales en inglés.
# No se usan en limpiar_texto(); se quitarán al vectorizar (paso 1.4), junto con STOPWORDS_ES.
STOPWORDS_EN = frozenset(
    """
    a about all an and any are as at be been but by can do does for from had has
    have he her his how i if in into is it its me my no not of on or our she so
    than that the their them then there these they this to was we were what when
    which who will with you your
    """.split()
)

# Datos que la anonimización de SpaPhish dejó en una sola clase (ver docs/metricas.md).
# Sin ellos, el modelo aprendería "pablito = phishing" en vez de aprender del contenido.
NOMBRES_ANONIMIZADOS = [
    "pablito", "ezequiela", "miguelina", "missxtranger", "pancracio", "guadalupe",
    "robles", "salas", "garcía", "garcia", "jiménez", "jimenez", "vargas",
    "durán", "duran", "martínez", "martinez",
]
# Lugares y organizaciones se BORRAN (no se cambian por "lugartoken"/"orgtoken"):
# quitadas las direcciones, solo aparecen en legítimos, así que un token también
# quedaría en una sola clase y seguiría siendo un atajo. Los nombres sí aparecen en
# ambas clases, por eso se cambian por "nombretoken".
LUGARES_ANONIMIZADOS = ["ciudad central", "hidalgo", "northwood"]
ORGS_ANONIMIZADAS = ["myown", "cietec", "estelar", "sni"]

# Direcciones ficticias de los pies de página de phishing, por ejemplo
# "escriba a: 128 Willow Crest Rd Ste 402#5912, Northwood, VT, 05744".
# Empieza después de ":" o de "escribiendo a" con un número de calle y termina en
# estado + código postal ("vt, 05744", "cdmx, 01000"). Solo aparecen en phishing,
# así que se BORRAN; la frase de antes ("escriba a:") se conserva.
_DIRECCION = re.compile(
    r"(:|\bescribiendo a)\s*\d{1,5}\s[^:\n]{3,120}?\b[a-z]{2,4},?\s+\d{5}(?!\d)"
)

# Solo etiquetas HTML reales. Un patrón genérico <...> borraría texto como
# "<<Cancelar la eliminación de mi cuenta>>", que es el texto de un botón.
_ETIQUETAS_HTML = (
    "a abbr b blockquote body br center div em font h1 h2 h3 h4 h5 h6 head hr html i "
    "img li meta o:p ol p span strong style sub sup table tbody td tfoot th thead "
    "title tr u ul"
).split()
_HTML_COMENTARIO = re.compile(r"<!--.*?-->", re.DOTALL)
_HTML_ETIQUETA = re.compile(
    r"</?(?:" + "|".join(map(re.escape, _ETIQUETAS_HTML)) + r")\b[^<>]*>",
    re.IGNORECASE,
)
# Caracteres invisibles que deja &zwnj; y similares.
_INVISIBLES = re.compile(r"[​-\u200F⁠﻿]")
# URL: http(s):// o www. hasta un espacio, comilla o < >. Va antes que el correo.
_URL_LIMPIEZA = re.compile(r"(?:https?://|www\.)[^\s<>\"']+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_ESPACIOS = re.compile(r"\s+")


def _patron_palabra_completa(frase):
    """Regex que encuentra la frase sola, no dentro de otra palabra ('salas' ≠ 'ensaladas').

    Los espacios de la frase aceptan uno o varios espacios o saltos de línea.
    """
    partes = [re.escape(p) for p in frase.split()]
    return re.compile(r"(?<!\w)" + r"\s+".join(partes) + r"(?!\w)")


# Cada entrada: (token, término, patrón). Un token vacío ("") significa borrar.
_REEMPLAZOS_ANONIMIZADOS = [
    ("", t, _patron_palabra_completa(t)) for t in LUGARES_ANONIMIZADOS
] + [
    ("", t, _patron_palabra_completa(t)) for t in ORGS_ANONIMIZADAS
] + [
    ("nombretoken", t, _patron_palabra_completa(t)) for t in NOMBRES_ANONIMIZADOS
]


def limpiar_texto_contando(texto):
    """Igual que limpiar_texto(), pero también devuelve cuántos reemplazos hizo.

    Devuelve (texto_limpio, conteo). Las claves del conteo son "html", "urltoken",
    "emailtoken", "borrado: dirección", "<token>: <término>" (por ejemplo
    "nombretoken: pablito") y "borrado: <término>" (por ejemplo "borrado: myown").
    """
    conteo = Counter()
    if not isinstance(texto, str):
        return "", conteo

    # 1. HTML: entidades (&aacute; -> á), comentarios y etiquetas reales.
    texto = html.unescape(texto)
    texto = _INVISIBLES.sub("", texto)
    texto, n = _HTML_COMENTARIO.subn(" ", texto)
    conteo["html"] += n
    texto, n = _HTML_ETIQUETA.subn(" ", texto)
    conteo["html"] += n

    # 2. Minúsculas.
    texto = texto.lower()

    # 3. URLs y luego correos (así un correo dentro de una URL no se cuenta dos veces).
    texto, n = _URL_LIMPIEZA.subn(" urltoken ", texto)
    conteo["urltoken"] += n
    texto, n = _EMAIL.subn(" emailtoken ", texto)
    conteo["emailtoken"] += n

    # 4. Direcciones ficticias completas (antes que los lugares: "northwood" va dentro).
    texto, n = _DIRECCION.subn(r"\1 ", texto)
    conteo["borrado: dirección"] += n

    # 5. Lugares, organizaciones y nombres, como palabras completas.
    for token, termino, patron in _REEMPLAZOS_ANONIMIZADOS:
        texto, n = patron.subn(token, texto)
        if n:
            conteo[f"{token or 'borrado'}: {termino}"] += n

    # 6. Espacios: tabs, saltos de línea y espacios repetidos -> un espacio.
    texto = _ESPACIOS.sub(" ", texto).strip()
    return texto, +conteo  # +conteo quita las claves en cero


def limpiar_texto(texto):
    """Deja el texto listo para el modelo.

    Quita HTML, pasa a minúsculas, cambia URLs por "urltoken", correos por
    "emailtoken" y nombres anonimizados por "nombretoken". Borra las direcciones
    ficticias (conservando "escriba a:"), los lugares y las organizaciones
    anonimizadas. Termina normalizando espacios.
    Un valor no textual (None, NaN) da "".
    """
    return limpiar_texto_contando(texto)[0]
