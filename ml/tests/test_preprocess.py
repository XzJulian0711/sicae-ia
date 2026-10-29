"""Pruebas de ml/src/preprocess.py con tablas pequeñas hechas a mano.

No dependen del CSV real de SpaPhish (no se sube a git).
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import pandas as pd

from src.preprocess import COLUMNAS_SALIDA, GRUPO_SIN_LETRAS, normalizar_asunto, preprocesar


def test_normalizar_asunto_junta_campanas_con_nombres_y_numeros_distintos():
    a = normalizar_asunto(">>Pablito!! - Tienes un (1) paquete 📦")
    b = normalizar_asunto("Miguelina!! - Tienes un (2) paquete 🚚")
    assert a == b == "nombretoken tienes un paquete"


def test_normalizar_asunto_quita_prefijos_de_respuesta():
    assert normalizar_asunto("RE: RV: Factura de octubre") == "factura de octubre"
    assert normalizar_asunto("Fwd: Factura de octubre") == "factura de octubre"


def test_normalizar_asunto_no_quita_re_dentro_de_palabras():
    assert normalizar_asunto("Recordatorio de pago") == "recordatorio de pago"


def test_normalizar_asunto_con_letras_decoradas_unicode():
    assert normalizar_asunto("𝐇𝐞𝐦𝐨𝐬 𝐢𝐧𝐭𝐞𝐧𝐭𝐚𝐝𝐨, ¡𝐫𝐞𝐬𝐩𝐨𝐧𝐝𝐚!") == "hemos intentado responda"


def test_normalizar_asunto_sin_letras_nunca_queda_vacio():
    assert normalizar_asunto("🔸 (1) 📦") == GRUPO_SIN_LETRAS


def tabla_correos():
    return pd.DataFrame(
        {
            "asunto": ["Pablito, su paquete", "Reunión"],
            "cuerpo": ["Entre a https://x.com", "Hola, nos vemos en <b>Hidalgo</b>"],
            "urls": ["[https://x.com]", ""],
            "n_urls": [1, 0],
            "n_adjuntos": [0, 2],
            "etiqueta": ["phishing", "legitimo"],
        }
    )


def test_preprocesar_columnas_y_valores():
    limpio, _ = preprocesar(tabla_correos())
    assert list(limpio.columns) == COLUMNAS_SALIDA
    assert limpio["texto"].tolist() == [
        "nombretoken, su paquete entre a urltoken",
        "reunión hola, nos vemos en",
    ]
    assert limpio["long_cuerpo"].tolist() == [21, 33]  # longitud del cuerpo original
    assert limpio["n_adjuntos"].tolist() == [0, 2]
    assert limpio["etiqueta"].tolist() == ["phishing", "legitimo"]
    assert limpio["grupo"].tolist() == ["nombretoken su paquete", "reunión"]


def test_preprocesar_cuenta_reemplazos():
    _, conteo = preprocesar(tabla_correos())
    assert conteo == {
        "nombretoken: pablito": 1,
        "urltoken": 1,
        "html": 2,
        "borrado: hidalgo": 1,
    }
