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

from src.texto import limpiar_texto, limpiar_texto_contando  # noqa: E402

RUTA_ENTRADA = CARPETA_ML / "data" / "processed" / "correos.csv"
RUTA_SALIDA = CARPETA_ML / "data" / "processed" / "correos_limpios.csv"

COLUMNAS_SALIDA = ["texto", "n_urls", "n_adjuntos", "long_cuerpo", "etiqueta", "grupo"]

# Prefijos de respuesta o reenvío: "RE: Factura" y "Factura" son la misma conversación.
_PREFIJOS = re.compile(r"^(?:(?:re|rv|fw|fwd|reenviar|resp)\s+)+")
# Todo lo que no sea letra se quita del grupo: números de pedido, emojis, signos.
_NO_LETRAS = re.compile(r"[^a-záéíóúüñ]+")


def normalizar_asunto(asunto):
    """Convierte un asunto en una clave de grupo para juntar campañas.

    Limpia el texto (los nombres pasan a "nombretoken"), quita números, signos,
    emojis y prefijos como "RE:" o "RV:". Así "Pablito!! - Tienes un (1) paquete"
    y "Ezequiela!! - Tienes un (2) paquete" quedan en el mismo grupo.
    """
    texto = _NO_LETRAS.sub(" ", limpiar_texto(asunto))
    texto = " ".join(texto.split())
    return _PREFIJOS.sub("", texto)


def preprocesar(df):
    """Devuelve (df_limpio, conteo_de_reemplazos) a partir de correos.csv."""
    conteo = Counter()
    textos = []
    for asunto, cuerpo in zip(df["asunto"], df["cuerpo"]):
        limpio, c = limpiar_texto_contando(f"{asunto} {cuerpo}")
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
            "grupo": [normalizar_asunto(a) for a in df["asunto"]],
        }
    )
    return limpio[COLUMNAS_SALIDA], conteo


def main():
    correos = pd.read_csv(RUTA_ENTRADA, sep=",", encoding="utf-8-sig")
    print(f"1) Leídos {len(correos)} correos de {RUTA_ENTRADA.name}")

    limpio, conteo = preprocesar(correos)

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
