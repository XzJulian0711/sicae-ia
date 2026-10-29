"""Utilidades de texto para explorar y limpiar los correos.

- STOPWORDS_ES / STOPWORDS_EN: palabras vacías en español e inglés.
- tokenizar(): parte un texto en palabras limpias.
- palabras_frecuentes(): cuenta las palabras más comunes de varios textos.
- limpiar_texto(): quita HTML, cambia URLs, correos y nombres por tokens y borra
  direcciones, lugares y organizaciones anonimizadas.
"""

import html
import re
import unicodedata
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
    # Paso 1.5b: nombres que aparecen en 5 o más correos de una clase y en 1 o menos de
    # la otra (análisis de docs/metricas.md). Los que también son palabras comunes o
    # lugares (flores, luna, sol, rosa, cruz...) se dejan como limitación.
    "javier pérez", "roberto luna", "daniel flores", "mariana solís", "javier soto",
    "marcos díaz", "andrea sofía", "diana soto", "ricardo salgado",
    "alejandro", "rodolfo", "fernando", "vidal", "jimena", "manuel", "hernández",
    "calderón", "valeria", "ortega", "sánchez", "sanchez", "guzmán", "beltrán",
    "francisco", "lopez", "inés", "eric", "alfredo", "smith", "madero", "josé",
    "romero", "arturo", "isabel",
    # Al final: "ricardo vargas" y "ricardo salas" ya quedaron como "ricardo nombretoken".
    "ricardo nombretoken",
    # Después de lo anterior: nombres de relleno que la regla de saludos no cubre porque
    # las plantillas los escriben en minúscula ("fallo en la entrega para ricardo!").
    "ricardo", "lópez", "genovevo",
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
# Caracteres invisibles: los deja &zwnj; y similares, y el phishing los mete dentro de las
# palabras para partirlas ("c\u00adu\u2060enta" se ve como "cuenta"). NFKC no los quita.
# Guion suave, combinador invisible, marcas de dirección, rellenos de Hangul y Mongol,
# espacios de ancho cero, selectores de variación y BOM.
_INVISIBLES = re.compile(
    "[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f"
    "\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]"
)
# Número suelto como palabra: "10", "2020", "14,520.75", "24/7", "55-1234". No toca códigos
# con letras ("9qpnp-f9utof") ni números pegados a letras ("id2092").
_NUMERO = re.compile(r"(?<!\w)\d+(?:[.,:/-]\d+)*(?!\w)")
# URL: http(s):// o www. hasta un espacio, comilla o < >. Va antes que el correo.
_URL_LIMPIEZA = re.compile(r"(?:https?://|www\.)[^\s<>\"']+")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_ESPACIOS = re.compile(r"\s+")

# Regla de saludos (paso 1.5b): el nombre que sigue a un saludo o título se cambia por
# "nombretoken", aunque no esté en NOMBRES_ANONIMIZADOS. Se aplica ANTES de pasar a
# minúsculas, porque se reconoce el nombre por la mayúscula inicial.
#   "Estimada Sra. María López:"  ->  "Estimada Sra. nombretoken:"
# Los saludos y títulos se pueden encadenar ("Estimado Dr.") y no distinguen mayúsculas.
# Sr., Sra., Srta., Dr. y Dra. solo cuentan CON punto: sin punto "Dr" suele ser "Drive" en
# una dirección ("550 Technology Dr Ste 100").
# Los nombres: de 1 a 3 palabras en la misma línea, cada una con mayúscula inicial y el
# resto en minúscula ("Juan", no "SAT").
_SALUDO = re.compile(
    r"(?i:(?<!\w)(?:(?:estimad[oa]s?|hola|querid[oa]s?"
    r"|(?:sr|dr)\.?/(?:sra|dra)\.|(?:srta|sra|sr|dra|dr)\.)[ \t]*,?[ \t]*)+)"
    r"(?P<nombres>[A-ZÁÉÍÓÚÑ][a-záéíóúüñ]+(?:[ \t]+[A-ZÁÉÍÓÚÑ][a-záéíóúüñ]+){0,2})(?!\w)"
)
# Palabra escrita toda en minúscula, suelta: no pegada a "@" ni parte de "laura.mendez".
_MINUSCULA = re.compile(r"(?<![\w@.])[a-záéíóúüñ]+(?![\w@]|\.\w)")
# Palabras con mayúscula después de un saludo que NO son nombres ("Estimado Cliente").
SALUDOS_GENERICOS = frozenset(
    """
    cliente clientes usuario usuaria usuarios usuarias equipo equipos señor señora
    señores señoras amigo amiga amigos amigas colega colegas compañero compañera
    compañeros compañeras todos todas
    doctor doctora doctores asegurado asegurada profesor profesora profesores
    """.split()
)


def _quitar_html_y_ocultos(texto, conteo):
    """Entidades HTML, NFKC, caracteres invisibles, comentarios y etiquetas HTML.

    Es el primer paso de limpiar_texto_contando() y de palabras_minuscula().
    """
    texto = html.unescape(texto)
    # NFKC convierte letras "decoradas" en normales: "𝐇𝐞𝐦𝐨𝐬" -> "Hemos". El phishing las
    # usa para esquivar filtros; sin esto, "𝐞𝐧" y "en" serían palabras distintas.
    texto = unicodedata.normalize("NFKC", texto)
    texto, n = _INVISIBLES.subn("", texto)
    conteo["invisibles"] += n
    texto, n = _HTML_COMENTARIO.subn(" ", texto)
    conteo["html"] += n
    texto, n = _HTML_ETIQUETA.subn(" ", texto)
    conteo["html"] += n
    return texto


