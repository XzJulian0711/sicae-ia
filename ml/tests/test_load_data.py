"""Pruebas de ml/sicae_ml/load_data.py con tablas pequeñas hechas a mano.

No dependen del CSV real de SpaPhish (no se sube a git).
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import pandas as pd
import pytest

from sicae_ml.load_data import (
    filtrar_filas,
    guardar,
    seleccionar_y_renombrar,
    verificar_conteos,
)

CUERPO_OK = "x" * 40


def tabla_cruda():
    """Imita el CSV crudo: 3 correos, con columnas que deben descartarse."""
    return pd.DataFrame(
        {
            "hash": ["a", "b", "c"],
            "subject": ["Su paquete", "Factura", "Reunión"],
            "body": [CUERPO_OK, CUERPO_OK, CUERPO_OK],
            "date": ["07/06/2024", "08/06/2024", "09/06/2024"],
            "url_count": [2, 1, 0],
            "urls": ["[http://a.com],[http://b.com]", "[http://c.com]", None],
            "attachments_count": [0, 1, 0],
            "Label": [1, 1, 0],
            "authority": [1, 0, 0],
        }
    )


def test_verificar_conteos_acepta_conteos_correctos():
    verificar_conteos(tabla_cruda(), total=3, phishing=2, legitimo=1)


def test_verificar_conteos_falla_si_no_coinciden():
    with pytest.raises(ValueError):
        verificar_conteos(tabla_cruda(), total=3, phishing=1, legitimo=2)


def test_seleccionar_y_renombrar():
    resultado = seleccionar_y_renombrar(tabla_cruda())

    assert list(resultado.columns) == ["asunto", "cuerpo", "urls", "n_urls", "n_adjuntos", "etiqueta"]
    assert list(resultado["etiqueta"]) == ["phishing", "phishing", "legitimo"]
    assert resultado.loc[2, "urls"] == ""


def test_seleccionar_falla_con_label_desconocido():
    tabla = tabla_cruda()
    tabla.loc[0, "Label"] = 2
    with pytest.raises(ValueError):
        seleccionar_y_renombrar(tabla)


def test_filtrar_filas():
    tabla = pd.DataFrame(
        {
            "asunto": [None, "   ", "Corto", "Justo", "Normal"],
            "cuerpo": [CUERPO_OK, CUERPO_OK, "x" * 29, "x" * 30, CUERPO_OK],
        }
    )

    limpio, n_sin_asunto, n_cuerpo_corto = filtrar_filas(tabla)

    assert list(limpio["asunto"]) == ["Justo", "Normal"]
    assert n_sin_asunto == 2
    assert n_cuerpo_corto == 1


def test_guardar_conserva_tildes(tmp_path):
    tabla = pd.DataFrame({"asunto": ["Atención, mañana"], "etiqueta": ["legitimo"]})
    ruta = tmp_path / "salida" / "correos.csv"

    guardar(tabla, ruta)

    leido = pd.read_csv(ruta, sep=",", encoding="utf-8-sig")
    assert leido.loc[0, "asunto"] == "Atención, mañana"
