"""Configuración de la API, leída de variables de entorno o del archivo .env.

Cada campo se puede cambiar con una variable SICAE_<NOMBRE EN MAYÚSCULA>, por ejemplo
SICAE_RUTA_MODELO=ml/models/clasificador.joblib. Ver .env.example.
No hay claves ni tokens aquí: solo rutas y límites de tamaño.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from sicae_ml.calibrar import RUTA_PROMEDIOS, RUTA_UMBRAL
from sicae_ml.train import RUTA_MODELO


class Ajustes(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SICAE_", env_file=".env", extra="ignore")

    # Archivos del modelo v1.0. Por defecto, los del proyecto (ml/models y ml/reports).
    ruta_modelo: Path = RUTA_MODELO
    ruta_umbral: Path = RUTA_UMBRAL
    ruta_promedios: Path = RUTA_PROMEDIOS
    # Configuración de prioridad. Vacío = la de siempre: ml/config/prioridad.local.json si
    # existe, si no ml/config/prioridad.json.
    ruta_config_prioridad: Path | None = None

    # Límites de la entrada: un correo más grande se rechaza con 422.
    max_asunto: int = 1_000
    max_cuerpo: int = 50_000
    max_destinatarios: int = 100
    max_cabeceras: int = 100
    max_valor_cabecera: int = 2_000


@lru_cache
def obtener_ajustes():
    """Ajustes del proceso (se leen una sola vez)."""
    return Ajustes()
