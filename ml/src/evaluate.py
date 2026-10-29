"""Evaluación del clasificador (paso 1.5). No reentrena el modelo final ni cambia la selección.

Pasos:
  1. Repetir la misma división de train.py (entrenamiento / prueba por grupos).
  2. Matrices de confusión de validación cruzada de los 3 modelos, con los hiperparámetros
     de resultados_cv.json y los mismos 5 pliegues -> ml/reports/matrices_cv.png.
  3. Matriz de prueba del modelo guardado (clasificador.joblib), comprobando que da lo mismo
     que resultados_prueba.json -> ml/reports/matriz_prueba.png.
  4. F1 macro de los 3 modelos con su desviación -> ml/reports/comparacion_modelos.png.
  5. Falsos negativos y falsos positivos de prueba -> ml/reports/errores_prueba.md.
  6. Palabras con más peso hacia cada clase -> ml/reports/palabras_clave.md.

Uso (desde la raíz del proyecto):
    .venv\\Scripts\\python ml/src/evaluate.py
"""

import json
import sys
from pathlib import Path

import joblib
import matplotlib

matplotlib.use("Agg")  # sin ventanas: solo guarda archivos
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402
from sklearn.metrics import confusion_matrix  # noqa: E402
from sklearn.model_selection import cross_val_predict  # noqa: E402

CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.features import COLUMNAS_ENTRADA  # noqa: E402
from src.texto import limpiar_texto  # noqa: E402
from src.train import (  # noqa: E402
    ETIQUETAS,
    RUTA_CV,
    RUTA_DATOS,
    RUTA_MODELO,
    RUTA_PRUEBA,
    construir_modelos,
    dividir_entrenamiento_prueba,
    elegir_mejor,
    evaluar,
    pliegues,
)

CARPETA_REPORTES = CARPETA_ML / "reports"
RUTA_ORIGINAL = CARPETA_ML / "data" / "processed" / "correos.csv"  # para leer el asunto
RUTA_MATRICES_CV = CARPETA_REPORTES / "matrices_cv.png"
RUTA_MATRIZ_PRUEBA = CARPETA_REPORTES / "matriz_prueba.png"
RUTA_COMPARACION = CARPETA_REPORTES / "comparacion_modelos.png"
RUTA_ERRORES = CARPETA_REPORTES / "errores_prueba.md"
RUTA_PALABRAS = CARPETA_REPORTES / "palabras_clave.md"

DPI = 300
NOMBRES = {
    "naive_bayes": "Naive Bayes",
    "regresion_logistica": "Regresión logística",
    "svm_lineal": "SVM lineal",
}
CLASES = ["Legítimo", "Phishing"]  # mismo orden que ETIQUETAS
LARGO_EXTRACTO = 200

