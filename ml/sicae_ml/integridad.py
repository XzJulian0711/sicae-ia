"""Integridad del modelo (paso 2.5): el SHA-256 esperado y cómo verificarlo.

Por qué importa: joblib.load usa pickle, y pickle PUEDE EJECUTAR CÓDIGO al cargar un
archivo. Si clasificador.joblib estuviera dañado o alguien lo cambiara, cargarlo podría
ejecutar cualquier cosa. Por eso se comprueba el SHA-256 ANTES de cargar, nunca después.

SHA256_MODELO es el ÚNICO lugar donde está escrito el hash esperado; el resto del código
(descargar_modelo.py, train.cargar_modelo, la API) lo importa de aquí.
"""

import hashlib
import hmac
from pathlib import Path

# SHA-256 de clasificador.joblib del modelo v1.0, publicado en la Release "v1.0-modelo".
# Si se reentrena, el archivo cambia (ya no es v1.0) y hay que actualizar este valor.
SHA256_MODELO = "92905d608c0f00d852dae614cf968f7e773ae04a820e1df2e9333204d8b81e40"

TAMANO_BLOQUE = 1024 * 1024  # se lee de a 1 MB para no cargar archivos grandes en memoria


class ModeloAlterado(Exception):
    """El archivo del modelo no tiene el SHA-256 esperado: no se debe cargar."""

    def __init__(self, ruta):
        super().__init__(
            f"{Path(ruta).name} no tiene el SHA-256 esperado: puede estar dañado o modificado, "
            "así que no se carga. Descárguelo de nuevo con:\n"
            "    python -m sicae_ml.descargar_modelo --forzar"
        )


def calcular_sha256(ruta):
    """SHA-256 de un archivo, en hexadecimal (64 caracteres)."""
    resumen = hashlib.sha256()
    with open(ruta, "rb") as archivo:
        while bloque := archivo.read(TAMANO_BLOQUE):
            resumen.update(bloque)
    return resumen.hexdigest()


def verificar_sha256(ruta, esperado):
    """True si el archivo existe y su SHA-256 es `esperado` (sin importar mayúsculas)."""
    if not Path(ruta).is_file():
        return False
    return hmac.compare_digest(calcular_sha256(ruta), esperado.strip().lower())