def palabras_minuscula(textos, minimo=3):
    """Palabras que aparecen escritas en minúscula al menos `minimo` veces en los textos.

    Sirve para que la regla de saludos no tome como nombre una palabra normal que va con
    mayúscula por empezar la frase ("Querido Luis Tienes (1) mensaje": "tienes" sale muchas
    veces en minúscula; "Luis" casi nunca). Antes de contar se quitan URLs y correos, porque
    los nombres aparecen en minúscula dentro de ellos ("ricardo.lopez@...").
    Solo recibe textos: no usa las etiquetas phishing / legítimo.
    """
    conteo = Counter()
    for texto in textos:
        if not isinstance(texto, str):
            continue
        texto = _quitar_html_y_ocultos(texto, Counter())
        texto = _EMAIL.sub(" ", _URL_LIMPIEZA.sub(" ", texto))
        conteo.update(_MINUSCULA.findall(texto))
    return frozenset(palabra for palabra, veces in conteo.items() if veces >= minimo)


def _es_corte(palabra, palabras_comunes):
    """True si la palabra con mayúscula NO parece nombre: la regla de saludos se detiene ahí."""
    minuscula = palabra.lower()
    return (
        minuscula in SALUDOS_GENERICOS
        or minuscula in STOPWORDS_ES
        or minuscula in STOPWORDS_EN
        or minuscula in palabras_comunes
    )


def _reemplazar_saludo(coincidencia, palabras_comunes=frozenset()):
    """Cambia por "nombretoken" las palabras iniciales que parecen nombre.

    Se detiene en la primera palabra genérica, vacía o común en minúscula:
    "Hola Juan Para" -> "Hola nombretoken Para". Si la primera ya es de corte
    ("Estimado Cliente"), no cambia nada.
    """
    nombres = coincidencia.group("nombres")
    palabras = nombres.split()
    n = 0
    for palabra in palabras:
        if _es_corte(palabra, palabras_comunes):
            break
        n += 1
    if n == 0:
        return coincidencia.group(0)
    resto = " ".join(palabras[n:])
    inicio = coincidencia.group(0)[: coincidencia.start("nombres") - coincidencia.start()]
    return inicio + "nombretoken" + (" " + resto if resto else "")


def _contar_saludo(coincidencia, conteo, palabras_comunes):
    """_reemplazar_saludo() que además suma 1 a conteo["nombretoken: saludo"] si cambió algo."""
    nuevo = _reemplazar_saludo(coincidencia, palabras_comunes)
    if nuevo != coincidencia.group(0):
        conteo["nombretoken: saludo"] += 1
    return nuevo


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


def limpiar_texto_contando(texto, palabras_comunes=frozenset()):
    """Igual que limpiar_texto(), pero también devuelve cuántos reemplazos hizo.

    Devuelve (texto_limpio, conteo). Las claves del conteo son "html", "urltoken",
    "emailtoken", "borrado: dirección", "nombretoken: saludo", "<token>: <término>"
    (por ejemplo "nombretoken: pablito") y "borrado: <término>" (por ejemplo "borrado: myown").
    palabras_comunes: salida de palabras_minuscula(); ver limpiar_texto().
    """
    conteo = Counter()
    if not isinstance(texto, str):
        return "", conteo

    # 1. HTML: entidades (&aacute; -> á), NFKC, invisibles, comentarios y etiquetas reales.
    texto = _quitar_html_y_ocultos(texto, conteo)

    # 1b. Nombre después de un saludo o título (necesita las mayúsculas, va antes del paso 2).
    texto = _SALUDO.sub(lambda m: _contar_saludo(m, conteo, palabras_comunes), texto)

    # 2. Minúsculas.
    texto = texto.lower()

    # 3. URLs y luego correos (así un correo dentro de una URL no se cuenta dos veces).
    # Las URL se BORRAN: en SpaPhish casi nunca están en el texto del phishing (van en la
    # columna urls), así que "urltoken" era un atajo hacia legítimo. La cantidad de enlaces
    # sigue llegando al modelo en la columna numérica n_urls.
    texto, n = _URL_LIMPIEZA.subn(" ", texto)
    conteo["borrado: url"] += n
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

    # 6. Números sueltos -> "numtoken" (después de las direcciones, que necesitan los dígitos).
    # Evita que el modelo memorice fechas o cantidades de un solo correo ("10 marzo").
    texto, n = _NUMERO.subn("numtoken", texto)
    conteo["numtoken"] += n

    # 7. Espacios: tabs, saltos de línea y espacios repetidos -> un espacio.
    texto = _ESPACIOS.sub(" ", texto).strip()
    return texto, +conteo  # +conteo quita las claves en cero


def limpiar_texto(texto, palabras_comunes=frozenset()):
    """Deja el texto listo para el modelo.

    Quita HTML, cambia por "nombretoken" el nombre que sigue a un saludo, pasa a
    minúsculas, cambia URLs por "urltoken", correos por "emailtoken" y nombres
    anonimizados por "nombretoken". Borra las direcciones ficticias (conservando
    "escriba a:"), los lugares y las organizaciones anonimizadas. Termina normalizando
    espacios. Un valor no textual (None, NaN) da "".

    palabras_comunes: palabras que aparecen muchas veces en minúscula en el corpus
    (palabras_minuscula()). La regla de saludos no las toma como nombre. Sin ellas, la
    regla solo se detiene en palabras genéricas y stopwords.
    """
    return limpiar_texto_contando(texto, palabras_comunes)[0]
