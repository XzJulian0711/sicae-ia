"""Descarga el modelo v1.0 de la Release de GitHub y verifica su SHA-256 (paso 2.5).

Uso (desde la raíz del proyecto):
    python -m sicae_ml.descargar_modelo            # descarga si falta
    python -m sicae_ml.descargar_modelo --forzar   # reemplaza un archivo con otro hash

Qué hace:
  1. Si ml/models/clasificador.joblib ya existe con el hash correcto, no descarga nada.
     Si existe con otro hash, no lo toca (salvo con --forzar).
  2. Descarga solo por HTTPS, con tiempo máximo de espera, a un archivo TEMPORAL en
     ml/models/, calculando el SHA-256 mientras llegan los datos.
  3. Si el hash coincide, renombra el temporal a clasificador.joblib.
     Si no, borra el temporal y termina con error: nunca queda un modelo sin verificar.

Solo usa la librería estándar (urllib.request + hashlib).
"""

import argparse
import hashlib
import hmac
import os
import sys
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

from sicae_ml.integridad import SHA256_MODELO, verificar_sha256
from sicae_ml.train import RUTA_MODELO

URL_MODELO = "https://github.com/XzJulian0711/sicae-ia/releases/download/v1.0-modelo/clasificador.joblib"
TIEMPO_ESPERA = 60  # segundos sin respuesta antes de rendirse
TAMANO_MAXIMO = 50 * 1024 * 1024  # 50 MB; el modelo pesa ~0,7 MB
TAMANO_BLOQUE = 64 * 1024


class ErrorDescarga(Exception):
    """Algo salió mal; el mensaje está en español y listo para mostrar."""


def _es_https(url):
    return str(url).lower().startswith("https://")


def _descargar_a_temporal(url, carpeta):
    """Descarga `url` a un temporal en `carpeta`. Devuelve (ruta_temporal, sha256)."""
    temporal = tempfile.NamedTemporaryFile(dir=carpeta, prefix="clasificador.", suffix=".descarga",
                                           delete=False)
    resumen = hashlib.sha256()
    recibidos = 0
    try:
        with temporal, urlopen(Request(url, headers={"User-Agent": "sicae-ia-descarga"}),
                               timeout=TIEMPO_ESPERA) as respuesta:
            # GitHub redirige la descarga: la dirección final también debe ser HTTPS.
            if not _es_https(respuesta.geturl()):
                raise ErrorDescarga("La descarga fue redirigida a una dirección sin HTTPS: se cancela.")
            while bloque := respuesta.read(TAMANO_BLOQUE):
                recibidos += len(bloque)
                if recibidos > TAMANO_MAXIMO:
                    raise ErrorDescarga("El archivo descargado es demasiado grande: se cancela.")
                resumen.update(bloque)
                temporal.write(bloque)
    except BaseException:
        Path(temporal.name).unlink(missing_ok=True)
        raise
    return Path(temporal.name), resumen.hexdigest()


def descargar(url=URL_MODELO, destino=RUTA_MODELO, esperado=SHA256_MODELO, forzar=False):
    """Deja en `destino` el modelo verificado. Devuelve un mensaje; lanza ErrorDescarga si falla."""
    destino = Path(destino)
    if not _es_https(url):
        raise ErrorDescarga(f"Solo se permite descargar por HTTPS (la dirección es {url}).")

    if destino.exists():
        if verificar_sha256(destino, esperado):
            return f"El modelo ya está en {destino} y su SHA-256 es correcto: no se descarga nada."
        if not forzar:
            raise ErrorDescarga(
                f"Ya existe {destino} pero su SHA-256 no es el esperado. No se sobrescribe.\n"
                "Si quiere reemplazarlo por el de la Release, use:  "
                "python -m sicae_ml.descargar_modelo --forzar"
            )

    destino.parent.mkdir(parents=True, exist_ok=True)
    print(f"Descargando el modelo desde {url} ...")
    try:
        temporal, obtenido = _descargar_a_temporal(url, destino.parent)
    except ErrorDescarga:
        raise
    except TimeoutError:
        raise ErrorDescarga(f"La descarga tardó más de {TIEMPO_ESPERA} s. Revise su conexión.") from None
    except OSError as error:  # incluye URLError y HTTPError
        raise ErrorDescarga(f"No se pudo descargar el modelo ({type(error).__name__}: {error}).") from None

    if not hmac.compare_digest(obtenido, esperado.strip().lower()):
        temporal.unlink(missing_ok=True)
        raise ErrorDescarga(
            "El SHA-256 del archivo descargado no coincide con el esperado: no se guardó nada.\n"
            "Puede ser una descarga dañada o un archivo cambiado en la Release."
        )
    os.replace(temporal, destino)  # cambio de nombre atómico: o queda el archivo entero, o nada
    return f"Modelo descargado y verificado (SHA-256 correcto): {destino}"


def main(argv=None):
    lector = argparse.ArgumentParser(
        prog="python -m sicae_ml.descargar_modelo",
        description="Descarga el modelo v1.0 de la Release y verifica su SHA-256.",
    )
    lector.add_argument("--forzar", action="store_true",
                        help="reemplaza clasificador.joblib aunque exista con otro SHA-256")
    argumentos = lector.parse_args(argv)
    try:
        print(descargar(URL_MODELO, RUTA_MODELO, SHA256_MODELO, forzar=argumentos.forzar))
    except ErrorDescarga as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
