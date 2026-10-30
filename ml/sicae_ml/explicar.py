"""Explicación de la decisión del modelo para UN correo (paso 1.7).

El modelo v1.0 es lineal (SVM lineal): su puntaje es una suma,
    puntaje = intercepto + Σ coeficiente_i × valor_i
así que la parte de cada característica en el puntaje es EXACTA: no es una aproximación.

- Palabras (TF-IDF): contribución = coeficiente × valor TF-IDF del correo.
- Estructurales (n_urls, n_adjuntos, long_cuerpo): se miden respecto del correo PROMEDIO de
  entrenamiento, contribución = coeficiente × (valor − promedio). Así "No trae adjuntos"
  puede explicar un phishing. Lo que se resta pasa a la base:
    base = intercepto + Σ coeficiente_num × promedio_num
  y se cumple siempre: base + Σ contribuciones = decision_function.
"""

import numpy as np
import pandas as pd

from sicae_ml.features import COLUMNAS_ENTRADA

PALABRA = "palabra"
ESTRUCTURAL = "estructural"
# Tokens que pone la limpieza: no dicen nada útil al usuario ("Menciona «nombretoken»").
TOKENS_OCULTOS = {"nombretoken", "numtoken", "emailtoken"}

# Palabras sueltas que con "Menciona «…»" no se entenderían. "re", "rv", "fw" y "fwd" son los
# prefijos de respuesta o reenvío del asunto ("RE: ..."). "cliente" y "usuario" suelen venir de
# un saludo que no usa el nombre de la persona ("Estimado cliente").
ETIQUETAS_ESPECIALES = {
    "re": "El asunto es una respuesta (RE:)",
    "rv": "El correo es un reenvío",
    "fw": "El correo es un reenvío",
    "fwd": "El correo es un reenvío",
    "cliente": "Usa un saludo genérico («cliente»)",
    "usuario": "Usa un saludo genérico («usuario»)",
}

# Frase para cada columna estructural: (por debajo del promedio, por encima del promedio).
# Si el valor es 0 se usa la frase de "cero".
ETIQUETAS_ESTRUCTURALES = {
    "n_adjuntos": {"cero": "No trae adjuntos", "bajo": "Trae pocos adjuntos", "alto": "Trae adjuntos"},
    "long_cuerpo": {"cero": "El correo es corto", "bajo": "El correo es corto", "alto": "El correo es largo"},
    "n_urls": {"cero": "No trae enlaces", "bajo": "Trae pocos enlaces", "alto": "Trae muchos enlaces"},
}


def _fila(texto_limpio, n_urls, n_adjuntos, long_cuerpo):
    valores = {"texto": texto_limpio, "n_urls": n_urls, "n_adjuntos": n_adjuntos, "long_cuerpo": long_cuerpo}
    return pd.DataFrame([valores])[COLUMNAS_ENTRADA]


def contribuciones(modelo, texto_limpio, n_urls, n_adjuntos, long_cuerpo, promedios=None):
    """Parte exacta de cada característica en el puntaje del modelo.

    modelo: el pipeline de clasificador.joblib (features + SVM lineal).
    promedios: {"n_urls": ..., "n_adjuntos": ..., "long_cuerpo": ...} ya transformados
        (ml/reports/promedios_estructurales.json). Sin promedios no se centra nada.

    Devuelve (base, lista de dicts {nombre, tipo, valor, contribucion}) con
    base + Σ contribucion == decision_function del correo.
    """
    preprocesador = modelo.named_steps["features"]
    clasificador = modelo.named_steps["modelo"]
    promedios = promedios or {}

    x = preprocesador.transform(_fila(texto_limpio, n_urls, n_adjuntos, long_cuerpo))
    x = x.toarray().ravel() if hasattr(x, "toarray") else np.asarray(x).ravel()
    coef = np.ravel(clasificador.coef_)
    nombres = preprocesador.get_feature_names_out()

    base = float(np.ravel(clasificador.intercept_)[0])
    lista = []
    for i, nombre in enumerate(nombres):
        bloque, termino = nombre.split("__", 1)
        if bloque == "numericas":
            promedio = float(promedios.get(termino, 0.0))
            base += coef[i] * promedio
            lista.append({"nombre": termino, "tipo": ESTRUCTURAL, "valor": float(x[i]),
                          "contribucion": float(coef[i] * (x[i] - promedio))})
        elif x[i] != 0:
            lista.append({"nombre": termino, "tipo": PALABRA, "valor": float(x[i]),
                          "contribucion": float(coef[i] * x[i])})
    return base, lista


def _es_visible(termino):
    return not (set(termino.split()) & TOKENS_OCULTOS)


def _etiqueta(item, valor_original, promedios):
    if item["tipo"] == PALABRA:
        # Solo términos sueltos: "estimado cliente" sigue como "Menciona «estimado cliente»".
        return ETIQUETAS_ESPECIALES.get(item["nombre"], f"Menciona «{item['nombre']}»")
    frases = ETIQUETAS_ESTRUCTURALES[item["nombre"]]
    if valor_original == 0:
        return frases["cero"]
    return frases["bajo"] if item["valor"] < float(promedios.get(item["nombre"], 0.0)) else frases["alto"]


def explicar(modelo, texto_limpio, n_urls, n_adjuntos, long_cuerpo, n=4, promedios=None):
    """Puntaje, clase y los motivos más fuertes HACIA la clase predicha.

    Motivos visibles: primero las palabras (de mayor a menor peso) y, al final, como
    máximo UN motivo estructural. En total, como mucho n. No se muestran nombretoken,
    numtoken ni emailtoken, ni nada que empuje en contra de la clase predicha.

    Devuelve {"puntaje", "clase", "motivos": [{codigo, termino, contribucion, tipo, etiqueta}]}.
    """
    promedios = promedios or {}
    base, lista = contribuciones(modelo, texto_limpio, n_urls, n_adjuntos, long_cuerpo, promedios)
    puntaje = base + sum(item["contribucion"] for item in lista)
    clase = "phishing" if puntaje > 0 else "legitimo"
    signo = 1 if clase == "phishing" else -1

    a_favor = sorted(
        (item for item in lista if signo * item["contribucion"] > 0 and _es_visible(item["nombre"])),
        key=lambda item: -abs(item["contribucion"]),
    )
    # Entre los n más fuertes, ¿hay alguno estructural? Si sí, va UNO (el más fuerte), al final.
    estructurales = [item for item in a_favor[:n] if item["tipo"] == ESTRUCTURAL]
    final = estructurales[:1]
    palabras = [item for item in a_favor if item["tipo"] == PALABRA][: n - len(final)]

    originales = {"n_urls": n_urls, "n_adjuntos": n_adjuntos, "long_cuerpo": long_cuerpo}
    motivos = []
    for item in palabras + final:
        prefijo = "palabra" if item["tipo"] == PALABRA else "estructura"
        motivos.append({
            "codigo": f"{prefijo}:{item['nombre']}",
            "termino": item["nombre"],
            "contribucion": round(item["contribucion"], 4),
            "tipo": item["tipo"],
            "etiqueta": _etiqueta(item, originales.get(item["nombre"]), promedios),
        })
    return {"puntaje": round(puntaje, 4), "clase": clase, "motivos": motivos}
