"""Entrenamiento y selección del clasificador phishing vs legitimo (paso 1.4).

Pasos:
  1. Leer ml/data/processed/correos_limpios.csv (salida de preprocess.py).
  2. Separar 20 % para prueba, sin que una campaña (grupo) quede en los dos lados.
  3. Comparar Naive Bayes, regresión logística y SVM lineal con validación cruzada
     por grupos sobre el entrenamiento -> ml/reports/resultados_cv.json.
  4. Elegir el de mayor F1 macro (empate: mayor recall de phishing).
  5. Evaluar SOLO ese modelo, una vez, en prueba -> ml/reports/resultados_prueba.json.
  6. Guardar el modelo en ml/models/clasificador.joblib.

Uso (desde la raíz del proyecto):
    .venv\\Scripts\\python ml/src/train.py
"""

import json
import sys
from pathlib import Path

import joblib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    make_scorer,
    precision_score,
    recall_score,
)
from sklearn.model_selection import GridSearchCV, StratifiedGroupKFold
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.features import COLUMNAS_ENTRADA, construir_preprocesador  # noqa: E402
from src.preprocess import RUTA_ENTRADA, calcular_palabras_comunes  # noqa: E402

RUTA_DATOS = CARPETA_ML / "data" / "processed" / "correos_limpios.csv"
# Versión del modelo guardado. v1.0 = modelo congelado del paso 1.5b (ver docs/metricas.md).
VERSION_MODELO = "v1.0"
CLAVES_MODELO = {"version", "pipeline", "palabras_minuscula"}
RUTA_CV = CARPETA_ML / "reports" / "resultados_cv.json"
RUTA_PRUEBA = CARPETA_ML / "reports" / "resultados_prueba.json"
RUTA_MODELO = CARPETA_ML / "models" / "clasificador.joblib"

SEMILLA = 42
N_PLIEGUES = 5
POSITIVA = "phishing"
ETIQUETAS = ["legitimo", "phishing"]
REJILLA_C = [0.1, 1.0, 10.0, 30.0, 100.0]  # regresión logística y SVM lineal

# Métricas de la validación cruzada. Las de clase usan phishing como clase positiva:
# es la que más cuesta fallar (un phishing que pasa como legítimo).
METRICAS = {
    "accuracy": "accuracy",
    "precision_phishing": make_scorer(precision_score, pos_label=POSITIVA, zero_division=0),
    "recall_phishing": make_scorer(recall_score, pos_label=POSITIVA, zero_division=0),
    "f1_phishing": make_scorer(f1_score, pos_label=POSITIVA, zero_division=0),
    "f1_macro": "f1_macro",
}


def pliegues():
    """StratifiedGroupKFold: mantiene la proporción de clases y no parte los grupos."""
    return StratifiedGroupKFold(n_splits=N_PLIEGUES, shuffle=True, random_state=SEMILLA)


def dividir_entrenamiento_prueba(df):
    """Usa el primer pliegue de StratifiedGroupKFold(5) como prueba (~20 %).

    Devuelve (entrenamiento, prueba). Falla con AssertionError si algún grupo
    quedara en los dos conjuntos.
    """
    assert df["grupo"].notna().all(), "Hay correos sin grupo: vuelva a correr preprocess.py"
    idx_entrenamiento, idx_prueba = next(pliegues().split(df, df["etiqueta"], groups=df["grupo"]))
    entrenamiento = df.iloc[idx_entrenamiento].reset_index(drop=True)
    prueba = df.iloc[idx_prueba].reset_index(drop=True)
    compartidos = set(entrenamiento["grupo"]) & set(prueba["grupo"])
    assert not compartidos, f"Grupos en entrenamiento y prueba a la vez: {sorted(compartidos)[:5]}"
    return entrenamiento, prueba


