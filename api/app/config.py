"""Configuración de la API, leída de variables de entorno o del archivo .env.

Cada campo se puede cambiar con una variable SICAE_<NOMBRE EN MAYÚSCULA>, por ejemplo
SICAE_RUTA_MODELO=ml/models/clasificador.joblib. Ver .env.example.
La API no tiene secretos propios: el acceso es con la sesión de Google (paso 4.3).
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

from sicae_ml.calibrar import RUTA_PROMEDIOS, RUTA_UMBRAL
from sicae_ml.train import RUTA_MODELO

# api/data/sicae.db (fuera de Git: *.db está en .gitignore).
RUTA_DB = Path(__file__).resolve().parents[1] / "data" / "sicae.db"


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

    # ---------- Registro (paso 2.3) ----------
    # Base SQLite con una fila por análisis, SIN texto del correo (ver registro.py).
    db_path: Path = RUTA_DB

    # ---------- Inicio de sesión con Google (paso 4.3) ----------
    # Client ID de OAuth de la extensión (Google Cloud). Es PÚBLICO: no es un secreto. Solo se
    # aceptan tokens de Google emitidos para este client ID. Sin él la API no arranca.
    # (Reemplaza a SICAE_API_KEY, que ya no se usa: si sigue en .env, se ignora.)
    google_client_id: str = ""
    # Cuánto dura una sesión de la API antes de pedir una nueva (en horas).
    duracion_sesion_horas: int = 8

    # ---------- Seguridad (paso 2.4) ----------
    # Orígenes del navegador permitidos (CORS), separados por comas.
    # Ej.: chrome-extension://abcdefghijklmnop. Nunca "*".
    cors_origins: str = ""
    # Tamaño máximo de una petición en bytes (más grande = 413).
    max_bytes: int = 200_000
    # ---------- Lote (paso 4.4: pestaña Bandeja) ----------
    # Cuántos correos puede traer POST /analizar/lote y su tamaño máximo en bytes (50 correos no
    # caben en max_bytes; la extensión recorta cada cuerpo para no pasar este tope).
    max_lote: int = 50
    max_bytes_lote: int = 2_000_000
    # Peticiones por minuto por IP (más = 429).
    rate_limit: int = 30
    # "desarrollo" habilita /docs y /redoc; en "produccion" quedan apagados.
    modo: Literal["desarrollo", "produccion"] = "produccion"

    @property
    def origenes_cors(self):
        """SICAE_CORS_ORIGINS como lista: "a, b" -> ["a", "b"] (sin vacíos)."""
        return [origen.strip() for origen in self.cors_origins.split(",") if origen.strip()]


@lru_cache
def obtener_ajustes():
    """Ajustes del proceso (se leen una sola vez)."""
    return Ajustes()
