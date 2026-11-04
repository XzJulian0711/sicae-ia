"""Usuarios y sesiones de la API (paso 4.3), en el mismo SQLite del registro (sqlite3).

usuarios: id, google_sub (UNIQUE), creado, ultimo_acceso, consentimiento_version,
          consentimiento_fecha.  NUNCA el correo ni el nombre: google_sub es el identificador
          de la cuenta que da Google.
sesiones: hash (SHA-256 del token de sesión), usuario_id, creada, expira.  El token en claro
          NUNCA se guarda: solo lo tiene la extensión. Si alguien copiara la base, no podría
          usar las sesiones.

Los análisis (tabla analisis de registro.py) NO se ligan al usuario.
Las funciones reciben `ahora` (datetime UTC) para poder probar el vencimiento sin esperar.
"""

import hashlib
import secrets
import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

ESQUEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL UNIQUE CHECK (length(google_sub) BETWEEN 1 AND 255),
    creado TEXT NOT NULL,
    ultimo_acceso TEXT NOT NULL,
    consentimiento_version TEXT CHECK (consentimiento_version IS NULL OR length(consentimiento_version) <= 20),
    consentimiento_fecha TEXT
);
CREATE TABLE IF NOT EXISTS sesiones (
    hash TEXT PRIMARY KEY CHECK (length(hash) = 64),
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada TEXT NOT NULL,
    expira TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sesiones_por_usuario ON sesiones (usuario_id);
"""


def ahora_utc():
    return datetime.now(UTC)


def _texto(momento):
    return momento.astimezone(UTC).isoformat(timespec="seconds")


def hash_token(token):
    """SHA-256 del token de sesión, en hexadecimal (64 caracteres). Es lo único que se guarda."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _conectar(ruta):
    conexion = sqlite3.connect(ruta)
    conexion.execute("PRAGMA foreign_keys = ON")  # borrar un usuario borra sus sesiones
    return closing(conexion)


def inicializar(ruta):
    """Crea la carpeta y las tablas si no existen."""
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with _conectar(ruta) as conexion, conexion:
        conexion.executescript(ESQUEMA)


def registrar_acceso(ruta, google_sub, ahora=None):
    """Crea el usuario (si es nuevo) o actualiza su último acceso. Devuelve
    {"id", "consentimiento_version"}."""
    momento = _texto(ahora or ahora_utc())
    with _conectar(ruta) as conexion, conexion:
        conexion.execute(
            "INSERT INTO usuarios (google_sub, creado, ultimo_acceso) VALUES (?, ?, ?) "
            "ON CONFLICT(google_sub) DO UPDATE SET ultimo_acceso = excluded.ultimo_acceso",
            (google_sub, momento, momento),
        )
        fila = conexion.execute(
            "SELECT id, consentimiento_version FROM usuarios WHERE google_sub = ?", (google_sub,)
        ).fetchone()
    return {"id": fila[0], "consentimiento_version": fila[1]}


def crear_sesion(ruta, usuario_id, horas, ahora=None):
    """Crea una sesión de `horas` horas. Devuelve (token, expira).

    El token (secrets.token_urlsafe(32), 43 caracteres) se devuelve UNA vez, para la extensión;
    en la base solo queda su hash. De paso se borran las sesiones vencidas.
    """
    momento = ahora or ahora_utc()
    token = secrets.token_urlsafe(32)
    expira = momento + timedelta(hours=horas)
    with _conectar(ruta) as conexion, conexion:
        conexion.execute("DELETE FROM sesiones WHERE expira <= ?", (_texto(momento),))
        conexion.execute(
            "INSERT INTO sesiones (hash, usuario_id, creada, expira) VALUES (?, ?, ?, ?)",
            (hash_token(token), usuario_id, _texto(momento), _texto(expira)),
        )
    return token, _texto(expira)


def usuario_de_sesion(ruta, token, ahora=None):
    """{"id", "consentimiento_version"} si la sesión existe y no venció; si no, None.
    Una sesión vencida se borra."""
    if not isinstance(token, str) or not token:
        return None
    momento = _texto(ahora or ahora_utc())
    with _conectar(ruta) as conexion, conexion:
        fila = conexion.execute(
            "SELECT s.expira, u.id, u.consentimiento_version FROM sesiones s "
            "JOIN usuarios u ON u.id = s.usuario_id WHERE s.hash = ?",
            (hash_token(token),),
        ).fetchone()
        if fila is None:
            return None
        if fila[0] <= momento:
            conexion.execute("DELETE FROM sesiones WHERE hash = ?", (hash_token(token),))
            return None
    return {"id": fila[1], "consentimiento_version": fila[2]}


def cerrar_sesion(ruta, token):
    """Borra esa sesión (si existe)."""
    with _conectar(ruta) as conexion, conexion:
        conexion.execute("DELETE FROM sesiones WHERE hash = ?", (hash_token(token),))


def guardar_consentimiento(ruta, usuario_id, version, ahora=None):
    """Guarda qué versión del texto de permisos aceptó y cuándo."""
    with _conectar(ruta) as conexion, conexion:
        conexion.execute(
            "UPDATE usuarios SET consentimiento_version = ?, consentimiento_fecha = ? WHERE id = ?",
            (version, _texto(ahora or ahora_utc()), usuario_id),
        )


def borrar_usuario(ruta, usuario_id):
    """Borra el usuario y (por ON DELETE CASCADE) todas sus sesiones."""
    with _conectar(ruta) as conexion, conexion:
        conexion.execute("DELETE FROM usuarios WHERE id = ?", (usuario_id,))