# Escrito a mano después de leer los errores de prueba del SVM lineal (C = 30).
# Si cambia el modelo o los datos, hay que volver a leer la tabla y reescribirlo.
ANALISIS_ERRORES = """\
Los 10 errores se concentran en **temas que comparten las dos clases**: entregas de paquetes,
cuentas y seguridad. El modelo decide por el vocabulario del tema más que por señales de
fraude (remitente, enlaces que no coinciden), que no ve. 7 de los 10 tienen un puntaje entre
-0,3 y 0,3: el modelo dudó.

- **Falsos positivos de entregas (#1 y #2, Shein).** Son los errores más seguros (1,16 y 0,94).
  "paquete", "entrega" y "estimado cliente" son de los términos con más peso hacia phishing,
  porque las campañas de paquete falso dominan esa clase (225 correos de phishing con
  "paquete" en entrenamiento frente a 4 legítimos). Una notificación de entrega real se
  parece demasiado a la falsa.
- **Llamados a iniciar sesión (#3 FP, buzón tributario).** "Ingresa" e "inicia sesión" son la
  llamada a la acción típica del phishing, aunque aquí venga de una entidad real.
- **Falsos negativos por señales de formato de SpaPhish (#1 y #2 FN).**
  - El "recibo de su compra" (#1 FN) trae un adjunto. En entrenamiento, el 38 % de los
    legítimos tiene adjuntos y solo el 3 % de los phishing, así que `n_adjuntos` pesa -1,67
    hacia legítimo.
  - El correo de "MDR en acción" (#2 FN) tiene URLs escritas en el texto. "urltoken" aparece en
    el 51 % de los legítimos y en el 11 % de los phishing (en el phishing de SpaPhish los
    enlaces casi nunca están en el texto plano), y es el término con más peso hacia legítimo
    (-1,94).
  - Las dos son características del formato del dataset, no del fraude.
- **Nombre fuera de la lista de anonimización (#4 FN).** "andros, informe de riesgo
  disponible en tu cuenta" usa un tema de cuenta genérico y nombres ("andros", "mendoza") que
  no están en `NOMBRES_ANONIMIZADOS`.
- **Evasión con caracteres invisibles (#3 FN, Amazon).** El asunto "s⁪u ⁪c­u⁪ent­a ... bloqueada"
  mete caracteres invisibles (U+00AD, U+034F, U+206A–U+206F, U+17B4) que la limpieza del paso
  1.3 no quita. Las palabras quedan partidas y el modelo no reconoce "cuenta bloqueada".
  Hay 24 correos de phishing y 3 legítimos con estos caracteres.
- **Correos legítimos de marketing o muy cortos (#4–#6 FP).** Duolingo, la verificación de
  Samsung ("account" pesa hacia phishing) y un aviso de misa con casi solo una imagen. Quedaron
  justo encima de la frontera (puntaje < 0,13)."""


# ---------------------------------------------------------------------------
# Formato
# ---------------------------------------------------------------------------


def coma(valor, decimales=3):
    """0.9522 -> '0,952': coma decimal, como en el documento en español."""
    return f"{valor:.{decimales}f}".replace(".", ",")


def titulo_modelo(nombre, hiperparametros):
    """'svm_lineal', {'modelo__C': 30.0} -> 'SVM lineal (C = 30)'."""
    partes = []
    for clave, valor in hiperparametros.items():
        simbolo = {"alpha": "α"}.get(clave.split("__")[-1], clave.split("__")[-1])
        partes.append(f"{simbolo} = {valor:g}".replace(".", ","))
    return f"{NOMBRES.get(nombre, nombre)} ({', '.join(partes)})"


def f1_macro_matriz(matriz):
    """F1 macro calculado desde una matriz 2×2 (filas real, columnas predicho)."""
    matriz = np.asarray(matriz, dtype=float)
    f1 = []
    for i in range(len(matriz)):
        tp = matriz[i, i]
        precision = tp / matriz[:, i].sum() if matriz[:, i].sum() else 0.0
        recall = tp / matriz[i, :].sum() if matriz[i, :].sum() else 0.0
        f1.append(2 * precision * recall / (precision + recall) if precision + recall else 0.0)
    return float(np.mean(f1))


# ---------------------------------------------------------------------------
# Datos
# ---------------------------------------------------------------------------


def cargar_division(ruta_limpios=RUTA_DATOS, ruta_original=RUTA_ORIGINAL):
    """La misma división de train.py, con una columna extra "asunto" (limpio) para leer errores.

    La división solo mira etiqueta y grupo, así que la columna extra no la cambia.
    """
    df = pd.read_csv(ruta_limpios, sep=",", encoding="utf-8-sig")
    original = pd.read_csv(ruta_original, sep=",", encoding="utf-8-sig", usecols=["asunto"])
    assert len(df) == len(original), "correos.csv y correos_limpios.csv no tienen las mismas filas"
    df["asunto"] = [limpiar_texto(a) for a in original["asunto"]]
    return dividir_entrenamiento_prueba(df)


# ---------------------------------------------------------------------------
# Matrices de confusión
# ---------------------------------------------------------------------------