def construir_modelos():
    """Los tres candidatos: {nombre: (pipeline, rejilla de hiperparámetros)}."""
    return {
        "naive_bayes": (
            Pipeline([("features", construir_preprocesador()), ("modelo", MultinomialNB())]),
            # alpha: suavizado; menor = confía más en palabras poco vistas.
            {"modelo__alpha": [0.1, 0.5, 1.0]},
        ),
        "regresion_logistica": (
            Pipeline(
                [
                    ("features", construir_preprocesador()),
                    ("modelo", LogisticRegression(class_weight="balanced", max_iter=2000)),
                ]
            ),
            # C: inverso de la regularización; mayor = se ajusta más a los datos.
            # Se amplió a 30 y 100 porque con [0.1, 1, 10] el mejor quedaba en el borde (10).
            {"modelo__C": REJILLA_C},
        ),
        "svm_lineal": (
            Pipeline(
                [
                    ("features", construir_preprocesador()),
                    (
                        "modelo",
                        LinearSVC(class_weight="balanced", max_iter=5000, random_state=SEMILLA),
                    ),
                ]
            ),
            {"modelo__C": REJILLA_C},
        ),
    }


def validar(pipeline, rejilla, entrenamiento):
    """GridSearchCV por grupos. Devuelve (búsqueda ajustada, resumen de métricas)."""
    busqueda = GridSearchCV(
        pipeline,
        rejilla,
        cv=pliegues(),
        scoring=METRICAS,
        refit="f1_macro",  # elige hiperparámetros por F1 macro y reentrena con todo el train
        n_jobs=-1,
    )
    busqueda.fit(
        entrenamiento[COLUMNAS_ENTRADA],
        entrenamiento["etiqueta"],
        groups=entrenamiento["grupo"],
    )
    i = busqueda.best_index_
    resumen = {
        "mejores_hiperparametros": busqueda.best_params_,
        **{
            nombre: {
                "media": round(float(busqueda.cv_results_[f"mean_test_{nombre}"][i]), 4),
                "desviacion": round(float(busqueda.cv_results_[f"std_test_{nombre}"][i]), 4),
            }
            for nombre in METRICAS
        },
    }
    return busqueda, resumen


def elegir_mejor(resultados_cv):
    """Nombre del modelo con mayor F1 macro medio; si empatan, mayor recall de phishing."""
    return max(
        resultados_cv,
        key=lambda m: (
            resultados_cv[m]["f1_macro"]["media"],
            resultados_cv[m]["recall_phishing"]["media"],
        ),
    )


def evaluar(modelo, prueba):
    """Métricas del modelo final en el conjunto de prueba."""
    real = prueba["etiqueta"]
    predicho = modelo.predict(prueba[COLUMNAS_ENTRADA])
    matriz = confusion_matrix(real, predicho, labels=ETIQUETAS)
    return {
        "correos": int(len(prueba)),
        "accuracy": round(accuracy_score(real, predicho), 4),
        "precision_phishing": round(precision_score(real, predicho, pos_label=POSITIVA), 4),
        "recall_phishing": round(recall_score(real, predicho, pos_label=POSITIVA), 4),
        "f1_phishing": round(f1_score(real, predicho, pos_label=POSITIVA), 4),
        "f1_macro": round(f1_score(real, predicho, average="macro"), 4),
        "matriz_confusion": {
            "orden": ETIQUETAS,
            "filas_real_columnas_predicho": matriz.tolist(),
        },
    }


def guardar_modelo(pipeline, palabras_comunes, ruta, version=VERSION_MODELO):
    """Guarda en un solo archivo todo lo que el API necesita para clasificar un correo.

    - "pipeline": características + clasificador entrenado.
    - "palabras_minuscula": lista que usa limpiar_texto() para la regla de saludos.
    - "version": para saber qué modelo está cargado.
    """
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {"version": version, "pipeline": pipeline, "palabras_minuscula": sorted(palabras_comunes)},
        ruta,
    )
    return ruta


