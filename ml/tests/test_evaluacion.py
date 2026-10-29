"""Pruebas de ml/src/evaluate.py con correos inventados.

No dependen del CSV real ni del modelo guardado. Las figuras se guardan en una carpeta
temporal de pytest (tmp_path).
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import numpy as np
import pandas as pd
import pytest
from PIL import Image

from src.evaluate import (
    cargar_division,
    coma,
    escribir_errores,
    escribir_palabras_clave,
    f1_macro_matriz,
    figura_comparacion,
    figura_matrices,
    matriz_prueba,
    matrices_cv,
    palabras_clave,
    separar_errores,
    tabla_markdown,
    titulo_modelo,
)
from src.features import COLUMNAS_ENTRADA
from src.train import construir_modelos, evaluar
from tests.test_entrenamiento import correos_inventados


def resultados_cv_inventados():
    """Misma forma que resultados_cv.json."""

    def resumen(hiper, media, desv):
        return {"mejores_hiperparametros": hiper, "f1_macro": {"media": media, "desviacion": desv}}

    return {
        "naive_bayes": resumen({"modelo__alpha": 0.5}, 0.905, 0.021),
        "regresion_logistica": resumen({"modelo__C": 100.0}, 0.950, 0.011),
        "svm_lineal": resumen({"modelo__C": 30.0}, 0.952, 0.010),
    }


def svm_entrenado(df):
    pipeline, _ = construir_modelos()["svm_lineal"]
    return pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])


def comprobar_png_300_dpi(ruta):
    assert ruta.exists() and ruta.stat().st_size > 0
    with Image.open(ruta) as imagen:
        dpi_x, dpi_y = imagen.info["dpi"]
        assert round(dpi_x) == 300 and round(dpi_y) == 300
        assert imagen.width > 500 and imagen.height > 500


# ----- formato -----


def test_coma_y_titulo_modelo_en_espanol():
    assert coma(0.95224) == "0,952"
    assert titulo_modelo("svm_lineal", {"modelo__C": 30.0}) == "SVM lineal (C = 30)"
    assert titulo_modelo("naive_bayes", {"modelo__alpha": 0.5}) == "Naive Bayes (α = 0,5)"


def test_f1_macro_matriz():
    assert f1_macro_matriz([[5, 0], [0, 5]]) == 1.0
    # F1 legítimo = 2·(1·0,5)/1,5 = 0,667; F1 phishing = 2·(0,667·1)/1,667 = 0,8
    assert f1_macro_matriz([[2, 2], [0, 4]]) == pytest.approx((2 / 3 + 0.8) / 2)


# ----- datos -----


def test_cargar_division_agrega_asunto_limpio(tmp_path):
    df = correos_inventados()
    df.to_csv(tmp_path / "limpios.csv", index=False, encoding="utf-8-sig")
    pd.DataFrame(
        {"asunto": [f"Pablito, aviso {i}" for i in range(len(df))], "cuerpo": ["hola"] * len(df)}
    ).to_csv(
        tmp_path / "original.csv", index=False, encoding="utf-8-sig"
    )
    entrenamiento, prueba = cargar_division(tmp_path / "limpios.csv", tmp_path / "original.csv")
    assert len(entrenamiento) + len(prueba) == len(df)
    assert prueba["asunto"].str.startswith("nombretoken, aviso").all()


# ----- matrices de confusión -----


def test_matrices_cv_son_2x2_y_suman_todos_los_correos():
    df = correos_inventados()
    matrices = matrices_cv(df, resultados_cv_inventados())
    assert set(matrices) == {"naive_bayes", "regresion_logistica", "svm_lineal"}
    for matriz in matrices.values():
        assert matriz.shape == (2, 2)
        assert matriz.sum() == len(df)  # cada correo se predice exactamente una vez


def test_matriz_prueba_coincide_con_lo_esperado_y_falla_si_no():
    df = correos_inventados()
    modelo = svm_entrenado(df)
    esperado = {"modelo": "svm_lineal", **evaluar(modelo, df)}
    matriz, predicho = matriz_prueba(modelo, "svm_lineal", df, esperado)
    assert matriz.sum() == len(df) and len(predicho) == len(df)

    alterado = {**esperado, "accuracy": 0.5}
    with pytest.raises(AssertionError):
        matriz_prueba(modelo, "svm_lineal", df, alterado)


def test_figura_matrices_guarda_png_a_300_dpi(tmp_path):
    matrices = {
        "Modelo A": np.array([[126, 6], [4, 140]]),
        "Modelo B": np.array([[100, 32], [20, 124]]),
    }
    comprobar_png_300_dpi(figura_matrices(matrices, tmp_path / "matrices.png"))


def test_figura_matrices_de_un_solo_panel(tmp_path):
    comprobar_png_300_dpi(figura_matrices({"Prueba": [[1, 0], [0, 1]]}, tmp_path / "una.png"))


def test_figura_comparacion_guarda_png_a_300_dpi(tmp_path):
    ruta = figura_comparacion(resultados_cv_inventados(), "svm_lineal", tmp_path / "barras.png")
    comprobar_png_300_dpi(ruta)


# ----- errores -----


def test_separar_errores_distingue_falsos_negativos_y_positivos():
    prueba = pd.DataFrame(
        {
            "asunto": ["a", "b", "c", "d", "e"],
            "texto": ["x" * 300, "texto b", "texto c", "texto d", "texto e"],
            "etiqueta": ["phishing", "phishing", "legitimo", "legitimo", "phishing"],
        }
    )
    predicho = ["legitimo", "phishing", "phishing", "legitimo", "legitimo"]
    puntaje = [-0.1, 1.5, 0.4, -2.0, -0.9]
    falsos_negativos, falsos_positivos = separar_errores(prueba, predicho, puntaje)
    assert falsos_negativos["asunto"].tolist() == ["e", "a"]  # el más seguro primero
    assert falsos_positivos["asunto"].tolist() == ["c"]
    assert len(falsos_negativos.loc[1, "texto"]) == 200  # recortado a 200 caracteres


def test_tabla_markdown_escapa_barras_y_saltos_de_linea():
    df = pd.DataFrame({"asunto": ["hola | adiós\nchao"], "puntaje": [-0.25]})
    tabla = tabla_markdown(df, {"asunto": "Asunto", "puntaje": "Puntaje"})
    lineas = tabla.splitlines()
    assert len(lineas) == 3
    assert lineas[2] == "| 1 | hola \\| adiós chao | -0,250 |"


def test_escribir_errores_crea_el_markdown(tmp_path):
    fn = pd.DataFrame({"asunto": ["a"], "texto": ["t"], "puntaje": [-0.5]})
    fp = fn.iloc[0:0]
    ruta = escribir_errores(fn, fp, "Patrón de prueba.", tmp_path / "errores.md")
    contenido = ruta.read_text(encoding="utf-8")
    assert "Falsos negativos** (phishing clasificado como legítimo): 1" in contenido
    assert "Patrón de prueba." in contenido


# ----- palabras clave -----


def test_palabras_clave_da_terminos_de_texto_hacia_cada_clase(tmp_path):
    df = correos_inventados()
    hacia_phishing, hacia_legitimo, numericas = palabras_clave(svm_entrenado(df), df, n=5)
    assert len(hacia_phishing) == 5 and len(hacia_legitimo) == 5
    assert (hacia_phishing["peso"] > 0).all() and (hacia_legitimo["peso"] < 0).all()
    assert "urltoken" in hacia_phishing["termino"].tolist()  # sale en todos los phishing inventados
    assert set(numericas) == {"n_urls", "n_adjuntos", "long_cuerpo"}
    fila = hacia_phishing.set_index("termino").loc["urltoken"]
    assert fila["correos_phishing"] == 20 and fila["correos_legitimo"] == 0

    ruta = escribir_palabras_clave(
        hacia_phishing, hacia_legitimo, numericas, {"phishing": 20, "legitimo": 20},
        tmp_path / "palabras.md",
    )
    assert "urltoken" in ruta.read_text(encoding="utf-8")
