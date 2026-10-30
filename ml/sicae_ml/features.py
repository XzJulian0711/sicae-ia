"""Construcción de las características del modelo (paso 1.4).

Convierte cada correo limpio en números que el clasificador puede usar:
  - "texto"  -> TF-IDF de palabras sueltas y pares de palabras.
  - "n_urls", "n_adjuntos", "long_cuerpo" -> log1p y escala a [0, 1].
"""

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, MinMaxScaler

from sicae_ml.texto import STOPWORDS_EN, STOPWORDS_ES

COLUMNA_TEXTO = "texto"
COLUMNAS_NUMERICAS = ["n_urls", "n_adjuntos", "long_cuerpo"]
COLUMNAS_ENTRADA = [COLUMNA_TEXTO, *COLUMNAS_NUMERICAS]

# Ordenadas para que el modelo guardado sea idéntico en cada ejecución.
STOPWORDS = sorted(STOPWORDS_ES | STOPWORDS_EN)


def construir_preprocesador():
    """ColumnTransformer que une TF-IDF del texto y las 3 columnas numéricas.

    Todas las salidas son >= 0, así que sirve también para MultinomialNB.
    """
    tfidf = TfidfVectorizer(
        stop_words=STOPWORDS,
        ngram_range=(1, 2),  # "darse" y "darse baja": los pares capturan frases típicas
        min_df=2,  # una palabra que sale en un solo correo no generaliza
        sublinear_tf=True,  # 1 + log(tf): repetir 20 veces una palabra no pesa 20 veces más
    )
    numericas = Pipeline(
        [
            # log1p: long_cuerpo va de 30 a 28.630; sin log, los pocos correos larguísimos
            # aplastarían a los demás al escalar. log1p(0) = 0, sirve con ceros.
            ("log", FunctionTransformer(np.log1p, feature_names_out="one-to-one")),
            # clip=True: un correo de prueba más largo o más corto que todos los de
            # entrenamiento queda en 1 o en 0, nunca negativo (Naive Bayes no acepta negativos).
            ("escala", MinMaxScaler(clip=True)),
        ]
    )
    return ColumnTransformer(
        [
            ("texto", tfidf, COLUMNA_TEXTO),
            ("numericas", numericas, COLUMNAS_NUMERICAS),
        ]
    )
