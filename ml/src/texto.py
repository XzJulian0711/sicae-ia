"""Utilidades de texto para explorar los correos.

- STOPWORDS_ES: palabras vacías en español (no aportan significado).
- tokenizar(): parte un texto en palabras limpias.
- palabras_frecuentes(): cuenta las palabras más comunes de varios textos.
"""

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
