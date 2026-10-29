"""Preprocesamiento de SpaPhish para el modelo (paso 1.3).

Pasos:
  1. Leer ml/data/processed/correos.csv (salida de load_data.py).
  2. Unir asunto + cuerpo y limpiarlos con texto.limpiar_texto().
  3. Calcular la longitud del cuerpo original y el grupo (asunto normalizado),
     que en el paso 1.4 sirve para que una campaña no quede en train y en test.
  4. Guardar ml/data/processed/correos_limpios.csv.
  5. Imprimir cuántos grupos hay y cuántas veces se aplicó cada reemplazo.

La columna date de SpaPhish no se usa (load_data.py ya la descarta).

Uso (desde la raíz del proyecto):
    .venv\\Scripts\\python ml/src/preprocess.py
"""

import re
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

# Permite "python ml/src/preprocess.py" además de "from src.preprocess import ...".
CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.texto import limpiar_texto, limpiar_texto_contando, palabras_minuscula  # noqa: E402

RUTA_ENTRADA = CARPETA_ML / "data" / "processed" / "correos.csv"
RUTA_SALIDA = CARPETA_ML / "data" / "processed" / "correos_limpios.csv"
# Lista de palabras comunes en minúscula (regla de saludos). Se guarda para revisarla y
# para que el API use la misma lista más adelante.
RUTA_PALABRAS_COMUNES = CARPETA_ML / "data" / "processed" / "palabras_minuscula.txt"

COLUMNAS_SALIDA = ["texto", "n_urls", "n_adjuntos", "long_cuerpo", "etiqueta", "grupo"]
GRUPO_SIN_LETRAS = "(sin letras)"

# Prefijos de respuesta o reenvío: "RE: Factura" y "Factura" son la misma conversación.
_PREFIJOS = re.compile(r"^(?:(?:re|rv|fw|fwd|reenviar|resp)\s+)+")
# Todo lo que no sea letra se quita del grupo: números de pedido, emojis, signos.
_NO_LETRAS = re.compile(r"[^a-záéíóúüñ]+")


def normalizar_asunto(asunto, palabras_comunes=frozenset()):
    """Convierte un asunto en una clave de grupo para juntar campañas.

    Limpia el texto (los nombres pasan a "nombretoken"), quita números, signos,
    emojis y prefijos como "RE:" o "RV:". Así "Pablito!! - Tienes un (1) paquete"
    y "Ezequiela!! - Tienes un (2) paquete" quedan en el mismo grupo.

    Si no queda ninguna letra (asunto solo con emojis o números) devuelve
    GRUPO_SIN_LETRAS: un texto vacío se leería como nulo al abrir el CSV.
    """
    texto = _NO_LETRAS.sub(" ", limpiar_texto(asunto, palabras_comunes))
    # "numtoken" son letras, pero viene de un número: como antes, los números no cuentan.
    texto = " ".join(p for p in texto.split() if p != "numtoken")
    return _PREFIJOS.sub("", texto) or GRUPO_SIN_LETRAS


def textos_completos(df):
    """Asunto + cuerpo de cada correo, tal como entran a la limpieza."""
    return [f"{asunto} {cuerpo}" for asunto, cuerpo in zip(df["asunto"], df["cuerpo"])]


def calcular_palabras_comunes(df):
    """Palabras que salen 3 o más veces en minúscula en TODOS los correos (sin etiquetas)."""
    return palabras_minuscula(textos_completos(df))


def preprocesar(df, palabras_comunes=None):
    """Devuelve (df_limpio, conteo_de_reemplazos) a partir de correos.csv.

    palabras_comunes: para la regla de saludos. Si no se da, se calcula con todos los
    correos de df (solo con el texto, sin mirar la etiqueta).
    """
    if palabras_comunes is None:
        palabras_comunes = calcular_palabras_comunes(df)
    conteo = Counter()
    textos = []
    for texto in textos_completos(df):
        limpio, c = limpiar_texto_contando(texto, palabras_comunes)
        textos.append(limpio)
        conteo.update(c)

    limpio = pd.DataFrame(
        {
            "texto": textos,
            "n_urls": df["n_urls"].to_numpy(),
            "n_adjuntos": df["n_adjuntos"].to_numpy(),
            # Longitud del cuerpo ORIGINAL: es la señal que medimos en el paso 1.2.
            "long_cuerpo": df["cuerpo"].fillna("").astype(str).str.len().to_numpy(),
            "etiqueta": df["etiqueta"].to_numpy(),
            "grupo": [normalizar_asunto(a, palabras_comunes) for a in df["asunto"]],
        }
    )
    return limpio[COLUMNAS_SALIDA], conteo


def main():
    correos = pd.read_csv(RUTA_ENTRADA, sep=",", encoding="utf-8-sig")
    print(f"1) Leídos {len(correos)} correos de {RUTA_ENTRADA.name}")

    palabras_comunes = calcular_palabras_comunes(correos)
    RUTA_PALABRAS_COMUNES.write_text("\n".join(sorted(palabras_comunes)) + "\n", encoding="utf-8")
    print(f"   Palabras comunes en minúscula (3+ veces, sin etiquetas): {len(palabras_comunes)}"
          f" -> {RUTA_PALABRAS_COMUNES.name}")

    limpio, conteo = preprocesar(correos, palabras_comunes)

    grupos = limpio["grupo"].nunique()
    print(f"2) Grupos distintos (asunto normalizado): {grupos} de {len(limpio)} correos")
    tamanos = limpio["grupo"].value_counts()
    print(f"   Grupos con más de un correo: {(tamanos > 1).sum()}; el más grande tiene {tamanos.iloc[0]}")

    print("3) Reemplazos aplicados:")
    for clave, veces in sorted(conteo.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"   {clave:<32} {veces:>6}")

    limpio.to_csv(RUTA_SALIDA, sep=",", encoding="utf-8-sig", index=False)
    print(f"4) Guardado en {RUTA_SALIDA}")


if __name__ == "__main__":
    main()
