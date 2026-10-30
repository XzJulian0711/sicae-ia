"""Calibración para la explicación y el nivel de confianza del modelo v1.0 (paso 1.7).

No reentrena ni modifica clasificador.joblib. Calcula dos cosas y las guarda en ml/reports/:

1. umbral_confianza.json: a partir de qué |puntaje| la decisión deja de ser "dudosa".
   Se usan las predicciones FUERA DE PLIEGUE de la validación cruzada sobre el conjunto de
   ENTRENAMIENTO (mismos 5 pliegues por grupo y mismo C que v1.0): cada correo lo predice
   un modelo que no lo vio. El conjunto de prueba NO se usa.
2. promedios_estructurales.json: el valor promedio (ya transformado) de n_urls, n_adjuntos y
   long_cuerpo en entrenamiento, con el preprocesador congelado de v1.0. Lo usa explicar.py
   para medir las estructurales respecto del correo promedio.

Ambos archivos guardan solo cifras agregadas, nada de los correos.

Uso (desde la raíz del proyecto):
    .venv\\Scripts\\python ml/src/calibrar.py
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import cross_val_predict

CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.features import COLUMNAS_ENTRADA, COLUMNAS_NUMERICAS  # noqa: E402
from src.train import (  # noqa: E402
    RUTA_CV,
    RUTA_DATOS,
    RUTA_MODELO,
    VERSION_MODELO,
    cargar_modelo,
    construir_modelos,
    dividir_entrenamiento_prueba,
    guardar_json,
    pliegues,
)

RUTA_UMBRAL = CARPETA_ML / "reports" / "umbral_confianza.json"
RUTA_PROMEDIOS = CARPETA_ML / "reports" / "promedios_estructurales.json"
ANCHO_TRAMO = 0.25

METODO_UMBRAL = (
    "Se agrupan los correos por |puntaje| en tramos de {ancho} ([0; {ancho}), [{ancho}; {doble}), ...). "
    "El umbral es el borde superior del último tramo SEGUIDO desde 0 cuya tasa de error supera "
    "la tasa de error global. |puntaje| < umbral = confianza dudosa."
)


def calcular_umbral(puntajes, errores, ancho=ANCHO_TRAMO):
    """Umbral de "dudoso" según dónde se concentran los errores alrededor de 0.

    puntajes: decision_function de cada correo; errores: True si el correo se clasificó mal.
    Recorre los tramos de |puntaje| desde 0 mientras su tasa de error supere la global.
    Sin errores, el umbral es 0 (nada es dudoso).
    """
    absolutos = np.abs(np.asarray(puntajes, dtype=float))
    errores = np.asarray(errores, dtype=bool)
    tasa_global = float(errores.mean()) if len(errores) else 0.0

    tramos = []
    n_tramos = int(np.floor(absolutos.max() / ancho)) + 1 if len(absolutos) else 0
    for k in range(n_tramos):
        desde, hasta = k * ancho, (k + 1) * ancho
        dentro = (absolutos >= desde) & (absolutos < hasta)
        n = int(dentro.sum())
        e = int(errores[dentro].sum())
        tramos.append({"desde": round(desde, 4), "hasta": round(hasta, 4), "correos": n,
                       "errores": e, "tasa_error": round(e / n, 4) if n else None})

    umbral = 0.0
    for tramo in tramos:
        if tramo["tasa_error"] is not None and tramo["tasa_error"] > tasa_global:
            umbral = tramo["hasta"]
        else:
            break

    dudosos = absolutos < umbral
    return {
        "umbral": umbral,
        "ancho_tramo": ancho,
        "tasa_error_global": round(tasa_global, 4),
        "tramos": tramos,
        "dudosos": {
            "correos": int(dudosos.sum()),
            "porcentaje": round(float(dudosos.mean()), 4) if len(dudosos) else 0.0,
            "errores": int(errores[dudosos].sum()),
            "porcentaje_de_los_errores": round(float(errores[dudosos].sum() / errores.sum()), 4)
            if errores.sum() else 0.0,
            "tasa_error_dentro": round(float(errores[dudosos].mean()), 4) if dudosos.any() else None,
            "tasa_error_fuera": round(float(errores[~dudosos].mean()), 4) if (~dudosos).any() else None,
        },
    }


def promedios_estructurales(pipeline, entrenamiento):
    """Media de n_urls, n_adjuntos y long_cuerpo ya transformados (log1p + escala) en entrenamiento."""
    preprocesador = pipeline.named_steps["features"]
    x = preprocesador.transform(entrenamiento[COLUMNAS_ENTRADA])
    nombres = list(preprocesador.get_feature_names_out())
    promedios = {}
    for columna in COLUMNAS_NUMERICAS:
        i = nombres.index(f"numericas__{columna}")
        promedios[columna] = round(float(np.asarray(x[:, i].mean())), 6)
    return promedios


def main():
    guardado = cargar_modelo(RUTA_MODELO)
    assert guardado["version"] == VERSION_MODELO, f"Se esperaba el modelo {VERSION_MODELO}"
    resultados_cv = json.loads(RUTA_CV.read_text(encoding="utf-8"))
    c = resultados_cv["svm_lineal"]["mejores_hiperparametros"]["modelo__C"]
    assert guardado["pipeline"].named_steps["modelo"].C == c, "El C del modelo no coincide con resultados_cv.json"

    df = pd.read_csv(RUTA_DATOS, sep=",", encoding="utf-8-sig")
    entrenamiento, _ = dividir_entrenamiento_prueba(df)  # la prueba no se usa
    print(f"1) Entrenamiento: {len(entrenamiento)} correos (la prueba no se usa)")

    pipeline, _ = construir_modelos()["svm_lineal"]
    pipeline.set_params(modelo__C=c)
    puntajes = cross_val_predict(
        pipeline, entrenamiento[COLUMNAS_ENTRADA], entrenamiento["etiqueta"],
        groups=entrenamiento["grupo"], cv=pliegues(), method="decision_function", n_jobs=-1,
    )
    predicho = np.where(puntajes > 0, "phishing", "legitimo")
    errores = predicho != entrenamiento["etiqueta"].to_numpy()

    umbral = calcular_umbral(puntajes, errores)
    salida = {
        "version_modelo": guardado["version"],
        **umbral,
        "metodo": METODO_UMBRAL.format(ancho=ANCHO_TRAMO, doble=2 * ANCHO_TRAMO),
        "fuente": (
            f"Predicciones fuera de pliegue de la validación cruzada (5 pliegues por grupo, "
            f"SVM lineal C = {c:g}) sobre los {len(entrenamiento)} correos de entrenamiento. "
            "No usa el conjunto de prueba."
        ),
    }
    guardar_json(salida, RUTA_UMBRAL)
    print(f"2) Errores fuera de pliegue: {int(errores.sum())} de {len(errores)} "
          f"(tasa global {umbral['tasa_error_global']:.2%})")
    for tramo in umbral["tramos"]:
        print(f"   |puntaje| [{tramo['desde']:.2f}; {tramo['hasta']:.2f}): {tramo['correos']:4d} correos, "
              f"{tramo['errores']:3d} errores, tasa {tramo['tasa_error'] if tramo['tasa_error'] is not None else '-'}")
    d = umbral["dudosos"]
    print(f"   Umbral: {umbral['umbral']} -> dudosos {d['correos']} ({d['porcentaje']:.1%}), "
          f"con el {d['porcentaje_de_los_errores']:.0%} de los errores; tasa fuera {d['tasa_error_fuera']:.2%}")
    print(f"   Guardado en {RUTA_UMBRAL}")

    promedios = promedios_estructurales(guardado["pipeline"], entrenamiento)
    guardar_json({"version_modelo": guardado["version"], "promedios": promedios,
                  "fuente": "Media en entrenamiento, después de log1p y escala a [0, 1] "
                            "(preprocesador congelado de v1.0)."}, RUTA_PROMEDIOS)
    print(f"3) Promedios estructurales: {promedios}\n   Guardado en {RUTA_PROMEDIOS}")


if __name__ == "__main__":
    main()
