"""Configuración de la API, leída de variables de entorno o del archivo .env.

Cada campo se puede cambiar con una variable SICAE_<NOMBRE EN MAYÚSCULA>, por ejemplo
SICAE_RUTA_MODELO=ml/models/clasificador.joblib. Ver .env.example.
La API no tiene secretos propios: el acceso es con la sesión de Google (paso 4.3).
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
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

    # ---------- Redacción con IA (paso 6.2: POST /redactar) ----------
    # Proveedor por defecto: Ollama en ESTE equipo (nada sale de la máquina). Solo se acepta
    # http://127.0.0.1:<puerto>; si no, /redactar responde 503 y dice por qué (redaccion.py).
    ia_url: str = "http://127.0.0.1:11434"
    ia_modelo: str = "gemma4:e4b"
    # Cuánto tiempo deja Ollama el modelo cargado después de un borrador ("10m", "1h", "0").
    ia_keep_alive: str = "10m"
    # Tiempo máximo de una respuesta de la IA (s). La primera carga del modelo puede tardar.
    ia_tiempo_max_s: int = Field(default=60, ge=5, le=300)
    # Caracteres del cuerpo del correo que se le pasan a la IA (el resto se recorta).
    ia_max_cuerpo: int = Field(default=4_000, ge=200, le=50_000)
    # Borradores por usuario por hora (más = 429).
    ia_limite_hora: int = Field(default=20, ge=1, le=1_000)
    # Modo demostración (Gemini, capa gratuita): SOLO la cuenta de prueba del proyecto.
    # Sin clave queda desactivado. La clave es SECRETA: solo en .env, nunca en Git ni en logs.
    demo_api_key: SecretStr = SecretStr("")
    demo_modelo: str = "gemini-3.5-flash-lite"
    # google_sub (identificador numérico de Google, NO el correo) de la cuenta de prueba.
    demo_cuenta: str = ""

    @property
    def origenes_cors(self):
        """SICAE_CORS_ORIGINS como lista: "a, b" -> ["a", "b"] (sin vacíos)."""
        return [origen.strip() for origen in self.cors_origins.split(",") if origen.strip()]


@lru_cache
def obtener_ajustes():
    """Ajustes del proceso (se leen una sola vez)."""
    return Ajustes()
