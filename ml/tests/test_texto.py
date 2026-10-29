"""Pruebas de ml/src/texto.py con textos cortos hechos a mano.

Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import math

from src.texto import (
    STOPWORDS_EN,
    STOPWORDS_ES,
    limpiar_texto,
    limpiar_texto_contando,
    palabras_frecuentes,
    tokenizar,
)


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


# ----- limpiar_texto (paso 1.3) -----


def test_stopwords_en_son_minusculas_y_tienen_las_comunes():
    assert all(p == p.lower() for p in STOPWORDS_EN)
    assert {"the", "and", "you"} <= STOPWORDS_EN
    assert len(STOPWORDS_EN) >= 50


def test_limpiar_quita_html_y_entidades():
    texto = "<p>Su cuenta est&aacute; <strong>bloqueada</strong></p>&nbsp;<br/>Hoy"
    assert limpiar_texto(texto) == "su cuenta está bloqueada hoy"


def test_limpiar_conserva_texto_de_botones_entre_angulos():
    # "<<Cancelar>>" no es HTML: es el texto de un botón y debe quedarse.
    assert limpiar_texto("Clic en <<Cancelar eliminación>>") == "clic en <<cancelar eliminación>>"


def test_limpiar_pasa_a_minusculas_y_normaliza_espacios():
    assert limpiar_texto("  URGENTE:\n\n  Verifique\tYA  ") == "urgente: verifique ya"


def test_limpiar_reemplaza_url():
    assert limpiar_texto("Entre a https://banco-falso.com/login?id=1 hoy") == "entre a urltoken hoy"
    assert limpiar_texto("o a www.otro.es") == "o a urltoken"


def test_limpiar_reemplaza_url_entre_angulos():
    assert limpiar_texto("Ver <https://x.com/a> ahora") == "ver < urltoken > ahora"


def test_limpiar_reemplaza_correo():
    assert limpiar_texto("Escriba a Ricardo.Vargas@uhisa.edu.mx ya") == "escriba a emailtoken ya"


def test_limpiar_reemplaza_nombre():
    assert limpiar_texto(">>Pablito!! Tienes un paquete") == ">>nombretoken!! tienes un paquete"


def test_limpiar_reemplaza_nombre_con_y_sin_tilde():
    assert limpiar_texto("Luisa García y Pedro Garcia") == "luisa nombretoken y pedro nombretoken"


def test_limpiar_borra_lugar():
    assert limpiar_texto("Ciudad Central, Jalisco") == ", jalisco"
    assert limpiar_texto("Pachuca, Hidalgo.") == "pachuca, ."


def test_limpiar_borra_lugar_de_varias_palabras_con_salto_de_linea():
    assert limpiar_texto("en Ciudad\nCentral hoy") == "en hoy"


def test_limpiar_borra_direccion_y_conserva_escriba_a():
    texto = "O escriba a: 128 Willow Crest Rd Ste 402#5912, Northwood, VT, 05744 Gracias"
    assert limpiar_texto(texto) == "o escriba a: gracias"


def test_limpiar_borra_direccion_sin_dos_puntos_y_en_ingles():
    assert limpiar_texto("o escribiendo a 780 Industrial Dr Ste.1-5055 Pleasant Hill, CA 94523") == (
        "o escribiendo a"
    )
    assert limpiar_texto("Or write to: 1050 Calle del Comercio, Ste 200 #300, Dallas TX 75201") == (
        "or write to:"
    )


def test_limpiar_no_borra_texto_que_no_es_direccion():
    assert limpiar_texto("Reunión: 10 de mayo de 2025, sala 3") == "reunión: 10 de mayo de 2025, sala 3"


def test_limpiar_borra_organizacion():
    assert limpiar_texto("Titular del MyOwn 2025") == "titular del 2025"
    assert limpiar_texto("Director General CIETEC") == "director general"
    assert limpiar_texto("Instituto de Ciencia Estelar y Microelectrónica") == (
        "instituto de ciencia y microelectrónica"
    )
    assert limpiar_texto("Convocatoria SNI 2019") == "convocatoria 2019"


def test_limpiar_borra_organizacion_solo_como_palabra_completa():
    # "sni" no se toca dentro de "snif"; "estelar" no dentro de "constelaria".
    assert limpiar_texto("snif constelaria") == "snif constelaria"


def test_limpiar_no_reemplaza_dentro_de_otras_palabras():
    # "salas" es un nombre de la lista, pero "ensaladas" no debe cambiar.
    assert limpiar_texto("Ensaladas para las Salas") == "ensaladas para las nombretoken"
    assert limpiar_texto("ensaladas") == "ensaladas"


def test_limpiar_valor_no_textual_da_texto_vacio():
    assert limpiar_texto(None) == ""
    assert limpiar_texto(math.nan) == ""


def test_limpiar_contando_cuenta_cada_reemplazo():
    texto = (
        "<b>Pablito</b>, pablito: https://a.com y x@y.com en Hidalgo. "
        "Escriba a: 1 Main St, Lakeview, IL, 62841"
    )
    limpio, conteo = limpiar_texto_contando(texto)
    assert limpio == "nombretoken , nombretoken: urltoken y emailtoken en . escriba a:"
    assert conteo == {
        "html": 2,
        "urltoken": 1,
        "emailtoken": 1,
        "borrado: dirección": 1,
        "nombretoken: pablito": 2,
        "borrado: hidalgo": 1,
    }