def matrices_cv(entrenamiento, resultados_cv):
    """Matriz de confusión de validación cruzada de cada modelo.

    Usa los hiperparámetros elegidos en resultados_cv.json y los mismos pliegues por grupo
    que GridSearchCV. Cada correo de entrenamiento se predice una vez, con el modelo del
    pliegue en el que no se usó para entrenar. Devuelve {nombre: matriz 2×2}.
    """
    x = entrenamiento[COLUMNAS_ENTRADA]
    y = entrenamiento["etiqueta"]
    modelos = construir_modelos()
    matrices = {}
    for nombre, resumen in resultados_cv.items():
        pipeline = modelos[nombre][0].set_params(**resumen["mejores_hiperparametros"])
        predicho = cross_val_predict(
            pipeline, x, y, groups=entrenamiento["grupo"], cv=pliegues(), n_jobs=-1
        )
        matrices[nombre] = confusion_matrix(y, predicho, labels=ETIQUETAS)
    return matrices


def matriz_prueba(modelo, nombre, prueba, esperado):
    """Evalúa el modelo guardado en prueba y comprueba que coincide con resultados_prueba.json.

    Devuelve (matriz 2×2, predicciones). Falla con AssertionError si algo no coincide
    (por ejemplo, si el .joblib o la división no son los del paso 1.4).
    """
    resultado = {"modelo": nombre, **evaluar(modelo, prueba)}
    assert resultado == esperado, (
        "La evaluación no coincide con resultados_prueba.json:\n"
        f"  calculado: {resultado}\n  guardado:  {esperado}"
    )
    matriz = np.array(resultado["matriz_confusion"]["filas_real_columnas_predicho"])
    return matriz, modelo.predict(prueba[COLUMNAS_ENTRADA])


def figura_matrices(matrices, ruta):
    """Dibuja una o varias matrices 2×2 lado a lado. matrices = {título: matriz}.

    Escala de grises: se lee igual impresa en blanco y negro. Cada celda muestra el número
    de correos y el porcentaje de su fila (de la clase real).
    """
    n = len(matrices)
    fig, ejes = plt.subplots(1, n, figsize=(4.2 * n, 4.0), squeeze=False)
    for ax, (titulo, matriz) in zip(ejes[0], matrices.items()):
        matriz = np.asarray(matriz)
        ax.imshow(matriz, cmap="Greys", vmin=0, vmax=matriz.max())
        for i in range(2):
            fila = matriz[i].sum()
            for j in range(2):
                valor = matriz[i, j]
                porcentaje = coma(100 * valor / fila, 1) if fila else "0,0"
                color = "white" if valor > matriz.max() / 2 else "black"
                ax.text(j, i, f"{valor}\n({porcentaje} %)", ha="center", va="center",
                        color=color, fontsize=13, fontweight="bold")
        ax.set_xticks([0, 1], CLASES)
        ax.set_yticks([0, 1], CLASES)
        ax.set_xlabel("Clase predicha", fontsize=11)
        ax.set_ylabel("Clase real", fontsize=11)
        ax.set_title(titulo, fontsize=12)
    fig.tight_layout()
    return _guardar(fig, ruta)


# ---------------------------------------------------------------------------
# Comparación de modelos
# ---------------------------------------------------------------------------


