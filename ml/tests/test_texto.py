"""Pruebas de ml/sicae_ml/texto.py con textos cortos hechos a mano.

Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import math

from sicae_ml.texto import (
    STOPWORDS_EN,
    STOPWORDS_ES,
    limpiar_texto,
    limpiar_texto_contando,
    palabras_frecuentes,
    palabras_minuscula,
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


def test_limpiar_convierte_letras_decoradas_unicode_en_normales():
    assert limpiar_texto("𝐇𝐞𝐦𝐨𝐬 𝐢𝐧𝐭𝐞𝐧𝐭𝐚𝐝𝐨 𝑭𝑨𝑪𝑻𝑼𝑹𝑨𝑺") == "hemos intentado facturas"


def test_limpiar_conserva_texto_de_botones_entre_angulos():
    # "<<Cancelar>>" no es HTML: es el texto de un botón y debe quedarse.
    assert limpiar_texto("Clic en <<Cancelar eliminación>>") == "clic en <<cancelar eliminación>>"


def test_limpiar_pasa_a_minusculas_y_normaliza_espacios():
    assert limpiar_texto("  URGENTE:\n\n  Verifique\tYA  ") == "urgente: verifique ya"


def test_limpiar_borra_url():
    # Paso 1.5b: las URL se borran; la cantidad queda en la columna n_urls.
    assert limpiar_texto("Entre a https://banco-falso.com/login?id=1 hoy") == "entre a hoy"
    assert limpiar_texto("o a www.otro.es") == "o a"


def test_limpiar_borra_url_entre_angulos():
    assert limpiar_texto("Ver <https://x.com/a> ahora") == "ver < > ahora"


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
    assert limpiar_texto("Reunión: 10 de mayo de 2025, sala 3") == (
        "reunión: numtoken de mayo de numtoken, sala numtoken"
    )


def test_limpiar_borra_organizacion():
    assert limpiar_texto("Titular del MyOwn 2025") == "titular del numtoken"
    assert limpiar_texto("Director General CIETEC") == "director general"
    assert limpiar_texto("Instituto de Ciencia Estelar y Microelectrónica") == (
        "instituto de ciencia y microelectrónica"
    )
    assert limpiar_texto("Convocatoria SNI 2019") == "convocatoria numtoken"


def test_limpiar_borra_organizacion_solo_como_palabra_completa():
    # "sni" no se toca dentro de "snif"; "estelar" no dentro de "constelaria".
    assert limpiar_texto("snif constelaria") == "snif constelaria"


def test_limpiar_no_reemplaza_dentro_de_otras_palabras():
    # "salas" es un nombre de la lista, pero "ensaladas" no debe cambiar.
    assert limpiar_texto("Ensaladas para las Salas") == "ensaladas para las nombretoken"
    assert limpiar_texto("ensaladas") == "ensaladas"


# ----- nombres y regla de saludos (paso 1.5b) -----


def test_limpiar_reemplaza_nombres_nuevos_de_la_lista():
    assert limpiar_texto("Envié ayer a Rodolfo") == "envié ayer a nombretoken"
    assert limpiar_texto("atte. Javier Pérez") == "atte. nombretoken"


def test_limpiar_reemplaza_ricardo_seguido_de_apellido_anonimizado():
    # "vargas" pasa a nombretoken y luego "ricardo nombretoken" queda como uno solo.
    assert limpiar_texto("firma: ricardo vargas") == "firma: nombretoken"


def test_saludo_reemplaza_nombre_y_apellido():
    assert limpiar_texto("Hola Ricardo Montoya, tu paquete") == "hola nombretoken, tu paquete"


def test_saludo_encadena_titulos():
    assert limpiar_texto("Estimada Sra. María Lantier:") == "estimada sra. nombretoken:"
    assert limpiar_texto("Estimado Dr. Daniel Kowalski") == "estimado dr. nombretoken"


def test_saludo_con_coma_y_nombre_solo():
    assert limpiar_texto("Hola, Genovevo. Inicio de sesión") == "hola, nombretoken. inicio de sesión"


def test_saludo_no_toca_palabras_genericas():
    assert limpiar_texto("Estimado Cliente, su cuenta") == "estimado cliente, su cuenta"
    assert limpiar_texto("Hola Equipo") == "hola equipo"
    assert limpiar_texto("Estimados Usuarios") == "estimados usuarios"


def test_saludo_no_toca_stopwords_y_corta_en_ellas():
    assert limpiar_texto("Hola Para todos") == "hola para todos"
    assert limpiar_texto("Hola Ana Para todos") == "hola nombretoken para todos"


def test_saludo_toma_maximo_tres_palabras():
    assert limpiar_texto("Hola Ana Luisa Mora Peña") == "hola nombretoken peña"


def test_saludo_necesita_mayuscula_y_misma_linea():
    assert limpiar_texto("hola juan") == "hola juan"
    assert limpiar_texto("Hola\nGracias por escribir") == "hola gracias por escribir"
    assert limpiar_texto("Holanda Bonita") == "holanda bonita"


def test_saludo_se_detiene_en_palabra_comun_en_minuscula():
    comunes = frozenset({"tienes"})
    assert limpiar_texto("Querido Luis Romero Tienes (1) mensaje", comunes) == (
        "querido nombretoken tienes (numtoken) mensaje"
    )


def test_saludo_no_toma_palabra_comun_como_nombre():
    assert limpiar_texto("Estimadas Familias", frozenset({"familias"})) == "estimadas familias"


def test_saludo_no_toca_doctores_ni_asegurados():
    assert limpiar_texto("Estimados Doctores y Estimada Doctora") == "estimados doctores y estimada doctora"
    assert limpiar_texto("Estimado Asegurado: su póliza") == "estimado asegurado: su póliza"


def test_limpiar_reemplaza_ricardo_lopez_y_genovevo_en_minuscula():
    assert limpiar_texto("¡Fallo en la entrega para ricardo!") == "¡fallo en la entrega para nombretoken!"
    assert limpiar_texto("Hola, genovevo.") == "hola, nombretoken."
    assert limpiar_texto("ing. Ricardo López") == "ing. nombretoken nombretoken"


def test_saludo_titulos_sin_punto_no_cuentan():
    # Sin punto, "Dr" es "Drive" en una dirección: no es un saludo.
    assert limpiar_texto("550 Technology Dr Ste 100") == "numtoken technology dr ste numtoken"
    assert limpiar_texto("Saludos Sr Gomez") == "saludos sr gomez"
    assert limpiar_texto("Sr/Sra. Mendoza") == "sr/sra. nombretoken"


def test_palabras_minuscula_cuenta_solo_minusculas_y_respeta_el_minimo():
    textos = ["Tienes un mensaje", "tienes otro", "ya tienes dos", "y tienes tres", "Luis luis", "Hola"]
    comunes = palabras_minuscula(textos, minimo=3)
    assert "tienes" in comunes  # 3 veces en minúscula (la de "Tienes" no cuenta)
    assert "luis" not in comunes  # solo 1 vez en minúscula
    assert "hola" not in comunes


def test_palabras_minuscula_ignora_urls_correos_y_usuarios():
    textos = [
        "ricardo.lopez@banco.com https://x.com/ricardo laura.mendez",
        "ricardo.lopez@banco.com https://x.com/ricardo laura.mendez",
        "ricardo.lopez@banco.com https://x.com/ricardo laura.mendez",
    ]
    comunes = palabras_minuscula(textos, minimo=3)
    assert "ricardo" not in comunes and "laura" not in comunes and "lopez" not in comunes


def test_saludo_se_cuenta_solo_si_cambia_algo():
    _, conteo = limpiar_texto_contando("Hola Ana. Estimado Cliente. Querido Pedro")
    assert conteo["nombretoken: saludo"] == 2


# ----- invisibles y numtoken (paso 1.5b) -----


def test_limpiar_quita_caracteres_invisibles_dentro_de_palabras():
    texto = "Su c­u⁠en͏ta ha sido b⁪l឴oqueada"
    limpio, conteo = limpiar_texto_contando(texto)
    assert limpio == "su cuenta ha sido bloqueada"
    assert conteo["invisibles"] == 5


def test_limpiar_cambia_numeros_sueltos_por_numtoken():
    assert limpiar_texto("Vuelo del 10 marzo 2020") == "vuelo del numtoken marzo numtoken"
    assert limpiar_texto("Saldo 14,520.75 disponible 24/7") == "saldo numtoken disponible numtoken"


def test_limpiar_no_cambia_codigos_con_letras():
    assert limpiar_texto("ID 9qpnp-f9utof y id2092") == "id 9qpnp-f9utof y id2092"


def test_limpiar_borra_direccion_antes_de_numtoken():
    texto = "Escriba a: 1 Main St, Lakeview, IL, 62841 gracias"
    assert limpiar_texto(texto) == "escriba a: gracias"


def test_limpiar_valor_no_textual_da_texto_vacio():
    assert limpiar_texto(None) == ""
    assert limpiar_texto(math.nan) == ""


def test_limpiar_contando_cuenta_cada_reemplazo():
    texto = (
        "<b>Pablito</b>, pablito: https://a.com y x@y.com en Hidalgo. "
        "Escriba a: 1 Main St, Lakeview, IL, 62841"
    )
    limpio, conteo = limpiar_texto_contando(texto)
    assert limpio == "nombretoken , nombretoken: y emailtoken en . escriba a:"
    assert conteo == {
        "html": 2,
        "borrado: url": 1,
        "emailtoken": 1,
        "borrado: dirección": 1,
        "nombretoken: pablito": 2,
        "borrado: hidalgo": 1,
    }
