"""Registro de análisis en SQLite (paso 2.3), con sqlite3 de la librería estándar.

Una fila por correo analizado, SOLO con el resultado:
    id, fecha (UTC ISO), categoria, puntaje, confianza, prioridad, version_modelo
NUNCA se guarda el asunto, el cuerpo, el remitente, los destinatarios, las URLs, un hash del
contenido ni los motivos. Las restricciones CHECK de la tabla hacen que la base de datos
rechace cualquier valor distinto de los esperados.

Cada operación abre y cierra su propia conexión: es simple, funciona en los hilos de
FastAPI y, con el modo de diario por defecto (DELETE), no deja archivos -wal con datos.
"""

import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

CATEGORIAS = ("legitimo", "publicidad", "phishing")
PRIORIDADES = ("alta", "media", "baja")

ESQUEMA = """
CREATE TABLE IF NOT EXISTS analisis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    categoria TEXT NOT NULL CHECK (categoria IN ('legitimo', 'publicidad', 'phishing')),
    puntaje REAL NOT NULL,
    confianza TEXT NOT NULL CHECK (confianza IN ('alta', 'dudosa')),
    prioridad TEXT CHECK (prioridad IN ('alta', 'media', 'baja')),
    version_modelo TEXT NOT NULL
)
"""


# Acciones sobre el correo (paso 4.5): SOLO fecha, acción, cantidad y MB. Nunca ids de correo,
# remitentes ni el usuario.
ACCIONES = ("papelera", "deshacer_papelera", "cuarentena", "devolver_cuarentena")
ESQUEMA_ACCIONES = """
CREATE TABLE IF NOT EXISTS acciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    accion TEXT NOT NULL CHECK (accion IN ('papelera', 'deshacer_papelera', 'cuarentena', 'devolver_cuarentena')),
    cantidad INTEGER NOT NULL CHECK (cantidad BETWEEN 0 AND 500),
    mb REAL NOT NULL CHECK (mb >= 0)
)
"""


def _conectar(ruta):
    return closing(sqlite3.connect(ruta))


def inicializar(ruta):
    """Crea la carpeta y la tabla si no existen."""
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with _conectar(ruta) as conexion, conexion:
        conexion.execute(ESQUEMA)
        conexion.execute(ESQUEMA_ACCIONES)


def registrar(ruta, resultado):
    """Guarda UNA fila con el resultado de analizar_correo(). Devuelve el id.

    Solo se leen categoria, puntaje, confianza, prioridad y version; nada más del correo.
    """
    fila = (
        datetime.now(UTC).isoformat(timespec="seconds"),
        resultado["categoria"],
        float(resultado["puntaje"]),
        resultado["confianza"],
        resultado["prioridad"],
        resultado["version"],
    )
    inicializar(ruta)  # por si se borró el archivo con la API andando
    with _conectar(ruta) as conexion, conexion:
        cursor = conexion.execute(
            "INSERT INTO analisis (fecha, categoria, puntaje, confianza, prioridad, version_modelo) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            fila,
        )
        return cursor.lastrowid


def registrar_accion(ruta, accion, cantidad, mb):
    """Guarda UNA fila de una acción del paso 4.5 (papelera, deshacer, cuarentena, devolver).
    Solo fecha, acción, cantidad y MB: nada que identifique correos, remitentes ni usuarios."""
    inicializar(ruta)
    with _conectar(ruta) as conexion, conexion:
        cursor = conexion.execute(
            "INSERT INTO acciones (fecha, accion, cantidad, mb) VALUES (?, ?, ?, ?)",
            (datetime.now(UTC).isoformat(timespec="seconds"), accion, int(cantidad), round(float(mb), 3)),
        )
        return cursor.lastrowid


def estadisticas(ruta):
    """Conteos por categoría y por prioridad (solo números)."""
    inicializar(ruta)
    with _conectar(ruta) as conexion:
        total = conexion.execute("SELECT COUNT(*) FROM analisis").fetchone()[0]
        por_categoria = dict(conexion.execute("SELECT categoria, COUNT(*) FROM analisis GROUP BY categoria"))
        por_prioridad = dict(conexion.execute("SELECT prioridad, COUNT(*) FROM analisis GROUP BY prioridad"))
    return {
        "total": total,
        "por_categoria": {c: por_categoria.get(c, 0) for c in CATEGORIAS},
        "por_prioridad": {
            **{p: por_prioridad.get(p, 0) for p in PRIORIDADES},
            "sin_prioridad": por_prioridad.get(None, 0),  # phishing: va como alerta
        },
    }