def figura_comparacion(resultados_cv, elegido, ruta):
    """Barras de F1 macro (media de los 5 pliegues) con la desviación estándar como error.

    El modelo elegido va en gris oscuro con rayas, para distinguirlo también en blanco y negro.
    """
    nombres = list(resultados_cv)
    medias = [resultados_cv[m]["f1_macro"]["media"] for m in nombres]
    desviaciones = [resultados_cv[m]["f1_macro"]["desviacion"] for m in nombres]
    etiquetas = [
        titulo_modelo(m, resultados_cv[m]["mejores_hiperparametros"]).replace(" (", "\n(")
        + ("\nseleccionado" if m == elegido else "")
        for m in nombres
    ]

    fig, ax = plt.subplots(figsize=(6.4, 4.4))
    barras = ax.bar(
        range(len(nombres)), medias, yerr=desviaciones, capsize=8, width=0.6,
        color=["0.35" if m == elegido else "0.85" for m in nombres],
        edgecolor="black", linewidth=1, error_kw={"ecolor": "black", "elinewidth": 1.2},
    )
    for barra, m in zip(barras, nombres):
        if m == elegido:
            barra.set_hatch("//")
    for i, (media, desv) in enumerate(zip(medias, desviaciones)):
        ax.text(i, media + desv + 0.015, f"{coma(media)}\n± {coma(desv)}",
                ha="center", va="bottom", fontsize=10)
    ax.set_xticks(range(len(nombres)), etiquetas, fontsize=10)
    ax.set_ylim(0, 1.12)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: coma(v, 1)))
    ax.set_ylabel("F1 macro (validación cruzada, 5 pliegues)", fontsize=11)
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    return _guardar(fig, ruta)


