"""Pruebas de ml/sicae_ml/features.py y ml/sicae_ml/train.py con correos inventados.

No dependen del CSV real ni de un modelo guardado.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import numpy as np
import pandas as pd
import pytest

from sicae_ml.features import COLUMNAS_ENTRADA, construir_preprocesador
import joblib

from sicae_ml.train import (
    VERSION_MODELO,
    cargar_modelo,
    construir_modelos,
    dividir_entrenamiento_prueba,
    elegir_mejor,
    evaluar,
    guardar_modelo,
)

TEXTO_PHISHING = [
    "nombretoken su paquete está detenido pague la tasa urltoken",
    "su cuenta será suspendida verifique sus datos urltoken urgente",
    "felicidades ganador reclame su premio urltoken hoy",
    "su suscripción caducó renovar pago urltoken",
]
TEXTO_LEGITIMO = [
    "estimados profesores les comparto la convocatoria de la maestría",
    "hola equipo adjunto el acta de la reunión del jueves saludos",
    "aviso de privacidad de datos personales del instituto",
    "invitación al seminario de investigación del viernes gracias",
]


def correos_inventados(grupos_por_clase=10, correos_por_grupo=2):
    """Tabla con la forma de correos_limpios.csv: cada grupo es una 'campaña'."""
    filas = []
    for etiqueta, textos in [("phishing", TEXTO_PHISHING), ("legitimo", TEXTO_LEGITIMO)]:
        for g in range(grupos_por_clase):
            for c in range(correos_por_grupo):
                filas.append(
                    {
                        "texto": textos[g % len(textos)] + f" variante {c}",
                        "n_urls": 3 if etiqueta == "phishing" else 8,
                        "n_adjuntos": 0 if etiqueta == "phishing" else 1,
                        "long_cuerpo": 400 + 10 * g if etiqueta == "phishing" else 1500 + 10 * g,
                        "etiqueta": etiqueta,
                        "grupo": f"{etiqueta}-{g}",
                    }
                )
    return pd.DataFrame(filas)


# ----- features.py -----


def test_preprocesador_da_valores_no_negativos_y_numericas_en_0_1():
    df = correos_inventados()
    prep = construir_preprocesador().fit(df[COLUMNAS_ENTRADA])
    nuevos = df[COLUMNAS_ENTRADA].copy()
    nuevos.loc[0, "long_cuerpo"] = 1_000_000  # mucho más largo que en el ajuste
    nuevos.loc[1, "long_cuerpo"] = 0  # más corto que en el ajuste
    x = prep.transform(nuevos).toarray()
    assert x.min() >= 0  # Naive Bayes no acepta negativos
    numericas = x[:, -3:]
    assert numericas.min() >= 0 and numericas.max() <= 1


def test_preprocesador_quita_stopwords_y_usa_pares_de_palabras():
    df = correos_inventados()
    prep = construir_preprocesador().fit(df[COLUMNAS_ENTRADA])
    vocabulario = set(prep.named_transformers_["texto"].vocabulary_)
    assert "paquete" in vocabulario
    # "su paquete está detenido": "su" y "está" son palabras vacías, se quitan antes de
    # formar los pares, así que queda el par "paquete detenido".
    assert "paquete detenido" in vocabulario
    assert "de" not in vocabulario and "the" not in vocabulario


# ----- train.py -----


def test_division_no_repite_grupos_y_tiene_ambas_clases():
    df = correos_inventados()
    entrenamiento, prueba = dividir_entrenamiento_prueba(df)
    assert set(entrenamiento["grupo"]).isdisjoint(prueba["grupo"])
    assert len(entrenamiento) + len(prueba) == len(df)
    assert set(prueba["etiqueta"]) == {"phishing", "legitimo"}
    assert 0.1 <= len(prueba) / len(df) <= 0.3  # ~20 %


def test_division_mantiene_juntos_los_correos_de_un_grupo():
    df = correos_inventados(correos_por_grupo=3)
    entrenamiento, prueba = dividir_entrenamiento_prueba(df)
    assert (prueba["grupo"].value_counts() == 3).all()
    assert (entrenamiento["grupo"].value_counts() == 3).all()


@pytest.mark.parametrize("nombre", ["naive_bayes", "regresion_logistica", "svm_lineal"])
def test_cada_pipeline_entrena_y_predice(nombre):
    df = correos_inventados()
    pipeline, rejilla = construir_modelos()[nombre]
    assert rejilla  # cada modelo tiene hiperparámetros para la búsqueda
    pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])
    predicho = pipeline.predict(df[COLUMNAS_ENTRADA])
    assert set(predicho) <= {"phishing", "legitimo"}
    assert (predicho == df["etiqueta"]).mean() >= 0.9  # datos fáciles: debe acertar casi todo


def test_evaluar_devuelve_metricas_y_matriz():
    df = correos_inventados()
    pipeline, _ = construir_modelos()["regresion_logistica"]
    pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])
    resultado = evaluar(pipeline, df)
    assert resultado["correos"] == len(df)
    assert 0 <= resultado["f1_macro"] <= 1
    matriz = np.array(resultado["matriz_confusion"]["filas_real_columnas_predicho"])
    assert matriz.sum() == len(df)


def resumen(f1_macro, recall):
    return {"f1_macro": {"media": f1_macro}, "recall_phishing": {"media": recall}}


def test_elegir_mejor_usa_f1_macro():
    resultados = {"a": resumen(0.90, 0.99), "b": resumen(0.95, 0.80)}
    assert elegir_mejor(resultados) == "b"


def test_elegir_mejor_desempata_por_recall_de_phishing():
    resultados = {"a": resumen(0.95, 0.90), "b": resumen(0.95, 0.97)}
    assert elegir_mejor(resultados) == "b"


# ----- modelo guardado (v1.0) -----


def test_guardar_y_cargar_modelo_conserva_todo(tmp_path):
    df = correos_inventados()
    pipeline, _ = construir_modelos()["svm_lineal"]
    pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])
    ruta = guardar_modelo(pipeline, {"tienes", "aviso"}, tmp_path / "modelo.joblib")

    cargado = cargar_modelo(ruta)
    assert cargado["version"] == VERSION_MODELO == "v1.0"
    assert cargado["palabras_minuscula"] == frozenset({"tienes", "aviso"})
    antes = pipeline.predict(df[COLUMNAS_ENTRADA])
    despues = cargado["pipeline"].predict(df[COLUMNAS_ENTRADA])
    assert (antes == despues).all()


def test_cargar_modelo_rechaza_el_formato_viejo(tmp_path):
    # Antes de v1.0 se guardaba solo el pipeline, sin la lista de palabras.
    pipeline, _ = construir_modelos()["naive_bayes"]
    ruta = tmp_path / "viejo.joblib"
    joblib.dump(pipeline, ruta)
    with pytest.raises(AssertionError):
        cargar_modelo(ruta)