def cargar_modelo(ruta):
    """Lee el archivo de guardar_modelo(). Devuelve un dict con version, pipeline y
    palabras_minuscula (como frozenset, listo para limpiar_texto()).

    Falla con AssertionError si el archivo tiene otro formato (por ejemplo, el de antes
    de v1.0, que guardaba solo el pipeline).
    """
    datos = joblib.load(ruta)
    assert isinstance(datos, dict) and set(datos) == CLAVES_MODELO, (
        f"{ruta} no tiene el formato esperado {sorted(CLAVES_MODELO)}: vuelva a correr train.py"
    )
    return {**datos, "palabras_minuscula": frozenset(datos["palabras_minuscula"])}


def guardar_json(datos, ruta):
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def imprimir_tabla(resultados_cv, elegido):
    columnas = ["accuracy", "precision_phishing", "recall_phishing", "f1_phishing", "f1_macro"]
    cortas = ["accuracy", "prec_phish", "rec_phish", "f1_phish", "f1_macro"]
    print(f"   {'modelo':<22}" + "".join(f"{c:>17}" for c in cortas))
    for nombre, r in resultados_cv.items():
        celdas = "".join(f"{r[c]['media']:>10.3f} ± {r[c]['desviacion']:.3f}" for c in columnas)
        marca = " <- elegido" if nombre == elegido else ""
        print(f"   {nombre:<22}{celdas}{marca}")


def main():
    df = pd.read_csv(RUTA_DATOS, sep=",", encoding="utf-8-sig")
    print(f"1) Leídos {len(df)} correos de {RUTA_DATOS.name} ({df['grupo'].nunique()} grupos)")

    entrenamiento, prueba = dividir_entrenamiento_prueba(df)
    print("2) División por grupos (ningún grupo en ambos conjuntos):")
    for nombre, parte in [("entrenamiento", entrenamiento), ("prueba", prueba)]:
        conteo = parte["etiqueta"].value_counts()
        print(
            f"   {nombre:<14} {len(parte):>5} correos ({len(parte) / len(df):.0%}): "
            f"{conteo.get('phishing', 0)} phishing, {conteo.get('legitimo', 0)} legitimo, "
            f"{parte['grupo'].nunique()} grupos"
        )

    print(f"3) Validación cruzada ({N_PLIEGUES} pliegues por grupo) sobre entrenamiento...")
    resultados_cv, busquedas = {}, {}
    for nombre, (pipeline, rejilla) in construir_modelos().items():
        busquedas[nombre], resultados_cv[nombre] = validar(pipeline, rejilla, entrenamiento)
        print(f"   {nombre}: mejores hiperparámetros {resultados_cv[nombre]['mejores_hiperparametros']}")
    guardar_json(resultados_cv, RUTA_CV)

    elegido = elegir_mejor(resultados_cv)
    print("4) Resultados de validación cruzada (media ± desviación entre pliegues):")
    imprimir_tabla(resultados_cv, elegido)
    print(f"   Guardado en {RUTA_CV}")

    modelo = busquedas[elegido].best_estimator_
    resultados_prueba = {"modelo": elegido, **evaluar(modelo, prueba)}
    guardar_json(resultados_prueba, RUTA_PRUEBA)
    print(f"5) Prueba ({resultados_prueba['correos']} correos, una sola evaluación) con {elegido}:")
    for clave in ["accuracy", "precision_phishing", "recall_phishing", "f1_phishing", "f1_macro"]:
        print(f"   {clave:<20} {resultados_prueba[clave]:.3f}")
    print(f"   Matriz (filas real, columnas predicho, orden {ETIQUETAS}): "
          f"{resultados_prueba['matriz_confusion']['filas_real_columnas_predicho']}")
    print(f"   Guardado en {RUTA_PRUEBA}")

    # Misma lista que usó preprocess.py para limpiar (se calcula igual, desde correos.csv).
    correos = pd.read_csv(RUTA_ENTRADA, sep=",", encoding="utf-8-sig")
    palabras_comunes = calcular_palabras_comunes(correos)
    guardar_modelo(modelo, palabras_comunes, RUTA_MODELO)
    print(f"6) Modelo {VERSION_MODELO} guardado en {RUTA_MODELO} "
          f"(pipeline + {len(palabras_comunes)} palabras en minúscula)")


if __name__ == "__main__":
    main()