def _guardar(fig, ruta):
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(ruta, dpi=DPI, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return ruta


# ---------------------------------------------------------------------------
# Análisis de errores
# ---------------------------------------------------------------------------


def separar_errores(prueba, predicho, puntaje):
    """Devuelve (falsos_negativos, falsos_positivos) con asunto, extracto y puntaje.

    Falso negativo: phishing que el modelo dejó pasar como legítimo (el más grave).
    Falso positivo: legítimo marcado como phishing.
    puntaje > 0 empuja hacia phishing; cerca de 0 = el modelo dudó. Se ordenan del error
    más seguro (puntaje más lejos de 0) al más dudoso.
    """
    tabla = pd.DataFrame(
        {
            "asunto": prueba["asunto"].to_numpy(),
            "texto": prueba["texto"].str.slice(0, LARGO_EXTRACTO).to_numpy(),
            "puntaje": np.asarray(puntaje, dtype=float),
        }
    )
    real = prueba["etiqueta"].to_numpy()
    predicho = np.asarray(predicho)

    def ordenar(parte):
        orden = parte["puntaje"].abs().sort_values(ascending=False).index
        return parte.loc[orden].reset_index(drop=True)

    falsos_negativos = ordenar(tabla[(real == "phishing") & (predicho == "legitimo")])
    falsos_positivos = ordenar(tabla[(real == "legitimo") & (predicho == "phishing")])
    return falsos_negativos, falsos_positivos


def _celda(valor):
    if isinstance(valor, float):
        return coma(valor)
    return " ".join(str(valor).split()).replace("|", "\\|")  # sin saltos de línea ni "|"


def tabla_markdown(df, encabezados):
    """Tabla Markdown. encabezados = {columna: título}. Escapa "|" y quita saltos de línea."""
    lineas = [
        "| # | " + " | ".join(encabezados.values()) + " |",
        "|---|" + "---|" * len(encabezados),
    ]
    for i, fila in enumerate(df.itertuples(index=False), start=1):
        valores = [_celda(getattr(fila, columna)) for columna in encabezados]
        lineas.append(f"| {i} | " + " | ".join(valores) + " |")
    return "\n".join(lineas)


def escribir_errores(falsos_negativos, falsos_positivos, analisis, ruta, modelo="svm_lineal"):
    encabezados = {
        "asunto": "Asunto (limpio)",
        "texto": f"Primeros {LARGO_EXTRACTO} caracteres del texto limpio",
        "puntaje": "Puntaje",
    }
    contenido = f"""# Errores del modelo en el conjunto de prueba (paso 1.5)

Generado por `ml/src/evaluate.py` con `{modelo}` (`ml/models/clasificador.joblib`).

- **Falsos negativos** (phishing clasificado como legítimo): {len(falsos_negativos)}
- **Falsos positivos** (legítimo clasificado como phishing): {len(falsos_positivos)}

El texto es el que ve el modelo: ya limpio (urltoken, emailtoken, nombretoken, sin HTML).
**Puntaje**: salida de `decision_function`. Mayor que 0 empuja hacia phishing; cerca de 0
significa que el modelo dudó. Cada tabla va del error más seguro al más dudoso.

## Falsos negativos (phishing que pasó como legítimo)

{tabla_markdown(falsos_negativos, encabezados)}

## Falsos positivos (legítimo marcado como phishing)

{tabla_markdown(falsos_positivos, encabezados)}

## Patrones comunes

{analisis}
"""
    Path(ruta).write_text(contenido, encoding="utf-8")
    return Path(ruta)


# ---------------------------------------------------------------------------
# Palabras clave del modelo
# ---------------------------------------------------------------------------


def palabras_clave(modelo, entrenamiento, n=10):
    """Términos de TF-IDF con más peso hacia cada clase en un modelo lineal.

    Devuelve (hacia_phishing, hacia_legitimo, pesos_numericas). Las dos tablas tienen
    termino, peso y en cuántos correos de entrenamiento de cada clase aparece el término.
    Un término con mucho peso que solo sale en una clase y en pocos correos puede ser un
    atajo (por ejemplo, un nombre propio) en vez de una señal general.
    """
    preprocesador = modelo.named_steps["features"]
    clasificador = modelo.named_steps["modelo"]
    # coef_ > 0 empuja hacia classes_[1]; debe ser phishing.
    assert list(clasificador.classes_) == ETIQUETAS, clasificador.classes_

    nombres = preprocesador.get_feature_names_out()
    pesos = np.ravel(clasificador.coef_[0])
    tfidf = preprocesador.named_transformers_["texto"]
    vocabulario = tfidf.get_feature_names_out()
    # El bloque de texto va primero en el ColumnTransformer.
    assert all(nombre.startswith("texto__") for nombre in nombres[: len(vocabulario)])
    pesos_texto = pesos[: len(vocabulario)]

    presente = tfidf.transform(entrenamiento["texto"]) > 0
    etiqueta = entrenamiento["etiqueta"].to_numpy()
    en_phishing = np.asarray(presente[etiqueta == "phishing"].sum(axis=0)).ravel()
    en_legitimo = np.asarray(presente[etiqueta == "legitimo"].sum(axis=0)).ravel()

    def tabla(indices):
        return pd.DataFrame(
            {
                "termino": vocabulario[indices],
                "peso": pesos_texto[indices],
                "correos_phishing": en_phishing[indices],
                "correos_legitimo": en_legitimo[indices],
            }
        )

    orden = np.argsort(pesos_texto)
    hacia_phishing = tabla(orden[::-1][:n])
    hacia_legitimo = tabla(orden[:n])
    pesos_numericas = {
        nombre.split("__", 1)[1]: float(peso)
        for nombre, peso in zip(nombres, pesos)
        if nombre.startswith("numericas__")
    }
    return hacia_phishing, hacia_legitimo, pesos_numericas


def escribir_palabras_clave(hacia_phishing, hacia_legitimo, pesos_numericas, conteo_clases, ruta):
    encabezados = {
        "termino": "Término",
        "peso": "Peso",
        "correos_phishing": f"Correos phishing (de {conteo_clases['phishing']})",
        "correos_legitimo": f"Correos legítimos (de {conteo_clases['legitimo']})",
    }
    numericas = ", ".join(f"`{k}` {coma(v)}" for k, v in pesos_numericas.items())
    contenido = f"""# Palabras clave del modelo seleccionado (paso 1.5)

Generado por `ml/src/evaluate.py` desde los coeficientes del SVM lineal guardado.
Peso positivo empuja hacia phishing; negativo, hacia legítimo. Las columnas de correos
cuentan en cuántos correos de **entrenamiento** de cada clase aparece el término.
Un término fuerte que solo sale en una clase y en pocos correos puede ser un atajo.

## Hacia phishing

{tabla_markdown(hacia_phishing, encabezados)}

## Hacia legítimo

{tabla_markdown(hacia_legitimo, encabezados)}

## Columnas numéricas

Pesos (tras log1p y escala a [0, 1]): {numericas}.
"""
    Path(ruta).write_text(contenido, encoding="utf-8")
    return Path(ruta)


# ---------------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------------


def _leer_json(ruta):
    return json.loads(Path(ruta).read_text(encoding="utf-8"))


def main():
    resultados_cv = _leer_json(RUTA_CV)
    esperado = _leer_json(RUTA_PRUEBA)
    elegido = elegir_mejor(resultados_cv)
    assert elegido == esperado["modelo"], "La selección por CV no coincide con el modelo guardado"

    entrenamiento, prueba = cargar_division()
    assert len(prueba) == esperado["correos"], "La división no es la del paso 1.4"
    print(f"1) División repetida: {len(entrenamiento)} entrenamiento, {len(prueba)} prueba")

    print("2) Matrices de validación cruzada (filas real, columnas predicho; legítimo, phishing):")
    matrices = matrices_cv(entrenamiento, resultados_cv)
    for nombre, matriz in matrices.items():
        print(f"   {nombre:<20} {matriz.tolist()}  F1 macro de las predicciones juntas "
              f"{f1_macro_matriz(matriz):.3f} (media por pliegue en el JSON: "
              f"{resultados_cv[nombre]['f1_macro']['media']:.3f})")
    titulos = {titulo_modelo(m, resultados_cv[m]["mejores_hiperparametros"]): matrices[m]
               for m in matrices}
    print(f"   Guardado en {figura_matrices(titulos, RUTA_MATRICES_CV)}")

    modelo = joblib.load(RUTA_MODELO)
    matriz, predicho = matriz_prueba(modelo, elegido, prueba, esperado)
    print(f"3) Prueba con el modelo guardado: {matriz.tolist()} = resultados_prueba.json (assert OK)")
    titulo = titulo_modelo(elegido, resultados_cv[elegido]["mejores_hiperparametros"])
    print(f"   Guardado en {figura_matrices({titulo + ', prueba': matriz}, RUTA_MATRIZ_PRUEBA)}")

    print(f"4) Guardado en {figura_comparacion(resultados_cv, elegido, RUTA_COMPARACION)}")

    puntaje = modelo.decision_function(prueba[COLUMNAS_ENTRADA])
    falsos_negativos, falsos_positivos = separar_errores(prueba, predicho, puntaje)
    print(f"5) Errores: {len(falsos_negativos)} falsos negativos, {len(falsos_positivos)} falsos positivos")
    for titulo_tabla, tabla in [("FN", falsos_negativos), ("FP", falsos_positivos)]:
        for fila in tabla.itertuples(index=False):
            print(f"   {titulo_tabla} {fila.puntaje:+.2f} | {fila.asunto[:70]}")
    print(f"   Guardado en {escribir_errores(falsos_negativos, falsos_positivos, ANALISIS_ERRORES, RUTA_ERRORES, elegido)}")

    hacia_phishing, hacia_legitimo, pesos_numericas = palabras_clave(modelo, entrenamiento)
    print("6) Palabras clave (peso, correos phishing / legítimos en entrenamiento):")
    for lado, tabla in [("phishing", hacia_phishing), ("legitimo", hacia_legitimo)]:
        print(f"   Hacia {lado}:")
        for fila in tabla.itertuples(index=False):
            print(f"     {fila.termino:<28} {fila.peso:+.3f}  {fila.correos_phishing:>4} / {fila.correos_legitimo:<4}")
    print(f"   Numéricas: { {k: round(v, 3) for k, v in pesos_numericas.items()} }")
    conteo = entrenamiento["etiqueta"].value_counts().to_dict()
    print(f"   Guardado en {escribir_palabras_clave(hacia_phishing, hacia_legitimo, pesos_numericas, conteo, RUTA_PALABRAS)}")


if __name__ == "__main__":
    main()
