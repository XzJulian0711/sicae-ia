"""Pruebas de ml/src/texto.py con textos cortos hechos a mano.

Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import math

from src.texto import STOPWORDS_ES, palabras_frecuentes, tokenizar


def test_tokenizar_pasa_a_minusculas_y_conserva_tildes_y_enie():
    assert tokenizar("Contraseña BANCARIA Verificación") == [
        "contraseña",
        "bancaria",
        "verificación",
    ]


def test_tokenizar_quita_urls():
    texto = "Entre aquí https://banco-falso.com/login?id=1 o en www.otro.es ya"
    # Las dos URLs desaparecen completas ("otro" no sale de www.otro.es).
    assert tokenizar(texto) == ["entre", "aquí"]


def test_tokenizar_ignora_numeros_y_palabras_cortas():
    assert tokenizar("Pague 300 euros en 24 h ya") == ["pague", "euros"]


def test_tokenizar_valor_no_textual_da_lista_vacia():
    assert tokenizar(None) == []
    assert tokenizar(math.nan) == []


def test_stopwords_son_minusculas():
    assert all(p == p.lower() for p in STOPWORDS_ES)
    assert "para" in STOPWORDS_ES and "cuenta" not in STOPWORDS_ES


def test_palabras_frecuentes_quita_stopwords_y_ordena():
    textos = [
        "Su cuenta está bloqueada",
        "Verifique su cuenta para evitar el bloqueo",
        "La cuenta del banco",
    ]
    resultado = palabras_frecuentes(textos, n=2)
    assert resultado[0] == ("cuenta", 3)
    assert len(resultado) == 2
    assert all(palabra not in STOPWORDS_ES for palabra, _ in resultado)


def test_palabras_frecuentes_respeta_n():
    textos = ["uno dos tres cuatro cinco seis siete"]
    assert len(palabras_frecuentes(textos, n=3, stopwords=frozenset())) == 3


def test_palabras_frecuentes_sin_textos_da_lista_vacia():
    assert palabras_frecuentes([]) == []
    assert palabras_frecuentes(["", None]) == []
